// 播放列表管理组件
import { useState, useEffect, useCallback, useMemo } from 'react';
import { getPlaylists, deletePlaylist } from '../../stores/api';
import { AITaggerModal } from './AITaggerModal';
import { PLAYLIST_SORT_OPTIONS } from './utils';

export function PlaylistManager({ onSelectPlaylist }: {
  onSelectPlaylist: (playlistId: number) => void;
}) {
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [playlistSort, setPlaylistSort] = useState<string>('name');
  const [showAITagger, setShowAITagger] = useState(false);

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

  const sortedPlaylists = useMemo(() => {
    let sorted = [...playlists];
    switch (playlistSort) {
      case 'name':
        sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-CN'));
        break;
      case 'id':
        sorted.sort((a, b) => a.id - b.id);
        break;
      case 'random':
        for (let i = sorted.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
        }
        break;
    }
    return sorted;
  }, [playlists, playlistSort]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const { createPlaylist } = await import('../../stores/api');
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
        <div className="flex gap-2">
          <button onClick={() => setShowAITagger(true)} className="px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-sm">🏷️ AI标签</button>
          <button onClick={() => setShowCreate(true)} className="px-2 py-1 bg-purple-600 hover:bg-purple-500 rounded text-sm">➕ 新建</button>
        </div>
      </div>

      {showCreate && (
        <div className="p-3 border-b border-gray-700 flex gap-2">
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="播放列表名称" className="flex-1 px-3 py-1 bg-gray-700 rounded text-sm" autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false); }} />
          <button onClick={handleCreate} className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-sm">创建</button>
          <button onClick={() => setShowCreate(false)} className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-sm">取消</button>
        </div>
      )}

      {/* 排序选择 */}
      <div className="px-3 py-1 border-b border-gray-700 flex items-center gap-2 text-sm">
        <span className="text-gray-400">排序:</span>
        <select
          value={playlistSort}
          onChange={(e) => setPlaylistSort(e.target.value)}
          className="px-2 py-0.5 bg-gray-700 rounded text-sm"
        >
          {PLAYLIST_SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {loading ? (<div className="text-center text-gray-500 py-8">加载中...</div>) : playlists.length === 0 ? (
          <div className="text-center text-gray-500 py-8">暂无播放列表<br/><span className="text-sm">点击"新建"创建播放列表</span></div>
        ) : (
          <div className="space-y-1">
            {sortedPlaylists.map((pl) => (
              <div key={pl.id} className="flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer" onClick={() => onSelectPlaylist(pl.id)}>
                <span className="text-purple-400">{pl.is_auto ? '📝' : '📋'}</span>
                <div className="flex-1 min-w-0"><div className="truncate">{pl.name}</div><div className="text-xs text-gray-500">{pl.item_count} 项</div></div>
                <button onClick={(e) => { e.stopPropagation(); handleDelete(pl.id); }} className="px-2 py-1 bg-red-600 hover:bg-red-500 rounded text-xs">🗑️</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI 标签弹窗 */}
      {showAITagger && (
        <AITaggerModal onClose={() => setShowAITagger(false)} />
      )}
    </div>
  );
}