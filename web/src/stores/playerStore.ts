// 播放器状态管理
import { create } from 'zustand';

type PlayMode = 'sequential' | 'shuffle' | 'weighted' | 'random' | 'single-loop';

interface Track {
  id: number;
  path: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
  rating: number;
  playCount: number;
  skipCount: number;
  lastPlayed?: number;
  dateAdded: number;
}

interface Playlist {
  id: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  isAuto: boolean;
  playMode?: string;
  skipIntro?: number;
  skipOutro?: number;
}

interface PlayerState {
  // 当前播放
  currentTrack: Track | null;
  currentPlaylist: Playlist | null;
  playlistTracks: Track[];

  // 播放状态
  isPlaying: boolean;
  position: number;
  duration: number;
  volume: number;

  // 待恢复的播放位置（从历史记录恢复时使用）
  pendingSeekPosition: number | null;

  // 播放模式
  playMode: PlayMode;

  // 乱序队列（用于 random 模式）
  shuffleQueue: number[];
  shuffleIndex: number;

  // 操作
  setCurrentTrack: (track: Track | null) => void;
  setCurrentPlaylist: (playlist: Playlist | null, tracks: Track[]) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setPosition: (position: number) => void;
  setDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  setPlayMode: (mode: PlayMode) => void;
  setPendingSeekPosition: (position: number | null) => void;
  clearPendingSeekPosition: () => void;

  // 播放控制
  playNext: () => void;
  playPrevious: () => void;
  deleteAndPlayNext: () => void;

  // 更新评分
  updateTrackRating: (trackId: number, delta: number) => void;

    // 👇 新增：缓存最近播放位置（用于历史记录实时刷新）
  lastPlayedPositions: Record<string, number>;

  // 👇 新增：刷新历史播放位置的方法
  refreshTrackHistoryPosition: (trackId: number, playlistId: number, position: number) => void;

}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  currentPlaylist: null,
  playlistTracks: [],
  isPlaying: false,
  position: 0,
  duration: 0,
  volume: 80,
  pendingSeekPosition: null,
  playMode: 'sequential',
  shuffleQueue: [],
  shuffleIndex: 0,

  // 👇 新增
  lastPlayedPositions: {},

  // 👇 新增方法
  refreshTrackHistoryPosition: (trackId, playlistId, position) => {
    const key = `${playlistId}-${trackId}`;
    set((state) => ({
      lastPlayedPositions: {
        ...state.lastPlayedPositions,
        [key]: position,
      },
    }));
  },

  // ... 下面所有你的原有代码 完全不动
  setCurrentTrack: (track) => set({ currentTrack: track }),

  setCurrentPlaylist: (playlist, tracks) => set({
    currentPlaylist: playlist,
    playlistTracks: tracks,
    shuffleQueue: generateShuffleQueue(tracks.length),
    shuffleIndex: 0,
    // 如果播放列表有默认播放模式，切换过去
    playMode: (playlist?.playMode as PlayMode) || get().playMode
  }),

  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setPosition: (position) => set({ position }),
  setDuration: (duration) => set({ duration }),
  setVolume: (volume) => set({ volume }),

  setPlayMode: (mode) => {
    const state = get();
    if (mode === 'random') {
      set({
        playMode: mode,
        shuffleQueue: generateShuffleQueue(state.playlistTracks.length),
        shuffleIndex: 0
      });
    } else {
      set({ playMode: mode });
    }
  },

  setPendingSeekPosition: (position) => set({ pendingSeekPosition: position }),
  clearPendingSeekPosition: () => set({ pendingSeekPosition: null }),

  playNext: () => {
    const state = get();
    const { playlistTracks, currentTrack, playMode, shuffleQueue, shuffleIndex } = state;

    if (playlistTracks.length === 0) return;

    const currentIndex = currentTrack
      ? playlistTracks.findIndex(t => t.id === currentTrack.id)
      : -1;

    let nextIndex = -1;

    switch (playMode) {
      case 'sequential':
        nextIndex = (currentIndex + 1) % playlistTracks.length;
        break;

      case 'shuffle':
        nextIndex = Math.floor(Math.random() * playlistTracks.length);
        break;

      case 'weighted':
        nextIndex = weightedRandomIndex(playlistTracks);
        break;

      case 'random':
        if (shuffleIndex < shuffleQueue.length - 1) {
          set({ shuffleIndex: shuffleIndex + 1 });
          nextIndex = shuffleQueue[shuffleIndex + 1];
        } else {
          const newQueue = generateShuffleQueue(playlistTracks.length);
          set({ shuffleQueue: newQueue, shuffleIndex: 0 });
          nextIndex = newQueue[0];
        }
        break;

      case 'single-loop':
        nextIndex = currentIndex >= 0 ? currentIndex : 0;
        break;
    }

    if (nextIndex >= 0 && nextIndex < playlistTracks.length) {
      set({ currentTrack: playlistTracks[nextIndex] });
    }
  },

  playPrevious: () => {
    const state = get();
    const { playlistTracks, currentTrack } = state;

    if (playlistTracks.length === 0) return;

    const currentIndex = currentTrack
      ? playlistTracks.findIndex(t => t.id === currentTrack.id)
      : 0;

    const prevIndex = (currentIndex - 1 + playlistTracks.length) % playlistTracks.length;
    set({ currentTrack: playlistTracks[prevIndex] });
  },

  updateTrackRating: (trackId, delta) => {
    const state = get();
    if (state.currentTrack?.id === trackId) {
      set({
        currentTrack: {
          ...state.currentTrack,
          rating: state.currentTrack.rating + delta
        }
      });
    }

    const updatedTracks = state.playlistTracks.map(t =>
      t.id === trackId ? { ...t, rating: t.rating + delta } : t
    );
    set({ playlistTracks: updatedTracks });
  },

  deleteAndPlayNext: () => {
    const state = get();
    const { playlistTracks, currentTrack } = state;

    if (!currentTrack || playlistTracks.length === 0) return;

    const currentIndex = playlistTracks.findIndex(t => t.id === currentTrack.id);
    const newTracks = playlistTracks.filter(t => t.id !== currentTrack.id);

    const nextIndex = Math.min(currentIndex, newTracks.length - 1);
    if (newTracks.length > 0) {
      set({ playlistTracks: newTracks, currentTrack: newTracks[nextIndex] });
    } else {
      set({ playlistTracks: [], currentTrack: null, isPlaying: false });
    }
  }
}));

// 生成乱序队列
function generateShuffleQueue(length: number): number[] {
  const arr = Array.from({ length }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 权重随机
function weightedRandomIndex(tracks: Track[]): number {
  const weights = tracks.map(t => Math.max(1, t.rating + 10));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  let random = Math.random() * totalWeight;
  for (let i = 0; i < weights.length; i++) {
    random -= weights[i];
    if (random <= 0) return i;
  }

  return Math.floor(Math.random() * tracks.length);
}

export type { Track, Playlist, PlayMode };