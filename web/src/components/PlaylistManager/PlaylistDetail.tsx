// 播放列表详情组件
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getPlaylist, refreshPlaylist, updatePlaylist, setSkipSettings, getPlaylistHistory, updatePlaylistItem, removePlaylistItem, recordHistory, getPlaylistTracks } from '../../stores/api';
import { usePlayerStore } from '../../stores/playerStore';
import type { Track, Playlist } from '../../stores/playerStore';
import { AddSourceModal } from './AddSourceModal';
import { PLAY_MODES, TRACK_SORT_OPTIONS, MATCH_FIELDS, MATCH_OP_LABELS, formatDuration } from './utils';
import { formatTrackTitle } from '../../utils/format';
import { setPendingSeekPosition } from '../AudioPlayer/PlayerBar';

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
  const [editName, setEditName] = useState('');
  const [editPlayMode, setEditPlayMode] = useState('sequential');
  const [editSkipIntro, setEditSkipIntro] = useState(0);
  const [editSkipOutro, setEditSkipOutro] = useState(0);
  const [saving, setSaving] = useState(false);
  // 从初始化历史获取的播放位置（用于显示非当前播放列表的信息）
  const [initialLastTrackId, setInitialLastTrackId] = useState<number | null>(null);
  const [initialLastPosition, setInitialLastPosition] = useState<number>(0);

  // 从 store 获取实时更新的播放位置（当前播放列表时使用）
  const { lastPlayedPositions } = usePlayerStore();
  const [trackSort, setTrackSort] = useState<string>('name');
  const { currentPlaylist, currentTrack, setCurrentPlaylist, setCurrentTrack, setIsPlaying } = usePlayerStore();
  const lastPlayedRef = useRef<HTMLDivElement>(null);

  const loadPlaylist = useCallback(async (autoPlay = false, signal?: AbortSignal) => {
    setLoading(true);
    try {
      if (signal?.aborted) return;
      
      const result = await getPlaylist(playlistId);
      if (signal?.aborted) return;
      setPlaylist(result);
      
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
            skipOutro: result.skip_outro
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
  }, [playlistId, currentPlaylist, currentTrack, setCurrentPlaylist, setCurrentTrack, setIsPlaying]);

  useEffect(() => {
    const controller = new AbortController();
    loadPlaylist(true, controller.signal); // 首次加载时自动播放
    return () => controller.abort();
  }, [loadPlaylist]);

  // 计算需要高亮和滚动的曲目 ID
  // 当前播放列表用 currentTrack，非当前播放列表用历史记录
  const highlightTrackId = currentPlaylist?.id === playlistId 
    ? currentTrack?.id 
    : initialLastTrackId;

  // 滚动到高亮的音轨
  useEffect(() => {
    if (lastPlayedRef.current && highlightTrackId) {
      lastPlayedRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightTrackId, loading]);

  // 打开设置时初始化表单
  useEffect(() => {
    if (showSettings && playlist) {
      setEditName(playlist.name || '');
      setEditPlayMode(playlist.play_mode || 'sequential');
      setEditSkipIntro(playlist.skip_intro || 0);
      setEditSkipOutro(playlist.skip_outro || 0);
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

  const handleSaveSettings = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await updatePlaylist(playlistId, { name: editName.trim(), playMode: editPlayMode });
      if (editSkipIntro > 0 || editSkipOutro > 0) {
        await setSkipSettings(playlistId, { skipIntro: editSkipIntro, skipOutro: editSkipOutro });
      }
      setPlaylist((prev: any) => ({
        ...prev,
        name: editName.trim(),
        play_mode: editPlayMode,
        skip_intro: editSkipIntro,
        skip_outro: editSkipOutro
      }));
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
      const result = await refreshPlaylist(playlistId);
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
          skipOutro: result.playlist.skip_outro
        };
        setCurrentPlaylist(pl, result.tracks);
        setCurrentTrack(result.tracks[0]);
        setIsPlaying(true);
      }
    } catch (err) {
      console.error('刷新播放列表失败:', err);
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
        skipOutro: playlist.skip_outro
      };
      setCurrentPlaylist(pl, tracks);
      setCurrentTrack(track);
      setIsPlaying(true);
    }
  };

  // 更新目录来源的子目录设置
  const handleToggleSubdirs = async (item: any) => {
    const newValue = item.include_subdirs === 1 ? false : true;
    try {
      await updatePlaylistItem(playlistId, item.id, { includeSubdirs: newValue });
      setPlaylist((prev: any) => ({
        ...prev,
        items: prev.items.map((i: any) =>
          i.id === item.id ? { ...i, include_subdirs: newValue ? 1 : 0 } : i
        )
      }));
      handleRefreshAndPlay();
    } catch (err) {
      console.error('更新设置失败:', err);
      alert('更新失败');
    }
  };

  // 删除来源
  const handleRemoveSource = async (itemId: number) => {
    if (!confirm('确定删除此来源?')) return;
    try {
      await removePlaylistItem(playlistId, itemId);
      setPlaylist((prev: any) => ({
        ...prev,
        items: prev.items.filter((i: any) => i.id !== itemId)
      }));
    } catch (err) {
      console.error('删除来源失败:', err);
      alert('删除失败');
    }
  };

  if (loading) return <div className="p-4 text-gray-500">加载中...</div>;
  if (!playlist) return <div className="p-4 text-gray-500">播放列表不存在</div>;

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="p-3 border-b border-gray-700 flex items-center justify-between">
        <div>
          <h2 className="font-medium">{playlist.name}</h2>
          <div className="text-xs text-gray-500">{tracks.length} 首歌曲 · 模式: {PLAY_MODES.find(m => m.value === playlist.play_mode)?.label || playlist.play_mode}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowSettings(true)} className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-sm">⚙️ 设置</button>
          <button onClick={handleRefreshAndPlay} disabled={refreshing} className="px-3 py-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded text-sm">
            {refreshing ? '刷新中...' : '🔄 重新扫描'}
          </button>
          <button onClick={onClose} className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-sm">返回</button>
        </div>
      </div>

      {/* 设置面板 */}
      {showSettings && (
        <div className="p-3 border-b border-gray-700 bg-gray-800">
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
          <div className="flex gap-2">
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="px-3 py-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-sm"
            >
              {saving ? '保存中...' : '保存'}
            </button>
            <button onClick={() => setShowSettings(false)} className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-sm">取消</button>
          </div>
        </div>
      )}

      {/* 来源列表 */}
      <div className="p-2 border-b border-gray-700 bg-gray-800/30">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs text-gray-500">
            来源 ({playlist.items?.length || 0})
            <span className="text-gray-600 ml-2">多个来源之间是"或"关系</span>
          </div>
          <button
            onClick={() => setShowAddSource(true)}
            className="px-2 py-0.5 bg-purple-600 hover:bg-purple-500 rounded text-xs"
          >
            + 添加来源
          </button>
        </div>
        {playlist.items && playlist.items.length > 0 ? (
          <div className="space-y-1">
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
                {/* 显示匹配类型的条件 */}
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

      {/* 添加来源弹窗 */}
      {showAddSource && (
        <AddSourceModal
          playlistId={playlistId}
          onClose={() => setShowAddSource(false)}
          onSuccess={loadPlaylist}
        />
      )}

      {/* 音轨排序 */}
      <div className="px-3 py-1 border-b border-gray-700 flex items-center gap-2 text-sm">
        <span className="text-gray-400">排序:</span>
        <select
          value={trackSort}
          onChange={(e) => setTrackSort(e.target.value)}
          className="px-2 py-0.5 bg-gray-700 rounded text-sm"
        >
          {TRACK_SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* 音轨列表 */}
      <div className="flex-1 overflow-auto p-2">
        {tracks.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            暂无音轨<br/>
            <span className="text-sm">添加来源后点击"重新扫描"</span>
          </div>
        ) : (
          <div className="space-y-1">
            {sortedTracks.map((track, index) => {
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
                  <span className="text-green-500">🎵</span>
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