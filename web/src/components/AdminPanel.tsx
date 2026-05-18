import { useState, useEffect } from 'react';
import { getUsers, createUserByAdmin, deleteUserByAdmin, getCurrentUser } from '../stores/api';

interface UserInfo {
  id: number;
  username: string;
  role: 'admin' | 'user';
  created_at: number;
  updated_at: number;
}

export function AdminPanel() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', role: 'user' as 'admin' | 'user' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [currentUserId, setCurrentUserId] = useState<number>(0);

  useEffect(() => {
    loadUsers();
    getCurrentUser().then(u => setCurrentUserId(u.id)).catch(() => {});
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await getUsers();
      setUsers(data);
    } catch (err) {
      console.error('加载用户列表失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!form.username.trim()) {
      setError('请输入用户名');
      return;
    }
    if (form.username.length < 2 || form.username.length > 32) {
      setError('用户名需要2-32个字符');
      return;
    }
    if (!form.password) {
      setError('请输入密码');
      return;
    }
    if (form.password.length < 6) {
      setError('密码至少需要6个字符');
      return;
    }

    try {
      await createUserByAdmin(form.username, form.password, form.role);
      setSuccess(`用户 ${form.username} 创建成功`);
      setForm({ username: '', password: '', role: 'user' });
      setShowAddForm(false);
      loadUsers();
    } catch (err: any) {
      setError(err.response?.data?.error || '创建失败');
    }
  };

  const handleDelete = async (user: UserInfo) => {
    if (user.id === currentUserId) {
      setError('不能删除当前登录的账户');
      return;
    }
    if (!confirm(`确定要删除用户 "${user.username}" 吗？`)) return;

    try {
      await deleteUserByAdmin(user.id);
      loadUsers();
    } catch (err: any) {
      setError(err.response?.data?.error || '删除失败');
    }
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  return (
    <div className="h-full overflow-auto p-3 md:p-4">
      <h2 className="text-lg md:text-xl font-bold mb-4 md:mb-6">用户管理</h2>

      {error && (
        <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">
          {error}
          <button className="float-right text-red-400 hover:text-red-200" onClick={() => setError('')}>✕</button>
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-900/50 border border-green-700 rounded-lg text-green-300 text-sm">
          {success}
          <button className="float-right text-green-400 hover:text-green-200" onClick={() => setSuccess('')}>✕</button>
        </div>
      )}

      {/* 用户列表 */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm text-gray-400">全部用户 ({users.length})</label>
          <button
            onClick={() => { setShowAddForm(!showAddForm); setError(''); setSuccess(''); }}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm"
          >
            {showAddForm ? '取消' : '+ 添加用户'}
          </button>
        </div>

        {loading ? (
          <div className="text-gray-500 text-sm">加载中...</div>
        ) : users.length === 0 ? (
          <div className="text-gray-500 text-sm">暂无用户</div>
        ) : (
          <div className="space-y-2">
            {users.map((user) => (
              <div key={user.id} className="flex items-center gap-3 p-3 bg-gray-800 rounded-lg">
                <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center text-sm shrink-0">
                  {user.role === 'admin' ? '👑' : '👤'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{user.username}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ${
                      user.role === 'admin' ? 'bg-purple-600/30 text-purple-300' : 'bg-blue-600/30 text-blue-300'
                    }`}>
                      {user.role === 'admin' ? '管理员' : '普通用户'}
                    </span>
                    {user.id === currentUserId && (
                      <span className="text-xs text-gray-500 shrink-0">(当前)</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    创建于 {formatDate(user.created_at)}
                  </div>
                </div>
                {user.id !== currentUserId && (
                  <button
                    onClick={() => handleDelete(user)}
                    className="text-red-500 hover:text-red-400 text-sm px-2 shrink-0"
                    title="删除用户"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 添加用户表单 */}
      {showAddForm && (
        <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
          <h3 className="text-sm font-medium mb-3">添加用户</h3>
          <form onSubmit={handleCreate} className="space-y-3">
            <input
              type="text"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 rounded-lg text-sm"
              placeholder="用户名（2-32个字符）"
            />
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 rounded-lg text-sm"
              placeholder="密码（至少6个字符）"
            />
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'user' })}
              className="w-full px-3 py-2 bg-gray-700 rounded-lg text-sm text-white border border-gray-600 focus:border-purple-500 focus:outline-none"
            >
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
            <button
              type="submit"
              className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm"
            >
              创建
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
