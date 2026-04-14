// 侧边栏组件
import { useState } from 'react';

type Tab = 'browse' | 'playlists' | 'history' | 'ratings' | 'settings';

export function Sidebar({ activeTab, onTabChange }: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const tabs: { id: Tab; icon: string; label: string }[] = [
    { id: 'browse', icon: '📁', label: '浏览' },
    { id: 'playlists', icon: '📋', label: '播放列表' },
    { id: 'history', icon: '🕐', label: '历史' },
    { id: 'ratings', icon: '⭐', label: '评分管理' },
    { id: 'settings', icon: '⚙️', label: '设置' }
  ];

  // 点击当前激活的 tab 时，回到根目录
  const handleTabClick = (tabId: Tab) => {
    onTabChange(tabId);
    // 触发自定义事件，让页面组件知道需要重置
    window.dispatchEvent(new CustomEvent('sidebar-reset', { detail: { tab: tabId } }));
  };

  return (
    <div className={`bg-gray-900 border-r border-gray-700 flex flex-col transition-all duration-300 ${collapsed ? 'w-14' : 'w-48'}`}>
      {/* Logo / 收缩按钮 */}
      <div className="p-3 border-b border-gray-700 flex items-center justify-between">
        {!collapsed && <h1 className="text-lg font-bold text-purple-400">🎵</h1>}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-gray-400 hover:text-white p-1"
        >
          {collapsed ? '▶' : '◀'}
        </button>
      </div>

      {/* 导航 */}
      <nav className="flex-1 p-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab.id)}
            title={collapsed ? tab.label : undefined}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded text-left mb-1 ${
              activeTab === tab.id
                ? 'bg-purple-600 text-white'
                : 'hover:bg-gray-700 text-gray-300'
            }`}
          >
            <span className="text-lg">{tab.icon}</span>
            {!collapsed && <span>{tab.label}</span>}
          </button>
        ))}
      </nav>

      {/* 版本 */}
      {!collapsed && (
        <div className="p-3 text-xs text-gray-600 border-t border-gray-700">
          moonPlayer v1.0.0
        </div>
      )}
    </div>
  );
}

export type { Tab };