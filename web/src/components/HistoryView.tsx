// 历史记录组件
import { useState, useEffect, useCallback } from 'react';
import { getRecentPlaylists, deletePlaylistHistory, refreshPlaylist, recordHistory } from '../stores/api';
import { usePlayerStore } from '../stores/playerStore';
import { setPendingSeekPosition } from './AudioPlayer/PlayerBar';
import type { Track, Playlist } from '../stores/playerStore';

interface HistoryItem {
  playlist_id: number;
  playlist_name: string;
  track_id: number;
  track_title: string;
  track_artist: string;
  track_duration: number;
  position: number;
  timestamp: number;
}

export function HistoryView() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<HistoryItem | null>(null);

  const { setCurrentPlaylist, setCurrentTrack, setIsPlaying, currentPlaylist } = usePlayerStore();

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getRecentPlaylists();
      setHistory(data || []);
    } catch (err) {
      console.error('加载历史记录失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deletePlaylistHistory(deleteConfirm.playlist_id);
      setHistory(prev => prev.filter(h => h.playlist_id !== deleteConfirm.playlist_id));
    } catch (err) {
      console.error('删除历史失败:', err);
    } finally {
      setDeleteConfirm(null);
    }
  };

  const handleContinuePlay = async (item: HistoryItem) => {
  try {
    // 在切换播放列表之前，先记录当前播放列表的位置
    const currentPlayer = usePlayerStore.getState();
    if (currentPlayer.currentPlaylist && currentPlayer.currentTrack) {
      const audio = document.querySelector('audio');
      if (audio) {
        const position = audio.currentTime;
        const duration = audio.duration || 0;

        // 🔥 修复：只有有效进度才保存，绝对不保存 0！
        if (position > 1.0 && duration > 0 && position < duration) {
          console.log("✅ 切换前保存有效进度:", position);
          await recordHistory(
            currentPlayer.currentPlaylist.id,
            currentPlayer.currentTrack.id,
            position
          );
        } else {
          console.log("⛔ 切换前不保存无效进度（0），避免覆盖历史");
        }
      }
    }

    // 下面的代码完全不动
    if (item.position > 0) {
      setPendingSeekPosition(item.position);
      console.log('[HistoryView] 设置待恢复位置:', item.position, 'trackId:', item.track_id);
    }

    const refreshed = await refreshPlaylist(item.playlist_id);
    const trackList = refreshed.tracks as Track[];
    if (trackList.length === 0) return;

    const pl: Playlist = {
      id: item.playlist_id,
      name: item.playlist_name,
      createdAt: refreshed.playlist.created_at,
      updatedAt: refreshed.playlist.updated_at,
      isAuto: refreshed.playlist.is_auto === 1,
      playMode: refreshed.playlist.play_mode,
      skipIntro: refreshed.playlist.skip_intro,
      skipOutro: refreshed.playlist.skip_outro
    };
    setCurrentPlaylist(pl, trackList);

    let lastTrack = trackList.find((t: Track) => t.id === item.track_id);
    if (!lastTrack) lastTrack = trackList[0];

    setCurrentTrack(lastTrack);
    setIsPlaying(true);

    setTimeout(() => loadHistory(), 500);
  } catch (err) {
    console.error('继续播放失败:', err);
  }
};

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return `今天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    } else if (days === 1) {
      return '昨天';
    } else if (days < 7) {
      return `${days} 天前`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const formatDuration = (seconds: number) => {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatPosition = (seconds: number) => {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // 判断当前播放的是否是这个历史项
  const isCurrentPlaying = (item: HistoryItem) => {
    return currentPlaylist?.id === item.playlist_id;
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-gray-700 flex items-center justify-between">
        <h2 className="font-medium">最近播放</h2>
        <button onClick={loadHistory} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm">刷新</button>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {loading ? (
          <div className="text-center text-gray-500 py-8">加载中...</div>
        ) : history.length === 0 ? (
          <div className="text-center text-gray-500 py-8">暂无播放历史</div>
        ) : (
          <div className="space-y-1">
            {history.map((item) => (
              <div
                key={item.playlist_id}
                className={`flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer group ${
                  isCurrentPlaying(item) ? 'bg-gray-700' : ''
                }`}
              >
                <div
                  className="flex-1 min-w-0"
                  onClick={() => handleContinuePlay(item)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-purple-400">📋</span>
                    <span className="truncate font-medium">{item.playlist_name}</span>
                    {isCurrentPlaying(item) && <span className="text-green-400 text-xs">正在播放</span>}
                  </div>
                  <div className="text-xs text-gray-500 flex items-center gap-2">
                    <span className="truncate">{item.track_title || '未知曲目'}</span>
                    {item.track_artist && <span className="truncate">- {item.track_artist}</span>}
                    {item.track_duration && <span className="text-gray-600">({formatDuration(item.track_duration)})</span>}
                    {item.position > 0 && (
                      <span className="text-blue-400" title={`播放位置: ${formatPosition(item.position)}`}>
                        📍 {formatPosition(item.position)}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-gray-500">{formatTime(item.timestamp)}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteConfirm(item);
                  }}
                  className="opacity-0 group-hover:opacity-100 px-2 py-1 text-red-400 hover:text-red-300 text-sm transition-opacity"
                  title="删除此历史记录"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 删除确认弹窗 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-4 max-w-sm mx-4">
            <h3 className="text-lg font-medium mb-2">确认删除</h3>
            <p className="text-gray-400 mb-4">
              是否删除播放列表「{deleteConfirm.playlist_name}」的历史记录？
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-1 bg-red-600 hover:bg-red-500 rounded"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}