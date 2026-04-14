// moonPlayer 共享类型定义
// 前后端共用

// ============ 音轨相关 ============

export interface Track {
  id: number;
  path: string;              // 文件路径
  title: string;             // 标题（从元数据或文件名提取）
  artist?: string;           // 艺术家
  album?: string;             // 专辑
  duration?: number;         // 时长（秒）
  rating: number;             // 评分（整数，可负）
  playCount: number;          // 播放次数
  skipCount: number;         // 快切次数
  lastPlayed?: number;       // 最后播放时间戳
  dateAdded: number;          // 添加时间戳
}

// ============ 播放列表相关 ============

export type PlaylistItemType = 'directory' | 'file';

export interface PlaylistItem {
  id: number;
  playlistId: number;
  type: PlaylistItemType;
  path: string;              // 目录路径或文件路径
  includeSubdirs: boolean;   // 仅对目录有效
  order: number;             // 排序
}

export interface Playlist {
  id: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  isAuto: boolean;           // 是否自动创建
}

export interface PlaylistWithItems extends Playlist {
  items: PlaylistItem[];
}

// ============ 播放历史 ============

export interface PlayHistory {
  id: number;
  playlistId: number;
  trackId: number;
  position: number;          // 播放位置（秒）
  timestamp: number;         // 记录时间戳
}

// ============ 播放模式 ============

export type PlayMode =
  | 'sequential'    // 顺序播放
  | 'shuffle'       // 随机播放（可重复）
  | 'weighted'       // 权重随机（按评分）
  | 'random'         // 乱序（打乱后顺序播放）
  | 'single-loop';   // 单曲循环

// ============ 配置 ============

export interface Settings {
  musicPath: string;         // 音乐目录路径
  defaultPlayMode: PlayMode;
  volume: number;            // 0-100
}

// ============ API 响应 ============

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============ 文件浏览 ============

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

// ============ 播放状态 ============

export interface PlayerState {
  currentTrack: Track | null;
  currentPlaylist: PlaylistWithItems | null;
  playMode: PlayMode;
  isPlaying: boolean;
  position: number;          // 当前播放位置（秒）
  volume: number;
  shuffleQueue: number[];    // 乱序模式下的打乱队列
}