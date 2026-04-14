// moonPlayer 后端服务入口
import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import cookie from '@fastify/cookie';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureAppDir } from './utils/path.js';
import { filesRoutes } from './routes/files.js';
import { streamRoutes } from './routes/stream.js';
import { playlistRoutes } from './routes/playlists.js';
import { trackRoutes } from './routes/tracks.js';
import { historyRoutes } from './routes/history.js';
import { skipRoutes } from './routes/skip.js';
import { webdavRoutes } from './routes/webdav.js';
import { authRoutes, PUBLIC_PATHS } from './routes/auth.js';
import { settingsRoutes } from './routes/settings.js';
import { closeDatabase, needsAdminSetup, validateSession, cleanExpiredSessions } from './db/schema.js';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function start() {
  // 确保应用目录存在
  ensureAppDir();

  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport: process.env.NODE_ENV !== 'production' ? {
        target: 'pino-pretty',
        options: { colorize: true }
      } : undefined
    }
  });

  // CORS - 必须指定 origin 才能配合 credentials: 'include' 使用
  await app.register(cors, {
    origin: true,  // 允许所有来源
    credentials: true  // 允许发送 Cookie
  });

  // Cookie 支持
  await app.register(cookie);

  // 注册鉴权路由（不需要认证）
  await app.register(authRoutes);

  // 静态文件服务（生产环境）
  const webDistPath = path.resolve(__dirname, '../../web/dist');

  // 鉴权中间件
  app.addHook('onRequest', async (req, reply) => {
    // 公开路径不需要鉴权
    if (PUBLIC_PATHS.some(p => req.url.startsWith(p))) {
      return;
    }

    // 静态资源不需要鉴权
    if (req.url.startsWith('/assets/') || req.url.match(/\.(js|css|png|jpg|ico|woff|woff2)$/)) {
      return;
    }

    // 检查是否需要初始化
    if (needsAdminSetup()) {
      // 未初始化时，只允许访问设置页面
      if (!req.url.startsWith('/api/auth/')) {
        // 对于前端路由，返回初始化页面
        if (!req.url.startsWith('/api/')) {
          const indexPath = path.join(webDistPath, 'index.html');
          if (fs.existsSync(indexPath)) {
            return reply.sendFile('index.html');
          }
        }
        return reply.code(401).send({ error: 'NEED_SETUP', message: '请先初始化管理员账户' });
      }
      return;
    }

    // 检查登录状态
    const token = req.cookies?.moonplayer_session;
    if (!token) {
      // API 请求返回 401
      if (req.url.startsWith('/api/')) {
        return reply.code(401).send({ error: 'UNAUTHORIZED' });
      }
      // 前端路由返回 index.html（让前端处理）
      const indexPath = path.join(webDistPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        return reply.sendFile('index.html');
      }
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    // 验证会话
    if (!validateSession(token)) {
      reply.clearCookie('moonplayer_session', { path: '/' });
      if (req.url.startsWith('/api/')) {
        return reply.code(401).send({ error: 'UNAUTHORIZED' });
      }
      const indexPath = path.join(webDistPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        return reply.sendFile('index.html');
      }
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }
  });

  // 注册路由
  await app.register(filesRoutes);
  await app.register(streamRoutes);
  await app.register(playlistRoutes);
  await app.register(trackRoutes);
  await app.register(historyRoutes);
  await app.register(skipRoutes);
  await app.register(webdavRoutes);
  await app.register(settingsRoutes);

  try {
    await app.register(staticPlugin, {
      root: webDistPath,
      prefix: '/'
    });
    app.log.info(`静态文件服务已启用: ${webDistPath}`);
  } catch {
    app.log.info('前端构建目录不存在，跳过静态文件服务');
  }

  // 所有非 API 路由返回 index.html（SPA）
  app.setNotFoundHandler((req, reply) => {
    const indexPath = path.join(webDistPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found' });
  });

  // 健康检查
  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: Date.now() };
  });

  // 定期清理过期会话
  setInterval(() => {
    cleanExpiredSessions();
  }, 60 * 60 * 1000); // 每小时清理一次

  // 优雅关闭
  process.on('SIGINT', async () => {
    app.log.info('正在关闭服务器...');
    closeDatabase();
    await app.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    app.log.info('正在关闭服务器...');
    closeDatabase();
    await app.close();
    process.exit(0);
  });

  // 启动服务器
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';

  try {
    await app.listen({ port, host });
    app.log.info(`🚀 moonPlayer 服务已启动: http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();