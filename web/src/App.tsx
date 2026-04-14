// moonPlayer 主应用
import { useState, useEffect } from 'react';
import { Sidebar, Tab } from './components/Sidebar';
import { FileBrowser } from './components/FileBrowser';
import { PlaylistManager, PlaylistDetail } from './components/PlaylistManager';
import { Settings } from './components/Settings';
import { PlayerBar } from './components/AudioPlayer';
import { RatingManager } from './components/RatingManager';
import { HistoryView } from './components/HistoryView';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('browse');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);

  // 监听侧边栏重置事件，回到列表首页
  useEffect(() => {
    const handleReset = (e: CustomEvent<{ tab: Tab }>) => {
      if (e.detail.tab === 'playlists') {
        setSelectedPlaylistId(null);
      }
    };
    window.addEventListener('sidebar-reset', handleReset as EventListener);
    return () => window.removeEventListener('sidebar-reset', handleReset as EventListener);
  }, []);

  const handlePlay = (_path: string) => {
    console.log('Playing:', _path);
  };

  const handleSelectPlaylist = (id: number) => {
    setSelectedPlaylistId(id);
    setActiveTab('playlists');
  };

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 侧边栏 */}
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

        {/* 内容区 */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'browse' && (
            <FileBrowser onPlay={handlePlay} onAddToPlaylist={() => {}} />
          )}

          {activeTab === 'playlists' && (
            selectedPlaylistId ? (
              <PlaylistDetail
                playlistId={selectedPlaylistId}
                onClose={() => setSelectedPlaylistId(null)}
              />
            ) : (
              <PlaylistManager onSelectPlaylist={handleSelectPlaylist} />
            )
          )}

          {activeTab === 'history' && <HistoryView />}

          {activeTab === 'ratings' && <RatingManager />}

          {activeTab === 'settings' && <Settings />}
        </div>
      </div>

      {/* 底部播放器 */}
      <PlayerBar />
    </div>
  );
}

export default App;