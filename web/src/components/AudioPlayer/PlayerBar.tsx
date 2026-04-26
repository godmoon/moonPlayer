// 音频播放器组件
import { useRef, useEffect, useLayoutEffect, useCallback, useState } from 'react';
import AudioPlayer from 'react-h5-audio-player';
import 'react-h5-audio-player/lib/styles.css';
import { usePlayerStore, type QualityMode } from '../../stores/playerStore';
import { getStreamUrl, recordPlay, deleteTrack, updatePlaylist, recordHistory } from '../../stores/api';
import { getDuration, getStreamBitrate } from '../../stores/api';
import { AddToPlaylistModal } from '../AddToPlaylistModal';
import { SleepTimerModal } from './SleepTimerModal';
import { TrackInfoModal } from './TrackInfoModal';
import { PLAY_MODES, PLAY_MODE_LABELS, SKIP_AMOUNTS, setPendingSeekPosition, consumePendingSeekPosition, getLockedPosition, clearLockedPosition, formatTrackTitle } from './utils';
import { registerAudioElementFn } from '../../utils/nativeBridge';
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
    qualityMode,
    playlistTracks,
    setIsPlaying,
    setDuration,
    setPlayMode,
    setCurrentTrack,
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
  const [showTrackInfoModal, setShowTrackInfoModal] = useState(false);
  const [streamBitrate, setStreamBitrate] = useState<number | null>(null);
  const [sourceBitrate, setSourceBitrate] = useState<number | null>(null);
  const [needsTranscode, setNeedsTranscode] = useState(false);
  const [isSingleLoop, setIsSingleLoop] = useState(false);
  
  // 🚗 车机环境检测
  const [carEnvInfo, setCarEnvInfo] = useState({
    isCarEnv: false,
    userAgent: ''
  });

  // 初始化时检测车机环境
  useEffect(() => {
    const ua = navigator.userAgent || '';
    const isCarEnv = /car|lixiang|LiBrowser|auto|vehicle/i.test(ua);
    setCarEnvInfo({
      isCarEnv,
      userAgent: ua
    });
  }, []);


  // 🚗 车机多击控制适配
  const playTapRef = useRef<number[]>([]);
  const playTimerRef = useRef<any>(null);

