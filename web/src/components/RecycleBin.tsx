// 回收站组件
import { useState, useEffect, useCallback } from 'react';
import { getRecycledTracks, restoreTrack, permanentDeleteTrack } from '../stores/api';
import { formatTrackTitle } from '../utils/format';

export function RecycleBin() {
  const [tracks, setTracks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  const loadRecycledTracks = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getRecycledTracks();
      setTracks(list);
    } catch (err) {
      console.error('加载回收站失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecycledTracks();
  }, [loadRecycledTracks]);

  const handleRestore = async (trackId: number) => {
    setRestoring(trackId);
    try {
      await restoreTrack(trackId);
      setTracks(prev => prev.filter(t => t.id !== trackId));
    } catch (err) {
      console.error('恢复失败:', err);
      alert('恢复失败');
    } finally {
      setRestoring(null);
    }
  };

  const handlePermanentDelete = async (track: any) => {
    if (!confirm(`确定彻底删除 "${track.title}" 吗？此操作不可恢复！`)) return;
    
    setDeleting(track.id);
    try {
      const result = await permanentDeleteTrack(track.id);
      if (result.success) {
        setTracks(prev => prev.filter(t => t.id !== track.id));
      } else {
        alert(result.error || '删除失败');
      }
    } catch (err: any) {
      console.error('彻底删除失败:', err);
      const errorMsg = err.response?.data?.error || err.message || '删除失败';
      alert(errorMsg);
    } finally {
      setDeleting(null);
    }
  };

  const formatDate = (timestamp: number) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-gray-700 flex items-center justify-between">
        <div>
          <h2 className="font-medium">🗑️ 回收站</h2>
          <div className="text-xs text-gray-500">{tracks.length} 个文件</div>
        </div>
        <button onClick={loadRecycledTracks} className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-sm">刷新</button>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {loading ? (
          <div className="text-center text-gray-500 py-8">加载中...</div>
        ) : tracks.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            回收站为空
          </div>
        ) : (
          <div className="space-y-1">
            {tracks.map((track) => (
              <div
                key={track.id}
                className="flex items-center gap-2 p-2 hover:bg-gray-800 rounded"
              >
                <span className="text-gray-500">🎵</span>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-gray-300">{formatTrackTitle(track)}</div>
                  <div className="text-xs text-gray-500 truncate">
                    {track.artist}
                    {track.recycled_at && (
                      <span className="ml-2 text-gray-600">
                        · {formatDate(track.recycled_at)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleRestore(track.id)}
                  disabled={restoring === track.id}
                  className="px-3 py-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded text-xs"
                >
                  {restoring === track.id ? '恢复中...' : '恢复'}
                </button>
                <button
                  onClick={() => handlePermanentDelete(track)}
                  disabled={deleting === track.id}
                  className="px-3 py-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded text-xs"
                >
                  {deleting === track.id ? '删除中...' : '彻底删除'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}