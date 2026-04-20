/**
 * 原生应用桥接工具
 * 用于 Android/iOS WebView 与网页通信
 */

import { usePlayerStore } from '../stores/playerStore';

// 检测是否在原生 App 中运行
export function isNativeApp(): boolean {
  return typeof (window as any).MoonPlayerApp !== 'undefined';
}

// 设置原生桥接
export function setupNativeBridge() {
  // 暴露桥接接口给原生 App 调用
  (window as any).MoonPlayerBridge = {
    play: () => {
      const store = usePlayerStore.getState();
      if (!store.isPlaying) {
        store.setIsPlaying(true);
      }
    },
    
    pause: () => {
      const store = usePlayerStore.getState();
      if (store.isPlaying) {
        store.setIsPlaying(false);
      }
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
    
    seek: (positionMs: number) => {
      const audio = document.querySelector('audio');
      if (audio) {
        audio.currentTime = positionMs / 1000;
      }
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
  let lastUpdate = 0;
  
  // 监听 store 变化
  usePlayerStore.subscribe((state, prevState) => {
    const now = Date.now();
    // 节流：最多每秒更新一次
    if (now - lastUpdate < 1000) return;
    
    // 播放状态变化
    if (state.isPlaying !== prevState.isPlaying || 
        state.currentTrack?.id !== prevState.currentTrack?.id) {
      updateNativeMedia();
      lastUpdate = now;
    }
  });
  
  // 初始更新
  setTimeout(() => updateNativeMedia(), 1000);
}

// 更新原生 App 的媒体信息
function updateNativeMedia() {
  const state = usePlayerStore.getState();
  const audio = document.querySelector('audio');
  
  if (!(window as any).MoonPlayerApp) return;
  
  try {
    (window as any).MoonPlayerApp.updateMedia(JSON.stringify({
      title: state.currentTrack?.title || '未知歌曲',
      artist: state.currentTrack?.artist || '未知艺术家',
      album: state.currentTrack?.album || '',
      duration: audio?.duration || 0,
      position: audio?.currentTime || 0,
      isPlaying: state.isPlaying
    }));
  } catch (e) {
    console.error('[NativeBridge] updateMedia error:', e);
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