const getAudio = useCallback(() => {
    return playerRef.current?.audio?.current;
  }, []);

  // 有效品质设置（优先使用播放列表配置，否则使用全局配置）
  const effectiveQualityMode = (currentPlaylist?.qualityMode as QualityMode) || qualityMode;

  // 注册音频元素获取函数到 nativeBridge（必须在 getAudio 定义后）
  useEffect(() => {
    registerAudioElementFn(getAudio);
  }, [getAudio]);

 // 📱 页面可见性状态（用于修复后台唤醒后通知栏控制失效）
 const pageWasHiddenRef = useRef<boolean>(false);
 // 页面可见性变化处理：修复后台唤醒后通知栏控制失效
 useEffect(() => {
   if (typeof document === 'undefined') return;
   const handleVisibilityChange = () => {
     const isVisible = document.visibilityState === 'visible';
     const audio = getAudio();
     if (isVisible && pageWasHiddenRef.current) {
       // 页面从后台恢复
       if (audio && currentTrack) {
         const realIsPlaying = !audio.paused && !audio.ended;
         const storeState = usePlayerStore.getState();
         if (realIsPlaying !== storeState.isPlaying) {
           console.log('[PlayerBar] 可见性恢复：同步播放状态', { realIsPlaying, storeIsPlaying: storeState.isPlaying });
           storeState.setIsPlaying(realIsPlaying);
         }
         if ('mediaSession' in navigator) {
           navigator.mediaSession.playbackState = realIsPlaying ? 'playing' : 'paused';
         }
         if (storeState.isPlaying && !realIsPlaying) {
           audio.play().catch((e: any) => console.log('[PlayerBar] 恢复播放失败:', e.message));
         }
       }
       pageWasHiddenRef.current = false;
     } else if (!isVisible) {
       pageWasHiddenRef.current = true;
     }
   };
   document.addEventListener('visibilitychange', handleVisibilityChange);
   return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
 }, [currentTrack, getAudio]);

 // 更新页面标题为当前播放歌曲
  useEffect(() => {
    if (currentTrack) {
      document.title = `${formatTrackTitle(currentTrack, effectiveQualityMode, needsTranscode)} - MoonPlayer`;
    } else {
      document.title = 'MoonPlayer';
    }
  }, [currentTrack, effectiveQualityMode]);

  // 获取实际音频流比特率
  useEffect(() => {
    if (!currentTrack) {
      setStreamBitrate(null);
      setSourceBitrate(null);
      setNeedsTranscode(false);
      return;
    }
    getStreamBitrate(currentTrack.id, effectiveQualityMode).then(result => {
      if (result) {
        setStreamBitrate(result.bitrate);
        setSourceBitrate(result.sourceBitrate);
        setNeedsTranscode(result.needsTranscode);
      }
    });
  }, [currentTrack, effectiveQualityMode]);

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
        if (match) {
          const baseUrl = `/api/webdav/${match[1]}/stream?path=${encodeURIComponent(match[2])}`;
          return effectiveQualityMode !== 'lossless' ? `${baseUrl}&quality=${effectiveQualityMode}` : baseUrl;
        }
        return null;
      })() : getStreamUrl(currentTrack.id, effectiveQualityMode)) 
    : null;

  // 品质切换时保存并恢复播放位置
  // 持续跟踪当前播放位置
  const currentPositionRef = useRef<number>(0);
  const wasPlayingRef = useRef<boolean>(false);
  const lastQualityRef = useRef<QualityMode>(effectiveQualityMode);
  const savedPositionRef = useRef<{ trackId: number; position: number; wasPlaying: boolean } | null>(null);

  // 使用 timeupdate 持续跟踪位置
  useEffect(() => {
    const audio = getAudio();
    if (!audio) return;
    
    const updateTime = () => {
      currentPositionRef.current = audio.currentTime;
    };
    
    audio.addEventListener('timeupdate', updateTime);
    return () => audio.removeEventListener('timeupdate', updateTime);
  }, [getAudio, streamUrl]); // 添加 streamUrl 依赖，每次 src 变化时重新绑定

  // 当 effectiveQualityMode 变化时，保存当前位置
  useLayoutEffect(() => {
    // 检测品质是否发生变化
    if (lastQualityRef.current !== effectiveQualityMode && currentTrack) {
      // 使用 ref 中保存的位置
      savedPositionRef.current = {
        trackId: currentTrack.id,
        position: currentPositionRef.current,
        wasPlaying: wasPlayingRef.current
      };
    }
    lastQualityRef.current = effectiveQualityMode;
  }, [effectiveQualityMode, currentTrack, getAudio]);

  // 当 streamUrl 变化后，恢复播放位置
  useEffect(() => {
    const audio = getAudio();
    if (!audio || !currentTrack) return;
    
    // 如果有保存的状态，且是同一首歌，恢复位置
    if (savedPositionRef.current && savedPositionRef.current.trackId === currentTrack.id) {
      const { position, wasPlaying } = savedPositionRef.current;
      
      // 等待音频加载完成后恢复位置
      const restorePlay = () => {
        if (audio.readyState >= 1) {
          audio.currentTime = position;
          if (wasPlaying) {
            setIsPlaying(true);
            audio.play().catch(() => {});
          }
          audio.removeEventListener('loadedmetadata', restorePlay);
          audio.removeEventListener('canplay', restorePlay);
        }
      };
      
      if (audio.readyState >= 1) {
        restorePlay();
      } else {
        audio.addEventListener('loadedmetadata', restorePlay);
        audio.addEventListener('canplay', restorePlay);
      }
      
      // 清空保存的状态
      savedPositionRef.current = null;
    }
  }, [streamUrl, currentTrack?.id, getAudio, setIsPlaying]);

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
  const audio = getAudio();
  
  // 关键修复：如果音频没有暂停（可能是假暂停或已播放），直接返回，避免抖动
  if (audio && !audio.paused) return;
  
  wasPlayingRef.current = true;
  setIsPlaying(true);
  playStartedRef.current = Date.now();

  // 如果音频对象不存在，等待后续流加载
  if (!audio) return;

  // 如果有待恢复的播放位置，先恢复
  if (getLockedPosition() !== null) {
    audio.currentTime = getLockedPosition()!;
    clearLockedPosition();
  }

  // 尝试恢复播放状态（可能因暂停或网络中断）
  if (audio.paused) {
    audio.play().catch(() => {
      // 如果自动播放失败，添加播放事件监听再尝试
      const onCanPlay = () => {
        audio.play().catch(() => {});
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('loadedmetadata', onCanPlay);
      };
      audio.addEventListener('canplay', onCanPlay);
      audio.addEventListener('loadedmetadata', onCanPlay);
    });
  }

  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'playing';
  }
}, [setIsPlaying, getAudio]);

  // 暂停
