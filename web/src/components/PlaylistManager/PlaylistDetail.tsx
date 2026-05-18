// 播放列表详情组件
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getPlaylist, refreshPlaylist, updatePlaylist, setSkipSettings, getPlaylistHistory, updatePlaylistItem, removePlaylistItem, recordHistory, getPlaylistTracks } from '../../stores/api';
import { usePlayerStore } from '../../stores/playerStore';
import type { Track, Playlist } from '../../stores/playerStore';
import { AddSourceModal } from './AddSourceModal';
import { PLAY_MODES, TRACK_SORT_OPTIONS, MATCH_FIELDS, MATCH_OP_LABELS, formatDuration } from './utils';
import { QUALITY_MODES } from '../../stores/playerStore';
import { formatTrackTitle } from '../../utils/format';
import { setPendingSeekPosition } from '../AudioPlayer/PlayerBar';
import { pinyin } from 'pinyin-pro';

export function PlaylistDetail({ playlistId, onClose }: {
  playlistId: number;
  onClose: () => void;
}) {
  const [playlist, setPlaylist] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showAddSource, setShowAddSource] = useState(false);
  const [sourceChanges, setSourceChanges] = useState<Record<number, { includeSubdirs?: boolean; removed?: boolean }>>({});
  const [editName, setEditName] = useState('');
  const [editPlayMode, setEditPlayMode] = useState('sequential');
  const [editSkipIntro, setEditSkipIntro] = useState(0);
  const [editSkipOutro, setEditSkipOutro] = useState(0);
  const [editQualityMode, setEditQualityMode] = useState('');
  const [editPlaybackSpeed, setEditPlaybackSpeed] = useState(1.0);
  const [saving, setSaving] = useState(false);
  // 从初始化历史获取的播放位置（用于显示非当前播放列表的信息）
  const [initialLastTrackId, setInitialLastTrackId] = useState<number | null>(null);
  const [initialLastPosition, setInitialLastPosition] = useState<number>(0);

  // 搜索功能状态
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // 从 store 获取实时更新的播放位置（当前播放列表时使用）
  const { lastPlayedPositions } = usePlayerStore();
  const [trackSort, setTrackSort] = useState<string>('name');
  const { currentPlaylist, currentTrack, setCurrentPlaylist, setCurrentTrack, setIsPlaying } = usePlayerStore();
  const prevSortedTracksRef = useRef<Track[]>([]);
  const lastPlayedRef = useRef<HTMLDivElement>(null);


// ✅ 新增：滚动容器 ref
const listContainerRef = useRef<HTMLDivElement>(null);

// ✅ 新增：记录上一次高亮，避免重复滚动
const prevHighlightRef = useRef<number | null | undefined>(null);

  const loadPlaylist = useCallback(async (autoPlay = false, signal?: AbortSignal) => {
    setLoading(true);
    try {
      if (signal?.aborted) return;
      
      const result = await getPlaylist(playlistId);
      if (signal?.aborted) return;
      setPlaylist(result);
      if (result.track_sort) {
        setTrackSort(result.track_sort);
      }

      // 只加载已有数据，不重新扫描
      const tracksResult = await getPlaylistTracks(playlistId);
      if (signal?.aborted) return;
      setTracks(tracksResult.tracks || []);

      let lastTrackId: number | null = null;
      let lastPosition = 0;
      try {
        const history = await getPlaylistHistory(playlistId);
        if (signal?.aborted) return;
        if (history.lastTrack) {
          lastTrackId = history.lastTrack.id;
          lastPosition = history.position || 0;
        }
        setInitialLastTrackId(lastTrackId);
        setInitialLastPosition(lastPosition);
      } catch (err) {
        console.error('获取播放历史失败:', err);
        setInitialLastTrackId(null);
        setInitialLastPosition(0);
      }

      // 自动播放逻辑：如果不是当前播放列表，则自动开始播放
      if (autoPlay && tracksResult.tracks && tracksResult.tracks.length > 0) {
        if (signal?.aborted) return;
        const isCurrentPlaylist = currentPlaylist?.id === playlistId;
        
        if (!isCurrentPlaylist) {
          // 需要先保存当前播放位置
          if (currentPlaylist && currentTrack) {
            const audio = document.querySelector('audio');
            if (audio) {
              const position = audio.currentTime;
              const duration = audio.duration || 0;
              if (position > 1.0 && duration > 0 && position < duration) {
                await recordHistory(currentPlaylist.id, currentTrack.id, position);
              }
            }
          }

          // 设置新的播放列表
          const pl: Playlist = {
            id: playlistId,
            name: result.name,
            createdAt: result.created_at,
            updatedAt: result.updated_at,
            isAuto: result.is_auto === 1,
            playMode: result.play_mode,
            skipIntro: result.skip_intro,
            skipOutro: result.skip_outro,
            qualityMode: result.quality_mode,
            playbackSpeed: result.playback_speed ?? 1.0
          };
          setCurrentPlaylist(pl, tracksResult.tracks);

          // 定位到上次播放的曲目
          let startTrack = tracksResult.tracks[0];
          let seekPosition = 0;

          if (lastTrackId) {
            const lastTrack = tracksResult.tracks.find((t: Track) => t.id === lastTrackId);
            if (lastTrack) {
              startTrack = lastTrack;
              seekPosition = lastPosition;
            }
          }

          setCurrentTrack(startTrack);
          setIsPlaying(true);

          if (seekPosition > 0) {
            setPendingSeekPosition(seekPosition);
          }
        }
      }
    } catch (err) {
      console.error('加载播放列表详情失败:', err);
    } finally {
      setLoading(false);
    }
  }, [playlistId]); // ✅ 不再依赖 currentTrack 等

