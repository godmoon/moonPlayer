// 搜索组件
import { useState, useCallback, useEffect, useRef } from 'react';
import { searchTracks, scanTracks, createPlaylist, refreshPlaylist, findPlaylistForDir, getTags, getAllTracks, filterTracksByConditions } from '../stores/api';
import { usePlayerStore } from '../stores/playerStore';
import type { Track } from '../stores/playerStore';
import { createPlaylistObject } from './FileBrowser/utils';
import { MATCH_FIELDS, MATCH_OP_LABELS } from './PlaylistManager/utils';

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
  
  // 匹配条件状态
  const [matchConditions, setMatchConditions] = useState<{ match_field: string; match_op: string; match_value: string }[]>([]);
  const [matchField, setMatchField] = useState('rating');
  const [matchOp, setMatchOp] = useState('>');
  const [matchValue, setMatchValue] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  const { setCurrentPlaylist, setCurrentTrack, setIsPlaying } = usePlayerStore();

  // 加载标签列表
  useEffect(() => {
    getTags().then(setTags).catch(console.error);
  }, []);

  // 添加匹配条件
  const handleAddCondition = () => {
    if (!matchValue.trim()) {
      alert('请输入匹配值');
      return;
    }
    setMatchConditions(prev => [...prev, {
      match_field: matchField,
      match_op: matchOp,
      match_value: matchValue
    }]);
    setMatchValue('');
  };

  // 移除匹配条件
  const handleRemoveCondition = (index: number) => {
    setMatchConditions(prev => prev.filter((_, i) => i !== index));
  };

  // 加载数据（搜索或筛选）
  const loadData = useCallback(async (searchQuery: string, conditions: { match_field: string; match_op: string; match_value: string }[]) => {
    setLoading(true);
    setSearched(true);
    try {
      let tracks: any[];
      
      if (searchQuery.trim()) {
        // 有搜索词，使用搜索 API
        tracks = await searchTracks(searchQuery);
        
        // 如果同时有筛选条件，在前端进一步筛选搜索结果
        if (conditions.length > 0) {
          tracks = tracks.filter(track => {
            for (const cond of conditions) {
              if (!checkConditionLocal(track, cond)) {
                return false;
              }
            }
            return true;
          });
        }
      } else {
        // 无搜索词，使用筛选条件 API（服务端筛选）
        tracks = await filterTracksByConditions(conditions);
      }
      
      setResults(tracks);
    } catch (err) {
      console.error('加载失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 本地条件检查（用于搜索结果的二次筛选）
  const checkConditionLocal = (track: any, cond: { match_field: string; match_op: string; match_value: string }): boolean => {
    const fieldValue = track[cond.match_field];
    const condValue = cond.match_value;
    const numValue = parseFloat(condValue);
    
    switch (cond.match_op) {
      case '>':
        return typeof fieldValue === 'number' && fieldValue > numValue;
      case '<':
        return typeof fieldValue === 'number' && fieldValue < numValue;
      case '>=':
        return typeof fieldValue === 'number' && fieldValue >= numValue;
      case '<=':
        return typeof fieldValue === 'number' && fieldValue <= numValue;
      case '=':
        return String(fieldValue || '') === String(condValue);
      case 'contains':
        if (cond.match_field === 'tags') {
          try {
            const tagList = track.tags ? (typeof track.tags === 'string' ? JSON.parse(track.tags) : track.tags) : [];
            return tagList.some((t: string) => t.includes(condValue));
          } catch { return false; }
        }
        return String(fieldValue || '').includes(condValue);
      case 'not_contains':
        if (cond.match_field === 'tags') {
          try {
            const tagList = track.tags ? (typeof track.tags === 'string' ? JSON.parse(track.tags) : track.tags) : [];
            return !tagList.some((t: string) => t.includes(condValue));
          } catch { return true; }
        }
        return !String(fieldValue || '').includes(condValue);
      default:
        return false;
    }
  };

  // 防抖搜索/筛选
  useEffect(() => {
    const timer = setTimeout(() => {
      // 搜索框有内容 或 有筛选条件，才触发
      if (query.trim() || matchConditions.length > 0) {
        loadData(query, matchConditions);
      } else {
        // 空搜索时默认加载全部（100条）
        setLoading(true);
        setSearched(true);
        getAllTracks()
          .then(setResults)
          .catch(console.error)
          .finally(() => setLoading(false));
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, matchConditions, loadData]);

  // 初始化加载（空搜索显示全部100条）
  useEffect(() => {
    setLoading(true);
    setSearched(true);
    getAllTracks()
      .then(setResults)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

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

      {/* 匹配条件 */}
      <div className="p-3 border-b border-gray-700 bg-gray-800/50">
        <div className="text-xs text-gray-400 mb-2">筛选条件（多条件 AND）:</div>
        
        {/* 已添加的条件列表 */}
        {matchConditions.length > 0 && (
          <div className="mb-2 border border-gray-600 rounded p-2">
            {matchConditions.map((cond, index) => (
              <div key={index} className="flex items-center gap-2 py-0.5">
                <span className="text-sm flex-1">
                  {MATCH_FIELDS.find(f => f.value === cond.match_field)?.label || cond.match_field}
                  {' '}
                  {MATCH_OP_LABELS[cond.match_op] || cond.match_op}
                  {' '}
                  <span className="text-blue-400">{cond.match_value}</span>
                </span>
                <button
                  onClick={() => handleRemoveCondition(index)}
                  className="text-red-400 hover:text-red-300 text-xs"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        
        {/* 添加新条件 */}
        <div className="flex gap-2 items-center">
          <select
            value={matchField}
            onChange={(e) => {
              setMatchField(e.target.value);
              const field = MATCH_FIELDS.find(f => f.value === e.target.value);
              if (field) setMatchOp(field.ops[0]);
            }}
            className="px-2 py-1 bg-gray-700 rounded text-sm"
          >
            {MATCH_FIELDS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          <select
            value={matchOp}
            onChange={(e) => setMatchOp(e.target.value)}
            className="px-2 py-1 bg-gray-700 rounded text-sm"
          >
            {MATCH_FIELDS.find(f => f.value === matchField)?.ops.map((op) => (
              <option key={op} value={op}>{MATCH_OP_LABELS[op] || op}</option>
            ))}
          </select>
          {matchField === 'tags' ? (
            <select
              value={matchValue}
              onChange={(e) => setMatchValue(e.target.value)}
              className="flex-1 px-2 py-1 bg-gray-700 rounded text-sm"
            >
              <option value="">选择标签...</option>
              {tags.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={matchValue}
              onChange={(e) => setMatchValue(e.target.value)}
              placeholder="值..."
              className="flex-1 px-2 py-1 bg-gray-700 rounded text-sm"
            />
          )}
          <button
            onClick={handleAddCondition}
            disabled={!matchValue.trim()}
            className="px-2 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm"
          >
            添加
          </button>
        </div>
      </div>

      {/* 搜索结果 */}
      <div className="flex-1 overflow-auto p-2">
        {loading ? (
          <div className="text-center text-gray-500 py-8">加载中...</div>
        ) : searched && results.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            未找到符合条件的内容
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
                {track.rating !== undefined && track.rating !== 0 && (
                  <span className="text-xs text-yellow-500" title={`评分: ${track.rating}`}>
                    ⭐{track.rating > 0 ? `+${track.rating}` : track.rating}
                  </span>
                )}
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