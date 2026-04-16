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

// 转换 WebDAV 音轨数据
export function convertWebdavTracks(tracks: any[]): Track[] {
  return tracks.map((t: any) => ({
    id: t.id,
    path: t.path,
    title: t.title,
    artist: t.artist || '',
    album: t.album || '',
    duration: t.duration || 0,
    rating: t.rating || 0,
    playCount: t.play_count || 0,
    skipCount: t.skip_count || 0,
    dateAdded: t.date_added || Date.now()
  }));
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
    skipOutro: playlist.skip_outro || playlist.skipOutro
  };
}