useEffect(() => {
  const controller = new AbortController();

  // ✅ 只在 playlistId 变化时加载
  loadPlaylist(true, controller.signal);

  return () => controller.abort();
}, [playlistId]); // ✅ 关键：只依赖 playlistId

  // 计算需要高亮和滚动的曲目 ID
  // 当前播放列表用 currentTrack，非当前播放列表用历史记录
  const highlightTrackId = currentPlaylist?.id === playlistId 
    ? currentTrack?.id 
    : initialLastTrackId;
// 当 currentTrack 变化时，滚动到视图中心（使用 scrollIntoView 确保跨平台一致性）
useEffect(() => {
  if (currentPlaylist?.id === playlistId && currentTrack?.id && lastPlayedRef.current) {
    // 使用原生 scrollIntoView 确保移动端兼容性更好
    lastPlayedRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}, [currentPlaylist?.id, currentTrack?.id, playlistId]);

  // 打开设置时初始化表单
  useEffect(() => {
    if (showSettings && playlist) {
      setEditName(playlist.name || '');
      setEditPlayMode(playlist.play_mode || 'sequential');
      setEditSkipIntro(playlist.skip_intro || 0);
      setEditSkipOutro(playlist.skip_outro || 0);
      setEditQualityMode(playlist.quality_mode || '');
      setEditPlaybackSpeed(playlist.playback_speed ?? 1.0);
    }
  }, [showSettings, playlist]);

  // 音轨排序
  const sortedTracks = useMemo(() => {
    let sorted = [...tracks];
    switch (trackSort) {
      case 'name':
        sorted.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-CN'));
        break;
      case 'number': {
        const getNumber = (title: string) => {
          const match = title.match(/^(\d+)/);
          return match ? parseInt(match[1], 10) : Infinity;
        };
        sorted.sort((a, b) => getNumber(a.title) - getNumber(b.title));
        break;
      }
      case 'random':
        for (let i = sorted.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
        }
        break;
      case 'rating':
        sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        break;
    }
    return sorted;
  }, [tracks, trackSort]);

  // 同步展示顺序到播放列表顺序（确保顺序播放与显示顺序一致）
  useEffect(() => {
    if (currentPlaylist?.id === playlistId && sortedTracks.length > 0) {
      const prevJson = JSON.stringify(prevSortedTracksRef.current.map(t => t.id));
      const currJson = JSON.stringify(sortedTracks.map(t => t.id));
      if (prevJson !== currJson) {
        prevSortedTracksRef.current = sortedTracks;
        usePlayerStore.setState({ playlistTracks: sortedTracks });
      }
    }
  }, [sortedTracks, playlistId, currentPlaylist?.id, trackSort]);

  // 搜索过滤和优先级排序
  const filteredTracks = useMemo(() => {
    const list = sortedTracks;
    if (!searchQuery.trim()) return list;

    const q = searchQuery.toLowerCase().trim();
    const queryInitials = pinyin(q, { toneType: 'none', pattern: 'first' }).replace(/\s+/g, '').toLowerCase();
    const queryPinyin = pinyin(q, { toneType: 'none', }).replace(/\s+/g, '').toLowerCase();

    const isSubsequence = (query: string, target: string): boolean => {
      let i = 0, j = 0;
      while (i < query.length && j < target.length) {
        if (query[i] === target[j]) { i++; }
        j++;
      }
      return i === query.length;
    };

    const scored: { track: Track; score: number }[] = [];

    for (const track of list) {
      const title = track.title || '';
      const artist = track.artist || '';
      const path = track.path || '';

      const titlePinyin = pinyin(title, { toneType: 'none' }).replace(/\s+/g, '').toLowerCase();
      const artistPinyin = pinyin(artist, { toneType: 'none' }).replace(/\s+/g, '').toLowerCase();
      const pathPinyin = pinyin(path, { toneType: 'none' }).replace(/\s+/g, '').toLowerCase();

      const titleInitials = pinyin(title, { toneType: 'none', pattern: 'first' }).replace(/\s+/g, '').toLowerCase();
      const artistInitials = pinyin(artist, { toneType: 'none', pattern: 'first' }).replace(/\s+/g, '').toLowerCase();
      const pathInitials = pinyin(path, { toneType: 'none', pattern: 'first' }).replace(/\s+/g, '').toLowerCase();

      let score = 0;

      if (title.toLowerCase().includes(q) || artist.toLowerCase().includes(q) || path.toLowerCase().includes(q)) {
        score = 100;
      } else if (titlePinyin.includes(queryPinyin) || artistPinyin.includes(queryPinyin) || pathPinyin.includes(queryPinyin)) {
        score = 80;
      } else if (titleInitials.includes(queryInitials) || artistInitials.includes(queryInitials) || pathInitials.includes(queryInitials)) {
        score = 60;
      } else if (isSubsequence(queryPinyin, titlePinyin) || isSubsequence(queryPinyin, artistPinyin) || isSubsequence(queryPinyin, pathPinyin)) {
        score = 40;
      } else if (isSubsequence(queryInitials, titleInitials) || isSubsequence(queryInitials, artistInitials) || isSubsequence(queryInitials, pathInitials)) {
        score = 20;
      }

      if (score > 0) {
        scored.push({ track, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const matched = scored.map(s => s.track);
    const unmatched = list.filter(t => !scored.some(s => s.track.id === t.id));
    return [...matched, ...unmatched];
  }, [sortedTracks, searchQuery]);

  // 计算当前高亮曲目的索引
  const highlightIndex = highlightTrackId 
    ? sortedTracks.findIndex(t => t.id === highlightTrackId) 
    : -1;


useEffect(() => {
  if (!lastPlayedRef.current) return;
  if (highlightIndex < 0) return;
  if (loading) return;

  const currentId = highlightTrackId;

  // ✅ 只在切歌时触发
  if (prevHighlightRef.current === currentId) return;
  prevHighlightRef.current = currentId;

  // 使用原生 scrollIntoView 确保移动端兼容性
  lastPlayedRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
}, [highlightTrackId, highlightIndex, loading]);


  const handleSaveSettings = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await updatePlaylist(playlistId, { name: editName.trim(), playMode: editPlayMode, qualityMode: editQualityMode, playbackSpeed: editPlaybackSpeed });
      if (editSkipIntro > 0 || editSkipOutro > 0) {
        await setSkipSettings(playlistId, { skipIntro: editSkipIntro, skipOutro: editSkipOutro });
      }
      setPlaylist((prev: any) => ({
        ...prev,
        name: editName.trim(),
        play_mode: editPlayMode,
        skip_intro: editSkipIntro,
        skip_outro: editSkipOutro,
        quality_mode: editQualityMode,
        playback_speed: editPlaybackSpeed
      }));

      // 处理来源变更
      const changedItems = Object.entries(sourceChanges);
      for (const [itemId, changes] of changedItems) {
        const id = Number(itemId);
        if (changes.removed) {
          await removePlaylistItem(playlistId, id);
        } else if (changes.includeSubdirs !== undefined) {
          await updatePlaylistItem(playlistId, id, { includeSubdirs: changes.includeSubdirs });
        }
      }

      // 如果有来源变更，刷新播放列表
      if (changedItems.length > 0) {
        await handleRefreshAndPlay();
        setSourceChanges({});
      }

      setShowSettings(false);
    } catch (err) {
      console.error('保存设置失败:', err);
      alert('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleRefreshAndPlay = async () => {
    setRefreshing(true);
    
    try {
      const result = await refreshPlaylist(playlistId, false);
      
      if (result.task_id) {
        setRefreshing(false);
        return;
      }
      
      setTracks(result.tracks || []);
      if (result.tracks && result.tracks.length > 0) {
        const pl: Playlist = {
          id: playlistId,
          name: result.playlist.name,
          createdAt: result.playlist.created_at,
          updatedAt: result.playlist.updated_at,
          isAuto: result.playlist.is_auto === 1,
          playMode: result.playlist.play_mode,
          skipIntro: result.playlist.skip_intro,
          skipOutro: result.playlist.skip_outro,
          qualityMode: result.playlist.quality_mode,
          playbackSpeed: result.playlist.playback_speed ?? 1.0
        };
        setCurrentPlaylist(pl, result.tracks);
        setCurrentTrack(result.tracks[0]);
        setIsPlaying(true);
      }
    } catch (err: any) {
      console.error('刷新播放列表失败:', err);
      alert(err.message || '刷新失败');
    } finally {
      setRefreshing(false);
    }
  };

  const handlePlayTrack = (track: Track) => {
    if (tracks.length > 0) {
      const pl: Playlist = {
        id: playlistId,
        name: playlist.name,
        createdAt: playlist.created_at,
        updatedAt: playlist.updated_at,
        isAuto: playlist.is_auto === 1,
        playMode: playlist.play_mode,
        skipIntro: playlist.skip_intro,
        skipOutro: playlist.skip_outro,
        qualityMode: playlist.quality_mode,
        playbackSpeed: playlist.playback_speed ?? 1.0
      };
      setCurrentPlaylist(pl, sortedTracks);
      setCurrentTrack(track);
      setIsPlaying(true);
    }
  };

  // 仅更新本地状态（保存时才发送请求）
  const handleToggleSubdirs = (item: any) => {
    const newValue = item.include_subdirs === 1 ? false : true;
    setPlaylist((prev: any) => ({
      ...prev,
      items: prev.items.map((i: any) =>
        i.id === item.id ? { ...i, include_subdirs: newValue ? 1 : 0 } : i
      )
    }));
    setSourceChanges((prev) => ({
      ...prev,
      [item.id]: { ...prev[item.id], includeSubdirs: newValue }
    }));
  };

  // 仅更新本地状态（保存时才发送请求）
  const handleRemoveSource = (itemId: number) => {
    if (!confirm('确定删除此来源?')) return;
    setPlaylist((prev: any) => ({
      ...prev,
      items: prev.items.filter((i: any) => i.id !== itemId)
    }));
    setSourceChanges((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], removed: true }
    }));
  };

if (loading && !playlist) {
  return <div className="p-4 text-gray-500">加载中...</div>;
}
  if (!playlist) return <div className="p-4 text-gray-500">播放列表不存在</div>;

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="p-3 border-b border-gray-700 flex items-center justify-between">
        <div>
          <h2 className="font-medium">{playlist.name}</h2>
          <div className="text-xs text-gray-500">{tracks.length} 首歌曲</div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setShowSearch(!showSearch); setSearchQuery(''); }} className={`p-2 rounded md:px-3 ${showSearch ? 'bg-purple-600 text-white' : 'bg-gray-600 hover:bg-gray-500'}`} title="搜索">
            <span className="md:hidden">🔍</span><span className="hidden md:inline">🔍 搜索</span>
          </button>
          <select
            value={trackSort}
            onChange={async (e) => {
              const value = e.target.value;
              setTrackSort(value);
              try {
                await updatePlaylist(playlistId, { trackSort: value });
              } catch (err) {
                console.error('保存排序设置失败:', err);
              }
            }}
            className="px-1 py-2 bg-gray-600 hover:bg-gray-500 rounded text-sm"
          >
            {TRACK_SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button onClick={() => setShowSettings(true)} className="p-2 bg-gray-600 hover:bg-gray-500 rounded md:px-3" title="设置">
            <span className="md:hidden">⚙️</span><span className="hidden md:inline">⚙️ 设置</span>
          </button>
          <button onClick={handleRefreshAndPlay} disabled={refreshing} className="p-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded md:px-3" title={refreshing ? '扫描中...' : '重新扫描'}>
            <span className="md:hidden">{refreshing ? '⏳' : '🔄'}</span>
            <span className="hidden md:inline">{refreshing ? '🔄 扫描中...' : '🔄 重新扫描'}</span>
          </button>
          <button onClick={onClose} className="p-2 bg-gray-600 hover:bg-gray-500 rounded md:px-3" title="返回">
            <span className="md:hidden">⬅️</span><span className="hidden md:inline">返回</span>
          </button>
        </div>
      </div>

      {/* 设置弹窗 */}
      {showSettings && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-md max-h-[80vh] m-4 bg-gray-800 rounded-lg overflow-hidden flex flex-col">
            <div className="p-3 border-b border-gray-700 flex items-center justify-between">
              <h3 className="font-medium">设置</h3>
              <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-3">
              <div className="mb-3">
                <label className="block text-sm text-gray-400 mb-1">名称</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-1 bg-gray-700 rounded text-sm"
                />
              </div>
              <div className="mb-3">
                <label className="block text-sm text-gray-400 mb-1">播放模式</label>
                <select
                  value={editPlayMode}
                  onChange={(e) => setEditPlayMode(e.target.value)}
                  className="w-full px-3 py-1 bg-gray-700 rounded text-sm"
                >
                  {PLAY_MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="mb-3">
                <label className="block text-sm text-gray-400 mb-1">省流模式（留空使用全局配置）</label>
                <select
                  value={editQualityMode}
                  onChange={(e) => setEditQualityMode(e.target.value)}
                  className="w-full px-3 py-1 bg-gray-700 rounded text-sm"
                >
                  <option value="">跟随全局设置</option>
                  {QUALITY_MODES.filter(m => m.id !== 'lossless').map((m) => (
                    <option key={m.id} value={m.id}>{m.label} ({m.description})</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-4 mb-3">
                <div className="flex-1">
                  <label className="block text-sm text-gray-400 mb-1">片头跳过 (秒)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={editSkipIntro}
                    onChange={(e) => setEditSkipIntro(Number(e.target.value))}
                    className="w-full px-3 py-1 bg-gray-700 rounded text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm text-gray-400 mb-1">片尾跳过 (秒)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={editSkipOutro}
                    onChange={(e) => setEditSkipOutro(Number(e.target.value))}
                    className="w-full px-3 py-1 bg-gray-700 rounded text-sm"
                  />
                </div>
              </div>
              <div className="mb-3">
                <label className="block text-sm text-gray-400 mb-1">播放速度</label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditPlaybackSpeed(Math.round((editPlaybackSpeed - 0.1) * 10) / 10)}
                    className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                    disabled={editPlaybackSpeed <= 0.5}
                  >−</button>
                  <span className="text-sm font-mono w-12 text-center">{editPlaybackSpeed.toFixed(1)}x</span>
                  <button
                    onClick={() => setEditPlaybackSpeed(Math.round((editPlaybackSpeed + 0.1) * 10) / 10)}
                    className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                    disabled={editPlaybackSpeed >= 2.0}
                  >+</button>
                </div>
              </div>

              {/* 来源列表 */}
              <div className="mt-3 pt-3 border-t border-gray-700">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-gray-500">
                    来源 ({playlist.items?.length || 0})
                    <span className="text-gray-600 ml-1">多个来源之间是"或"关系</span>
                  </div>
                  <button
                    onClick={() => setShowAddSource(true)}
                    className="px-2 py-0.5 bg-purple-600 hover:bg-purple-500 rounded text-xs"
                  >
                    + 添加来源
                  </button>
                </div>
                {playlist.items && playlist.items.length > 0 ? (
                  <div className="space-y-1 max-h-40 overflow-auto">
                    {playlist.items.map((item: any) => (
                      <div key={item.id} className="bg-gray-700/50 px-2 py-1 rounded">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-gray-400">
                            {item.type === 'directory' ? '📁' : item.type === 'filter' ? '🔍' : item.type === 'match' ? '🎯' : '📄'}
                          </span>
                          <span className="flex-1 truncate text-gray-300" title={item.path}>
                            {item.type === 'directory' 
                              ? item.path 
                              : item.type === 'filter' 
                                ? `正则: ${item.filter_regex || '(全部)'}` 
                                : item.type === 'match' 
                                  ? '匹配条件' 
                                  : item.path}
                          </span>
                          {item.type === 'directory' && (
                            <label className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={item.include_subdirs === 1}
                                onChange={() => handleToggleSubdirs(item)}
                                className="w-3 h-3 rounded"
                              />
                              含子目录
                            </label>
                          )}
                          <button
                            onClick={() => handleRemoveSource(item.id)}
                            className="text-red-400 hover:text-red-300 text-xs"
                          >
                            ✕
                          </button>
                        </div>
                        {item.type === 'match' && item.conditions && item.conditions.length > 0 && (
                          <div className="mt-1 pl-6 text-xs text-gray-400">
                            <span className="text-blue-400">条件:</span>{' '}
                            {item.conditions.map((cond: any, idx: number) => (
                              <span key={cond.id || idx}>
                                {idx > 0 && <span className="text-green-400"> 且 </span>}
                                <span>
                                  {MATCH_FIELDS.find(f => f.value === cond.match_field)?.label || cond.match_field}
                                  {' '}
                                  {MATCH_OP_LABELS[cond.match_op] || cond.match_op}
                                  {' '}
                                  <span className="text-blue-300">{cond.match_value}</span>
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500 py-1">暂无来源,请添加</div>
                )}
              </div>
            </div>
            <div className="p-3 border-t border-gray-700 flex gap-2">
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className="flex-1 px-3 py-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-sm"
              >
                {saving ? '保存中...' : '保存'}
              </button>
              <button onClick={() => setShowSettings(false)} className="flex-1 px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-sm">取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 搜索输入框 */}
      {showSearch && (
        <div className="p-2 border-b border-gray-700 bg-gray-800/50 flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索列表中的歌曲（支持拼音/首字母）"
            className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1 text-sm"
          />
          <button
            onClick={() => { setShowSearch(false); setSearchQuery(''); }}
            className="p-1 text-gray-400 hover:text-white"
            title="关闭搜索"
          >
            ✕
          </button>
        </div>
      )}

      {/* 添加来源弹窗 */}
      {showAddSource && (
        <AddSourceModal
          playlistId={playlistId}
          onClose={() => setShowAddSource(false)}
          onSuccess={loadPlaylist}
        />
      )}

      {/* 音轨列表 */}
      <div ref={listContainerRef} className="flex-1 overflow-auto p-2">
        {tracks.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            暂无音轨<br/>
            <span className="text-sm">添加来源后点击"重新扫描"</span>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredTracks.map((track, index) => {
              const isLastPlayed = track.id === highlightTrackId;
              
              // 当前播放列表时，从 store 获取实时位置
              // 非当前播放列表时，使用初始化时获取的历史位置
              const storeKey = `${playlistId}-${track.id}`;
              const storePosition = lastPlayedPositions[storeKey];
              const displayPosition = currentPlaylist?.id === playlistId 
                ? (track.id === currentTrack?.id ? (storePosition ?? 0) : 0)
                : (track.id === initialLastTrackId ? initialLastPosition : 0);
              
              return (
                <div
                  key={track.id}
                  ref={isLastPlayed ? lastPlayedRef : null}
                  onClick={() => handlePlayTrack(track)}
                  className={`flex items-center gap-2 p-2 rounded cursor-pointer ${
                    isLastPlayed ? 'bg-purple-900/40 border border-purple-500/50' : 'hover:bg-gray-700'
                  }`}
                >
                  <span className="text-gray-500 w-6 text-center">{index + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{formatTrackTitle(track)}</div>
                    <div className="text-xs text-gray-500">{track.artist}</div>
                  </div>
                  {isLastPlayed && (
                    <span className="text-xs text-purple-400 bg-purple-900/50 px-2 py-0.5 rounded">
                      上次播放{displayPosition > 0 ? ` (${formatDuration(displayPosition)})` : ''}
                    </span>
                  )}
                  <span className="text-xs text-gray-600">{track.duration ? formatDuration(track.duration) : ''}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}