// 设置组件
import { useState, useEffect } from 'react';
import { getMusicPaths, setMusicPaths, getWebdavConfigs, addWebdavConfig, deleteWebdavConfig, testWebdavConfig, type WebdavConfig } from '../stores/api';
import { usePlayerStore, QUALITY_MODES, type PlayMode, type QualityMode } from '../stores/playerStore';

const playModes: { id: PlayMode; label: string; icon: string }[] = [
  { id: 'sequential', label: '顺序播放', icon: '▶️' },
  { id: 'shuffle', label: '随机播放', icon: '🔀' },
  { id: 'weighted', label: '权重随机', icon: '⚖️' },
  { id: 'random', label: '乱序播放', icon: '🎲' },
  { id: 'single-loop', label: '单曲循环', icon: '🔁' }
];

export function Settings() {
  const [musicPaths, setMusicPathsState] = useState<string[]>([]);
  const [newPath, setNewPath] = useState('');
  const [saving, setSaving] = useState(false);
  const { playMode, setPlayMode, qualityMode, setQualityMode } = usePlayerStore();

  // WebDAV 配置
  const [webdavConfigs, setWebdavConfigs] = useState<WebdavConfig[]>([]);
  const [showWebdavForm, setShowWebdavForm] = useState(false);
  const [webdavForm, setWebdavForm] = useState({
    name: '',
    url: '',
    username: '',
    password: '',
    base_path: '/'
  });

  // 密码修改
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  useEffect(() => {
    loadMusicPaths();
    loadWebdavConfigs();
    // 从 localStorage 恢复省流模式设置
    try {
      const savedQualityMode = localStorage.getItem('qualityMode');
      if (savedQualityMode && ['low', 'medium', 'high', 'lossless'].includes(savedQualityMode)) {
        // 只有当 store 中的值与 localStorage 不同时才设置
        if (savedQualityMode !== usePlayerStore.getState().qualityMode) {
          usePlayerStore.getState().setQualityMode(savedQualityMode as QualityMode);
        }
      }
    } catch {}
  }, []);

  const loadMusicPaths = async () => {
    try {
      const paths = await getMusicPaths();
      setMusicPathsState(paths);
    } catch (err) {
      console.error('加载音乐路径失败:', err);
    }
  };

  const loadWebdavConfigs = async () => {
    try {
      const configs = await getWebdavConfigs();
      setWebdavConfigs(configs);
    } catch (err) {
      console.error('加载 WebDAV 配置失败:', err);
    }
  };

  const handleAddPath = async () => {
    if (!newPath.trim()) return;
    const trimmed = newPath.trim();
    if (musicPaths.includes(trimmed)) {
      alert('此路径已存在');
      return;
    }
    setSaving(true);
    try {
      const updated = [...musicPaths, trimmed];
      await setMusicPaths(updated);
      setMusicPathsState(updated);
      setNewPath('');
    } catch (err) {
      console.error('添加路径失败:', err);
      alert('添加失败，请检查路径是否有效');
    } finally {
      setSaving(false);
    }
  };

  const handleRemovePath = async (path: string) => {
    const updated = musicPaths.filter(p => p !== path);
    setSaving(true);
    try {
      await setMusicPaths(updated);
      setMusicPathsState(updated);
    } catch (err) {
      console.error('移除路径失败:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleAddWebdav = async () => {
    if (!webdavForm.name.trim() || !webdavForm.url.trim()) {
      alert('名称和 URL 不能为空');
      return;
    }
    setSaving(true);
    try {
      await addWebdavConfig({
        name: webdavForm.name,
        url: webdavForm.url,
        username: webdavForm.username || undefined,
        password: webdavForm.password || undefined,
        base_path: webdavForm.base_path
      });
      await loadWebdavConfigs();
      setShowWebdavForm(false);
      setWebdavForm({ name: '', url: '', username: '', password: '', base_path: '/' });
    } catch (err: any) {
      alert(err.response?.data?.error || '添加失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTestWebdav = async (id: number) => {
    try {
      const result = await testWebdavConfig(id);
      alert(result.message);
    } catch (err) {
      alert('测试失败');
    }
  };

  const handleDeleteWebdav = async (id: number) => {
    if (!confirm('确定删除此 WebDAV 配置？')) return;
    await deleteWebdavConfig(id);
    await loadWebdavConfigs();
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!passwordForm.oldPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPasswordError('所有字段都不能为空');
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('新密码两次输入不一致');
      return;
    }

    if (passwordForm.newPassword.length < 6) {
      setPasswordError('新密码至少需要6个字符');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(passwordForm),
        credentials: 'include'
      });

      const data = await res.json();

      if (!res.ok) {
        setPasswordError(data.error || '修改失败');
        return;
      }

      setPasswordSuccess('密码修改成功');
      setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
      setTimeout(() => {
        setShowPasswordForm(false);
        setPasswordSuccess('');
      }, 2000);
    } catch (err) {
      setPasswordError('网络错误，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    if (!confirm('确定要退出登录吗？')) return;
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.reload();
  };

  return (
    <div className="h-full overflow-auto p-4">
      <h2 className="text-xl font-bold mb-6">设置</h2>

      {/* 音乐目录 */}
      <div className="mb-6">
        <label className="block text-sm text-gray-400 mb-2">本地音乐目录</label>
        <div className="space-y-2 mb-3">
          {musicPaths.length === 0 ? (
            <div className="text-gray-500 text-sm">暂无音乐目录，请添加</div>
          ) : (
            musicPaths.map((path) => (
              <div key={path} className="flex items-center gap-2 p-2 bg-gray-700 rounded">
                <span className="text-yellow-500">📁</span>
                <span className="flex-1 text-sm truncate">{path}</span>
                <button
                  onClick={() => handleRemovePath(path)}
                  className="text-red-500 hover:text-red-400 text-sm px-2"
                  disabled={saving}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            className="flex-1 px-3 py-2 bg-gray-700 rounded text-sm"
            placeholder="/path/to/music"
          />
          <button
            onClick={handleAddPath}
            disabled={saving || !newPath.trim()}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded text-sm"
          >
            {saving ? '添加中...' : '添加'}
          </button>
        </div>
      </div>

      {/* WebDAV 配置 */}
      <div className="mb-6">
        <label className="block text-sm text-gray-400 mb-2">WebDAV 远程存储</label>
        <div className="space-y-2 mb-3">
          {webdavConfigs.length === 0 ? (
            <div className="text-gray-500 text-sm">暂无 WebDAV 配置</div>
          ) : (
            webdavConfigs.map((config) => (
              <div key={config.id} className="flex items-center gap-2 p-2 bg-gray-700 rounded">
                <span className="text-blue-500">☁️</span>
                <div className="flex-1">
                  <div className="text-sm">{config.name}</div>
                  <div className="text-xs text-gray-500">{config.url}</div>
                </div>
                <button
                  onClick={() => handleTestWebdav(config.id)}
                  className="text-green-500 hover:text-green-400 text-sm px-2"
                >
                  测试
                </button>
                <button
                  onClick={() => handleDeleteWebdav(config.id)}
                  className="text-red-500 hover:text-red-400 text-sm px-2"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        {showWebdavForm ? (
          <div className="bg-gray-700 p-3 rounded space-y-2">
            <input
              type="text"
              value={webdavForm.name}
              onChange={(e) => setWebdavForm({ ...webdavForm, name: e.target.value })}
              className="w-full px-3 py-2 bg-gray-600 rounded text-sm"
              placeholder="名称（如：坚果云）"
            />
            <input
              type="text"
              value={webdavForm.url}
              onChange={(e) => setWebdavForm({ ...webdavForm, url: e.target.value })}
              className="w-full px-3 py-2 bg-gray-600 rounded text-sm"
              placeholder="WebDAV URL（如：https://dav.jianguoyun.com/dav/）"
            />
            <input
              type="text"
              value={webdavForm.username}
              onChange={(e) => setWebdavForm({ ...webdavForm, username: e.target.value })}
              className="w-full px-3 py-2 bg-gray-600 rounded text-sm"
              placeholder="用户名（可选）"
            />
            <input
              type="password"
              value={webdavForm.password}
              onChange={(e) => setWebdavForm({ ...webdavForm, password: e.target.value })}
              className="w-full px-3 py-2 bg-gray-600 rounded text-sm"
              placeholder="密码（可选）"
            />
            <input
              type="text"
              value={webdavForm.base_path}
              onChange={(e) => setWebdavForm({ ...webdavForm, base_path: e.target.value })}
              className="w-full px-3 py-2 bg-gray-600 rounded text-sm"
              placeholder="基础路径（如：/Music）"
            />
            <div className="flex gap-2">
              <button
                onClick={handleAddWebdav}
                disabled={saving}
                className="flex-1 px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded text-sm"
              >
                {saving ? '保存中...' : '保存'}
              </button>
              <button
                onClick={() => setShowWebdavForm(false)}
                className="px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded text-sm"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowWebdavForm(true)}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm"
          >
            ➕ 添加 WebDAV
          </button>
        )}
      </div>

      {/* 播放模式 */}
      <div className="mb-6">
        <label className="block text-sm text-gray-400 mb-2">默认播放模式</label>
        <select
          value={playMode}
          onChange={(e) => setPlayMode(e.target.value as PlayMode)}
          className="w-full px-3 py-2 bg-gray-700 rounded text-sm text-white border border-gray-600 focus:border-purple-500 focus:outline-none"
        >
          {playModes.map((mode) => (
            <option key={mode.id} value={mode.id}>
              {mode.icon} {mode.label}
            </option>
          ))}
        </select>
      </div>

      {/* 省流模式 */}
      <div className="mb-6">
        <label className="block text-sm text-gray-400 mb-2">省流模式</label>
        <select
          value={qualityMode}
          onChange={(e) => setQualityMode(e.target.value as QualityMode)}
          className="w-full px-3 py-2 bg-gray-700 rounded text-sm text-white border border-gray-600 focus:border-purple-500 focus:outline-none"
        >
          {QUALITY_MODES.map((mode) => (
            <option key={mode.id} value={mode.id}>
              {mode.label} ({mode.description})
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500 mt-1">
          选择非无损品质时，高比特率音频将转码为指定比特率
        </p>
      </div>

      {/* 账户安全 */}
      <div className="mb-6">
        <label className="block text-sm text-gray-400 mb-2">账户安全</label>
        {showPasswordForm ? (
          <div className="bg-gray-700 p-3 rounded space-y-2">
            <input
              type="password"
              value={passwordForm.oldPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
              className="w-full px-3 py-2 bg-gray-600 rounded text-sm"
              placeholder="原密码"
              disabled={saving}
            />
            <input
              type="password"
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
              className="w-full px-3 py-2 bg-gray-600 rounded text-sm"
              placeholder="新密码（至少6个字符）"
              disabled={saving}
            />
            <input
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
              className="w-full px-3 py-2 bg-gray-600 rounded text-sm"
              placeholder="确认新密码"
              disabled={saving}
            />
            {passwordError && <p className="text-red-400 text-sm">{passwordError}</p>}
            {passwordSuccess && <p className="text-green-400 text-sm">{passwordSuccess}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleChangePassword}
                disabled={saving}
                className="flex-1 px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded text-sm"
              >
                {saving ? '保存中...' : '确认修改'}
              </button>
              <button
                onClick={() => {
                  setShowPasswordForm(false);
                  setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
                  setPasswordError('');
                }}
                className="px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded text-sm"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              onClick={() => setShowPasswordForm(true)}
              className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-left"
            >
              🔐 修改密码
            </button>
            <button
              onClick={handleLogout}
              className="w-full px-4 py-2 bg-gray-700 hover:bg-red-600 rounded text-sm text-left"
            >
              🚪 退出登录
            </button>
          </div>
        )}
      </div>

      {/* 关于 */}
      <div className="border-t border-gray-700 pt-4">
        <h3 className="font-medium mb-2">关于</h3>
        <p className="text-sm text-gray-400">
          moonPlayer - Web 音乐播放器<br/>
          支持多种播放模式、评分系统、播放列表管理、WebDAV<br/>
          <br/>
          技术栈: React + Fastify + SQLite
        </p>
      </div>
    </div>
  );
}