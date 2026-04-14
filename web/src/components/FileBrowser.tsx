// 文件浏览器组件
import { useState, useEffect, useCallback } from 'react';
import { browseDirectory, createPlaylist, scanTracks, getPlaylists, addPlaylistItem, refreshPlaylist, findPlaylistForDir, getWebdavConfigs, browseWebdav, scanWebdavDirectory, type WebdavConfig } from '../stores/api';
import { usePlayerStore } from '../stores/playerStore';
import type { Track, Playlist } from '../stores/playerStore';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface BrowseResult {
  currentPath: string;
  rootPath: string;
  parentPath: string | null;
  directories: FileNode[];
  files: FileNode[];
  isRootsView?: boolean;
}

export function FileBrowser({ onPlay }: {
  onPlay: (path: string) => void;
  onAddToPlaylist: (type: 'directory' | 'file', path: string) => void;
}) {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [rootPath, setRootPath] = useState<string>('');
  const [directories, setDirectories] = useState<FileNode[]>([]);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRootsView, setIsRootsView] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addTarget, setAddTarget] = useState<{ type: 'directory' | 'file'; path: string } | null>(null);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [newPlaylistName, setNewPlaylistName] = useState<string>('');
  const [creating, setCreating] = useState(false);

  // WebDAV 相关状态
  const [webdavConfigs, setWebdavConfigs] = useState<WebdavConfig[]>([]);
  const [currentWebdav, setCurrentWebdav] = useState<WebdavConfig | null>(null);
  const [isWebdavView, setIsWebdavView] = useState(false);

  const { setCurrentPlaylist, setCurrentTrack, setIsPlaying } = usePlayerStore();

  const loadDirectory = useCallback(async (path?: string) => {
    setLoading(true);
    try {
      const result: BrowseResult = await browseDirectory(path);
      setCurrentPath(result.currentPath);
      setRootPath(result.rootPath);
      setParentPath(result.parentPath);
      setDirectories(result.directories);
      setFiles(result.files);
      setIsRootsView(result.isRootsView || false);
    } catch (err) {
      console.error('加载目录失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDirectory();
    loadWebdavConfigs();
  }, [loadDirectory]);

  const loadWebdavConfigs = async () => {
    try {
      const configs = await getWebdavConfigs();
      setWebdavConfigs(configs);
    } catch (err) {
      console.error('加载 WebDAV 配置失败:', err);
    }
  };

  // 监听侧边栏重置事件
  useEffect(() => {
    const handleReset = (e: CustomEvent) => {
      if (e.detail.tab === 'browse') {
        loadDirectory(); // 回到根目录
      }
    };
    window.addEventListener('sidebar-reset', handleReset as EventListener);
    return () => window.removeEventListener('sidebar-reset', handleReset as EventListener);
  }, [loadDirectory]);

  const handleDirectoryClick = (path: string) => {
    loadDirectory(path);
  };

  const handleParentClick = () => {
    if (parentPath) loadDirectory(parentPath);
  };

  // 播放单个文件
  const handlePlayFile = async (path: string) => {
    // WebDAV 文件播放
    if (isWebdavView && currentWebdav) {
      handlePlayWebdavFile(path);
      return;
    }
    
    // 本地文件播放
    try {
      // 扫描文件获取音轨信息
      const result = await scanTracks([path]);
      const trackId = result.insertedIds[0] || result.existingIds[0];
      if (!trackId) return;

      // 先查找是否有匹配当前目录的播放列表
      const existing = await findPlaylistForDir(currentPath);
      let playlist: any;
      let playlistName: string;

      if (existing.playlist) {
        // 使用现有播放列表
        playlist = existing.playlist;
        playlistName = existing.playlist.name;
        
        // 刷新播放列表获取音轨
        const refreshed = await refreshPlaylist(playlist.id);
        let trackList = refreshed.tracks as Track[];

        // 检查当前音轨是否已在列表中
        const existingTrack = trackList.find((t: Track) => t.id === trackId);
        if (!existingTrack) {
          // 不在列表中，添加到播放列表
          await addPlaylistItem(playlist.id, 'file', path, false);
          // 再次刷新
          const refreshed2 = await refreshPlaylist(playlist.id);
          trackList = refreshed2.tracks as Track[];
        }

        if (trackList.length > 0) {
          const pl: Playlist = {
            id: playlist.id,
            name: playlistName,
            createdAt: playlist.created_at || playlist.createdAt,
            updatedAt: playlist.updated_at || playlist.updatedAt,
            isAuto: true,
            playMode: existing.playlist.play_mode || 'sequential',
            skipIntro: existing.playlist.skip_intro,
            skipOutro: existing.playlist.skip_outro
          };
          setCurrentPlaylist(pl, trackList);

          // 找到当前点击的音轨
          const targetTrack = trackList.find((t: Track) => t.id === trackId) || trackList[0];
          setCurrentTrack(targetTrack);
          setIsPlaying(true);
        }
      } else {
        // 创建新播放列表
        playlistName = currentPath.split('/').filter(Boolean).pop() || '临时播放列表';
        playlist = await createPlaylist(playlistName, [
          { type: 'directory', path: currentPath, includeSubdirs: false }
        ], true);

        // 刷新播放列表获取所有音轨
        const refreshed = await refreshPlaylist(playlist.id);
        const trackList = refreshed.tracks as Track[];

        if (trackList.length > 0) {
          const pl: Playlist = {
            id: playlist.id,
            name: playlistName,
            createdAt: playlist.created_at,
            updatedAt: playlist.updated_at,
            isAuto: true,
            playMode: 'sequential'
          };
          setCurrentPlaylist(pl, trackList);

          // 找到当前点击的音轨
          const targetTrack = trackList.find((t: Track) => t.id === trackId) || trackList[0];
          setCurrentTrack(targetTrack);
          setIsPlaying(true);
        }
      }

      onPlay(path);
    } catch (err) {
      console.error('播放失败:', err);
    }
  };

  // 播放 WebDAV 文件
  const handlePlayWebdavFile = async (filePath: string) => {
    if (!currentWebdav) return;
    
    try {
      // 扫描当前目录并创建播放列表
      const result = await scanWebdavDirectory(currentWebdav.id, {
        dir: currentPath,
        playlistName: currentWebdav.name + ': ' + (currentPath.split('/').filter(Boolean).pop() || '根目录'),
        includeSubdirs: false
      });
      
      const trackList: Track[] = result.tracks.map((t: any) => ({
        id: t.id,
        path: t.path,
        title: t.title,
        artist: t.artist || '',
        album: t.album || '',
        duration: t.duration || 0,
        rating: t.rating || 0,
        playCount: t.play_count || 0,
        skipCount: t.skip_count || 0,
        dateAdded: t.date_added || Date.now()
      }));
      
      const pl: Playlist = {
        id: result.playlist.id,
        name: result.playlist.name,
        createdAt: result.playlist.created_at,
        updatedAt: result.playlist.updated_at,
        isAuto: true,
        playMode: result.playlist.play_mode || 'sequential'
      };
      
      setCurrentPlaylist(pl, trackList);
      
      // 找到当前点击的音轨
      const targetTrack = trackList.find((t: Track) => t.path === `webdav://${currentWebdav.id}${filePath}`) || trackList[0];
      setCurrentTrack(targetTrack);
      setIsPlaying(true);
    } catch (err) {
      console.error('播放 WebDAV 文件失败:', err);
    }
  };

  // 播放整个目录
  const handlePlayDirectory = async (dirPath: string) => {
    // WebDAV 目录播放
    if (isWebdavView && currentWebdav) {
      handlePlayWebdavDirectory(dirPath);
      return;
    }
    
    try {
      // 先检查是否已有匹配的播放列表
      const existing = await findPlaylistForDir(dirPath);
      
      if (existing.playlist) {
        // 使用现有播放列表
        const refreshed = await refreshPlaylist(existing.playlist.id);
        const trackList = refreshed.tracks as Track[];
        
        if (trackList.length > 0) {
          const pl: Playlist = {
            id: existing.playlist.id,
            name: existing.playlist.name,
            createdAt: refreshed.playlist?.created_at || Date.now(),
            updatedAt: refreshed.playlist?.updated_at || Date.now(),
            isAuto: true,
            playMode: existing.playlist.play_mode,
            skipIntro: existing.playlist.skip_intro,
            skipOutro: existing.playlist.skip_outro
          };
          setCurrentPlaylist(pl, trackList);
          setCurrentTrack(trackList[0]);
          setIsPlaying(true);
        }
        return;
      }
      
      // 没有现有播放列表，创建新的
      const playlistName = dirPath.split('/').filter(Boolean).pop() || '目录播放列表';
      const playlist = await createPlaylist(playlistName, [
        { type: 'directory', path: dirPath, includeSubdirs: true }
      ], true);

      const refreshed = await refreshPlaylist(playlist.id);
      const trackList = refreshed.tracks as Track[];

      if (trackList.length > 0) {
        const pl: Playlist = {
          id: playlist.id,
          name: playlistName,
          createdAt: playlist.created_at,
          updatedAt: playlist.updated_at,
          isAuto: true,
          playMode: 'sequential'
        };
        setCurrentPlaylist(pl, trackList);
        setCurrentTrack(trackList[0]);
        setIsPlaying(true);
      }
    } catch (err) {
      console.error('播放目录失败:', err);
    }
  };

  // 播放 WebDAV 目录
  const handlePlayWebdavDirectory = async (dirPath: string) => {
    if (!currentWebdav) return;
    
    try {
      const dirName = dirPath.split('/').filter(Boolean).pop() || '根目录';
      const result = await scanWebdavDirectory(currentWebdav.id, {
        dir: dirPath,
        playlistName: currentWebdav.name + ': ' + dirName,
        includeSubdirs: true
      });
      
      const trackList: Track[] = result.tracks.map((t: any) => ({
        id: t.id,
        path: t.path,
        title: t.title,
        artist: t.artist || '',
        album: t.album || '',
        duration: t.duration || 0,
        rating: t.rating || 0,
        playCount: t.play_count || 0,
        skipCount: t.skip_count || 0,
        dateAdded: t.date_added || Date.now()
      }));
      
      const pl: Playlist = {
        id: result.playlist.id,
        name: result.playlist.name,
        createdAt: result.playlist.created_at,
        updatedAt: result.playlist.updated_at,
        isAuto: true,
        playMode: result.playlist.play_mode || 'sequential'
      };
      
      setCurrentPlaylist(pl, trackList);
      setCurrentTrack(trackList[0]);
      setIsPlaying(true);
    } catch (err) {
      console.error('播放 WebDAV 目录失败:', err);
    }
  };

  // 加载 WebDAV 目录
  const loadWebdavDirectory = async (config: WebdavConfig, dir?: string) => {
    setLoading(true);
    setIsWebdavView(true);
    setCurrentWebdav(config);
    try {
      const result = await browseWebdav(config.id, dir);
      setCurrentPath(result.currentPath);
      setParentPath(result.parentPath);
      setDirectories(result.directories);
      setFiles(result.files);
      setIsRootsView(false);
    } catch (err) {
      console.error('加载 WebDAV 目录失败:', err);
    } finally {
      setLoading(false);
    }
  };

  // 返回根目录时重置 WebDAV 视图
  const handleRootClick = () => {
    setIsWebdavView(false);
    setCurrentWebdav(null);
    loadDirectory();
  };

  const handleOpenAddModal = async (type: 'directory' | 'file', path: string) => {
    setAddTarget({ type, path });
    const list = await getPlaylists();
    setPlaylists(list);
    // 默认播放列表名称：文件夹用该文件夹名，文件用当前目录名
    const defaultName = type === 'directory'
      ? path.split('/').filter(Boolean).pop() || '新播放列表'
      : currentPath.split('/').filter(Boolean).pop() || '新播放列表';
    setNewPlaylistName(defaultName);
    setShowAddModal(true);
  };

  // 长按触发上下文菜单
  const handleContextMenu = (e: React.MouseEvent | React.TouchEvent, type: 'directory' | 'file', path: string) => {
    e.preventDefault();
    e.stopPropagation();
    handleOpenAddModal(type, path);
  };

  const handleAddToPlaylist = async (playlistId: number) => {
    if (!addTarget) return;
    try {
      await addPlaylistItem(playlistId, addTarget.type, addTarget.path, addTarget.type === 'directory');
      // 刷新播放列表音轨
      await refreshPlaylist(playlistId);
      setShowAddModal(false);
      setAddTarget(null);
    } catch (err) {
      console.error('添加到播放列表失败:', err);
    }
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim() || !addTarget) return;
    setCreating(true);
    try {
      const playlist = await createPlaylist(newPlaylistName.trim(), [
        { type: addTarget.type, path: addTarget.path, includeSubdirs: addTarget.type === 'directory' }
      ]);
      // 刷新播放列表音轨
      await refreshPlaylist(playlist.id);
      setShowAddModal(false);
      setAddTarget(null);
      // 刷新播放列表
      const list = await getPlaylists();
      setPlaylists(list);
    } catch (err) {
      console.error('创建播放列表失败:', err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-gray-700 flex items-center gap-2">
        <button onClick={handleRootClick} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm">🏠 根目录</button>
        {parentPath && (<button onClick={isWebdavView ? () => currentWebdav && loadWebdavDirectory(currentWebdav, parentPath) : handleParentClick} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm">⬆️ 上级</button>)}
        <span className="flex-1 text-gray-400 text-sm truncate">
          {isWebdavView && currentWebdav ? `☁️ ${currentWebdav.name}: ` : ''}{currentPath || rootPath}
        </span>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {loading ? (<div className="text-center text-gray-500 py-8">加载中...</div>) : (
          <div className="space-y-1">
            {/* 根目录视图：显示多个音乐路径 + WebDAV */}
            {isRootsView ? (
              <>
                <div className="text-gray-400 text-sm mb-2 px-2">本地目录：</div>
                {directories.map((dir) => (
                  <div key={dir.path} className="flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer" onClick={() => handleDirectoryClick(dir.path)}>
                    <span className="text-yellow-500">📁</span>
                    <span className="flex-1 truncate">{dir.name}</span>
                    <button onClick={(e) => { e.stopPropagation(); handleOpenAddModal('directory', dir.path); }} className="px-2 py-1 bg-green-600 hover:bg-green-500 rounded text-xs" title="添加到播放列表">➕</button>
                    <button onClick={(e) => { e.stopPropagation(); handlePlayDirectory(dir.path); }} className="px-2 py-1 bg-purple-600 hover:bg-purple-500 rounded text-xs" title="播放">▶️</button>
                  </div>
                ))}
                
                {/* WebDAV 配置列表 */}
                {webdavConfigs.length > 0 && (
                  <>
                    <div className="text-gray-400 text-sm mb-2 px-2 mt-4">WebDAV 存储：</div>
                    {webdavConfigs.map((config) => (
                      <div key={config.id} className="flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer" onClick={() => loadWebdavDirectory(config)}>
                        <span className="text-blue-500">☁️</span>
                        <span className="flex-1 truncate">{config.name}</span>
                      </div>
                    ))}
                  </>
                )}
              </>
            ) : (
              <>
                {directories.map((dir) => (
                  <div
                    key={dir.path}
                    className="flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer"
                    onClick={() => {
                      if (isWebdavView && currentWebdav) {
                        loadWebdavDirectory(currentWebdav, dir.path);
                      } else {
                        handleDirectoryClick(dir.path);
                      }
                    }}
                    onContextMenu={(e) => handleContextMenu(e, 'directory', dir.path)}
                  >
                    <span className="text-yellow-500">📁</span>
                    <span className="flex-1 truncate">{dir.name}</span>
                    <button onClick={(e) => { e.stopPropagation(); handleOpenAddModal('directory', dir.path); }} className="px-2 py-1 bg-green-600 hover:bg-green-500 rounded text-xs" title="添加到播放列表">➕</button>
                    <button onClick={(e) => { e.stopPropagation(); handlePlayDirectory(dir.path); }} className="px-2 py-1 bg-purple-600 hover:bg-purple-500 rounded text-xs" title="播放">▶️</button>
                  </div>
                ))}

                {files.map((file) => (
                  <div
                    key={file.path}
                    className="flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer"
                    onClick={() => handlePlayFile(file.path)}
                    onContextMenu={(e) => handleContextMenu(e, 'file', file.path)}
                  >
                    <span className="text-green-500">🎵</span>
                    <span className="flex-1 truncate">{file.name}</span>
                    <button onClick={(e) => { e.stopPropagation(); handleOpenAddModal('file', file.path); }} className="px-2 py-1 bg-green-600 hover:bg-green-500 rounded text-xs" title="添加到播放列表">➕</button>
                    <button onClick={(e) => { e.stopPropagation(); handlePlayFile(file.path); }} className="px-2 py-1 bg-purple-600 hover:bg-purple-500 rounded text-xs" title="播放">▶️</button>
                  </div>
                ))}

                {directories.length === 0 && files.length === 0 && (<div className="text-center text-gray-500 py-8">此目录为空</div>)}
              </>
            )}
          </div>
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg w-80 max-h-96 overflow-hidden">
            <div className="p-3 border-b border-gray-700 flex items-center justify-between">
              <h3 className="font-medium text-sm">添加到播放列表</h3>
              <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-white">✕</button>
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
              {playlists.length === 0 ? (
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
      )}
    </div>
  );
}