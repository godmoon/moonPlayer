// 文件浏览器工具函数

import type { Track, Playlist } from '../../stores/playerStore';

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface BrowseResult {
  currentPath: string;
  rootPath: string;
  parentPath: string | null;
  directories: FileNode[];
  files: FileNode[];
  isRootsView?: boolean;
}

/** @deprecated 使用 toTrack/toTracks 代替 */
export function convertWebdavTracks(tracks: any[]): Track[] {
  return tracks.map(toTrack);
}

// 通用音轨数据转换（服务端 snake_case → store camelCase）
function toTrack(t: Record<string, any>): Track {
  return {
    id: t.id,
    path: t.path,
    title: t.title,
    artist: t.artist || undefined,
    album: t.album || undefined,
    duration: t.duration || undefined,
    rating: t.rating || 0,
    playCount: t.playCount ?? t.play_count ?? 0,
    skipCount: t.skipCount ?? t.skip_count ?? 0,
    lastPlayed: t.lastPlayed ?? t.last_played ?? undefined,
    dateAdded: t.dateAdded ?? t.date_added ?? Date.now(),
  };
}

export function toTracks(tracks: Record<string, any>[]): Track[] {
  return tracks.map(toTrack);
}

// 创建播放列表对象
export function createPlaylistObject(playlist: any): Playlist {
  return {
    id: playlist.id,
    name: playlist.name,
    createdAt: playlist.created_at || playlist.createdAt,
    updatedAt: playlist.updated_at || playlist.updatedAt,
    isAuto: playlist.is_auto === 1 || playlist.isAuto === true,
    playMode: playlist.play_mode || playlist.playMode || 'sequential',
    skipIntro: playlist.skip_intro || playlist.skipIntro,
    skipOutro: playlist.skip_outro || playlist.skipOutro,
    playbackSpeed: playlist.playback_speed ?? playlist.playbackSpeed ?? 1.0
  };
}