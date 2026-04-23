// 文件浏览器组件
import { useState, useEffect, useCallback } from 'react';
import { browseDirectory, scanTracks, createPlaylist, refreshPlaylist, findPlaylistForDir, getWebdavConfigs, browseWebdav, scanWebdavDirectory, type WebdavConfig } from '../../stores/api';
import { usePlayerStore } from '../../stores/playerStore';
import type { Track } from '../../stores/playerStore';
import { type FileNode, type BrowseResult, convertWebdavTracks, createPlaylistObject } from './utils';
import { getFileName } from '../../utils/format';

export function FileBrowser({ onPlay, onRecycleBin }: {
  onPlay: (path: string) => void;
  onRecycleBin?: () => void;
}) {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [rootPath, setRootPath] = useState<string>('');
  const [directories, setDirectories] = useState<FileNode[]>([]);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRootsView, setIsRootsView] = useState(false);
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
        loadDirectory();
      }
    };
    window.addEventListener('sidebar-reset', handleReset as EventListener);
    return () => window.removeEventListener('sidebar-reset', handleReset as EventListener);
  }, [loadDirectory]);

  // 播放单个文件
  const handlePlayFile = async (path: string) => {
    if (isWebdavView && currentWebdav) {
      handlePlayWebdavFile(path);
      return;
    }
    
    try {
      const result = await scanTracks([path]);
      const trackId = result.insertedIds[0] || result.existingIds[0];
      if (!trackId) return;

      const existing = await findPlaylistForDir(currentPath);
      let playlist: any;

      if (existing.playlist) {
        playlist = existing.playlist;
        // 先刷新获取现有音轨列表
        const refreshed = await refreshPlaylist(playlist.id);
        let trackList = refreshed.tracks as Track[];

        const existingTrack = trackList.find((t: Track) => t.id === trackId);
        if (!existingTrack) {
          // 添加单个文件到播放列表（不创建新来源项，直接关联 track）
          await (await import('../../stores/api')).addPlaylistTrack(playlist.id, trackId);
          // 从 scanTracks 结果中获取新音轨信息（因为 refreshed.tracks 不会包含新添加的音轨）
          const newTrack: Track = {
            id: trackId,
            path: path,
            title: path.split('/').pop()?.replace(/\.[^.]+$/, '') || '未知曲目',
            artist: undefined,
            album: undefined,
            duration: undefined,
            rating: 0,
            playCount: 0,
            skipCount: 0,
            dateAdded: Date.now()
          };
          trackList = [...trackList, newTrack];
        }

        if (trackList.length > 0) {
          setCurrentPlaylist(createPlaylistObject(playlist), trackList);
          const targetTrack = trackList.find((t: Track) => t.id === trackId) || trackList[0];
          setCurrentTrack(targetTrack);
          setIsPlaying(true);
        }
      } else {
        const playlistName = getFileName(currentPath) || '临时播放列表';
        playlist = await createPlaylist(playlistName, [
          { type: 'directory', path: currentPath, includeSubdirs: false }
        ], true);

        const refreshed = await refreshPlaylist(playlist.id);
        const trackList = refreshed.tracks as Track[];

        if (trackList.length > 0) {
          setCurrentPlaylist(createPlaylistObject(playlist), trackList);
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
      const result = await scanWebdavDirectory(currentWebdav.id, {
        dir: currentPath,
        playlistName: currentWebdav.name + ': ' + (getFileName(currentPath) || '根目录'),
        includeSubdirs: false
      });
      
      const trackList = convertWebdavTracks(result.tracks);
      
      setCurrentPlaylist(createPlaylistObject(result.playlist), trackList);
      const targetTrack = trackList.find((t: Track) => t.path === `webdav://${currentWebdav.id}${filePath}`) || trackList[0];
      setCurrentTrack(targetTrack);
      setIsPlaying(true);
    } catch (err) {
      console.error('播放 WebDAV 文件失败:', err);
    }
  };

  // 播放整个目录
  const handlePlayDirectory = async (dirPath: string) => {
    if (isWebdavView && currentWebdav) {
      handlePlayWebdavDirectory(dirPath);
      return;
    }
    
    try {
      const existing = await findPlaylistForDir(dirPath);
      
      if (existing.playlist) {
        const refreshed = await refreshPlaylist(existing.playlist.id);
        const trackList = refreshed.tracks as Track[];
        
        if (trackList.length > 0) {
          setCurrentPlaylist(createPlaylistObject(existing.playlist), trackList);
          setCurrentTrack(trackList[0]);
          setIsPlaying(true);
        }
        return;
      }
      
      const playlistName = getFileName(dirPath) || '目录播放列表';
      const playlist = await createPlaylist(playlistName, [
        { type: 'directory', path: dirPath, includeSubdirs: true }
      ], true);

      const refreshed = await refreshPlaylist(playlist.id);
      const trackList = refreshed.tracks as Track[];

      if (trackList.length > 0) {
        setCurrentPlaylist(createPlaylistObject(playlist), trackList);
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
      const dirName = getFileName(dirPath) || '根目录';
      const result = await scanWebdavDirectory(currentWebdav.id, {
        dir: dirPath,
        playlistName: currentWebdav.name + ': ' + dirName,
        includeSubdirs: true
      });
      
      const trackList = convertWebdavTracks(result.tracks);
      
      setCurrentPlaylist(createPlaylistObject(result.playlist), trackList);
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

  // 返回根目录
  const handleRootClick = () => {
    setIsWebdavView(false);
    setCurrentWebdav(null);
    loadDirectory();
  };

  // 打开添加弹窗
  const handleOpenAddModal = async (type: 'directory' | 'file', path: string) => {
    // 简化：直接使用 window 确认
    const playlistName = type === 'directory'
      ? getFileName(path) || '新播放列表'
      : getFileName(currentPath) || '新播放列表';
    
    const name = prompt('输入播放列表名称:', playlistName);
    if (!name) return;
    
    try {
      const playlist = await createPlaylist(name, [
        { type, path, includeSubdirs: type === 'directory' }
      ]);
      await refreshPlaylist(playlist.id);
      alert('已添加到播放列表: ' + name);
    } catch (err) {
      console.error('添加失败:', err);
      alert('添加失败');
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-gray-700 flex items-center gap-2">
        <button onClick={handleRootClick} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm">🏠 根目录</button>
        {parentPath && (<button onClick={isWebdavView ? () => currentWebdav && loadWebdavDirectory(currentWebdav, parentPath) : () => loadDirectory(parentPath)} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm">⬆️ 上级</button>)}
        <span className="flex-1 text-gray-400 text-sm truncate">
          {isWebdavView && currentWebdav ? `☁️ ${currentWebdav.name}: ` : ''}{currentPath || rootPath}
        </span>
        {onRecycleBin && (
          <button onClick={onRecycleBin} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm" title="回收站">
            🗑️ 回收站
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto p-2">
        {loading ? (<div className="text-center text-gray-500 py-8">加载中...</div>) : (
          <div className="space-y-1">
            {/* 根目录视图：显示多个音乐路径 + WebDAV */}
            {isRootsView ? (
              <>
                <div className="text-gray-400 text-sm mb-2 px-2">本地目录：</div>
                {directories.map((dir) => (
                  <div key={dir.path} className="flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer" onClick={() => loadDirectory(dir.path)}>
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
                        loadDirectory(dir.path);
                      }
                    }}
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
                  >
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
    </div>
  );
}