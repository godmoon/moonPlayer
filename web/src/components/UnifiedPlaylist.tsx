// 统一播放列表组件 - 整合历史和列表功能
import { useState, useEffect, useCallback, useRef } from 'react';
import { getPlaylists, getRecentPlaylists, getPlaylistTracks, recordHistory, createPlaylist } from '../stores/api';
import { usePlayerStore } from '../stores/playerStore';
import { setPendingSeekPosition } from './AudioPlayer/PlayerBar';
import type { Track, Playlist } from '../stores/playerStore';
import { PLAYLIST_SORT_OPTIONS } from './PlaylistManager/utils';
import { AITaggerModal } from './PlaylistManager/AITaggerModal';

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

interface PlaylistWithHistory {
  id: number;
  name: string;
  item_count: number;
  is_auto: number;
  play_mode: string;
  skip_intro: number;
  skip_outro: number;
  lastTrack?: {
    id: number;
    title: string;
    artist: string;
    duration: number;
  };
  lastPosition: number;
  lastPlayedTime: number;
}

export function UnifiedPlaylist({ onSelectPlaylist }: {
  onSelectPlaylist: (playlistId: number) => void;
}) {
  // 第一层：播放列表列表
  const [playlists, setPlaylists] = useState<PlaylistWithHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<PlaylistWithHistory | null>(null);
  const [playlistSort, setPlaylistSort] = useState<string>('recent');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [showAITagger, setShowAITagger] = useState(false);

  const { currentPlaylist, currentTrack, setCurrentPlaylist, setCurrentTrack, setIsPlaying } = usePlayerStore();
  const listRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 获取所有播放列表
      const [playlistList, historyList] = await Promise.all([
        getPlaylists(),
        getRecentPlaylists()
      ]);

      // 创建历史记录映射
      const historyMap = new Map<number, HistoryItem>();
      for (const h of historyList) {
        historyMap.set(h.playlist_id, h);
      }

      // 合并播放列表和历史信息
      const merged: PlaylistWithHistory[] = playlistList.map((pl: any) => {
        const history = historyMap.get(pl.id);
        return {
          ...pl,
          lastTrack: history ? {
            id: history.track_id,
            title: history.track_title,
            artist: history.track_artist,
            duration: history.track_duration
          } : undefined,
          lastPosition: history?.position || 0,
          lastPlayedTime: history?.timestamp || 0
        };
      });

      setPlaylists(merged);
    } catch (err) {
      console.error('加载播放列表失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 排序后的播放列表
  const sortedPlaylists = (() => {
    let sorted = [...playlists];
    switch (playlistSort) {
      case 'recent':
        // 按最近播放时间排序，未播放的放最后
        sorted.sort((a, b) => {
          // 有播放记录的按时间排序
          if (a.lastPlayedTime && b.lastPlayedTime) {
            return b.lastPlayedTime - a.lastPlayedTime;
          }
          // 只有一个有播放记录
          if (a.lastPlayedTime) return -1;
          if (b.lastPlayedTime) return 1;
          // 都没有播放记录，按 id 排序（创建顺序）
          return a.id - b.id;
        });
        break;
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
  })();

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      const { deletePlaylist } = await import('../stores/api');
      await deletePlaylist(deleteConfirm.id);
      setPlaylists(prev => prev.filter(p => p.id !== deleteConfirm.id));
    } catch (err) {
      console.error('删除播放列表失败:', err);
    } finally {
      setDeleteConfirm(null);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await createPlaylist(newName.trim());
      setNewName('');
      setShowCreate(false);
      loadData();
    } catch (err) {
      console.error('创建播放列表失败:', err);
    }
  };

  const handlePlayPlaylist = async (item: PlaylistWithHistory) => {
    try {
      // 在切换播放列表之前，先记录当前播放列表的位置
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

      // 如果已经是当前播放列表，直接进入详情页面
      if (currentPlaylist?.id === item.id) {
        onSelectPlaylist(item.id);
        return;
      }

      // 只加载已有数据，不重新扫描
      const result = await getPlaylistTracks(item.id);
      const trackList = result.tracks as Track[];
      if (trackList.length === 0) return;

      const pl: Playlist = {
        id: item.id,
        name: item.name,
        createdAt: result.playlist.created_at,
        updatedAt: result.playlist.updated_at,
        isAuto: result.playlist.is_auto === 1,
        playMode: result.playlist.play_mode,
        skipIntro: result.playlist.skip_intro,
        skipOutro: result.playlist.skip_outro
      };
      setCurrentPlaylist(pl, trackList);

      // 尝试定位到上次播放的曲目
      let startTrack = trackList[0];
      let seekPosition = 0;

      if (item.lastTrack) {
        const lastTrack = trackList.find((t: Track) => t.id === item.lastTrack!.id);
        if (lastTrack) {
          startTrack = lastTrack;
          seekPosition = item.lastPosition;
        }
      }

      setCurrentTrack(startTrack);
      setIsPlaying(true);

      if (seekPosition > 0) {
        setPendingSeekPosition(seekPosition);
      }

      // 进入详情页面
      onSelectPlaylist(item.id);
    } catch (err) {
      console.error('播放失败:', err);
    }
  };

  const formatTime = (timestamp: number) => {
    if (!timestamp) return '';
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

  const formatPosition = (seconds: number) => {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const isCurrentPlaying = (item: PlaylistWithHistory) => {
    return currentPlaylist?.id === item.id;
  };

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="p-3 border-b border-gray-700 flex items-center justify-between">
        <h2 className="font-medium">播放列表</h2>
        <div className="flex gap-2">
          <button onClick={() => setShowAITagger(true)} className="px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-sm">🏷️ AI标签</button>
          <button onClick={() => setShowCreate(true)} className="px-2 py-1 bg-purple-600 hover:bg-purple-500 rounded text-sm">➕ 新建</button>
        </div>
      </div>

      {/* 新建播放列表输入框 */}
      {showCreate && (
        <div className="p-3 border-b border-gray-700 flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="播放列表名称"
            className="flex-1 px-3 py-1 bg-gray-700 rounded text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') setShowCreate(false);
            }}
          />
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
          <option value="recent">最近播放</option>
          {PLAYLIST_SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-auto p-2" ref={listRef}>
        {loading ? (
          <div className="text-center text-gray-500 py-8">加载中...</div>
        ) : playlists.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            暂无播放列表<br/>
            <span className="text-sm">从「浏览」中选择目录创建播放列表</span>
          </div>
        ) : (
          <div className="space-y-1">
            {sortedPlaylists.map((pl) => (
              <div
                key={pl.id}
                className={`flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer group ${
                  isCurrentPlaying(pl) ? 'bg-purple-900/30' : ''
                }`}
              >
                {/* 左侧：图标和播放信息 */}
                <div
                  className="flex-1 min-w-0"
                  onClick={() => handlePlayPlaylist(pl)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-purple-400">{pl.is_auto ? '📝' : '📋'}</span>
                    <span className="truncate font-medium">{pl.name}</span>
                    {isCurrentPlaying(pl) && (
                      <span className="text-green-400 text-xs flex items-center gap-1">
                        <span className="animate-pulse">▶</span> 正在播放
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                    <span>{pl.item_count} 项</span>
                    {pl.lastTrack && (
                      <>
                        <span className="text-gray-600">|</span>
                        <span className="truncate max-w-32">{pl.lastTrack.title || '未知曲目'}</span>
                        {pl.lastPosition > 0 && (
                          <span className="text-blue-400" title={`播放位置: ${formatPosition(pl.lastPosition)}`}>
                            📍 {formatPosition(pl.lastPosition)}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* 右侧：时间和删除按钮 */}
                <div className="flex items-center gap-2">
                  {pl.lastPlayedTime > 0 && (
                    <span className="text-xs text-gray-500">{formatTime(pl.lastPlayedTime)}</span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirm(pl);
                    }}
                    className="px-2 py-1 text-red-400 hover:text-red-300 text-sm"
                    title="删除播放列表"
                  >
                    ✕
                  </button>
                </div>
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
              是否删除播放列表「{deleteConfirm.name}」？此操作不可恢复。
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

      {/* AI 标签弹窗 */}
      {showAITagger && (
        <AITaggerModal onClose={() => setShowAITagger(false)} />
      )}
    </div>
  );
}