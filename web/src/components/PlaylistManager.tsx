// 播放列表管理组件
import { useState, useEffect, useCallback } from 'react';
import { getPlaylists, getPlaylist, createPlaylist, deletePlaylist, refreshPlaylist, updatePlaylist, setSkipSettings, addPlaylistItem, removePlaylistItem, updatePlaylistItem, browseDirectory, getRoots } from '../stores/api';
import { usePlayerStore } from '../stores/playerStore';
import type { Track, Playlist } from '../stores/playerStore';

// 播放模式选项
const PLAY_MODES = [
  { value: 'sequential', label: '顺序播放' },
  { value: 'shuffle', label: '随机播放' },
  { value: 'weighted', label: '权重随机' },
  { value: 'random', label: '乱序播放' },
  { value: 'single-loop', label: '单曲循环' }
];

// 来源类型
type SourceType = 'directory' | 'file' | 'filter';

export function PlaylistManager({ onSelectPlaylist }: {
  onSelectPlaylist: (playlistId: number) => void;
}) {
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');

  const loadPlaylists = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getPlaylists();
      setPlaylists(list);
    } catch (err) {
      console.error('加载播放列表失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlaylists();
  }, [loadPlaylists]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createPlaylist(newName.trim());
    setNewName('');
    setShowCreate(false);
    loadPlaylists();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此播放列表?')) return;
    await deletePlaylist(id);
    loadPlaylists();
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-gray-700 flex items-center justify-between">
        <h2 className="font-medium">播放列表</h2>
        <button onClick={() => setShowCreate(true)} className="px-2 py-1 bg-purple-600 hover:bg-purple-500 rounded text-sm">➕ 新建</button>
      </div>

      {showCreate && (
        <div className="p-3 border-b border-gray-700 flex gap-2">
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="播放列表名称" className="flex-1 px-3 py-1 bg-gray-700 rounded text-sm" autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false); }} />
          <button onClick={handleCreate} className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-sm">创建</button>
          <button onClick={() => setShowCreate(false)} className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-sm">取消</button>
        </div>
      )}

      <div className="flex-1 overflow-auto p-2">
        {loading ? (<div className="text-center text-gray-500 py-8">加载中...</div>) : playlists.length === 0 ? (
          <div className="text-center text-gray-500 py-8">暂无播放列表<br/><span className="text-sm">点击"新建"创建播放列表</span></div>
        ) : (
          <div className="space-y-1">
            {playlists.map((pl) => (
              <div key={pl.id} className="flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer" onClick={() => onSelectPlaylist(pl.id)}>
                <span className="text-purple-400">{pl.is_auto ? '📝' : '📋'}</span>
                <div className="flex-1 min-w-0"><div className="truncate">{pl.name}</div><div className="text-xs text-gray-500">{pl.item_count} 项</div></div>
                <button onClick={(e) => { e.stopPropagation(); handleDelete(pl.id); }} className="px-2 py-1 bg-red-600 hover:bg-red-500 rounded text-xs">🗑️</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// 播放列表详情 - 显示音轨列表和属性
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
  const { setCurrentPlaylist, setCurrentTrack, setIsPlaying } = usePlayerStore();

  // 添加来源相关状态
  const [sourceType, setSourceType] = useState<SourceType>('directory');
  const [includeSubdirs, setIncludeSubdirs] = useState(true);
  const [filterRegex, setFilterRegex] = useState('');
  const [browseResult, setBrowseResult] = useState<any>(null);
  const [musicRoots, setMusicRoots] = useState<{ name: string; path: string }[]>([]);

  const loadPlaylist = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getPlaylist(playlistId);
      setPlaylist(result);
      const tracksResult = await refreshPlaylist(playlistId);
      setTracks(tracksResult.tracks || []);
    } catch (err) {
      console.error('加载播放列表详情失败:', err);
    } finally {
      setLoading(false);
    }
  }, [playlistId]);

  useEffect(() => {
    loadPlaylist();
  }, [loadPlaylist]);

  // 加载音乐根目录
  useEffect(() => {
    getRoots().then(setMusicRoots).catch(console.error);
  }, []);

  // 打开设置时初始化表单
  useEffect(() => {
    if (showSettings && playlist) {
      setEditName(playlist.name || '');
      setEditPlayMode(playlist.play_mode || 'sequential');
      setEditSkipIntro(playlist.skip_intro || 0);
      setEditSkipOutro(playlist.skip_outro || 0);
    }
  }, [showSettings, playlist]);

  // 初始化添加来源面板
  useEffect(() => {
    if (showAddSource && musicRoots.length > 0 && !browseResult) {
      handleBrowse(null);
    }
  }, [showAddSource, musicRoots]);

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

  // 浏览目录
  const handleBrowse = async (dir: string | null) => {
    try {
      const result = await browseDirectory(dir || undefined);
      setBrowseResult(result);
    } catch (err) {
      console.error('浏览目录失败:', err);
    }
  };

  // 添加来源 (用于正则类型)
  const handleAddSource = async () => {
    if (!filterRegex.trim()) {
      alert('请输入正则表达式');
      return;
    }

    try {
      await addPlaylistItem(playlistId, 'filter', '*', false);
      // 更新过滤条件
      const result = await getPlaylist(playlistId);
      const items = result.items || [];
      const lastItem = items[items.length - 1];
      if (lastItem) {
        await updatePlaylist(playlistId, {
          items: items.map((item: any) =>
            item.id === lastItem.id
              ? { ...item, filterRegex: filterRegex }
              : item
          )
        });
      }
      loadPlaylist();
      setShowAddSource(false);
    } catch (err) {
      console.error('添加来源失败:', err);
      alert('添加失败');
    }
  };

  // 更新目录来源的子目录设置
  const handleToggleSubdirs = async (item: any) => {
    const newValue = item.include_subdirs === 1 ? false : true;
    try {
      await updatePlaylistItem(playlistId, item.id, { includeSubdirs: newValue });
      // 更新本地状态
      setPlaylist((prev: any) => ({
        ...prev,
        items: prev.items.map((i: any) =>
          i.id === item.id ? { ...i, include_subdirs: newValue ? 1 : 0 } : i
        )
      }));
      // 自动重新扫描
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
          <div className="text-xs text-gray-500">来源 ({playlist.items?.length || 0})</div>
          <button
            onClick={() => {
              setSourceType('directory');
              setFilterRegex('');
              setIncludeSubdirs(true);
              setShowAddSource(true);
            }}
            className="px-2 py-0.5 bg-purple-600 hover:bg-purple-500 rounded text-xs"
          >
            + 添加来源
          </button>
        </div>
        {playlist.items && playlist.items.length > 0 ? (
          <div className="space-y-1">
            {playlist.items.map((item: any) => (
              <div key={item.id} className="flex items-center gap-2 text-sm bg-gray-700/50 px-2 py-1 rounded">
                <span className="text-gray-400">
                  {item.type === 'directory' ? '📁' : item.type === 'filter' ? '🔍' : '📄'}
                </span>
                <span className="flex-1 truncate text-gray-300" title={item.path}>
                  {item.type === 'filter' ? `正则: ${item.filter_regex || '(全部)'}` : item.path}
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
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-500 py-1">暂无来源，请添加</div>
        )}
      </div>

      {/* 添加来源弹窗 */}
      {showAddSource && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-4 w-[600px] max-h-[80vh] overflow-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium">添加来源</h3>
              <button onClick={() => setShowAddSource(false)} className="text-gray-400 hover:text-white">✕</button>
            </div>

            {/* 来源类型选择 */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setSourceType('directory')}
                className={`px-3 py-1 rounded text-sm ${sourceType === 'directory' ? 'bg-purple-600' : 'bg-gray-700'}`}
              >
                📁 目录
              </button>
              <button
                onClick={() => setSourceType('file')}
                className={`px-3 py-1 rounded text-sm ${sourceType === 'file' ? 'bg-purple-600' : 'bg-gray-700'}`}
              >
                📄 文件
              </button>
              <button
                onClick={() => setSourceType('filter')}
                className={`px-3 py-1 rounded text-sm ${sourceType === 'filter' ? 'bg-purple-600' : 'bg-gray-700'}`}
              >
                🔍 正则匹配
              </button>
            </div>

            {sourceType === 'directory' && (
              <div>
                {/* 目录浏览器 */}
                <div className="mb-2 text-xs text-gray-400">
                  {browseResult?.isRootsView ? '选择音乐根目录:' : `当前: ${browseResult?.currentPath || ''}`}
                </div>
                <div className="border border-gray-700 rounded max-h-60 overflow-auto mb-3">
                  {/* 返回上级 */}
                  {browseResult && !browseResult.isRootsView && browseResult.parentPath !== null && (
                    <div
                      onClick={() => handleBrowse(browseResult.parentPath)}
                      className="px-3 py-2 hover:bg-gray-700 cursor-pointer text-sm"
                    >
                      📁 ..
                    </div>
                  )}
                  {/* 目录列表 */}
                  {browseResult?.directories?.map((dir: any) => (
                    <div
                      key={dir.path}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-gray-700 cursor-pointer text-sm"
                    >
                      <span
                        className="flex-1"
                        onClick={() => handleBrowse(dir.path)}
                      >
                        📁 {dir.name}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          addPlaylistItem(playlistId, 'directory', dir.path, includeSubdirs).then(() => {
                            loadPlaylist();
                            setShowAddSource(false);
                          });
                        }}
                        className="px-2 py-0.5 bg-green-600 hover:bg-green-500 rounded text-xs"
                      >
                        添加
                      </button>
                    </div>
                  ))}
            {browseResult?.files?.map((file: any) => (
              <div
                key={file.path}
                onClick={async () => {
                  try {
                    await addPlaylistItem(playlistId, 'file', file.path, false);
                    loadPlaylist();
                    setShowAddSource(false);
                  } catch (err) {
                    alert('添加失败');
                  }
                }}
                className="px-3 py-2 hover:bg-gray-700 cursor-pointer text-sm"
              >
                🎵 {file.name}
              </div>
            ))}
                </div>
                {/* 选项 */}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeSubdirs}
                    onChange={(e) => setIncludeSubdirs(e.target.checked)}
                  />
                  包含子目录
                </label>
              </div>
            )}

            {sourceType === 'filter' && (
              <div>
                <div className="mb-2 text-xs text-gray-400">
                  输入正则表达式匹配所有音乐目录中的文件路径
                </div>
                <input
                  type="text"
                  value={filterRegex}
                  onChange={(e) => setFilterRegex(e.target.value)}
                  placeholder="例如: .*周杰伦.*\.mp3"
                  className="w-full px-3 py-2 bg-gray-700 rounded text-sm"
                />
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={handleAddSource}
                    className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded text-sm"
                  >
                    添加
                  </button>
                </div>
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <button onClick={() => setShowAddSource(false)} className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-sm">
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 音轨列表 */}
      <div className="flex-1 overflow-auto p-2">
        {tracks.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            暂无音轨<br/>
            <span className="text-sm">添加来源后点击"重新扫描"</span>
          </div>
        ) : (
          <div className="space-y-1">
            {tracks.map((track, index) => (
              <div
                key={track.id}
                onClick={() => handlePlayTrack(track)}
                className="flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer"
              >
                <span className="text-gray-500 w-6 text-center">{index + 1}</span>
                <span className="text-green-500">🎵</span>
                <div className="flex-1 min-w-0">
                  <div className="truncate">{track.title}</div>
                  <div className="text-xs text-gray-500">{track.artist || '未知艺术家'}</div>
                </div>
                <span className="text-xs text-gray-600">{track.duration ? formatDuration(track.duration) : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}