const handlePause = useCallback(() => {
  wasPlayingRef.current = false;
  setIsPlaying(false);

  const audio = getAudio();
  audio?.pause();

  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'paused';
  }

}, [setIsPlaying, getAudio]);

// 播放结束
  const handleEnded = useCallback(async () => {
    if (isSingleLoop) {
      const audio = getAudio();
      if (audio) { audio.currentTime = 0; audio.play(); }
      return;
    }
    if (currentTrack) {
      await recordPlay(currentTrack.id, true, 0);
      await updateRating(currentTrack.id, 1);
    }
    playNext();
    setIsPlaying(true);
  }, [currentTrack, isSingleLoop, playNext, updateRating, setIsPlaying, getAudio]);

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

    if (isSingleLoop) {
      if (audio) { audio.currentTime = 0; audio.play(); }
      return;
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
  }, [currentTrack, isSingleLoop, playMode, playNext, playPrevious, updateRating, currentPlaylist, getAudio]);

 
  


  // 顶部 Ref 保持不变
const isProgrammaticRef = useRef(false);

const handlePlayWrapped = useCallback(() => {

  // 1. 代码触发的系统事件：跳过
  if (isProgrammaticRef.current) {
    //console.log("✅ 代码触发，跳过");
    return;
  }

  // 2. 非车机跳过
  if (!carEnvInfo.isCarEnv) {
    return;
  }

  const now = Date.now();

  // 防抖（保持你原来的写法）
  if (playTapRef.current.length > 0 && now - playTapRef.current[playTapRef.current.length - 1] < 80) {
    //console.log('⚡️ 防抖跳过');
    return;
  }

  // 记录点击
  playTapRef.current.push(now);
  const taps = playTapRef.current.length;
  //console.log('点击次数:', taps);

  // 每次点击都清空上一个定时器（核心！）
  if (playTimerRef.current) {
    clearTimeout(playTimerRef.current);
    playTimerRef.current = null;
  }

  // ==============================================
  // 🔥 终极正确逻辑：全部延迟触发，三击自动覆盖双击
  // ==============================================

  // 单击：延迟清空
  if (taps === 1) {
    playTimerRef.current = setTimeout(() => {
      playTapRef.current = [];
    }, 1000);
  }

  // 双击：延迟执行！！！不是立刻执行！
  else if (taps === 2) {
    //console.log("⌛ 等待确认是否为双击...");
    playTimerRef.current = setTimeout(() => {
      // 延迟到时间后，才真的执行下一曲
      //console.log("👉 双击 → 下一曲");
      playTapRef.current = [];
      
      isProgrammaticRef.current = true;
      handlePreviousOrNext('next');
      setIsPlaying(true);
      setTimeout(() => {
        isProgrammaticRef.current = false;
      }, 100);
    }, 250); // 250ms 内按第三下，就会取消这个定时器
  }

  // 三击：立即执行，清空所有，优先级最高
  else if (taps >= 3) {
    //console.log("👈 三击 → 上一曲");
    playTapRef.current = []; // 清空点击
    
    isProgrammaticRef.current = true;
    handlePreviousOrNext('prev');
    setIsPlaying(true);
    setTimeout(() => {
      isProgrammaticRef.current = false;
    }, 100);
  }

}, [handlePreviousOrNext, setIsPlaying, carEnvInfo.isCarEnv]);




useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;

    // ✅ metadata 始终用当前歌曲
    if (currentTrack) {
      ms.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist || '未知',
        album: currentTrack.album
      });
    }

    // ✅ 状态真实
    ms.playbackState = isPlaying ? 'playing' : 'paused';

    // ✅ 全部接管
    const safe = (fn: () => void) => () => {
      try { fn(); } catch {}
    };

    // 设置所有操作处理器（每次状态变化时重新绑定）
    ms.setActionHandler('play', safe(() => {
      handlePlay();
    }));
    ms.setActionHandler('pause', safe(() => {
      handlePause();
    }));
    ms.setActionHandler('nexttrack', safe(() => {
      handlePreviousOrNext('next');
    }));
    ms.setActionHandler('previoustrack', safe(() => {
      handlePreviousOrNext('prev');
    }));
    ms.setActionHandler('seekbackward', safe(() => {
      const a = getAudio();
      if (a) a.currentTime -= 10;
    }));
    ms.setActionHandler('seekforward', safe(() => {
      const a = getAudio();
      if (a) a.currentTime += 10;
    }));

    return () => {
      ['play', 'pause', 'nexttrack', 'previoustrack', 'seekbackward', 'seekforward'].forEach(a => {
        try { ms.setActionHandler(a as any, null); } catch {}
      });
    };
  }, [currentTrack, isPlaying, handlePlay, handlePause, handlePreviousOrNext, getAudio]); // 确保关键依赖变化时重新绑定

  // 快进快退（支持跨文件跳转）
  const handleSkipForward = useCallback(() => {
    const audio = getAudio();
    if (!audio || !currentTrack) return;
    
    const currentTime = audio.currentTime;
    const duration = audio.duration || 0;
    const newTime = currentTime + skipAmounts.forward;
    
    // 如果跳转后超出当前文件，切换到下一曲
    if (newTime >= duration - 0.5 && duration > 0) {
      // 顺序播放模式下切换到下一曲，从头开始播放
      if (playMode === 'sequential' && playlistTracks.length > 0) {
        const currentIndex = playlistTracks.findIndex(t => t.id === currentTrack.id);
        const nextIndex = (currentIndex + 1) % playlistTracks.length;
        setCurrentTrack(playlistTracks[nextIndex]);
        // 不设置 pendingSeekPosition，从头播放
      } else {
        // 非顺序模式，用原来的 playNext
        playNext();
      }
    } else {
      // 正常跳转
      audio.currentTime = Math.min(newTime, duration - 0.5);
    }
    
    const i = SKIP_AMOUNTS.indexOf(skipAmounts.forward);
    setSkipAmounts(p => ({ ...p, forward: i < SKIP_AMOUNTS.length-1 ? SKIP_AMOUNTS[i+1] : 120 }));
    setTimeout(() => setSkipAmounts(p => ({ ...p, forward: 5 })), 3000);
  }, [skipAmounts.forward, currentTrack, playMode, playlistTracks, getAudio, playNext, setCurrentTrack]);

  const handleSkipBackward = useCallback(() => {
    const audio = getAudio();
    if (!audio || !currentTrack) return;
    
    const currentTime = audio.currentTime;
    const newTime = currentTime - skipAmounts.backward;
    
    // 如果跳转后小于 0，需要切换到上一曲
    if (newTime < 0 && playMode === 'sequential' && playlistTracks.length > 0) {
      const currentIndex = playlistTracks.findIndex(t => t.id === currentTrack.id);
      const prevIndex = currentIndex <= 0 ? playlistTracks.length - 1 : currentIndex - 1;
      const prevTrack = playlistTracks[prevIndex];
      
      // 计算上一曲应该从什么位置开始
      // 从当前曲往前跳 skipAmounts.backward 秒
      // 例如：当前 115 的 00:30，往前跳 120 秒
      // 实际位置应该是上一曲末尾往前推 (120 - 30) = 90 秒
      const seekFromEnd = skipAmounts.backward - currentTime;
      
      // 获取上一曲的时长（如果有）
      const prevDuration = prevTrack.duration || 0;
      
      if (prevDuration > 0 && seekFromEnd < prevDuration) {
        // 上一曲够长，从末尾往前推
        const seekPosition = prevDuration - seekFromEnd;
        setPendingSeekPosition(seekPosition);
      } else if (prevDuration > 0 && seekFromEnd >= prevDuration) {
        // 上一曲不够长，最多跳过一个文件
        // 直接从 00:00 开始
        setPendingSeekPosition(0);
      } else {
        // 没有时长信息，从头开始
        setPendingSeekPosition(0);
      }
      
      setCurrentTrack(prevTrack);
      setIsPlaying(true); // 确保播放状态
    } else {
      // 正常跳转
      audio.currentTime = Math.max(newTime, 0);
    }
    
    const i = SKIP_AMOUNTS.indexOf(skipAmounts.backward);
    setSkipAmounts(p => ({ ...p, backward: i < SKIP_AMOUNTS.length-1 ? SKIP_AMOUNTS[i+1] : 120 }));
    setTimeout(() => setSkipAmounts(p => ({ ...p, backward: 5 })), 3000);
  }, [skipAmounts.backward, currentTrack, playMode, playlistTracks, getAudio, setCurrentTrack, setIsPlaying]);

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
    <div className="bg-gray-900 border-t border-gray-800 px-2 md:px-4 py-3 flex-shrink-0"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      
      {/* 全端统一布局 */}
      <div className="flex flex-col gap-3 w-full">
        {/* 歌名和快捷信息 */}
        <div className="flex items-center justify-between gap-2">
          <div className="text-white font-medium text-base truncate flex-1 min-w-0">
            {currentTrack && formatTrackTitle(currentTrack, effectiveQualityMode, needsTranscode)}
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-400 flex-shrink-0">
            <span>{currentTrack?.rating ? `${currentTrack.rating > 0 ? '+' : ''}${currentTrack.rating}` : ''}</span>
            <span>{streamBitrate ? `${streamBitrate}k` : ''}</span>
            <button
              onClick={() => setShowTrackInfoModal(true)}
              className="player-custom-btn text-gray-400 hover:text-white"
              title="歌曲详情"
            >ℹ️</button>
          </div>
        </div>

        

        {/* 播放器 */}
        <div className="w-full flex flex-col gap-3 px-1 mt-1">
          <style>{`
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
              background: transparent !important;
              border-radius: 0 !important;
            }
            .rhap_download-progress {
              display: none !important;
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
            .rhap_button {
              width: 4.5vmin !important;
              height: 4.5vmin !important;
              max-width: 32px !important;
              max-height: 32px !important;
              min-width: 24px !important;
              min-height: 24px !important;
            }
            .rhap_button svg {
              width: 3vmin !important;
              height: 3vmin !important;
              max-width: 22px !important;
              max-height: 22px !important;
              min-width: 16px !important;
              min-height: 16px !important;
            }
            .rhap_main-controls-button {
              width: 6vmin !important;
              height: 6vmin !important;
              max-width: 44px !important;
              max-height: 44px !important;
              min-width: 32px !important;
              min-height: 32px !important;
            }
            .rhap_main-controls-button svg {
              width: 4.5vmin !important;
              height: 4.5vmin !important;
              max-width: 32px !important;
              max-height: 32px !important;
              min-width: 24px !important;
              min-height: 24px !important;
            }
            .player-custom-btn {
              background: none !important;
              border: none !important;
              cursor: pointer !important;
              font-size: clamp(16px, 3.5vmin, 30px) !important;
              line-height: 1 !important;
              padding: 2px !important;
            }
            .player-loop-btn svg {
              width: clamp(16px, 3.5vmin, 30px) !important;
              height: clamp(16px, 3.5vmin, 30px) !important;
            }
          `}</style>
          
          <AudioPlayer
            ref={playerRef}
            loop={isSingleLoop}
            src={streamUrl || undefined}
            showSkipControls
            showJumpControls={false}
            customAdditionalControls={[
              <button
                key="loop"
                onClick={() => setIsSingleLoop(prev => !prev)}
                className="player-custom-btn player-loop-btn"
                title={isSingleLoop ? 'Single loop on' : 'Single loop off'}
              >
                <svg viewBox="0 0 24 24" fill={isSingleLoop ? '#22c55e' : '#ef4444'}>
                  <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.83l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.83L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
                </svg>
              </button>,
              <button
                key="rating-up"
                onClick={() => updateRating(currentTrack.id, 1)}
                className="player-custom-btn text-green-400 hover:text-green-300"
                title="Like"
              >👍</button>,
              <button
                key="rating-down"
                onClick={() => updateRating(currentTrack.id, -1)}
                className="player-custom-btn text-red-400 hover:text-red-300"
                title="Dislike"
              >👎</button>,
              <button
                key="skip-back"
                onClick={handleSkipBackward}
                className="player-custom-btn text-gray-300 hover:text-white"
                title={`Rewind ${skipAmounts.backward}s`}
              >⏪</button>,
              <button
                key="skip-forward"
                onClick={handleSkipForward}
                className="player-custom-btn text-gray-300 hover:text-white"
                title={`Forward ${skipAmounts.forward}s`}
              >⏩</button>,
              <button
                key="favorites"
                onClick={handleAddToFavorites}
                className="player-custom-btn text-purple-400 hover:text-purple-300"
                title="Add to playlist"
              >❤️</button>,
              <button
                key="delete"
                onClick={handleDeleteAndNext}
                className="player-custom-btn text-red-400 hover:text-red-300"
                title="Delete and play next"
              >🗑️</button>,
              <button
                key="play-mode"
                onClick={handleTogglePlayMode}
                className="player-custom-btn text-gray-300 hover:text-white"
                title={playModeLabel}
              >{playModeIcon}</button>,
              <button
                key="sleep"
                onClick={() => setShowSleepModal(true)}
                className={`player-custom-btn ${sleepTimer.mode !== 'off' ? 'text-blue-400' : 'text-gray-400 hover:text-white'}`}
                title={sleepTimer.mode === 'once' ? `Timer ${sleepTimer.minutes}m` : sleepTimer.mode === 'repeat' ? `Repeat ${sleepTimer.minutes}m` : 'Sleep timer'}
              >{sleepTimerDisplay || '💤'}</button>,
            ]}
            customVolumeControls={[]}
            onClickPrevious={() => handlePreviousOrNext('prev')}
            onClickNext={() => handlePreviousOrNext('next')}
            onPlay={() => handlePlayWrapped()}
            onPause={() => handlePlayWrapped()}
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

      {showTrackInfoModal && (
        <TrackInfoModal onClose={() => setShowTrackInfoModal(false)} streamBitrate={streamBitrate} sourceBitrate={sourceBitrate} needsTranscode={needsTranscode} />
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