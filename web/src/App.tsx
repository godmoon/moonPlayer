// moonPlayer 主应用
import { useState, useEffect } from 'react';
import { Sidebar, Tab } from './components/Sidebar';
import { FileBrowser } from './components/FileBrowser';
import { PlaylistManager, PlaylistDetail } from './components/PlaylistManager';
import { Settings } from './components/Settings';
import { PlayerBar } from './components/AudioPlayer';
import { RatingManager } from './components/RatingManager';
import { HistoryView } from './components/HistoryView';
import { CurrentPlaylist } from './components/CurrentPlaylist';
import { Login } from './components/Login';
import { Setup } from './components/Setup';
import { getNavOrder } from './stores/api';

type AuthState = 'checking' | 'needSetup' | 'needLogin' | 'authenticated';

function App() {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [activeTab, setActiveTab] = useState<Tab | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);

  // 检查登录状态
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      // 先检查是否需要初始化
      const statusRes = await fetch('/api/auth/status');
      const statusData = await statusRes.json();

      if (statusData.needSetup) {
        setAuthState('needSetup');
        return;
      }

      // 检查登录状态
      const checkRes = await fetch('/api/auth/check', {
        credentials: 'include'
      });
      const checkData = await checkRes.json();

      if (checkData.authenticated) {
        setAuthState('authenticated');
        // 加载导航顺序，设置第一个为默认 tab
        getNavOrder().then(order => {
          if (order && order.length > 0) {
            setActiveTab(order[0] as Tab);
          } else {
            setActiveTab('browse');
          }
        }).catch(() => {
          setActiveTab('browse');
        });
      } else {
        setAuthState('needLogin');
      }
    } catch (err) {
      console.error('检查登录状态失败:', err);
      setAuthState('needLogin');
    }
  };

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

  // 检查中
  if (authState === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="text-white">加载中...</div>
      </div>
    );
  }

  // 需要初始化
  if (authState === 'needSetup') {
    return <Setup onSuccess={() => setAuthState('authenticated')} />;
  }

  // 需要登录
  if (authState === 'needLogin') {
    return <Login onSuccess={() => setAuthState('authenticated')} />;
  }

  // 已登录
  if (activeTab === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="text-white">加载中...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white overflow-hidden">
      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 侧边栏 */}
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

        {/* 内容区：手机端自动留出播放器空间 */}
        <div className="flex-1 overflow-hidden overflow-y-auto overscroll-contain pb-[120px] md:pb-0">
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

          {activeTab === 'current' && <CurrentPlaylist />}

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