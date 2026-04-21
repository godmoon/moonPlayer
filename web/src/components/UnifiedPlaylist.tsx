// 统一播放列表组件 - 播放列表列表
import { useState, useEffect, useCallback, useRef } from 'react';
import { getPlaylists, getPlaylistTracks, recordHistory, createPlaylist, getTags, getPlaylist } from '../stores/api';
import { usePlayerStore } from '../stores/playerStore';
import { setPendingSeekPosition } from './AudioPlayer/PlayerBar';
import type { Track, Playlist } from '../stores/playerStore';
import { PLAYLIST_SORT_OPTIONS, MATCH_FIELDS, MATCH_OP_LABELS, type SourceType } from './PlaylistManager/utils';
import { AITaggerModal } from './PlaylistManager/AITaggerModal';

interface PlaylistWithHistory {
  id: number;
  name: string;
  item_count: number;
  is_auto: number;
  play_mode: string;
  skip_intro: number;
  skip_outro: number;
  last_track: {
    id: number;
    title: string;
    artist: string;
    duration: number;
  } | null;
  last_position: number;
  last_played_time: number;
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
  const [showAITagger, setShowAITagger] = useState(false);
  
  // 新建播放列表弹窗状态
  const [createSourceType, setCreateSourceType] = useState<SourceType>('directory');
  const [createName, setCreateName] = useState('');
  const [createFilterRegex, setCreateFilterRegex] = useState('');
  const [createConditions, setCreateConditions] = useState<{ match_field: string; match_op: string; match_value: string }[]>([]);
  const [createMatchField, setCreateMatchField] = useState('rating');
  const [createMatchOp, setCreateMatchOp] = useState('>');
  const [createMatchValue, setCreateMatchValue] = useState('');
  const [createTags, setCreateTags] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const { currentPlaylist, currentTrack, setCurrentPlaylist, setCurrentTrack, setIsPlaying } = usePlayerStore();
  const listRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      if (signal?.aborted) return;
      
      // 获取所有播放列表（已含历史信息）
      const playlistList = await getPlaylists();
      
      if (signal?.aborted) return;

