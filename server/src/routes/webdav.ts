// WebDAV 路由
import type { FastifyInstance } from 'fastify';
import { createClient } from 'webdav';
import type { WebDAVClient } from 'webdav';
import { getDatabase, saveDatabase, normalizePath } from '../db/schema.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// WebDAV 文件缓存目录
const WEBDAV_CACHE_DIR = path.join(os.homedir(), '.moonplayer', 'webdav_cache');

// 确保缓存目录存在
function ensureCacheDir() {
  if (!fs.existsSync(WEBDAV_CACHE_DIR)) {
    fs.mkdirSync(WEBDAV_CACHE_DIR, { recursive: true });
  }
}

// 获取缓存文件路径
function getCachePath(configId: number, filePath: string): string {
  const hash = crypto.createHash('md5').update(`${configId}:${filePath}`).digest('hex');
  const ext = path.extname(filePath);
  return path.join(WEBDAV_CACHE_DIR, `${hash}${ext}`);
}

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

  // 获取 WebDAV 文件流（代理下载，支持 Range 请求）
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
      
      // 确保缓存目录存在
      ensureCacheDir();
      const cachePath = getCachePath(Number(id), filePath);
      
      // 获取远程文件信息
      const stat = await client.stat(filePath) as any;
      const remoteSize = stat?.size || 0;
      const remoteLastMod = stat?.lastmod ? new Date(stat.lastmod).getTime() : Date.now();
      
      // 检查缓存是否存在且有效
      let useCache = false;
      if (fs.existsSync(cachePath)) {
        try {
          const cacheStat = fs.statSync(cachePath);
          // 缓存大小匹配且比远程文件旧（远程已更新）或大小匹配
          if (cacheStat.size === remoteSize) {
            useCache = true;
          }
        } catch {}
      }
      
      // 如果没有有效缓存，下载文件
      if (!useCache) {
        const arrayBuffer = await client.getFileContents(filePath) as ArrayBuffer;
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(cachePath, buffer);
      }
      
      // 现在从缓存文件流式传输（支持完整 Range）
      const fileStat = fs.statSync(cachePath);
      const fileSize = fileStat.size;
      
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
      
      // 处理 Range 请求
      const range = req.headers.range;
      
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        reply.code(206);
        reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        reply.header('Content-Length', chunkSize);

        const stream = fs.createReadStream(cachePath, { start, end });
        return reply.send(stream);
      }
      
      // 非 Range 请求，发送整个文件
      reply.header('Content-Length', fileSize);
      return reply.send(fs.createReadStream(cachePath));
    } catch (err) {
      return reply.code(500).send({ error: `获取文件失败: ${(err as Error).message}` });
    }
  });

  // 扫描 WebDAV 目录并创建播放列表
  app.post('/api/webdav/:id/scan', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { dir, playlistId, playlistName, includeSubdirs } = req.body as {
      dir?: string;
      playlistId?: number;
      playlistName?: string;
      includeSubdirs?: boolean;
    };

    const config = db.prepare('SELECT * FROM webdav_configs WHERE id = ?').get(Number(id)) as any;
    if (!config) {
      return reply.code(404).send({ error: '配置不存在' });
    }

    try {
      const client = getWebdavClient(config.url, config.username || undefined, config.password || undefined);
      const targetPath = dir || config.base_path || '/';
      
      // 递归扫描获取所有音乐文件
      const musicFiles: { path: string; name: string; size: number }[] = [];
      
      async function scanDirectory(path: string, recursive: boolean) {
        const contents = await client.getDirectoryContents(path);
        
        for (const item of contents as any[]) {
          if (item.type === 'directory' && recursive) {
            await scanDirectory(item.filename, true);
          } else if (item.type === 'file' && /\.(mp3|flac|wav|ogg|m4a|aac|wma|ape)$/i.test(item.basename)) {
            musicFiles.push({
              path: item.filename,
              name: item.basename,
              size: item.size
            });
          }
        }
      }
      
      await scanDirectory(targetPath, includeSubdirs || false);
      
      if (musicFiles.length === 0) {
        return reply.code(400).send({ error: '目录中没有找到音乐文件' });
      }

      // 将 WebDAV 文件作为音轨存入数据库
      const webdavPathPrefix = `webdav://${id}`;
      const trackIds: number[] = [];
      
      for (const file of musicFiles) {
        const trackPath = `${webdavPathPrefix}${file.path}`;
        const title = file.name.replace(/\.[^.]+$/, '');
        
        // 检查是否已存在
        let track = db.prepare('SELECT id FROM tracks WHERE path = ?').get(trackPath) as any;
        
        if (!track) {
          // 插入新音轨
          const result = db.prepare(`
            INSERT INTO tracks (path, title, artist, album, duration, rating, play_count, skip_count, date_added)
            VALUES (?, ?, null, null, null, 0, 0, 0, ?)
          `).run(trackPath, title, Date.now());
          trackIds.push(Number(result.lastInsertRowid));
        } else {
          trackIds.push(track.id);
        }
      }

      // 创建或使用现有播放列表
      let playlistIdToUse = playlistId;
      if (!playlistIdToUse && playlistName) {
        const result = db.prepare(`
          INSERT INTO playlists (name, created_at, updated_at, is_auto, play_mode)
          VALUES (?, ?, ?, 1, 'sequential')
        `).run(playlistName, Date.now(), Date.now());
        playlistIdToUse = Number(result.lastInsertRowid);
        
        // 添加播放列表项（目录来源）
        db.prepare(`
          INSERT INTO playlist_items (playlist_id, type, path, include_subdirs, "order")
          VALUES (?, 'directory', ?, ?, 0)
        `).run(playlistIdToUse, `webdav://${id}${targetPath}`, includeSubdirs ? 1 : 0);
      }

      if (!playlistIdToUse) {
        return reply.code(400).send({ error: '需要指定播放列表' });
      }

      // 清空现有音轨
      db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlistIdToUse);
      
      // 添加音轨到播放列表
      const insertStmt = db.prepare(`
        INSERT INTO playlist_tracks (playlist_id, track_id, "order")
        VALUES (?, ?, ?)
      `);
      
      for (let i = 0; i < trackIds.length; i++) {
        insertStmt.run(playlistIdToUse, trackIds[i], i);
      }
      
      // 更新播放列表时间
      db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), playlistIdToUse);

      // 返回播放列表信息
      const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(playlistIdToUse) as any;
      const tracks = db.prepare(`
        SELECT t.*, pt."order" 
        FROM playlist_tracks pt
        JOIN tracks t ON pt.track_id = t.id
        WHERE pt.playlist_id = ?
        ORDER BY pt."order"
      `).all(playlistIdToUse);

      return {
        playlist: {
          id: playlist.id,
          name: playlist.name,
          created_at: playlist.created_at,
          updated_at: playlist.updated_at,
          is_auto: playlist.is_auto,
          play_mode: playlist.play_mode
        },
        tracks,
        scanned: musicFiles.length
      };
    } catch (err) {
      return reply.code(500).send({ error: `扫描失败: ${(err as Error).message}` });
    }
  });
}