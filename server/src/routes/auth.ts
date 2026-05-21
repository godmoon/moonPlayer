// 鉴权路由
import type { FastifyPluginCallback } from 'fastify';
import {
  getDatabase,
  saveDatabase,
  normalizePath,
  needsAdminSetup,
  setupAdmin,
  createUser,
  listUsers,
  deleteUser,
  verifyUserCredentials,
  changeUserPassword,
  createSession,
  validateSession,
  getUserBySession,
  recordLoginAttempt,
  getLoginWaitTime
} from '../db/schema.js';

const COOKIE_NAME = 'moonplayer_session';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1年（秒）

interface SetupRequest {
  username: string;
  password: string;
}

interface LoginRequest {
  username: string;
  password: string;
}

interface ChangePasswordRequest {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

// 获取客户端 IP
function getClientIp(req: any): string {
  return req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
}

export const authRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  // 检查是否需要初始化管理员
  fastify.get('/api/auth/status', async (req, reply) => {
    const needSetup = needsAdminSetup();
    return { needSetup, hasAdmin: !needSetup };
  });

  // 初始化管理员
  fastify.post<{ Body: SetupRequest }>('/api/auth/setup', async (req, reply) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return reply.code(400).send({ error: '用户名和密码不能为空' });
    }

    if (username.length < 2 || username.length > 32) {
      return reply.code(400).send({ error: '用户名需要2-32个字符' });
    }

    const result = setupAdmin(username, password);

    if (!result.success) {
      return reply.code(400).send({ error: result.error });
    }

    // 自动登录
    const user = getDatabase().prepare("SELECT id FROM users WHERE role = 'admin'").get() as { id: number } | undefined;
    const userId = user?.id || 1;
    const token = createSession(userId);

    const isSecure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/'
    });

    return { success: true, username };
  });

  // 登录
  fastify.post<{ Body: LoginRequest }>('/api/auth/login', async (req, reply) => {
    const { username, password } = req.body;
    const ip = getClientIp(req);

    if (!username || !password) {
      return reply.code(400).send({ error: '用户名和密码不能为空' });
    }

    // 检查是否需要等待
    const waitTime = getLoginWaitTime(ip);
    if (waitTime > 0) {
      recordLoginAttempt(ip, false);
      return reply.code(429).send({
        error: `登录失败次数过多，请等待 ${waitTime} 秒后重试`,
        waitTime
      });
    }

    // 验证用户名和密码
    const result = verifyUserCredentials(username, password);
    if (!result.success) {
      recordLoginAttempt(ip, false);
      const nextWaitTime = getLoginWaitTime(ip);
      return reply.code(401).send({
        error: result.error || '用户名或密码错误',
        waitTime: nextWaitTime
      });
    }

    // 登录成功
    recordLoginAttempt(ip, true);
    const token = createSession(result.userId!);

    const isSecure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/'
    });

    return { success: true };
  });

  // 登出
  fastify.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE_NAME];
    if (token) {
      // 删除会话
      getDatabase().prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }

    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { success: true };
  });

  // 检查登录状态
  fastify.get('/api/auth/check', async (req, reply) => {
    const token = req.cookies[COOKIE_NAME];

    if (!token) {
      return { authenticated: false };
    }

    const userId = validateSession(token);
    return { authenticated: userId !== null };
  });

  // 修改密码（需要已登录）
  fastify.post<{ Body: ChangePasswordRequest }>('/api/auth/change-password', async (req, reply) => {
    const token = req.cookies?.[COOKIE_NAME];

    if (!token) {
      return reply.code(401).send({ error: '未登录' });
    }

    const userId = validateSession(token);
    if (!userId) {
      return reply.code(401).send({ error: '未登录' });
    }

    const { oldPassword, newPassword, confirmPassword } = req.body;

    if (!oldPassword || !newPassword || !confirmPassword) {
      return reply.code(400).send({ error: '所有字段都不能为空' });
    }

    if (newPassword !== confirmPassword) {
      return reply.code(400).send({ error: '新密码两次输入不一致' });
    }

    const result = changeUserPassword(userId, oldPassword, newPassword);

    if (!result.success) {
      return reply.code(400).send({ error: result.error });
    }

    return { success: true };
  });

  // 获取当前用户信息
  fastify.get('/api/auth/me', async (req, reply) => {
    const token = req.cookies[COOKIE_NAME];

    if (!token) {
      return reply.code(401).send({ error: '未登录' });
    }

    const user = getUserBySession(token);
    if (!user) {
      return reply.code(401).send({ error: '未登录' });
    }

    return { username: user.username, role: user.role, id: user.id };
  });

  // ========== 管理员：用户管理 ==========

  // 获取所有用户（仅管理员）
  fastify.get('/api/admin/users', async (req, reply) => {
    const token = req.cookies[COOKIE_NAME];
    const currentUser = getUserBySession(token || '');
    if (!currentUser || currentUser.role !== 'admin') {
      return reply.code(403).send({ error: '仅管理员可执行此操作' });
    }

    const users = listUsers();
    return { users };
  });

  // 创建用户（仅管理员）
  fastify.post('/api/admin/users', async (req: any, reply) => {
    const token = req.cookies[COOKIE_NAME];
    const currentUser = getUserBySession(token || '');
    if (!currentUser || currentUser.role !== 'admin') {
      return reply.code(403).send({ error: '仅管理员可执行此操作' });
    }

    const { username, password, role } = req.body;

    if (!username || !password) {
      return reply.code(400).send({ error: '用户名和密码不能为空' });
    }
    if (role && !['admin', 'user'].includes(role)) {
      return reply.code(400).send({ error: '角色无效' });
    }

    const result = createUser(username, password, role || 'user');
    if (!result.success) {
      return reply.code(400).send({ error: result.error });
    }

    return { success: true };
  });

  // 删除用户（仅管理员）
  fastify.delete('/api/admin/users/:id', async (req: any, reply) => {
    const token = req.cookies[COOKIE_NAME];
    const currentUser = getUserBySession(token || '');
    if (!currentUser || currentUser.role !== 'admin') {
      return reply.code(403).send({ error: '仅管理员可执行此操作' });
    }

    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return reply.code(400).send({ error: '无效的用户 ID' });
    }

    // 不能删除自己
    if (id === currentUser.id) {
      return reply.code(400).send({ error: '不能删除当前登录的账户' });
    }

    const result = deleteUser(id);
    if (!result.success) {
      return reply.code(400).send({ error: result.error });
    }

    return { success: true };
  });

  done();
};

// 鉴权中间件
export function requireAuth(req: any, reply: any, done: (err?: Error) => void) {
  const token = req.cookies?.[COOKIE_NAME];

  if (!token) {
    done(new Error('UNAUTHORIZED'));
    return;
  }

  const userId = validateSession(token);
  if (!userId) {
    done(new Error('UNAUTHORIZED'));
    return;
  }

  done();
}

// 公开路径（不需要鉴权）
export const PUBLIC_PATHS = [
  '/api/auth/status',
  '/api/auth/setup',
  '/api/auth/login',
  '/api/health'
];