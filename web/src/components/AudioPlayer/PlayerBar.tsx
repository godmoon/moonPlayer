// 音频播放器组件
import { useRef, useEffect, useCallback, useState } from 'react';
import AudioPlayer from 'react-h5-audio-player';
import 'react-h5-audio-player/lib/styles.css';
import { usePlayerStore } from '../../stores/playerStore';
import { getStreamUrl, recordPlay, deleteTrack, updatePlaylist, recordHistory } from '../../stores/api';
import { getDuration } from '../../stores/api';
import { AddToPlaylistModal } from '../AddToPlaylistModal';
import { SleepTimerModal } from './SleepTimerModal';
import { PLAY_MODES, PLAY_MODE_LABELS, SKIP_AMOUNTS, setPendingSeekPosition, consumePendingSeekPosition, getLockedPosition, clearLockedPosition, formatTrackTitle } from './utils';
import type { PlayMode } from './utils';

// 导出设置待恢复位置的函数
export { setPendingSeekPosition };

export function PlayerBar() {
  const {
    currentTrack,
    isPlaying,
    playMode,
    volume,
    currentPlaylist,
    sleepTimer,
    setIsPlaying,
    setDuration,
    setPlayMode,
    playNext,
    playPrevious,
    deleteAndPlayNext,
    updateTrackRating: updateRating,
    tickSleepTimer
  } = usePlayerStore();

  const playerRef = useRef<any>(null);
  const playStartedRef = useRef<number>(0);
  const lastHistoryRecordRef = useRef<number>(0);
  const [skipAmounts, setSkipAmounts] = useState({ forward: 5, backward: 5 });
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSleepModal, setShowSleepModal] = useState(false);

  const getAudio = useCallback(() => {
    return playerRef.current?.audio?.current;
  }, []);

  // 更新页面标题为当前播放歌曲
  useEffect(() => {
    if (currentTrack) {
      document.title = `${formatTrackTitle(currentTrack)} - moonPlayer`;
    } else {
      document.title = 'moonPlayer';
    }
  }, [currentTrack]);

  // 更新音量
  useEffect(() => {
    const audio = getAudio();
    if (audio) audio.volume = volume / 100;
  }, [volume, getAudio]);

  // 睡眠定时器检查
  useEffect(() => {
    if (sleepTimer.mode === 'off') return;
    
    const interval = setInterval(() => {
      tickSleepTimer();
    }, 10000);
    
    return () => clearInterval(interval);
  }, [sleepTimer.mode, tickSleepTimer]);

  // 流媒体地址
  const streamUrl = currentTrack ? 
    (currentTrack.path.startsWith('webdav://') ? 
      (() => {
        const match = currentTrack.path.match(/^webdav:\/\/(\d+)(.+)$/);
        if (match) return `/api/webdav/${match[1]}/stream?path=${encodeURIComponent(match[2])}`;
        return null;
      })() : getStreamUrl(currentTrack.id)) 
    : null;

  // 播放状态同步
  useEffect(() => {
    const audio = getAudio();
    if (!audio || !streamUrl) return;
    if (isPlaying && audio.paused) audio.play().catch(() => {});
    else if (!isPlaying && !audio.paused) audio.pause();
  }, [isPlaying, streamUrl, currentTrack?.id, getAudio]);

  // 当新曲目加载完成后，如果应该播放则自动播放
  const handleCanPlay = useCallback(() => {
    const audio = getAudio();
    if (isPlaying && audio && audio.paused) {
      audio.play().catch(() => {});
    }
  }, [isPlaying, getAudio]);
  
  // 定期记录播放位置
  useEffect(() => {
    if (!isPlaying || !currentTrack || !currentPlaylist) return;
    const LOCK_PLAYLIST_ID = currentPlaylist.id;
    const LOCK_TRACK_ID = currentTrack.id;

    const interval = setInterval(() => {
      const audio = getAudio();
      if (!audio) return;

      const nowState = usePlayerStore.getState();
      if (nowState.currentPlaylist?.id !== LOCK_PLAYLIST_ID ||
          nowState.currentTrack?.id !== LOCK_TRACK_ID) return;

      const now = Date.now();
      if (now - lastHistoryRecordRef.current < 20000) return;

      const realPos = audio.currentTime;
      const duration = audio.duration || 0;
      const isValid = realPos > 1.0 && duration > 0 && realPos < duration;
      if (!isValid) return;

      recordHistory(LOCK_PLAYLIST_ID, LOCK_TRACK_ID, realPos).catch(() => {});
      usePlayerStore.getState().refreshTrackHistoryPosition(LOCK_TRACK_ID, LOCK_PLAYLIST_ID, realPos);
      lastHistoryRecordRef.current = now;
    }, 1000);

    return () => clearInterval(interval);
  }, [currentTrack, currentPlaylist, isPlaying, getAudio]);

  // 关闭页面记录位置
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (currentTrack && currentPlaylist) {
        const audio = getAudio();
        if (audio && audio.currentTime > 1) {
          const data = JSON.stringify({
            playlistId: currentPlaylist.id, trackId: currentTrack.id, position: audio.currentTime
          });
          navigator.sendBeacon?.('/api/history', new Blob([data], { type: 'application/json' }));
        }
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [currentTrack, currentPlaylist, getAudio]);

  // 播放
  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    playStartedRef.current = Date.now();
    const audio = getAudio();

    if (audio && getLockedPosition() !== null) {
      audio.currentTime = getLockedPosition()!;
      clearLockedPosition();
    }

    if (currentTrack && currentPlaylist && audio && audio.currentTime > 1) {
      recordHistory(currentPlaylist.id, currentTrack.id, audio.currentTime).catch(() => {});
      lastHistoryRecordRef.current = Date.now();
    }
  }, [setIsPlaying, currentTrack, currentPlaylist, getAudio]);

  // 暂停
  const handlePause = useCallback(() => {
    setIsPlaying(false);
    if (currentTrack && currentPlaylist) {
      const audio = getAudio();
      if (audio && audio.currentTime > 1) {
        recordHistory(currentPlaylist.id, currentTrack.id, audio.currentTime).catch(() => {});
      }
    }
  }, [setIsPlaying, currentTrack, currentPlaylist, getAudio]);

  // 播放结束
  const handleEnded = useCallback(async () => {
    if (currentTrack) {
      await recordPlay(currentTrack.id, true, 0);
      await updateRating(currentTrack.id, 1);
    }
    playNext();
    // 切换曲目后设置播放状态，useEffect 会触发 audio.play()
    setIsPlaying(true);
  }, [currentTrack, playNext, updateRating, setIsPlaying]);

  // 元数据加载
  const handleLoadedMetadata = useCallback((e: any) => {
    const audio = e.currentTarget;
    const duration = audio.duration;
    const pendingPos = consumePendingSeekPosition();

    if (pendingPos === null) return;

    const safeSeek = (pos: number) => {
      if (!audio || !isFinite(duration)) return;
      if (pos <= 0 || pos >= duration - 0.5) return;
      try {
        audio.currentTime = pos;
        const start = Date.now();
        const lock = () => {
          if (Date.now() - start < 200) {
            audio.currentTime = pos;
            requestAnimationFrame(lock);
          }
        };
        lock();
      } catch {}
    };

    if (!isFinite(duration) || duration === 0) {
      currentTrack && getDuration(currentTrack.id).then(d => {
        if (d && isFinite(d)) { setDuration(d); safeSeek(pendingPos); }
      });
      return;
    }

    setDuration(duration);
    safeSeek(pendingPos);
  }, [setDuration, currentTrack]);

  // 上一曲/下一曲
  const handlePreviousOrNext = useCallback(async (direction: 'prev' | 'next') => {
    const audio = getAudio();
    if (!currentTrack) { direction === 'next' ? playNext() : playPrevious(); return; }

    if (playMode === 'single-loop' && audio) {
      audio.currentTime = 0; audio.play(); return;
    }

    if (direction === 'next') {
      if (audio) {
        const currentTime = audio.currentTime;
        await recordPlay(currentTrack.id, false, currentTime);
        currentPlaylist && recordHistory(currentPlaylist.id, currentTrack.id, currentTime).catch(() => {});
        const progress = currentTime / (audio.duration || 1);
        if (progress > 0.03 && progress < 0.1) await updateRating(currentTrack.id, -1);
      }
      playNext();
    } else {
      playPrevious();
    }
  }, [currentTrack, playMode, playNext, playPrevious, updateRating, currentPlaylist, getAudio]);

  // 媒体快捷键
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({
      title: currentTrack.title, artist: currentTrack.artist || '未知', album: currentTrack.album
    });
    ms.playbackState = isPlaying ? 'playing' : 'paused';

    const handlers = {
      play: () => { setIsPlaying(true); getAudio()?.play(); },
      pause: () => { setIsPlaying(false); getAudio()?.pause(); },
      previoustrack: () => handlePreviousOrNext('prev'),
      nexttrack: () => handlePreviousOrNext('next'),
      seekbackward: () => { const a = getAudio(); a && (a.currentTime -= 10); },
      seekforward: () => { const a = getAudio(); a && (a.currentTime += 10); }
    };

    Object.entries(handlers).forEach(([k, f]) => {
      try { ms.setActionHandler(k as any, f); } catch {}
    });
    return () => {
      ['play','pause','previoustrack','nexttrack','seekbackward','seekforward'].forEach(a => {
        try { ms.setActionHandler(a as any, null); } catch {}
      });
    };
  }, [currentTrack, isPlaying, handlePreviousOrNext, setIsPlaying, getAudio]);

  // 快进快退
  const handleSkipForward = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;
    audio.currentTime = Math.min(audio.currentTime + skipAmounts.forward, audio.duration || 0);
    const i = SKIP_AMOUNTS.indexOf(skipAmounts.forward);
    setSkipAmounts(p => ({ ...p, forward: i < SKIP_AMOUNTS.length-1 ? SKIP_AMOUNTS[i+1] : 120 }));
    setTimeout(() => setSkipAmounts(p => ({ ...p, forward: 5 })), 3000);
  }, [skipAmounts.forward, getAudio]);

  const handleSkipBackward = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;
    audio.currentTime = Math.max(audio.currentTime - skipAmounts.backward, 0);
    const i = SKIP_AMOUNTS.indexOf(skipAmounts.backward);
    setSkipAmounts(p => ({ ...p, backward: i < SKIP_AMOUNTS.length-1 ? SKIP_AMOUNTS[i+1] : 120 }));
    setTimeout(() => setSkipAmounts(p => ({ ...p, backward: 5 })), 3000);
  }, [skipAmounts.backward, getAudio]);

  // 删除并下一曲
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteAndNext = useCallback(async () => {
    if (!currentTrack) return;
    try {
      const result = await deleteTrack(currentTrack.id, true);
      if (result.error) {
        setDeleteError(result.error);
        setTimeout(() => setDeleteError(null), 3000);
        return;
      }
      deleteAndPlayNext();
    } catch (e) {
      setDeleteError('删除失败');
      setTimeout(() => setDeleteError(null), 3000);
    }
  }, [currentTrack, deleteAndPlayNext]);

  const handleAddToFavorites = useCallback(() => setShowAddModal(true), []);

  // 切换播放模式
  const handleTogglePlayMode = useCallback(async () => {
    const i = PLAY_MODES.indexOf(playMode as PlayMode);
    const next = PLAY_MODES[(i+1)%PLAY_MODES.length];
    setPlayMode(next);
    if (currentPlaylist?.id) {
      try { await updatePlaylist(currentPlaylist.id, { playMode: next }); }
      catch (e) { console.error(e); }
    }
  }, [playMode, currentPlaylist, setPlayMode]);

  const { icon: playModeIcon, label: playModeLabel } = PLAY_MODE_LABELS[playMode as PlayMode] || PLAY_MODE_LABELS.sequential;

  // 睡眠定时器显示
  const sleepTimerDisplay = sleepTimer.mode !== 'off' 
    ? `💤 ${sleepTimer.remainingMinutes}分`
    : null;

  if (currentTrack) {
  return (
    <div className="bottom-0 left-0 right-0 h-[260px] md:h-[260px] bg-gray-900 border-t border-gray-800 px-2 md:px-6 py-4 z-50">
      {/* 全端统一布局 */}
      <div className="flex flex-col gap-3 w-full">
        {/* 歌名 */}
        <div className="text-white font-medium text-base truncate">
          {currentTrack && formatTrackTitle(currentTrack)}
        </div>

        {/* 歌手 */}
        <div className="text-gray-400 text-sm truncate">
          {currentTrack.artist}
        </div>

        {/* 按钮栏 - 两行布局 */}
        <div className="flex flex-col gap-2 w-full">
          {/* 第一行：评分 */}
          <div className="flex items-center gap-1">
            <span className="text-gray-300 text-sm">评分: {currentTrack.rating}</span>
            <button onClick={() => updateRating(currentTrack.id, 1)} className="text-green-400">👍</button>
            <button onClick={() => updateRating(currentTrack.id, -1)} className="text-red-400">👎</button>
            <button onClick={handleSkipBackward} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm">⏪{skipAmounts.backward}s</button>
            <button onClick={handleSkipForward} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm">{skipAmounts.forward}s⏩</button>
          </div>

          {/* 第二行：功能按钮 */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={handleAddToFavorites} className="px-2 py-1 bg-purple-700 hover:bg-purple-600 rounded text-sm">❤️</button>
            <button onClick={handleDeleteAndNext} className="px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-sm">🗑️</button>
            
            <button onClick={handleTogglePlayMode} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm" title={playModeLabel}>
              {playModeIcon} {playModeLabel.slice(0, 2)}
            </button>

            <button 
              onClick={() => setShowSleepModal(true)} 
              className={`px-2 py-1 rounded text-sm ${sleepTimer.mode !== 'off' ? 'bg-blue-600 hover:bg-blue-500' : 'bg-gray-700 hover:bg-gray-600'}`}
              title={sleepTimer.mode === 'once' ? `一次性定时 ${sleepTimer.minutes} 分钟` : sleepTimer.mode === 'repeat' ? `重复定时 ${sleepTimer.minutes} 分钟` : '睡眠定时'}
            >
              {sleepTimerDisplay || '💤'}
            </button>
          </div>
        </div>

        {/* 播放器 */}
        <div className="w-full flex flex-col gap-3 px-1 mt-1">
          <style>{`
            .rhap_loop-button { display: none !important; }
            .rhap_main {
              flex-direction: column !important;
              gap: 12px !important;
              width: 100% !important;
              padding-top: 4px !important;
            }
            .rhap_controls-section {
              width: 100% !important;
              justify-content: center !important;
            }
            .rhap_progress-section {
              display: flex !important;
              align-items: center !important;
              width: 100% !important;
              gap: 8px !important;
            }
            .rhap_progress-container {
              flex: 1 !important;
              height: 16px !important;
              margin: 0 !important;
              overflow: hidden !important;
              border-radius: 8px !important;
            }
            .rhap_progress-bar {
              height: 16px !important;
              background: #444 !important;
              border-radius: 0 !important;
            }
            .rhap_progress-loaded {
              height: 16px !important;
              background: #666 !important;
              border-radius: 0 !important;
            }
            .rhap_progress-filled {
              height: 16px !important;
              background: #3b82f6 !important;
              border-radius: 0 !important;
            }
            .rhap_progress-indicator {
              display: none !important;
            }
            .rhap_time {
              font-size: 12px !important;
              color: #ccc !important;
              min-width: 45px !important;
            }
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
      </div>

      {showAddModal && currentTrack && (
        <AddToPlaylistModal trackPath={currentTrack.path} onClose={() => setShowAddModal(false)} />
      )}

      {showSleepModal && (
        <SleepTimerModal onClose={() => setShowSleepModal(false)} />
      )}

      {/* 删除失败弹窗 */}
      {deleteError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg z-[100]">
          {deleteError}
        </div>
      )}
    </div>
  );
  }
}