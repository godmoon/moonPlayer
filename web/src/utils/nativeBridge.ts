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

// 前进/后退递增逻辑（与 PlayerBar 保持一致）
const SKIP_AMOUNTS = [5, 10, 30, 60, 120];
let skipState = { forward: 5, backward: 5 };
let skipTimeout: ReturnType<typeof setTimeout> | null = null;

function getSkipAmount(direction: 'forward' | 'backward'): number {
  const amount = skipState[direction];
  const idx = SKIP_AMOUNTS.indexOf(amount);
  skipState[direction] = idx < SKIP_AMOUNTS.length - 1 ? SKIP_AMOUNTS[idx + 1] : 120;
  // 3秒后重置
  if (skipTimeout) clearTimeout(skipTimeout);
  skipTimeout = setTimeout(() => {
    skipState = { forward: 5, backward: 5 };
  }, 3000);
  return amount;
}

// 设置原生桥接
export function setupNativeBridge() {
  // 暴露桥接接口给原生 App 调用
  (window as any).MoonPlayerBridge = {
    play: () => {
      const store = usePlayerStore.getState();
      store.setIsPlaying(true);
      const audio = getAudio();
      if (audio && audio.paused) {
        audio.play().catch(() => {});
      }
    },
    pause: () => {
      const store = usePlayerStore.getState();
      store.setIsPlaying(false);
      const audio = getAudio();
      if (audio) audio.pause();
    },
    next: () => {
      const store = usePlayerStore.getState();
      store.playNext();
      store.setIsPlaying(true);
    },
    prev: () => {
      const store = usePlayerStore.getState();
      store.playPrevious();
      store.setIsPlaying(true);
    },
    forward: () => {
      const audio = getAudio();
      if (!audio) return;
      const store = usePlayerStore.getState();
      const amount = getSkipAmount('forward');
      const newTime = audio.currentTime + amount;
      const duration = audio.duration || 0;
      if (newTime >= duration - 0.5 && duration > 0) {
        // 超出文件，切换下一曲
        store.playNext();
        store.setIsPlaying(true);
      } else {
        audio.currentTime = Math.min(newTime, duration - 0.5);
      }
    },
    backward: () => {
      const audio = getAudio();
      if (!audio) return;
      const store = usePlayerStore.getState();
      const amount = getSkipAmount('backward');
      const newTime = audio.currentTime - amount;
      if (newTime < 0) {
        // 切换上一曲
        store.playPrevious();
        store.setIsPlaying(true);
        // 上一曲从末尾开始
        setTimeout(() => {
          const newAudio = getAudio();
          if (newAudio && newAudio.duration > 0) {
            newAudio.currentTime = Math.max(0, newAudio.duration - amount);
          }
        }, 500);
      } else {
        audio.currentTime = Math.max(newTime, 0);
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