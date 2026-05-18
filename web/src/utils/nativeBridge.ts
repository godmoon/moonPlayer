/**
 * 原生应用桥接工具
 * 用于 Android/iOS WebView 与网页通信
 */
import { usePlayerStore } from '../stores/playerStore';

// 检测是否在原生 App 中运行
export function isNativeApp(): boolean {
  return typeof (window as any).MoonPlayerApp !== 'undefined';
}

// 获取音频元素的函数（由 PlayerBar 注册）
let getAudioElementFn: (() => HTMLAudioElement | null) | null = null;
export function registerAudioElementFn(fn: () => HTMLAudioElement | null) {
  getAudioElementFn = fn;
}
function getAudio(): HTMLAudioElement | null {
  // 优先使用注册的函数
  if (getAudioElementFn) {
    const audio = getAudioElementFn();
    if (audio) return audio;
  }
  // 备用：尝试直接查找 audio 标签
  return document.querySelector('audio');
}

// 前进/后退递增逻辑（与 PlayerBar 保持一致，每个方向独立跟踪）
const SKIP_AMOUNTS = [5, 10, 30, 60, 120];
const skipState = { forward: 5, backward: 5 };
const skipTimeouts: Record<string, ReturnType<typeof setTimeout> | null> = { forward: null, backward: null };

function getSkipAmount(direction: 'forward' | 'backward'): number {
  const amount = skipState[direction];
  const idx = SKIP_AMOUNTS.indexOf(amount);
  skipState[direction] = idx < SKIP_AMOUNTS.length - 1 ? SKIP_AMOUNTS[idx + 1] : 120;
  // 每个方向独立重置（3秒后）
  if (skipTimeouts[direction]) clearTimeout(skipTimeouts[direction]);
  skipTimeouts[direction] = setTimeout(() => {
    skipState[direction] = 5;
  }, 3000);
  return amount;
}

// 立即同步状态到原生 App
function syncToNative() {
  const state = usePlayerStore.getState();
  const audio = getAudio();
  updateNativeMedia(state, audio);
}

// 设置原生桥接
export function setupNativeBridge() {
  // 暴露桥接接口给原生 App 调用
  (window as any).MoonPlayerBridge = {
    play: () => {
      const store = usePlayerStore.getState();
      const audio = getAudio();
      if (audio && audio.paused) {
        store.setIsPlaying(true);
        audio.play().catch(() => {
          // 如果播放失败，纠正状态并立即同步
          store.setIsPlaying(false);
          syncToNative();
        });
        syncToNative();
      } else if (audio && !audio.paused) {
        // 已经在播放，仅同步状态
        syncToNative();
      } else {
        // 没有音频元素（无当前曲目），不设置 isPlaying，仅同步
        syncToNative();
      }
    },
    pause: () => {
      const store = usePlayerStore.getState();
      store.setIsPlaying(false);
      const audio = getAudio();
      if (audio) audio.pause();
      // 立即同步状态
      syncToNative();
    },
    next: () => {
      const store = usePlayerStore.getState();
      store.playNext();
      store.setIsPlaying(true);
      // 切歌后等一小段时间让音频元素更新，再同步
      setTimeout(syncToNative, 200);
    },
    prev: () => {
      const store = usePlayerStore.getState();
      store.playPrevious();
      store.setIsPlaying(true);
      setTimeout(syncToNative, 200);
    },
    forward: () => {
      const audio = getAudio();
      if (!audio) return;
      const store = usePlayerStore.getState();
      if (!store.currentTrack) return;
      const amount = getSkipAmount('forward');
      const currentTime = audio.currentTime;
      const duration = audio.duration || 0;
      const newTime = currentTime + amount;
      if (newTime >= duration - 0.5 && duration > 0) {
        // 跨文件跳转：与 PlayerBar 逻辑一致
        if (store.playMode === 'sequential' && store.playlistTracks.length > 0) {
          const currentIndex = store.playlistTracks.findIndex(t => t.id === store.currentTrack!.id);
          const nextIndex = (currentIndex + 1) % store.playlistTracks.length;
          store.setCurrentTrack(store.playlistTracks[nextIndex]);
        } else {
          store.playNext();
        }
        setTimeout(syncToNative, 200);
      } else {
        audio.currentTime = Math.min(newTime, duration - 0.5);
        syncToNative();
      }
    },
    backward: () => {
      const audio = getAudio();
      if (!audio) return;
      const store = usePlayerStore.getState();
      if (!store.currentTrack) return;
      const amount = getSkipAmount('backward');
      const currentTime = audio.currentTime;
      const newTime = currentTime - amount;
      if (newTime < 0 && store.playMode === 'sequential' && store.playlistTracks.length > 0) {
        // 跨文件跳转：与 PlayerBar 逻辑一致
        const currentIndex = store.playlistTracks.findIndex(t => t.id === store.currentTrack!.id);
        const prevIndex = currentIndex <= 0 ? store.playlistTracks.length - 1 : currentIndex - 1;
        const prevTrack = store.playlistTracks[prevIndex];
        const seekFromEnd = amount - currentTime;
        const prevDuration = prevTrack.duration || 0;
        if (prevDuration > 0 && seekFromEnd < prevDuration) {
          store.setPendingSeekPosition(prevDuration - seekFromEnd);
        } else {
          store.setPendingSeekPosition(0);
        }
        store.setCurrentTrack(prevTrack);
        store.setIsPlaying(true);
        setTimeout(syncToNative, 200);
      } else {
        audio.currentTime = Math.max(newTime, 0);
        syncToNative();
      }
    },
    seek: (positionSec: number) => {
      const audio = getAudio();
      if (!audio) {
        console.error('[NativeBridge] seek: no audio element');
        return;
      }
      const duration = audio.duration || 0;
      if (!isFinite(duration) || duration <= 0) {
        console.error('[NativeBridge] seek: invalid duration', duration);
        return;
      }
      // 确保在有效范围内
      const seekTime = Math.max(0, Math.min(positionSec, duration - 0.5));
      console.log('[NativeBridge] seek to:', seekTime, 'duration:', duration);
      audio.currentTime = seekTime;
      syncToNative();
    }
  };

  // 如果在原生 App 中，监听播放状态变化并同步
  if (isNativeApp()) {
    setupStateSync();
  }
  console.log('[NativeBridge] Bridge setup complete, isNative:', isNativeApp());
}

