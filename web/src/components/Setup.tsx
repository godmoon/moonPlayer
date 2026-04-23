// 初始化设置组件
import { useState } from 'react';

interface SetupProps {
  onSuccess: () => void;
}

export function Setup({ onSuccess }: SetupProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim()) {
      setError('请输入用户名');
      return;
    }

    if (username.length < 2 || username.length > 32) {
      setError('用户名需要2-32个字符');
      return;
    }

    if (!password.trim()) {
      setError('请输入密码');
      return;
    }

    if (password.length < 6) {
      setError('密码至少需要6个字符');
      return;
    }

    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '初始化失败');
        return;
      }

      onSuccess();
    } catch (err) {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm p-6 bg-gray-900 rounded-lg shadow-lg">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-white">MoonPlayer</h1>
          <p className="text-sm text-gray-400 mt-1">首次使用，请设置管理员账户</p>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-purple-500 mb-3"
            placeholder="管理员用户名"
            disabled={loading}
            autoFocus
          />

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-purple-500 mb-3"
            placeholder="密码（至少6个字符）"
            disabled={loading}
          />

          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-purple-500"
            placeholder="确认密码"
            disabled={loading}
          />

          {error && (
            <p className="text-red-400 text-sm mt-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !username.trim() || !password.trim() || !confirmPassword.trim()}
            className="w-full mt-4 px-4 py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white font-medium transition"
          >
            {loading ? '设置中...' : '设置并登录'}
          </button>
        </form>

        <p className="text-xs text-gray-500 mt-4 text-center">
          此账户用于管理播放器，密码将加密存储
        </p>
      </div>
    </div>
  );
}