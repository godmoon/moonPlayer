// moonPlayer 后端服务入口
import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
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
import { closeDatabase } from './db/schema.js';
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
    // CORS
    await app.register(cors, {
        origin: true // 开发环境允许所有来源
    });
    // 注册路由
    await app.register(filesRoutes);
    await app.register(streamRoutes);
    await app.register(playlistRoutes);
    await app.register(trackRoutes);
    await app.register(historyRoutes);
    await app.register(skipRoutes);
    await app.register(webdavRoutes);
    // 静态文件服务（生产环境）
    const webDistPath = path.resolve(__dirname, '../../web/dist');
    try {
        await app.register(staticPlugin, {
            root: webDistPath,
            prefix: '/'
        });
        app.log.info(`静态文件服务已启用: ${webDistPath}`);
    }
    catch {
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
    }
    catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}
start();
//# sourceMappingURL=index.js.map