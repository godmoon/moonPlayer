// API 请求封装
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000
});

// ========== 文件浏览 ==========

export async function getMusicPaths(): Promise<string[]> {
  const res = await api.get('/music-paths');
  return res.data.paths;
}

export async function setMusicPaths(paths: string[]): Promise<void> {
  await api.post('/music-paths', { paths });
}

export async function getRoots(): Promise<{ name: string; path: string }[]> {
  const res = await api.get('/roots');
  return res.data.roots;
}

export interface BrowseResult {
  currentPath: string;
  rootPath: string;
  parentPath: string | null;
  directories: Array<{ name: string; path: string; isDirectory: true }>;
  files: Array<{ name: string; path: string; isDirectory: false }>;
  isRootsView?: boolean;
}

export async function browseDirectory(dir?: string): Promise<BrowseResult> {
  const res = await api.get('/browse', { params: { dir } });
  return res.data;
}

// ========== 播放列表 ==========

export async function getPlaylists(): Promise<any[]> {
  const res = await api.get('/playlists');
  return res.data;
}

export async function getPlaylist(id: number): Promise<any> {
  const res = await api.get(`/playlists/${id}`);
  return res.data;
}

export async function createPlaylist(name: string, items: any[] = [], isAuto = false): Promise<any> {
  const res = await api.post('/playlists', { name, items, isAuto });
  return res.data;
}

export async function updatePlaylist(id: number, data: { name?: string; items?: any[]; playMode?: string; skipIntro?: number; skipOutro?: number }): Promise<void> {
  await api.put(`/playlists/${id}`, data);
}

export async function deletePlaylist(id: number): Promise<void> {
  await api.delete(`/playlists/${id}`);
}

export async function addPlaylistItem(playlistId: number, type: 'directory' | 'file' | 'filter', path: string, includeSubdirs = false): Promise<any> {
  const res = await api.post(`/playlists/${playlistId}/items`, { type, path, includeSubdirs });
  return res.data;
}

export async function removePlaylistItem(playlistId: number, itemId: number): Promise<void> {
  await api.delete(`/playlists/${playlistId}/items/${itemId}`);
}

export async function refreshPlaylist(playlistId: number): Promise<{ playlist: any; tracks: any[] }> {
  const res = await api.post(`/playlists/${playlistId}/refresh`);
  return res.data;
}

// ========== 音轨 ==========

export async function scanTracks(paths: string[]): Promise<{ insertedIds: number[]; existingIds: number[] }> {
  const res = await api.post('/tracks/scan', { paths });
  return res.data;
}

export async function getTrack(id: number): Promise<any> {
  const res = await api.get(`/tracks/${id}`);
  return res.data;
}

export async function updateTrackRating(id: number, delta: number): Promise<{ rating: number }> {
  const res = await api.put(`/tracks/${id}/rating`, { delta });
  return res.data;
}

export async function recordPlay(id: number, completed: boolean, position: number, playlistId?: number): Promise<void> {
  await api.post(`/tracks/${id}/play`, { completed, position, playlistId });
}

export async function searchTracks(query: string): Promise<any[]> {
  const res = await api.get('/tracks/search', { params: { q: query } });
  return res.data.tracks;
}

export async function getTopRatedTracks(limit = 100): Promise<any[]> {
  const res = await api.get('/tracks/top-rated', { params: { limit } });
  return res.data.tracks;
}

export async function batchRating(trackIds: number[], rating: number): Promise<{ updated: number }> {
  const res = await api.post('/tracks/batch-rating', { trackIds, rating });
  return res.data;
}

export async function resetAllRatings(): Promise<void> {
  await api.post('/tracks/reset-rating');
}

export async function filterTracks(filters: { artist?: string; album?: string; title?: string; minRating?: number; maxRating?: number }): Promise<any[]> {
  const res = await api.get('/tracks/filter', { params: filters });
  return res.data.tracks;
}

export async function deleteTrack(trackId: number): Promise<void> {
  await api.delete(`/tracks/${trackId}`);
}

