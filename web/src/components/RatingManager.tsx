// 评分管理组件
import { useState, useEffect, useCallback } from 'react';
import { getLowRatedTracks, batchRating, resetAllRatings, deleteTrack } from '../stores/api';
import { formatTrackTitle } from '../utils/format';

export function RatingManager() {
  const [tracks, setTracks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [threshold, setThreshold] = useState(-5);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);

  const loadLowRatedTracks = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getLowRatedTracks(threshold);
      setTracks(list);
      setSelectedIds(new Set());
    } catch (err) {
      console.error('加载低分音轨失败:', err);
    } finally {
      setLoading(false);
    }
  }, [threshold]);

  useEffect(() => {
    loadLowRatedTracks();
  }, [loadLowRatedTracks]);

  const handleToggleSelect = (id: number) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === tracks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tracks.map(t => t.id)));
    }
  };

  const handleBatchRating = async (rating: number) => {
    if (selectedIds.size === 0) return;
    setActionLoading(true);
    try {
      await batchRating(Array.from(selectedIds), rating);
      loadLowRatedTracks();
    } catch (err) {
      console.error('批量评分失败:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定删除选中的 ${selectedIds.size} 首歌曲？此操作不可恢复！`)) return;

    setActionLoading(true);
    try {
      for (const id of selectedIds) {
        await deleteTrack(id);
      }
      loadLowRatedTracks();
    } catch (err) {
      console.error('批量删除失败:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetAll = async () => {
    if (!confirm('确定重置所有歌曲的评分为 0？')) return;
    setActionLoading(true);
    try {
      await resetAllRatings();
      loadLowRatedTracks();
    } catch (err) {
      console.error('重置评分失败:', err);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-gray-700">
        <h2 className="font-medium mb-2">评分管理</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">显示评分低于</span>
          <input
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-16 px-2 py-1 bg-gray-700 rounded text-sm"
          />
          <span className="text-sm text-gray-400">的歌曲</span>
          <button onClick={loadLowRatedTracks} className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-sm">刷新</button>
        </div>
      </div>

      {/* 批量操作 */}
      {tracks.length > 0 && (
        <div className="p-2 border-b border-gray-700 flex items-center gap-2">
          <button onClick={handleSelectAll} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm">
            {selectedIds.size === tracks.length ? '取消全选' : '全选'}
          </button>
          {selectedIds.size > 0 && (
            <>
              <span className="text-sm text-gray-400">已选 {selectedIds.size} 首</span>
              <button onClick={() => handleBatchRating(0)} disabled={actionLoading} className="px-3 py-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded text-sm">设为 0 分</button>
              <button onClick={() => handleBatchRating(5)} disabled={actionLoading} className="px-3 py-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded text-sm">设为 +5</button>
              <button onClick={handleBatchDelete} disabled={actionLoading} className="px-3 py-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded text-sm">删除选中</button>
            </>
          )}
          <button onClick={handleResetAll} disabled={actionLoading} className="ml-auto px-3 py-1 bg-yellow-700 hover:bg-yellow-600 disabled:opacity-50 rounded text-sm">重置所有评分</button>
        </div>
      )}

      {/* 歌曲列表 */}
      <div className="flex-1 overflow-auto p-2">
        {loading ? (
          <div className="text-center text-gray-500 py-8">加载中...</div>
        ) : tracks.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            没有评分低于 {threshold} 的歌曲
          </div>
        ) : (
          <div className="space-y-1">
            {tracks.map((track) => (
              <div key={track.id} className={`flex items-center gap-2 p-2 rounded ${selectedIds.has(track.id) ? 'bg-gray-700' : 'hover:bg-gray-800'}`}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(track.id)}
                  onChange={() => handleToggleSelect(track.id)}
                  className="w-4 h-4"
                />
                <span className="text-green-500">🎵</span>
                <div className="flex-1 min-w-0">
                  <div className="truncate">{formatTrackTitle(track)}</div>
                  <div className="text-xs text-gray-500 truncate">{track.artist}</div>
                </div>
                <span className={`px-2 py-1 rounded text-sm ${track.rating < 0 ? 'bg-red-900 text-red-300' : 'bg-gray-700 text-gray-400'}`}>
                  {track.rating}
                </span>
                <button
                  onClick={async () => { await deleteTrack(track.id); loadLowRatedTracks(); }}
                  className="px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-xs"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}