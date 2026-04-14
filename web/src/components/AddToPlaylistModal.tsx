// 添加到播放列表的弹窗组件
import { useState, useEffect } from 'react';
import { getPlaylists, addPlaylistItem } from '../stores/api';

interface Props {
  trackPath: string;
  onClose: () => void;
}

export function AddToPlaylistModal({ trackPath, onClose }: Props) {
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<number | null>(null);
  const [success, setSuccess] = useState<number | null>(null);

  useEffect(() => {
    loadPlaylists();
  }, []);

  const loadPlaylists = async () => {
    setLoading(true);
    try {
      const list = await getPlaylists();
      setPlaylists(list);
    } catch (err) {
      console.error('加载播放列表失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (playlistId: number) => {
    setAdding(playlistId);
    try {
      await addPlaylistItem(playlistId, 'file', trackPath);
      setSuccess(playlistId);
      setTimeout(() => {
        setSuccess(null);
      }, 2000);
    } catch (err) {
      console.error('添加失败:', err);
      alert('添加失败');
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-96 max-h-96 overflow-hidden">
        {/* 标题 */}
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <h3 className="font-medium">添加到播放列表</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        {/* 文件名 */}
        <div className="px-4 py-2 bg-gray-700/50 text-sm text-gray-400 truncate">
          {trackPath.split('/').pop()}
        </div>

        {/* 播放列表 */}
        <div className="overflow-auto p-2" style={{ maxHeight: '250px' }}>
          {loading ? (
            <div className="text-center text-gray-500 py-4">加载中...</div>
          ) : playlists.length === 0 ? (
            <div className="text-center text-gray-500 py-4">
              暂无播放列表<br />
              <span className="text-sm">请先创建播放列表</span>
            </div>
          ) : (
            <div className="space-y-1">
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => handleAdd(pl.id)}
                  disabled={adding !== null}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded text-left ${
                    success === pl.id
                      ? 'bg-green-600 text-white'
                      : 'hover:bg-gray-700 text-gray-300'
                  } disabled:opacity-50`}
                >
                  <span className="text-purple-400">
                    {pl.is_auto ? '📝' : '📋'}
                  </span>
                  <span className="flex-1 truncate">{pl.name}</span>
                  <span className="text-xs text-gray-500">
                    {pl.item_count} 项
                  </span>
                  {adding === pl.id && (
                    <span className="text-xs text-gray-400">添加中...</span>
                  )}
                  {success === pl.id && (
                    <span className="text-xs">✓ 已添加</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="p-3 border-t border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded text-sm"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}