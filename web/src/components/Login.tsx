// 登录组件
import { useState, useEffect } from 'react';

interface LoginProps {
  onSuccess: () => void;
}

export function Login({ onSuccess }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [waitTime, setWaitTime] = useState(0);

  useEffect(() => {
    if (waitTime <= 0) return;
    const timer = setInterval(() => {
      setWaitTime(t => Math.max(0, t - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [waitTime]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('请输入用户名');
      return;
    }
    if (!password.trim()) {
      setError('请输入密码');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        credentials: 'include'  // 发送和接收 Cookie
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '登录失败');
        if (data.waitTime) {
          setWaitTime(data.waitTime);
        }
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
          <p className="text-sm text-gray-400 mt-1">请登录</p>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-purple-500 mb-3"
            placeholder="用户名"
            disabled={loading || waitTime > 0}
            autoFocus
          />

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-purple-500"
            placeholder="密码"
            disabled={loading || waitTime > 0}
          />

          {error && (
            <p className="text-red-400 text-sm mt-2">{error}</p>
          )}

          {waitTime > 0 && (
            <p className="text-yellow-400 text-sm mt-2">
              请等待 {waitTime} 秒后重试
            </p>
          )}

          <button
            type="submit"
            disabled={loading || waitTime > 0 || !username.trim() || !password.trim()}
            className="w-full mt-4 px-4 py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white font-medium transition"
          >
            {loading ? '登录中...' : waitTime > 0 ? `等待 ${waitTime}秒` : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}