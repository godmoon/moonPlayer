// 音频播放器组件
import { useRef, useEffect, useCallback, useState } from 'react';
import AudioPlayer from 'react-h5-audio-player';
import 'react-h5-audio-player/lib/styles.css';
import { usePlayerStore } from '../stores/playerStore';
import { getStreamUrl, recordPlay, deleteTrack, updatePlaylist, recordHistory } from '../stores/api';
import { getDuration } from '../stores/api';
import { AddToPlaylistModal } from './AddToPlaylistModal';

// 全局待恢复播放位置（使用模块级变量，避免 ref 在组件重渲染时的问题）
let globalPendingSeekPosition: number | null = null;
let globalPendingSeekTrackId: number | null = null; // 关联的音轨 ID

// 设置待恢复播放位置（供外部调用）
export function setPendingSeekPosition(position: number, trackId?: number) {
  globalPendingSeekPosition = position;
  globalPendingSeekTrackId = trackId ?? null;
  console.log('[AudioPlayer] 设置待恢复位置:', position, 'trackId:', trackId);
}

// 获取并清除待恢复播放位置
// 如果 currentTrackId 为 0，跳过 trackId 检查
function consumePendingSeekPosition(currentTrackId: number): number | null {
  // 如果 currentTrackId 为 0，跳过检查（用于事件处理时不知道当前 trackId 的情况）
  if (currentTrackId !== 0 && globalPendingSeekTrackId !== null && globalPendingSeekTrackId !== currentTrackId) {
    // trackId 不匹配，但仍然返回位置（因为可能是正常的切换）
    // 这种情况下不清除位置，让后续的调用处理
    console.log('[AudioPlayer] trackId 不匹配，跳过恢复:', 'expected:', globalPendingSeekTrackId, 'actual:', currentTrackId);
    return null;
  }
  const pos = globalPendingSeekPosition;
  globalPendingSeekPosition = null;
  globalPendingSeekTrackId = null;
  console.log('[AudioPlayer] 消费待恢复位置:', pos);
  return pos;
}

type PlayMode = 'sequential' | 'shuffle' | 'weighted' | 'random' | 'single-loop';

const PLAY_MODES: PlayMode[] = ['sequential', 'shuffle', 'weighted', 'random', 'single-loop'];
const PLAY_MODE_LABELS: Record<PlayMode, { icon: string; label: string }> = {
  sequential: { icon: '➡️', label: '顺序播放' },
  shuffle: { icon: '🔀', label: '随机播放' },
  weighted: { icon: '⚖️', label: '权重随机' },
  random: { icon: '🎲', label: '乱序播放' },
  'single-loop': { icon: '🔁', label: '单曲循环' }
};

const SKIP_AMOUNTS = [5, 10, 30, 60, 120];

