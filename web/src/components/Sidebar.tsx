// 侧边栏组件
import { useState, useEffect, useRef } from 'react';
import { getNavOrder, setNavOrder } from '../stores/api';

type Tab = 'browse' | 'playlists' | 'current' | 'history' | 'ratings' | 'settings';

const DEFAULT_TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'browse', icon: '📁', label: '浏览' },
  { id: 'playlists', icon: '📋', label: '播放列表' },
  { id: 'current', icon: '▶️', label: '当前列表' },
  { id: 'history', icon: '🕐', label: '历史' },
  { id: 'ratings', icon: '⭐', label: '评分管理' },
  { id: 'settings', icon: '⚙️', label: '设置' }
];

export function Sidebar({ activeTab, onTabChange }: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}) {
  // 移动端默认收起，桌面端默认展开
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 768;
    }
    return false;
  });

  // 导航顺序
  const [navTabs, setNavTabs] = useState(DEFAULT_TABS);
  const [loaded, setLoaded] = useState(false);

  // 拖拽状态
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragNodeRef = useRef<HTMLDivElement | null>(null);

  // 加载导航顺序
  useEffect(() => {
    getNavOrder().then(order => {
      if (order && order.length > 0) {
        const sortedTabs = order.map(id => DEFAULT_TABS.find(t => t.id === id)!).filter(Boolean);
        setNavTabs(sortedTabs);
      }
      setLoaded(true);
    }).catch(() => {
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) setCollapsed(true);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 点击当前激活的 tab 时，回到根目录
  const handleTabClick = (tabId: Tab) => {
    onTabChange(tabId);
    // 触发自定义事件，让页面组件知道需要重置
    window.dispatchEvent(new CustomEvent('sidebar-reset', { detail: { tab: tabId } }));
  };

  // 拖拽开始
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
    }
    // 延迟添加拖拽样式，避免拖拽元素本身变透明
    setTimeout(() => {
      if (dragNodeRef.current) {
        dragNodeRef.current.style.opacity = '0.5';
      }
    }, 0);
  };

  // 拖拽结束
  const handleDragEnd = () => {
    if (dragNodeRef.current) {
      dragNodeRef.current.style.opacity = '1';
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // 拖拽进入
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    if (draggedIndex !== null && index !== draggedIndex) {
      setDragOverIndex(index);
    }
  };

  // 拖拽离开
  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  // 放下
  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIndex) {
      handleDragEnd();
      return;
    }

    // 重新排序
    const newTabs = [...navTabs];
    const [draggedTab] = newTabs.splice(draggedIndex, 1);
    newTabs.splice(dropIndex, 0, draggedTab);
    setNavTabs(newTabs);

    // 保存到后端
    const order = newTabs.map(t => t.id);
    try {
      await setNavOrder(order);
    } catch (err) {
      console.error('保存导航顺序失败:', err);
    }

    handleDragEnd();
  };

  return (
    <div className={`bg-gray-900 border-r border-gray-700 flex flex-col transition-all duration-300 ${collapsed ? 'w-14' : 'w-48'}`}>
      {/* Logo / 收缩按钮 */}
      <div className="p-2 md:p-3 border-b border-gray-700 flex items-center justify-between">
        {!collapsed && <h1 className="text-lg font-bold text-purple-400">🎵</h1>}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-gray-400 hover:text-white p-1"
        >
          {collapsed ? '▶' : '◀'}
        </button>
      </div>

      {/* 导航 */}
      <nav className="flex-1 p-1 md:p-2">
        {!loaded ? (
          <div className="text-gray-500 text-xs p-2">加载中...</div>
        ) : (
          navTabs.map((tab, index) => (
            <div
              key={tab.id}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              ref={draggedIndex === index ? dragNodeRef : null}
              title={collapsed ? tab.label : undefined}
              className={`w-full flex items-center gap-2 px-2 py-2 md:px-3 rounded text-left mb-1 cursor-grab transition-all duration-150 ${
                activeTab === tab.id
                  ? 'bg-purple-600 text-white'
                  : 'hover:bg-gray-700 text-gray-300'
              } ${
                draggedIndex !== null && draggedIndex === index ? 'opacity-50' : ''
              } ${
                dragOverIndex === index ? 'border-t-2 border-purple-400' : ''
              }`}
              onClick={() => handleTabClick(tab.id)}
            >
              <span className="text-lg cursor-grab">{tab.icon}</span>
              {!collapsed && <span className="text-sm md:text-base cursor-grab">{tab.label}</span>}
            </div>
          ))
        )}
      </nav>

      {/* 版本 */}
      {!collapsed && (
        <div className="p-2 md:p-3 text-xs text-gray-600 border-t border-gray-700">
          <div className="mb-1 text-gray-500">拖拽导航可排序</div>
          moonPlayer v1.0.0
        </div>
      )}
    </div>
  );
}

export type { Tab };