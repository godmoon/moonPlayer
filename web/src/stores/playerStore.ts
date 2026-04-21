// 播放器状态管理
import { create } from 'zustand';

// 睡眠定时模式
export type SleepTimerMode = 'off' | 'once' | 'repeat';

interface SleepTimerState {
  mode: SleepTimerMode;
  minutes: number;
  endTime: number | null;  // 结束时间的毫秒时间戳
  remainingMinutes: number; // 剩余分钟数（用于显示）
}

type PlayMode = 'sequential' | 'shuffle' | 'weighted' | 'random' | 'single-loop';

// 省流模式（比特率限制）
export type QualityMode = 'low' | 'medium' | 'high' | 'lossless';

export const QUALITY_MODES: { id: QualityMode; label: string; bitrate: number; description: string }[] = [
  { id: 'low', label: '低品质', bitrate: 120, description: '120kbps，省流量' },
  { id: 'medium', label: '中品质', bitrate: 192, description: '192kbps，平衡' },
  { id: 'high', label: '高品质', bitrate: 320, description: '320kbps，高音质' },
  { id: 'lossless', label: '无损', bitrate: 0, description: '原始音质' }
];

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

  // 省流模式
  qualityMode: QualityMode;

  // 睡眠定时
  sleepTimer: SleepTimerState;

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

  // 睡眠定时控制
  setSleepTimer: (mode: SleepTimerMode, minutes: number) => void;
  clearSleepTimer: () => void;
  tickSleepTimer: () => void; // 每分钟调用一次，更新剩余时间

  // 省流模式控制
  setQualityMode: (mode: QualityMode) => void;

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
  sleepTimer: {
    mode: 'off' as SleepTimerMode,
    minutes: 0,
    endTime: null,
    remainingMinutes: 0
  },
  qualityMode: 'lossless' as QualityMode,

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

  setQualityMode: (mode: QualityMode) => {
    set({ qualityMode: mode });
    // 保存到 localStorage
    try {
      localStorage.setItem('qualityMode', mode);
    } catch {}
  },

  setPendingSeekPosition: (position) => set({ pendingSeekPosition: position }),
  clearPendingSeekPosition: () => set({ pendingSeekPosition: null }),

  // 睡眠定时控制
  setSleepTimer: (mode, minutes) => {
    const now = Date.now();
    const endTime = mode !== 'off' ? now + minutes * 60 * 1000 : null;
    set({
      sleepTimer: {
        mode,
        minutes,
        endTime,
        remainingMinutes: mode !== 'off' ? minutes : 0
      }
    });
  },

  clearSleepTimer: () => {
    set({
      sleepTimer: {
        mode: 'off',
        minutes: 0,
        endTime: null,
        remainingMinutes: 0
      }
    });
  },

  tickSleepTimer: () => {
    const state = get();
    const { sleepTimer, isPlaying } = state;
    
    if (sleepTimer.mode === 'off' || !sleepTimer.endTime) return;
    
    const now = Date.now();
    const remaining = Math.max(0, Math.ceil((sleepTimer.endTime - now) / 60000));
    
    // 时间到了
    if (remaining <= 0 && isPlaying) {
      // 停止播放
      set({ isPlaying: false });
      
      // 如果是 repeat 模式，重置定时器
      if (sleepTimer.mode === 'repeat') {
        const newEndTime = Date.now() + sleepTimer.minutes * 60 * 1000;
        set({
          sleepTimer: {
            ...sleepTimer,
            endTime: newEndTime,
            remainingMinutes: sleepTimer.minutes
          }
        });
      } else {
        // 一次性模式，关闭定时器
        set({
          sleepTimer: {
            mode: 'off',
            minutes: 0,
            endTime: null,
            remainingMinutes: 0
          }
        });
      }
      return;
    }
    
    // 更新剩余时间
    if (remaining !== sleepTimer.remainingMinutes) {
      set({
        sleepTimer: {
          ...sleepTimer,
          remainingMinutes: remaining
        }
      });
    }
  },

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

// 权重随机：每多1分，增加10%被随机到的概率
// 评分0分：权重10（基准）
// 评分5分：权重15（比基准高50%）
// 评分10分：权重20（比基准高100%）
function weightedRandomIndex(tracks: Track[]): number {
  const weights = tracks.map(t => Math.max(1, 10 + t.rating));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  let random = Math.random() * totalWeight;
  for (let i = 0; i < weights.length; i++) {
    random -= weights[i];
    if (random <= 0) return i;
  }

  return Math.floor(Math.random() * tracks.length);
}

export type { Track, Playlist, PlayMode };