export async function getLowRatedTracks(threshold = -5, limit = 100): Promise<any[]> {
  const res = await api.get('/tracks/low-rated', { params: { threshold, limit } });
  return res.data.tracks;
}

// ========== 历史记录 ==========

export async function getRecentPlaylists(): Promise<any[]> {
  const res = await api.get('/history/playlists');
  return res.data;
}

export async function getPlaylistHistory(playlistId: number): Promise<any> {
  const res = await api.get(`/history/playlist/${playlistId}`);
  return res.data;
}

export async function deletePlaylistHistory(playlistId: number): Promise<void> {
  await api.delete(`/history/playlist/${playlistId}`);
}

export async function recordHistory(playlistId: number, trackId: number, position: number): Promise<void> {
  await api.post('/history', { playlistId, trackId, position });
}

// ========== 流媒体 ==========

export function getStreamUrl(trackId: number): string {
  return `/api/stream/${trackId}`;
}

export async function getDuration(trackId: number): Promise<number | null> {
  try {
    const res = await api.get(`/duration/${trackId}`);
    return res.data.duration;
  } catch {
    return null;
  }
}

// ========== 跳过设置 ==========

export async function getSkipSettings(playlistId: number): Promise<{ skipIntro: number; skipOutro: number }> {
  const res = await api.get(`/playlists/${playlistId}/skip-settings`);
  return res.data;
}

export async function setSkipSettings(playlistId: number, settings: { skipIntro?: number; skipOutro?: number }): Promise<void> {
  await api.put(`/playlists/${playlistId}/skip-settings`, settings);
}

export async function findPlaylistForDir(dir: string): Promise<{ playlist: any | null }> {
  const res = await api.get('/find-playlist-for-dir', { params: { dir } });
  return res.data;
}

// ========== WebDAV ==========

export interface WebdavConfig {
  id: number;
  name: string;
  url: string;
  username?: string;
  base_path?: string;
}

export async function getWebdavConfigs(): Promise<WebdavConfig[]> {
  const res = await api.get('/webdav');
  return res.data.configs;
}

export async function addWebdavConfig(config: { name: string; url: string; username?: string; password?: string; base_path?: string }): Promise<WebdavConfig> {
  const res = await api.post('/webdav', config);
  return res.data;
}

export async function updateWebdavConfig(id: number, config: Partial<{ name: string; url: string; username: string; password: string; base_path: string }>): Promise<{ success: boolean }> {
  const res = await api.put(`/webdav/${id}`, config);
  return res.data;
}

export async function deleteWebdavConfig(id: number): Promise<{ success: boolean }> {
  const res = await api.delete(`/webdav/${id}`);
  return res.data;
}

export async function testWebdavConfig(id: number): Promise<{ success: boolean; message: string }> {
  const res = await api.post(`/webdav/${id}/test`);
  return res.data;
}

export async function browseWebdav(id: number, dir?: string): Promise<{
  currentPath: string;
  parentPath: string | null;
  directories: Array<{ name: string; path: string; isDirectory: true }>;
  files: Array<{ name: string; path: string; isDirectory: false; size: number; lastModified: string }>;
  configId: number;
}> {
  const res = await api.get(`/webdav/${id}/browse`, { params: { dir } });
  return res.data;
}

export function getWebdavStreamUrl(configId: number, filePath: string): string {
  return `/api/webdav/${configId}/stream?path=${encodeURIComponent(filePath)}`;
}

export async function scanWebdavDirectory(configId: number, options: {
  dir?: string;
  playlistId?: number;
  playlistName?: string;
  includeSubdirs?: boolean;
}): Promise<{ playlist: any; tracks: any[]; scanned: number }> {
  const res = await api.post(`/webdav/${configId}/scan`, options);
  return res.data;
}

export async function recordSkipIntro(trackId: number, playlistId: number, position: number): Promise<void> {
  await api.post('/skip/intro', { trackId, playlistId, position });
}

export async function recordSkipOutro(trackId: number, playlistId: number, position: number): Promise<void> {
  await api.post('/skip/outro', { trackId, playlistId, position });
}