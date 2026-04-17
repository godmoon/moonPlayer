// 设置路由
import type { FastifyPluginCallback } from 'fastify';
import { getDatabase } from '../db/schema.js';
import { updateTranscodeFormats } from '../utils/webdavCache.js';

// 默认导航项顺序
const DEFAULT_NAV_ORDER = ['browse', 'playlists', 'current', 'search', 'history', 'ratings', 'settings'];

export const settingsRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  // 获取导航顺序
  fastify.get('/api/settings/nav-order', async () => {
    const db = getDatabase();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'nav_order'").get() as { value: string } | undefined;
    
    if (row) {
      const order = row.value.split(',').filter(item => DEFAULT_NAV_ORDER.includes(item));
      // 确保所有导航项都在列表中
      const missingItems = DEFAULT_NAV_ORDER.filter(item => !order.includes(item));
      return { order: [...order, ...missingItems] };
    }
    
    return { order: DEFAULT_NAV_ORDER };
  });

  // 设置导航顺序
  fastify.put<{ Body: { order: string[] } }>('/api/settings/nav-order', async (req, reply) => {
    const { order } = req.body;
    
    // 验证
    if (!Array.isArray(order)) {
      return reply.code(400).send({ error: 'order 必须是数组' });
    }
    
    // 过滤并确保所有项目都是有效的导航项
    const validOrder = order.filter(item => DEFAULT_NAV_ORDER.includes(item));
    
    // 确保所有导航项都在列表中
    const missingItems = DEFAULT_NAV_ORDER.filter(item => !validOrder.includes(item));
    const finalOrder = [...validOrder, ...missingItems];
    
    const db = getDatabase();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('nav_order', ?)").run(finalOrder.join(','));
    
    return { success: true, order: finalOrder };
  });

  // 接收前端浏览器格式支持检测结果
  fastify.post<{ Body: {
    flac?: boolean;
    wav?: boolean;
    aac?: boolean;
    m4a?: boolean;
    ogg?: boolean;
    mp3?: boolean;
    wma?: boolean;
    ape?: boolean;
  } }>('/api/settings/format-support', async (req, reply) => {
    const support = req.body;
    
    // 更新转码格式列表
    updateTranscodeFormats(support);
    
    return { success: true };
  });

  done();
};