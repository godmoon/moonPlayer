/// <reference types="vite/client" />

declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

declare module 'react-h5-audio-player/lib/styles.css';

// Media Session API 类型
declare global {
  interface Navigator {
    mediaSession: MediaSession;
  }

  interface MediaSession {
    metadata: MediaMetadata | null;
    playbackState: MediaSessionPlaybackState;
    setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void;
  }

  type MediaSessionPlaybackState = 'playing' | 'paused' | 'none';
  type MediaSessionAction = 'play' | 'pause' | 'previoustrack' | 'nexttrack' | 'seekbackward' | 'seekforward' | 'seekto' | 'stop' | 'skipad';
  type MediaSessionActionHandler = (details: MediaSessionActionDetails) => void;
  interface MediaSessionActionDetails {
    action: MediaSessionAction;
    seekTime?: number;
    fastSeek?: boolean;
  }
}

export {};