export function PlayerBar() {
  const {
    currentTrack,
    isPlaying,
    playMode,
    volume,
    currentPlaylist,
    setIsPlaying,
    setDuration,
    setPlayMode,
    playNext,
    playPrevious,
    deleteAndPlayNext,
    updateTrackRating: updateRating
  } = usePlayerStore();

  const playerRef = useRef<any>(null);
  const playStartedRef = useRef<number>(0);
  const lastHistoryRecordRef = useRef<number>(0); // 上次记录历史的时间
  const [skipAmounts, setSkipAmounts] = useState({ forward: 5, backward: 5 });
  const [showAddModal, setShowAddModal] = useState(false);

  // 更新音量
  useEffect(() => {
    if (playerRef.current?.audio?.current) {
      playerRef.current.audio.current.volume = volume / 100;
    }
  }, [volume]);

  // 获取流媒体 URL
  const streamUrl = currentTrack ? 
    (currentTrack.path.startsWith('webdav://') ? 
      (() => {
        const match = currentTrack.path.match(/^webdav:\/\/(\d+)(.+)$/);
        if (match) {
          return `/api/webdav/${match[1]}/stream?path=${encodeURIComponent(match[2])}`;
        }
        return null;
      })() : 
      getStreamUrl(currentTrack.id)) 
    : null;

  // 播放状态同步（当 streamUrl 变化时也需要检查，因为切歌后音频元素会重置为 paused）
  useEffect(() => {
    if (!playerRef.current?.audio?.current || !streamUrl) return;

    const audio = playerRef.current.audio.current;
    if (isPlaying && audio.paused) {
      audio.play().catch(() => {});
    } else if (!isPlaying && !audio.paused) {
      audio.pause();
    }
  }, [isPlaying, streamUrl, currentTrack?.id]);

  // 定期记录播放位置（每5秒）
  useEffect(() => {
    if (!currentTrack || !currentPlaylist || !isPlaying) return;

    const interval = setInterval(() => {
      if (playerRef.current?.audio?.current) {
        const position = playerRef.current.audio.current.currentTime;
        const now = Date.now();
        // 每5秒记录一次
        if (now - lastHistoryRecordRef.current >= 5000) {
          recordHistory(currentPlaylist.id, currentTrack.id, position).catch(() => {});
          lastHistoryRecordRef.current = now;
        }
      }
    }, 1000); // 每秒检查一次

    return () => clearInterval(interval);
  }, [currentTrack, currentPlaylist, isPlaying]);

  // 离开页面时记录播放位置
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (currentTrack && currentPlaylist && playerRef.current?.audio?.current) {
        const position = playerRef.current.audio.current.currentTime;
        // 使用 sync 方式发送（虽然不可靠，但总比不发送好）
        const data = JSON.stringify({
          playlistId: currentPlaylist.id,
          trackId: currentTrack.id,
          position
        });
        // 尝试使用 sendBeacon
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/history', new Blob([data], { type: 'application/json' }));
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [currentTrack, currentPlaylist]);

  // 播放事件处理
  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    playStartedRef.current = Date.now();
  // 开始播放时记录历史位置
    if (currentTrack && currentPlaylist && playerRef.current?.audio?.current) {
      const position = playerRef.current.audio.current.currentTime || 0;
      recordHistory(currentPlaylist.id, currentTrack.id, position).catch(() => {});
      lastHistoryRecordRef.current = Date.now();
    }
  }, [setIsPlaying, currentTrack, currentPlaylist]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    // 记录播放位置到历史
    if (currentTrack && currentPlaylist && playerRef.current?.audio?.current) {
      const position = playerRef.current.audio.current.currentTime;
      recordHistory(currentPlaylist.id, currentTrack.id, position).catch(() => {});
    }
  }, [setIsPlaying, currentTrack, currentPlaylist]);

  const handleEnded = useCallback(async () => {
    if (currentTrack) {
      await recordPlay(currentTrack.id, true, 0);
      await updateRating(currentTrack.id, 1);
      // 记录播放完成（位置为0，表示已播完）
      if (currentPlaylist) {
        await recordHistory(currentPlaylist.id, currentTrack.id, 0).catch(() => {});
      }
    }
    // 切歌后继续播放
    setIsPlaying(true);
    playNext();
  }, [currentTrack, currentPlaylist, playNext, updateRating, setIsPlaying]);

  const handleLoadedMetadata = useCallback((e: any) => {
    const audio = e.currentTarget;
    const duration = audio.duration;
    console.log('[AudioPlayer] handleLoadedMetadata 触发, duration:', duration, 'readyState:', audio.readyState);

    // 从全局变量获取待恢复的播放位置
    // 不依赖 currentTrack，因为事件触发时 currentTrack 可能还没更新
    const pendingPos = consumePendingSeekPosition(0); // 0 表示跳过 trackId 检查
    console.log('[AudioPlayer] handleLoadedMetadata 获取到的位置:', pendingPos);

    // 如果 duration 是 Infinity 或 NaN（转码流可能出现），需要从服务器获取
    if (!isFinite(duration) || duration === 0) {
      // 异步获取时长
      if (currentTrack) {
        getDuration(currentTrack.id).then((d) => {
          if (d && isFinite(d)) {
            setDuration(d);
            // 恢复播放位置（优先级高于片头跳过）
            const asyncPendingPos = consumePendingSeekPosition(0);
            console.log('[AudioPlayer] 异步获取时长后获取到的位置:', asyncPendingPos);
            if (asyncPendingPos && asyncPendingPos > 0 && asyncPendingPos < d - 0.5) {
              console.log('[AudioPlayer] 恢复位置到:', asyncPendingPos);
              audio.currentTime = asyncPendingPos;
            } else {
              // 片头跳过
              const skipIntro = usePlayerStore.getState().currentPlaylist?.skipIntro || 0;
              if (skipIntro > 0 && audio.currentTime < skipIntro) {
                audio.currentTime = skipIntro;
              }
            }
          }
        }).catch(() => {});
      }
    } else {
      setDuration(duration);

      // 恢复播放位置（如果有待恢复的位置，优先级高于片头跳过）
      // 注意：如果位置等于或接近时长，从头开始播放
      // 使用 setTimeout 确保在 react-h5-audio-player 内部逻辑之后执行
      if (pendingPos && pendingPos > 0 && pendingPos < duration - 0.5) {
        console.log('[AudioPlayer] 准备恢复位置到:', pendingPos);
        // 延迟设置，确保在播放器内部逻辑之后执行
        setTimeout(() => {
          console.log('[AudioPlayer] 延迟恢复位置到:', pendingPos, '当前时间:', audio.currentTime);
          audio.currentTime = pendingPos;
          console.log('[AudioPlayer] 设置后当前时间:', audio.currentTime);
        }, 100);
      } else {
        console.log('[AudioPlayer] 不恢复位置，pendingPos:', pendingPos, 'duration:', duration);
        // 片头跳过（如果当前播放列表有设置）
        const skipIntro = usePlayerStore.getState().currentPlaylist?.skipIntro || 0;
        if (skipIntro > 0 && audio.currentTime < skipIntro) {
          audio.currentTime = skipIntro;
        }
      }
    }
  }, [setDuration, currentTrack]);

  // 当音频可以播放时也尝试恢复位置（备用方案）
  const handleCanPlay = useCallback((e: any) => {
    const audio = e.currentTarget;
    console.log('[AudioPlayer] handleCanPlay 触发');
    
    // 如果有待恢复的位置，尝试跳转
    const pendingPos = consumePendingSeekPosition(0);
    console.log('[AudioPlayer] handleCanPlay 获取到的位置:', pendingPos);
    if (pendingPos && pendingPos > 0 && pendingPos < audio.duration - 0.5) {
      console.log('[AudioPlayer] handleCanPlay 恢复位置到:', pendingPos);
      audio.currentTime = pendingPos;
    }
  }, []);

  // 快切评分逻辑
  const handlePreviousOrNext = useCallback(async (direction: 'prev' | 'next') => {
    if (!currentTrack || !playerRef.current?.audio?.current) {
      if (direction === 'next') playNext();
      else playPrevious();
      return;
    }

    const audio = playerRef.current.audio.current;
    const currentTime = audio.currentTime;
    const duration = audio.duration || 1;
    const progress = currentTime / duration;

    // 单曲循环模式：上一曲/下一曲都回到开始重新播放
    if (playMode === 'single-loop') {
      audio.currentTime = 0;
      audio.play();
      return;
    }

    if (direction === 'next') {
      await recordPlay(currentTrack.id, false, currentTime);

      // 记录播放位置到历史
      if (currentPlaylist) {
        await recordHistory(currentPlaylist.id, currentTrack.id, currentTime).catch(() => {});
      }

      // 快切扣分（3%-10%）
      if (progress > 0.03 && progress < 0.1) {
        await updateRating(currentTrack.id, -1);
      }

      playNext();
    } else {
      playPrevious();
    }
  }, [currentTrack, playMode, playNext, playPrevious, updateRating]);

  // Media Session API 支持（硬件快捷键）
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;

    const { mediaSession } = navigator;

    // 更新元数据
    mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist || '未知艺术家',
      album: currentTrack.album,
    });

    // 设置播放状态
    mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

    // 处理媒体按键
    const handlers: { [key in MediaSessionAction]?: MediaSessionActionHandler } = {
      play: () => {
        setIsPlaying(true);
        playerRef.current?.audio?.current?.play();
      },
      pause: () => {
        setIsPlaying(false);
        playerRef.current?.audio?.current?.pause();
      },
      previoustrack: () => handlePreviousOrNext('prev'),
      nexttrack: () => handlePreviousOrNext('next'),
      seekbackward: () => {
        if (playerRef.current?.audio?.current) {
          playerRef.current.audio.current.currentTime -= 10;
        }
      },
      seekforward: () => {
        if (playerRef.current?.audio?.current) {
          playerRef.current.audio.current.currentTime += 10;
        }
      },
    };

    Object.entries(handlers).forEach(([action, handler]) => {
      try {
        mediaSession.setActionHandler(action as MediaSessionAction, handler!);
      } catch {}
    });

    return () => {
      try {
        mediaSession.setActionHandler('play', null);
        mediaSession.setActionHandler('pause', null);
        mediaSession.setActionHandler('previoustrack', null);
        mediaSession.setActionHandler('nexttrack', null);
        mediaSession.setActionHandler('seekbackward', null);
        mediaSession.setActionHandler('seekforward', null);
      } catch {}
    };
  }, [currentTrack, isPlaying, handlePreviousOrNext, setIsPlaying]);

  // 跳转功能
  const handleSkipForward = useCallback(() => {
    if (!playerRef.current?.audio?.current) return;
    const audio = playerRef.current.audio.current;
    audio.currentTime = Math.min(audio.currentTime + skipAmounts.forward, audio.duration || 0);
    
    const currentIndex = SKIP_AMOUNTS.indexOf(skipAmounts.forward);
    const nextAmount = currentIndex < SKIP_AMOUNTS.length - 1 ? SKIP_AMOUNTS[currentIndex + 1] : 120;
    setSkipAmounts(prev => ({ ...prev, forward: nextAmount }));
    
    // 3秒后恢复默认
    setTimeout(() => {
      setSkipAmounts(prev => ({ ...prev, forward: 5 }));
    }, 3000);
  }, [skipAmounts.forward]);

  const handleSkipBackward = useCallback(() => {
    if (!playerRef.current?.audio?.current) return;
    const audio = playerRef.current.audio.current;
    audio.currentTime = Math.max(audio.currentTime - skipAmounts.backward, 0);
    
    const currentIndex = SKIP_AMOUNTS.indexOf(skipAmounts.backward);
    const nextAmount = currentIndex < SKIP_AMOUNTS.length - 1 ? SKIP_AMOUNTS[currentIndex + 1] : 120;
    setSkipAmounts(prev => ({ ...prev, backward: nextAmount }));
    
    // 3秒后恢复默认
    setTimeout(() => {
      setSkipAmounts(prev => ({ ...prev, backward: 5 }));
    }, 3000);
  }, [skipAmounts.backward]);

  // 删除并播放下一曲
  const handleDeleteAndNext = useCallback(async () => {
    if (!currentTrack) return;
    await deleteTrack(currentTrack.id);
    deleteAndPlayNext();
  }, [currentTrack, deleteAndPlayNext]);

  // 添加到"我喜欢的歌"
  const handleAddToFavorites = useCallback(() => {
    setShowAddModal(true);
  }, []);

  // 切换播放模式
  const handleTogglePlayMode = useCallback(async () => {
    const currentIndex = PLAY_MODES.indexOf(playMode);
    const nextIndex = (currentIndex + 1) % PLAY_MODES.length;
    const nextMode = PLAY_MODES[nextIndex];
    
    setPlayMode(nextMode);
    
    // 保存到播放列表属性
    if (currentPlaylist && currentPlaylist.id > 0) {
      try {
        await updatePlaylist(currentPlaylist.id, { playMode: nextMode });
      } catch (err) {
        console.error('保存播放模式失败:', err);
      }
    }
  }, [playMode, currentPlaylist, setPlayMode]);

  // 播放模式图标
  const playModeIcon = PLAY_MODE_LABELS[playMode].icon;
  const playModeLabel = PLAY_MODE_LABELS[playMode].label;

  if (!currentTrack) {
    return (
      <div className="h-28 md:h-24 bg-gray-900 border-t border-gray-800 flex items-center justify-center text-gray-500">
        请选择音乐播放
      </div>
    );
  }

  return (
    <div className="h-28 md:h-24 bg-gray-900 border-t border-gray-800 px-2 md:px-4">
      {/* 移动端布局 (竖屏): 两行显示 */}
      <div className="md:hidden h-full flex flex-col justify-center py-1">
        {/* 第一行: 曲目信息 + 控制按钮 */}
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex-1 min-w-0">
            <div className="text-white font-medium truncate text-sm">{currentTrack.title}</div>
            <div className="text-gray-400 text-xs truncate">{currentTrack.artist || '未知艺术家'}</div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={handleSkipBackward} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs">⏪{skipAmounts.backward}s</button>
            <button onClick={handleSkipForward} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs">{skipAmounts.forward}s⏩</button>
            <button onClick={handleDeleteAndNext} className="px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-xs">🗑️</button>
            <button onClick={handleAddToFavorites} className="px-2 py-1 bg-purple-700 hover:bg-purple-600 rounded text-xs">❤️</button>
          </div>
        </div>

        {/* 第二行: 播放器 */}
        <div className="flex-1 min-h-0">
          <style>{`
            .rhap_loop-button { display: none !important; }
            .rhap_main { flex-direction: column !important; }
            .rhap_controls-section { margin-top: -4px !important; }
          `}</style>
          <AudioPlayer
            ref={playerRef}
            src={streamUrl || undefined}
            showSkipControls
            showJumpControls={false}
            onClickPrevious={() => handlePreviousOrNext('prev')}
            onClickNext={() => handlePreviousOrNext('next')}
            onPlay={handlePlay}
            onPause={handlePause}
            onEnded={handleEnded}
            onLoadedMetaData={handleLoadedMetadata}
            onCanPlay={handleCanPlay}
            volume={volume / 100}
            layout="stacked"
            style={{ backgroundColor: 'transparent', boxShadow: 'none' }}
          />
        </div>

        {/* 第三行: 播放模式 + 评分 */}
        <div className="flex items-center gap-2 text-xs">
          <button onClick={handleTogglePlayMode} className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded" title={playModeLabel}>
            {playModeIcon} {playModeLabel}
          </button>
          <span className="text-gray-500">评分: {currentTrack.rating}</span>
          <button onClick={() => updateRating(currentTrack.id, 1)} className="text-green-500 hover:text-green-400">👍</button>
          <button onClick={() => updateRating(currentTrack.id, -1)} className="text-red-500 hover:text-red-400">👎</button>
        </div>
      </div>

      {/* 桌面端布局 (横屏): 原有单行布局 */}
      <div className="hidden md:flex h-full items-center gap-4">
        {/* 曲目信息 */}
        <div className="flex-shrink-0 w-64">
          <div className="text-white font-medium truncate">{currentTrack.title}</div>
          <div className="text-gray-400 text-sm truncate">{currentTrack.artist || '未知艺术家'}</div>
          <div className="flex items-center gap-2 mt-1">
            <button onClick={handleTogglePlayMode} className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-sm" title={playModeLabel}>
              {playModeIcon} {playModeLabel}
            </button>
            <span className="text-gray-500 text-sm">评分: {currentTrack.rating}</span>
            <button onClick={() => updateRating(currentTrack.id, 1)} className="text-green-500 hover:text-green-400">👍</button>
            <button onClick={() => updateRating(currentTrack.id, -1)} className="text-red-500 hover:text-red-400">👎</button>
          </div>
        </div>

        {/* 播放器 */}
        <div className="flex-1">
          <style>{`
            .rhap_loop-button { display: none !important; }
          `}</style>
          <AudioPlayer
            ref={playerRef}
            src={streamUrl || undefined}
            showSkipControls
            showJumpControls={false}
            onClickPrevious={() => handlePreviousOrNext('prev')}
            onClickNext={() => handlePreviousOrNext('next')}
            onPlay={handlePlay}
            onPause={handlePause}
            onEnded={handleEnded}
            onLoadedMetaData={handleLoadedMetadata}
            onCanPlay={handleCanPlay}
            volume={volume / 100}
            style={{ backgroundColor: 'transparent', boxShadow: 'none' }}
          />
        </div>

        {/* 控制按钮 */}
        <div className="flex-shrink-0 flex items-center gap-2">
          <button onClick={handleSkipBackward} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm" title={`后退 ${skipAmounts.backward}秒`}>⏪ {skipAmounts.backward}s</button>
          <button onClick={handleSkipForward} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm" title={`前进 ${skipAmounts.forward}秒`}>{skipAmounts.forward}s ⏩</button>
          <button onClick={handleDeleteAndNext} className="px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-sm" title="删除并播放下一曲">🗑️ 删除</button>
          <button onClick={handleAddToFavorites} className="px-2 py-1 bg-purple-700 hover:bg-purple-600 rounded text-sm" title="添加到我喜欢的歌">❤️</button>
        </div>
      </div>

      {/* 添加到播放列表弹窗 */}
      {showAddModal && currentTrack && (
        <AddToPlaylistModal trackPath={currentTrack.path} onClose={() => setShowAddModal(false)} />
      )}
    </div>
  );
}