// 同步播放状态到原生 App
function setupStateSync() {
  let lastTrackId: number | null = null;
  let lastIsPlaying: boolean = false;
  let lastPosition: number = 0;
  let lastDuration: number = 0;

  // 定期同步进度（每 2 秒）
  setInterval(() => {
    const audio = getAudio();
    const state = usePlayerStore.getState();
    const currentTrackId = state.currentTrack?.id || null;
    const isPlaying = state.isPlaying;
    const position = audio?.currentTime || 0;
    const duration = audio?.duration || 0;

    // 只有变化时才更新
    if (currentTrackId !== lastTrackId || isPlaying !== lastIsPlaying || Math.abs(position - lastPosition) > 2 || Math.abs(duration - lastDuration) > 1) {
      lastTrackId = currentTrackId;
      lastIsPlaying = isPlaying;
      lastPosition = position;
      lastDuration = duration;
      updateNativeMedia(state, audio);
    }
  }, 2000);

  // 监听 store 变化（立即响应曲目切换和播放状态变化）
  usePlayerStore.subscribe((state, prevState) => {
    // 曲目变化
    if (state.currentTrack?.id !== prevState.currentTrack?.id) {
      setTimeout(() => {
        const audio = getAudio();
        updateNativeMedia(state, audio);
      }, 100);
    }
    // 播放状态变化
    if (state.isPlaying !== prevState.isPlaying) {
      const audio = getAudio();
      updateNativeMedia(state, audio);
    }
  });

  // 初始更新
  setTimeout(() => {
    const audio = getAudio();
    const state = usePlayerStore.getState();
    updateNativeMedia(state, audio);
  }, 1000);
}

// 更新原生 App 的媒体信息
function updateNativeMedia(state: ReturnType<typeof usePlayerStore.getState>, audio: HTMLAudioElement | null) {
  if (!(window as any).MoonPlayerApp) return;
  try {
    (window as any).MoonPlayerApp.updateMedia(JSON.stringify({
      title: state.currentTrack?.title || 'MoonPlayer',
      artist: state.currentTrack?.artist || '',
      album: state.currentTrack?.album || '',
      duration: audio?.duration || 0,
      position: audio?.currentTime || 0,
      isPlaying: state.isPlaying
    }));
  } catch (e) {
    console.error('[NativeBridge] updateNativeMedia error:', e);
  }
}

// 主动通知原生 App 播放状态变化
export function notifyNativePlay() {
  if (isNativeApp()) {
    try {
      (window as any).MoonPlayerApp.play();
    } catch (e) {
      console.error('[NativeBridge] play error:', e);
    }
  }
}

export function notifyNativePause() {
  if (isNativeApp()) {
    try {
      (window as any).MoonPlayerApp.pause();
    } catch (e) {
      console.error('[NativeBridge] pause error:', e);
    }
  }
}