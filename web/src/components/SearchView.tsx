// 搜索组件
import { useState, useCallback, useEffect, useRef } from 'react';
import { searchTracks, scanTracks, createPlaylist, refreshPlaylist, findPlaylistForDir } from '../stores/api';
import { usePlayerStore } from '../stores/playerStore';
import type { Track } from '../stores/playerStore';
import { createPlaylistObject } from './FileBrowser/utils';

// 高亮匹配文本
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  
  // 尝试直接匹配
  const idx = lowerText.indexOf(lowerQuery);
  if (idx >= 0) {
    return (
      <>
        {text.slice(0, idx)}
        <span className="text-purple-400">{text.slice(idx, idx + query.length)}</span>
        {text.slice(idx + query.length)}
      </>
    );
  }
  
  // 返回原文本（拼音匹配不进行高亮）
  return text;
}

export function SearchView() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { setCurrentPlaylist, setCurrentTrack, setIsPlaying } = usePlayerStore();

  // 搜索处理
  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }

    setLoading(true);
      setSearched(true);
    try {
      // 后端已经做了拼音搜索，直接使用结果
      const tracks = await searchTracks(q);
      setResults(tracks);
    } catch (err) {
      console.error('搜索失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 防抖搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query) {
        handleSearch(query);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, handleSearch]);

  // 播放搜索结果中的文件（与浏览页面逻辑一致）
  const handlePlayFile = async (track: any) => {
    const filePath = track.path;
    
    // 从路径提取父目录
    const pathParts = filePath.split('/');
    const parentDir = pathParts.slice(0, -1).join('/');
    
    try {
      const result = await scanTracks([filePath]);
      const trackId = result.insertedIds[0] || result.existingIds[0];
      if (!trackId) return;

      // 查找或创建该目录的播放列表
      const existing = await findPlaylistForDir(parentDir);
      let playlist: any;

      if (existing.playlist) {
        playlist = existing.playlist;
        const refreshed = await refreshPlaylist(playlist.id);
        let trackList = refreshed.tracks as Track[];

        const existingTrack = trackList.find((t: Track) => t.id === trackId);
        if (!existingTrack) {
          await (await import('../stores/api')).addPlaylistItem(playlist.id, 'file', filePath, false);
          const refreshed2 = await refreshPlaylist(playlist.id);
          trackList = refreshed2.tracks as Track[];
        }

        if (trackList.length > 0) {
          setCurrentPlaylist(createPlaylistObject(playlist), trackList);
          const targetTrack = trackList.find((t: Track) => t.id === trackId) || trackList[0];
          setCurrentTrack(targetTrack);
          setIsPlaying(true);
        }
      } else {
        // 创建以父目录名命名的播放列表
        const playlistName = parentDir.split('/').filter(Boolean).pop() || '临时播放列表';
        playlist = await createPlaylist(playlistName, [
          { type: 'directory', path: parentDir, includeSubdirs: false }
        ], true);

        const refreshed = await refreshPlaylist(playlist.id);
        const trackList = refreshed.tracks as Track[];

        if (trackList.length > 0) {
          setCurrentPlaylist(createPlaylistObject(playlist), trackList);
          const targetTrack = trackList.find((t: Track) => t.id === trackId) || trackList[0];
          setCurrentTrack(targetTrack);
          setIsPlaying(true);
        }
      }
    } catch (err) {
      console.error('播放失败:', err);
    }
  };

  // 监听侧边栏重置事件
  useEffect(() => {
    const handleReset = (e: CustomEvent) => {
      if (e.detail.tab === 'search') {
        inputRef.current?.focus();
      }
    };
    window.addEventListener('sidebar-reset', handleReset as EventListener);
    return () => window.removeEventListener('sidebar-reset', handleReset as EventListener);
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* 搜索框 */}
      <div className="p-3 border-b border-gray-700">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索歌曲（支持拼音/首字母）"
            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-2 pl-10 text-white placeholder-gray-400 focus:outline-none focus:border-purple-500"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
          {query && (
            <button
              onClick={() => {
                setQuery('');
                setResults([]);
                setSearched(false);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
        <div className="text-xs text-gray-500 mt-1">
          支持文件名、路径、演唱者搜索，支持拼音首字母
        </div>
      </div>

      {/* 搜索结果 */}
      <div className="flex-1 overflow-auto p-2">
        {loading ? (
          <div className="text-center text-gray-500 py-8">搜索中...</div>
        ) : searched && results.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            未找到匹配的歌曲
          </div>
        ) : (
          <div className="space-y-1">
            {results.map((track) => (
              <div
                key={track.id}
                className="flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer"
                onClick={() => handlePlayFile(track)}
              >
                <span className="text-green-500">🎵</span>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm">
                    {highlightMatch(track.title || track.path.split('/').pop() || '', query)}
                  </div>
                  {track.artist && (
                    <div className="text-xs text-gray-400 truncate">
                      {track.artist} {track.album && `- ${track.album}`}
                    </div>
                  )}
                  <div className="text-xs text-gray-500 truncate">
                    {track.path}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePlayFile(track);
                  }}
                  className="px-2 py-1 bg-purple-600 hover:bg-purple-500 rounded text-xs"
                  title="播放"
                >
                  ▶️
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}