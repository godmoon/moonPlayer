// 添加到播放列表弹窗组件
import { useState } from 'react';
import { getPlaylists, createPlaylist, addPlaylistItem, refreshPlaylist } from '../../stores/api';
import { getParentDirName } from '../../utils/format';

interface AddToPlaylistModalProps {
  targetType: 'directory' | 'file';
  targetPath: string;
  currentPath?: string;
  onClose: () => void;
}

export function AddToPlaylistModal({ targetType, targetPath, currentPath, onClose }: AddToPlaylistModalProps) {
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [newPlaylistName, setNewPlaylistName] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  useState(() => {
    const load = async () => {
      try {
        const list = await getPlaylists();
        setPlaylists(list);
        const defaultName = targetType === 'directory'
          ? getParentDirName(targetPath) || '新播放列表'
          : getParentDirName(currentPath || '') || '新播放列表';
        setNewPlaylistName(defaultName);
      } catch (err) {
        console.error('加载播放列表失败:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  });

  const handleAddToPlaylist = async (playlistId: number) => {
    try {
      await addPlaylistItem(playlistId, targetType, targetPath, targetType === 'directory');
      await refreshPlaylist(playlistId);
      onClose();
    } catch (err) {
      console.error('添加到播放列表失败:', err);
      alert('添加失败');
    }
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) return;
    setCreating(true);
    try {
      const playlist = await createPlaylist(newPlaylistName.trim(), [
        { type: targetType, path: targetPath, includeSubdirs: targetType === 'directory' }
      ]);
      await refreshPlaylist(playlist.id);
      onClose();
    } catch (err) {
      console.error('创建播放列表失败:', err);
      alert('创建失败');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-80 max-h-96 overflow-hidden">
        <div className="p-3 border-b border-gray-700 flex items-center justify-between">
          <h3 className="font-medium text-sm">添加到播放列表</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>
        
        <div className="p-2 border-b border-gray-700">
          <div className="text-xs text-gray-400 mb-1">新建播放列表</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              className="flex-1 px-2 py-1 bg-gray-700 rounded text-sm"
              placeholder="播放列表名称"
            />
            <button
              onClick={handleCreatePlaylist}
              disabled={creating || !newPlaylistName.trim()}
              className="px-3 py-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded text-sm"
            >
              {creating ? '创建中...' : '创建'}
            </button>
          </div>
        </div>
        
        <div className="overflow-auto p-2" style={{ maxHeight: '200px' }}>
          <div className="text-xs text-gray-400 mb-1">选择已有播放列表</div>
          {loading ? (
            <div className="text-center text-gray-500 py-4">加载中...</div>
          ) : playlists.length === 0 ? (
            <div className="text-center text-gray-500 py-4">暂无播放列表</div>
          ) : (
            <div className="space-y-1">
              {playlists.map((pl) => (
                <button key={pl.id} onClick={() => handleAddToPlaylist(pl.id)} className="w-full flex items-center gap-2 px-3 py-2 rounded text-left hover:bg-gray-700 text-gray-300">
                  <span className="text-purple-400">{pl.is_auto ? '📝' : '📋'}</span>
                  <span className="flex-1 truncate">{pl.name}</span>
                  <span className="text-xs text-gray-500">{pl.item_count} 项</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}