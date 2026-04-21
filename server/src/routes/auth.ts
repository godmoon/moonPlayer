// 鉴权路由
import type { FastifyPluginCallback } from 'fastify';
import {
  getDatabase,
  saveDatabase,
  normalizePath,
  needsAdminSetup,
  setupAdmin,
  verifyAdminPassword,
  verifyAdminCredentials,
  changeAdminPassword,
  clearAdminPassword,
  createSession,
  validateSession,
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
    const token = createSession();

    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: false,  // 开发环境不支持 HTTPS，所以禁用 Secure
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
    const result = verifyAdminCredentials(username, password);
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
    const token = createSession();

    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: false,  // 开发环境不支持 HTTPS
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

    const valid = validateSession(token);
    return { authenticated: valid };
  });

  // 修改密码（需要已登录）
  fastify.post<{ Body: ChangePasswordRequest }>('/api/auth/change-password', async (req, reply) => {
    const token = req.cookies[COOKIE_NAME];

    if (!token || !validateSession(token)) {
      return reply.code(401).send({ error: '未登录' });
    }

    const { oldPassword, newPassword, confirmPassword } = req.body;

    if (!oldPassword || !newPassword || !confirmPassword) {
      return reply.code(400).send({ error: '所有字段都不能为空' });
    }

    if (newPassword !== confirmPassword) {
      return reply.code(400).send({ error: '新密码两次输入不一致' });
    }

    const result = changeAdminPassword(oldPassword, newPassword);

    if (!result.success) {
      return reply.code(400).send({ error: result.error });
    }

    return { success: true };
  });

  // 获取当前用户信息
  fastify.get('/api/auth/me', async (req, reply) => {
    const token = req.cookies[COOKIE_NAME];

    if (!token || !validateSession(token)) {
      return reply.code(401).send({ error: '未登录' });
    }

    const admin = getDatabase().prepare('SELECT username FROM admin WHERE id = 1').get() as { username: string } | undefined;

    if (!admin) {
      return reply.code(401).send({ error: '未登录' });
    }

    return { username: admin.username };
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

  if (!validateSession(token)) {
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