      // API 已返回合并数据，直接使用
      setPlaylists(playlistList as PlaylistWithHistory[]);
    } catch (err) {
      console.error('加载播放列表失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  // 排序后的播放列表
  const sortedPlaylists = (() => {
    let sorted = [...playlists];
    switch (playlistSort) {
      case 'recent':
        // 按最近播放时间排序，未播放的放最后
        sorted.sort((a, b) => {
          // 有播放记录的按时间排序
          if (a.last_played_time && b.last_played_time) {
            return b.last_played_time - a.last_played_time;
          }
          // 只有一个有播放记录
          if (a.last_played_time) return -1;
          if (b.last_played_time) return 1;
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

  // 打开新建弹窗时加载标签列表
  const handleOpenCreate = async () => {
    setShowCreate(true);
    try {
      const tags = await getTags();
      setCreateTags(tags);
    } catch (err) {
      console.error('加载标签列表失败:', err);
    }
  };

  // 添加匹配条件
  const handleAddCreateCondition = () => {
    if (!createMatchValue.trim()) {
      alert('请输入匹配值');
      return;
    }
    setCreateConditions(prev => [...prev, {
      match_field: createMatchField,
      match_op: createMatchOp,
      match_value: createMatchValue
    }]);
    setCreateMatchValue('');
  };

  // 移除匹配条件
  const handleRemoveCreateCondition = (index: number) => {
    setCreateConditions(prev => prev.filter((_, i) => i !== index));
  };

  // 创建播放列表
  const handleCreatePlaylist = async () => {
    if (!createName.trim()) {
      alert('请输入播放列表名称');
      return;
    }
    
    // 匹配类型需要至少一个条件
    if (createSourceType === 'match' && createConditions.length === 0) {
      alert('请至少添加一个匹配条件');
      return;
    }
    
    setCreating(true);
    try {
      // 根据来源类型准备 items
      let items: any[] = [];
      if (createSourceType === 'directory' || createSourceType === 'file') {
        // 目录和文件类型：创建空的播放列表，稍后通过详情页添加
        items = [];
      } else if (createSourceType === 'filter') {
        if (!createFilterRegex.trim()) {
          alert('请输入正则表达式');
          setCreating(false);
          return;
        }
        items = [{ type: 'filter', path: '*', filterRegex: createFilterRegex }];
      } else if (createSourceType === 'match') {
        items = [{ type: 'match', path: '*' }];
      }
      
      const playlist = await createPlaylist(createName.trim(), items, createSourceType === 'match' || createSourceType === 'filter');
      
      // 如果是匹配类型，添加条件
      if (createSourceType === 'match' && playlist.id) {
        const { addItemCondition } = await import('../stores/api');
        // 先获取刚创建的 item
        const plDetail = await getPlaylist(playlist.id);
        const firstItem = plDetail.items?.[0];
        if (firstItem) {
          for (const cond of createConditions) {
            await addItemCondition(playlist.id, firstItem.id, {
              matchField: cond.match_field,
              matchOp: cond.match_op,
              matchValue: cond.match_value
            });
          }
        }
      }
      
      // 重置状态
      setCreateName('');
      setCreateSourceType('directory');
      setCreateFilterRegex('');
      setCreateConditions([]);
      setCreateMatchField('rating');
      setCreateMatchOp('>');
      setCreateMatchValue('');
      setShowCreate(false);
      loadData();
      
      // 提示用户
      if (createSourceType === 'directory' || createSourceType === 'file') {
        alert('播放列表已创建，请在详情页添加来源');
      }
    } catch (err) {
      console.error('创建播放列表失败:', err);
      alert('创建失败');
    } finally {
      setCreating(false);
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

      // 即使列表为空，也进入详情页（方便用户添加来源）
      if (trackList.length === 0) {
        onSelectPlaylist(item.id);
        return;
      }

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

      if (item.last_track) {
        const lastTrack = trackList.find((t: Track) => t.id === item.last_track!.id);
        if (lastTrack) {
          startTrack = lastTrack;
          seekPosition = item.last_position;
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
          <button onClick={handleOpenCreate} className="px-2 py-1 bg-purple-600 hover:bg-purple-500 rounded text-sm">➕ 新建</button>
        </div>
      </div>



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
                    {pl.last_track && (
                      <>
                        <span className="text-gray-600">|</span>
                        <span className="truncate max-w-32">{pl.last_track.title || '未知曲目'}</span>
                        {pl.last_position > 0 && (
                          <span className="text-blue-400" title={`播放位置: ${formatPosition(pl.last_position)}`}>
                            📍 {formatPosition(pl.last_position)}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* 右侧：时间和删除按钮 */}
                <div className="flex items-center gap-2">
                  {pl.last_played_time > 0 && (
                    <span className="text-xs text-gray-500">{formatTime(pl.last_played_time)}</span>
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

      {/* 新建播放列表弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-4 w-[600px] max-h-[80vh] overflow-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium">新建播放列表</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-white">✕</button>
            </div>

            {/* 播放列表名称 */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">播放列表名称</label>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="输入名称"
                className="w-full px-3 py-2 bg-gray-700 rounded text-sm"
                autoFocus
              />
            </div>

            {/* 来源类型选择 */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setCreateSourceType('directory')}
                className={`px-3 py-1 rounded text-sm ${createSourceType === 'directory' ? 'bg-purple-600' : 'bg-gray-700'}`}
              >
                📁 目录
              </button>
              <button
                onClick={() => setCreateSourceType('file')}
                className={`px-3 py-1 rounded text-sm ${createSourceType === 'file' ? 'bg-purple-600' : 'bg-gray-700'}`}
              >
                📄 文件
              </button>
              <button
                onClick={() => setCreateSourceType('filter')}
                className={`px-3 py-1 rounded text-sm ${createSourceType === 'filter' ? 'bg-purple-600' : 'bg-gray-700'}`}
              >
                🔍 正则匹配
              </button>
              <button
                onClick={() => setCreateSourceType('match')}
                className={`px-3 py-1 rounded text-sm ${createSourceType === 'match' ? 'bg-purple-600' : 'bg-gray-700'}`}
              >
                🎯 匹配
              </button>
            </div>

            {/* 目录/文件类型提示 */}
            {(createSourceType === 'directory' || createSourceType === 'file') && (
              <div className="text-sm text-gray-400 mb-4">
                创建后请在播放列表详情页添加目录或文件来源。
              </div>
            )}

            {/* 正则匹配类型 */}
            {createSourceType === 'filter' && (
              <div>
                <div className="mb-2 text-xs text-gray-400">
                  输入正则表达式匹配所有音乐目录中的文件路径
                </div>
                <input
                  type="text"
                  value={createFilterRegex}
                  onChange={(e) => setCreateFilterRegex(e.target.value)}
                  placeholder="例如: .*周杰伦.*\.mp3"
                  className="w-full px-3 py-2 bg-gray-700 rounded text-sm"
                />
              </div>
            )}

            {/* 匹配类型 */}
            {createSourceType === 'match' && (
              <div>
                <div className="mb-3 text-xs text-gray-400">
                  根据歌曲属性创建动态播放列表（多个条件之间是“与”关系，所有条件都必须满足）
                </div>
                
                {/* 已添加的条件列表 */}
                {createConditions.length > 0 && (
                  <div className="mb-3 border border-gray-600 rounded p-2">
                    <div className="text-xs text-gray-400 mb-1">已添加的条件（全部满足）:</div>
                    {createConditions.map((cond, index) => (
                      <div key={index} className="flex items-center gap-2 py-1">
                        <span className="text-sm flex-1">
                          {MATCH_FIELDS.find(f => f.value === cond.match_field)?.label || cond.match_field}
                          {' '}
                          {MATCH_OP_LABELS[cond.match_op] || cond.match_op}
                          {' '}
                          <span className="text-blue-400">{cond.match_value}</span>
                        </span>
                        <button
                          onClick={() => handleRemoveCreateCondition(index)}
                          className="text-red-400 hover:text-red-300 text-xs"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* 添加新条件 */}
                <div className="flex gap-2 items-center mb-3">
                  <select
                    value={createMatchField}
                    onChange={(e) => {
                      setCreateMatchField(e.target.value);
                      const field = MATCH_FIELDS.find(f => f.value === e.target.value);
                      if (field) setCreateMatchOp(field.ops[0]);
                    }}
                    className="px-3 py-2 bg-gray-700 rounded text-sm"
                  >
                    {MATCH_FIELDS.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                  <select
                    value={createMatchOp}
                    onChange={(e) => setCreateMatchOp(e.target.value)}
                    className="px-3 py-2 bg-gray-700 rounded text-sm"
                  >
                    {MATCH_FIELDS.find(f => f.value === createMatchField)?.ops.map((op) => (
                      <option key={op} value={op}>{MATCH_OP_LABELS[op] || op}</option>
                    ))}
                  </select>
                  {createMatchField === 'tags' ? (
                    <select
                      value={createMatchValue}
                      onChange={(e) => setCreateMatchValue(e.target.value)}
                      className="flex-1 px-3 py-2 bg-gray-700 rounded text-sm"
                    >
                      <option value="">选择标签...</option>
                      {createTags.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={createMatchValue}
                      onChange={(e) => setCreateMatchValue(e.target.value)}
                      placeholder="输入值..."
                      className="flex-1 px-3 py-2 bg-gray-700 rounded text-sm"
                    />
                  )}
                  <button
                    onClick={handleAddCreateCondition}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm"
                    disabled={!createMatchValue.trim()}
                  >
                    添加条件
                  </button>
                </div>
              </div>
            )}

            {/* 底部按钮 */}
            <div className="mt-4 flex justify-end gap-2">
              <button 
                onClick={() => setShowCreate(false)} 
                className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-sm"
              >
                取消
              </button>
              <button
                onClick={handleCreatePlaylist}
                disabled={creating || !createName.trim()}
                className="px-3 py-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-sm"
              >
                {creating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}