// WebDAV 路由
import type { FastifyInstance } from 'fastify';
import { createClient } from 'webdav';
import type { WebDAVClient } from 'webdav';
import { getDatabase } from '../db/schema.js';

// WebDAV 客户端缓存
const webdavClients = new Map<string, WebDAVClient>();

function getWebdavClient(url: string, username?: string, password?: string): WebDAVClient {
  const key = `${url}|${username || ''}`;
  
  if (!webdavClients.has(key)) {
    const client = createClient(url, {
      username,
      password
    });
    webdavClients.set(key, client);
  }
  
  return webdavClients.get(key)!;
}

export async function webdavRoutes(app: FastifyInstance) {
  const db = getDatabase();

  // 获取所有 WebDAV 配置
  app.get('/api/webdav', async () => {
    const rows = db.prepare('SELECT id, name, url, username, base_path FROM webdav_configs').all() as any[];
    return { configs: rows };
  });

  // 添加 WebDAV 配置
  app.post('/api/webdav', async (req, reply) => {
    const { name, url, username, password, base_path } = req.body as {
      name: string;
      url: string;
      username?: string;
      password?: string;
      base_path?: string;
    };

    if (!name || !url) {
      return reply.code(400).send({ error: '名称和 URL 不能为空' });
    }

    // 测试连接
    try {
      const client = getWebdavClient(url, username, password);
      await client.getDirectoryContents(base_path || '/');
    } catch (err) {
      return reply.code(400).send({ error: 'WebDAV 连接失败，请检查配置' });
    }

    const result = db.prepare(
      'INSERT INTO webdav_configs (name, url, username, password, base_path, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, url, username || null, password || null, base_path || '/', Date.now());

    return {
      id: result.lastInsertRowid,
      name,
      url,
      username,
      base_path
    };
  });

  // 更新 WebDAV 配置
  app.put('/api/webdav/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { name, url, username, password, base_path } = req.body as {
      name?: string;
      url?: string;
      username?: string;
      password?: string;
      base_path?: string;
    };

    // 获取现有配置
    const existing = db.prepare('SELECT * FROM webdav_configs WHERE id = ?').get(Number(id)) as any;
    if (!existing) {
      return reply.code(404).send({ error: '配置不存在' });
    }

    const newName = name || existing.name;
    const newUrl = url || existing.url;
    const newUsername = username !== undefined ? username : existing.username;
    const newPassword = password !== undefined ? password : existing.password;
    const newBasePath = base_path || existing.base_path;

    // 测试连接
    try {
      const client = getWebdavClient(newUrl, newUsername || undefined, newPassword || undefined);
      await client.getDirectoryContents(newBasePath);
    } catch (err) {
      return reply.code(400).send({ error: 'WebDAV 连接失败' });
    }

    db.prepare(
      'UPDATE webdav_configs SET name = ?, url = ?, username = ?, password = ?, base_path = ?, updated_at = ? WHERE id = ?'
    ).run(newName, newUrl, newUsername, newPassword, newBasePath, Date.now(), Number(id));

    return { success: true };
  });

  // 删除 WebDAV 配置
  app.delete('/api/webdav/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    db.prepare('DELETE FROM webdav_configs WHERE id = ?').run(Number(id));
    return { success: true };
  });

  // 测试 WebDAV 连接
  app.post('/api/webdav/:id/test', async (req, reply) => {
    const { id } = req.params as { id: string };
    const config = db.prepare('SELECT * FROM webdav_configs WHERE id = ?').get(Number(id)) as any;
    
    if (!config) {
      return reply.code(404).send({ error: '配置不存在' });
    }

    try {
      const client = getWebdavClient(config.url, config.username || undefined, config.password || undefined);
      await client.getDirectoryContents(config.base_path || '/');
      return { success: true, message: '连接成功' };
    } catch (err) {
      return { success: false, message: `连接失败: ${(err as Error).message}` };
    }
  });

  // 浏览 WebDAV 目录
  app.get('/api/webdav/:id/browse', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { dir } = req.query as { dir?: string };
    
    const config = db.prepare('SELECT * FROM webdav_configs WHERE id = ?').get(Number(id)) as any;
    if (!config) {
      return reply.code(404).send({ error: '配置不存在' });
    }

    try {
      const client = getWebdavClient(config.url, config.username || undefined, config.password || undefined);
      const targetPath = dir || config.base_path || '/';
      const contents = await client.getDirectoryContents(targetPath);

      const directories = contents
        .filter((item: any) => item.type === 'directory')
        .map((item: any) => ({
          name: item.basename,
          path: item.filename,
          isDirectory: true
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));

      const files = contents
        .filter((item: any) => item.type === 'file')
        .filter((item: any) => /\.(mp3|flac|wav|ogg|m4a|aac|wma|ape)$/i.test(item.basename))
        .map((item: any) => ({
          name: item.basename,
          path: item.filename,
          isDirectory: false,
          size: item.size,
          lastModified: item.lastmod
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));

      return {
        currentPath: targetPath,
        parentPath: targetPath !== '/' ? targetPath.split('/').slice(0, -1).join('/') || '/' : null,
        directories,
        files,
        configId: Number(id)
      };
    } catch (err) {
      return reply.code(500).send({ error: `浏览失败: ${(err as Error).message}` });
    }
  });

  // 获取 WebDAV 文件流（代理下载）
  app.get('/api/webdav/:id/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { path: filePath } = req.query as { path?: string };

    if (!filePath) {
      return reply.code(400).send({ error: '缺少文件路径' });
    }

    const config = db.prepare('SELECT * FROM webdav_configs WHERE id = ?').get(Number(id)) as any;
    if (!config) {
      return reply.code(404).send({ error: '配置不存在' });
    }

    try {
      const client = getWebdavClient(config.url, config.username || undefined, config.password || undefined);
      
      // 获取文件内容流
      const stream = await client.createReadStream(filePath);
      
      // 设置 Content-Type
      const ext = filePath.split('.').pop()?.toLowerCase();
      const mimeTypes: Record<string, string> = {
        mp3: 'audio/mpeg',
        flac: 'audio/flac',
        wav: 'audio/wav',
        ogg: 'audio/ogg',
        m4a: 'audio/mp4',
        aac: 'audio/aac',
        wma: 'audio/x-ms-wma',
        ape: 'audio/x-ape'
      };
      
      reply.header('Content-Type', mimeTypes[ext || ''] || 'audio/mpeg');
      reply.header('Accept-Ranges', 'bytes');
      
      return reply.send(stream);
    } catch (err) {
      return reply.code(500).send({ error: `获取文件失败: ${(err as Error).message}` });
    }
  });
}