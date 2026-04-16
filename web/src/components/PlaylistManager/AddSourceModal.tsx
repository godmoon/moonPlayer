// 添加来源弹窗组件
import { useState, useEffect } from 'react';
import { browseDirectory, getRoots, addPlaylistItem, updatePlaylistItem, getPlaylist, getTags } from '../../stores/api';
import { MATCH_FIELDS, MATCH_OP_LABELS, type SourceType } from './utils';

interface AddSourceModalProps {
  playlistId: number;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddSourceModal({ playlistId, onClose, onSuccess }: AddSourceModalProps) {
  const [sourceType, setSourceType] = useState<SourceType>('directory');
  const [includeSubdirs, setIncludeSubdirs] = useState(true);
  const [filterRegex, setFilterRegex] = useState('');
  const [browseResult, setBrowseResult] = useState<any>(null);
  const [musicRoots, setMusicRoots] = useState<{ name: string; path: string }[]>([]);
  
  // 匹配类型相关状态
  const [matchField, setMatchField] = useState<string>('rating');
  const [matchOp, setMatchOp] = useState<string>('>');
  const [matchValue, setMatchValue] = useState<string>('');
  const [tags, setTags] = useState<string[]>([]);

  // 加载音乐根目录
  useEffect(() => {
    getRoots().then(setMusicRoots).catch(console.error);
  }, []);

  // 初始化浏览
  useEffect(() => {
    if (musicRoots.length > 0 && !browseResult) {
      handleBrowse(null);
    }
  }, [musicRoots]);

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
  const handleAddFilterSource = async () => {
    if (!filterRegex.trim()) {
      alert('请输入正则表达式');
      return;
    }

    try {
      await addPlaylistItem(playlistId, 'filter', '*', false);
      const result = await getPlaylist(playlistId);
      const items = result.items || [];
      const lastItem = items[items.length - 1];
      if (lastItem) {
        await updatePlaylistItem(playlistId, lastItem.id, { filterRegex: filterRegex });
      }
      onSuccess();
      onClose();
    } catch (err) {
      console.error('添加来源失败:', err);
      alert('添加失败');
    }
  };

  // 添加匹配来源
  const handleAddMatchSource = async () => {
    if (!matchValue.trim()) {
      alert('请输入匹配值');
      return;
    }
    try {
      await addPlaylistItem(playlistId, 'filter', '*', false);
      const result = await getPlaylist(playlistId);
      const items = result.items || [];
      const lastItem = items[items.length - 1];
      if (lastItem) {
        await updatePlaylistItem(playlistId, lastItem.id, {
          filterRegex: '*',
          matchField,
          matchOp,
          matchValue
        });
      }
      onSuccess();
      onClose();
    } catch (err) {
      console.error('添加匹配来源失败:', err);
      alert('添加失败');
    }
  };

  // 添加目录来源
  const handleAddDirectorySource = async (path: string) => {
    try {
      await addPlaylistItem(playlistId, 'directory', path, includeSubdirs);
      onSuccess();
      onClose();
    } catch (err) {
      console.error('添加目录来源失败:', err);
      alert('添加失败');
    }
  };

  // 添加文件来源
  const handleAddFileSource = async (path: string) => {
    try {
      await addPlaylistItem(playlistId, 'file', path, false);
      onSuccess();
      onClose();
    } catch (err) {
      console.error('添加文件来源失败:', err);
      alert('添加失败');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-4 w-[600px] max-h-[80vh] overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">添加来源</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
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
          <button
            onClick={async () => {
              setSourceType('match');
              try {
                const t = await getTags();
                setTags(t);
              } catch (err) {
                console.error('加载标签列表失败:', err);
              }
            }}
            className={`px-3 py-1 rounded text-sm ${sourceType === 'match' ? 'bg-purple-600' : 'bg-gray-700'}`}
          >
            🎯 匹配
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
                      handleAddDirectorySource(dir.path);
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
                  onClick={() => handleAddFileSource(file.path)}
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

        {sourceType === 'file' && (
          <div>
            <div className="mb-2 text-xs text-gray-400">
              选择文件添加到播放列表
            </div>
            <div className="border border-gray-700 rounded max-h-60 overflow-auto">
              {browseResult && !browseResult.isRootsView && browseResult.parentPath !== null && (
                <div
                  onClick={() => handleBrowse(browseResult.parentPath)}
                  className="px-3 py-2 hover:bg-gray-700 cursor-pointer text-sm"
                >
                  📁 ..
                </div>
              )}
              {browseResult?.directories?.map((dir: any) => (
                <div
                  key={dir.path}
                  onClick={() => handleBrowse(dir.path)}
                  className="px-3 py-2 hover:bg-gray-700 cursor-pointer text-sm"
                >
                  📁 {dir.name}
                </div>
              ))}
              {browseResult?.files?.map((file: any) => (
                <div
                  key={file.path}
                  onClick={() => handleAddFileSource(file.path)}
                  className="px-3 py-2 hover:bg-gray-700 cursor-pointer text-sm"
                >
                  🎵 {file.name}
                </div>
              ))}
            </div>
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
                onClick={handleAddFilterSource}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded text-sm"
              >
                添加
              </button>
            </div>
          </div>
        )}

        {sourceType === 'match' && (
          <div>
            <div className="mb-3 text-xs text-gray-400">
              根据歌曲属性创建动态播放列表(需要先刷新缓存)
            </div>
            <div className="flex gap-2 items-center mb-3">
              <select
                value={matchField}
                onChange={(e) => {
                  setMatchField(e.target.value);
                  const field = MATCH_FIELDS.find(f => f.value === e.target.value);
                  if (field) setMatchOp(field.ops[0]);
                }}
                className="px-3 py-2 bg-gray-700 rounded text-sm"
              >
                {MATCH_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
              <select
                value={matchOp}
                onChange={(e) => setMatchOp(e.target.value)}
                className="px-3 py-2 bg-gray-700 rounded text-sm"
              >
                {MATCH_FIELDS.find(f => f.value === matchField)?.ops.map((op) => (
                  <option key={op} value={op}>{MATCH_OP_LABELS[op] || op}</option>
                ))}
              </select>
              {matchField === 'tags' ? (
                <select
                  value={matchValue}
                  onChange={(e) => setMatchValue(e.target.value)}
                  className="flex-1 px-3 py-2 bg-gray-700 rounded text-sm"
                >
                  <option value="">选择标签...</option>
                  {tags.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={matchValue}
                  onChange={(e) => setMatchValue(e.target.value)}
                  placeholder="输入值..."
                  className="flex-1 px-3 py-2 bg-gray-700 rounded text-sm"
                />
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAddMatchSource}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded text-sm"
              >
                添加
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-sm">
            取消
          </button>
        </div>
      </div>
    </div>
  );
}