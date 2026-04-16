// 音轨路由
import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../db/schema.js';
import { parseFile } from 'music-metadata';
import { createClient } from 'webdav';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function trackRoutes(app: FastifyInstance) {
  const db = getDatabase();

  // 扫描文件并添加到数据库
  app.post('/api/tracks/scan', async (req, reply) => {
    const { paths } = req.body as { paths: string[] };

    if (!paths || paths.length === 0) {
      return reply.code(400).send({ error: '缺少文件路径' });
    }

    const insertedIds: number[] = [];
    const existingIds: number[] = [];
    const errors: string[] = [];

    for (const filePath of paths) {
      try {
        // 检查是否已存在
        const existing = db.prepare('SELECT id FROM tracks WHERE path = ?').get(filePath);
        if (existing) {
          existingIds.push((existing as any).id);
          continue;
        }

        // 获取文件信息
        const stat = fs.statSync(filePath);
        const filename = path.basename(filePath);

        // 尝试解析元数据
        let title = path.basename(filename, path.extname(filename));
        let artist: string | undefined;
        let album: string | undefined;
        let duration: number | undefined;

        try {
          const metadata = await parseFile(filePath);
          if (metadata.common.title) title = metadata.common.title;
          if (metadata.common.artist) artist = metadata.common.artist;
          if (metadata.common.album) album = metadata.common.album;
          if (metadata.format.duration) duration = metadata.format.duration;
        } catch {
          // 无法解析元数据，使用文件名
        }

        // 插入数据库
        const result = db.prepare(`
          INSERT INTO tracks (path, title, artist, album, duration, rating, play_count, skip_count, date_added)
          VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?)
        `).run(filePath, title, artist || null, album || null, duration || null, Date.now());

        insertedIds.push(Number(result.lastInsertRowid));
      } catch (err) {
        errors.push(`${filePath}: ${err}`);
      }
    }

    return {
      inserted: insertedIds.length,
      existing: existingIds.length,
      insertedIds,
      existingIds,
      errors: errors.length > 0 ? errors : undefined
    };
  });

  // 获取音轨信息
  app.get('/api/tracks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };

    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(Number(id));
    if (!track) {
      return reply.code(404).send({ error: '音轨不存在' });
    }

    return track;
  });

  // 更新评分
  app.put('/api/tracks/:id/rating', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { delta } = req.body as { delta: number };

    db.prepare('UPDATE tracks SET rating = rating + ? WHERE id = ?').run(delta, Number(id));

    const track = db.prepare('SELECT rating FROM tracks WHERE id = ?').get(Number(id));
    return { rating: (track as any).rating };
  });

  // 记录播放
  app.post('/api/tracks/:id/play', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { completed, position } = req.body as { completed: boolean; position?: number };

    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(Number(id));
    if (!track) {
      return reply.code(404).send({ error: '音轨不存在' });
    }

    const duration = (track as any).duration || 0;
    const rating = (track as any).rating;
    const playCount = (track as any).play_count;
    const skipCount = (track as any).skip_count;

    // 自动评分逻辑
    let ratingDelta = 0;

    if (completed) {
      // 完整听完：+1 分
      ratingDelta = 1;
      db.prepare('UPDATE tracks SET play_count = play_count + 1, skip_count = 0, rating = rating + ?, last_played = ? WHERE id = ?').run(ratingDelta, Date.now(), Number(id));
    } else {
      // 检查播放进度
      const progress = duration > 0 ? (position || 0) / duration : 0;

      if (progress < 0.01) {
        // < 1% 就切歌：可能是快切
        db.prepare('UPDATE tracks SET skip_count = skip_count + 1, last_played = ? WHERE id = ?').run(Date.now(), Number(id));

        // 如果连续 3 次以上快切，这次听完，额外加分在 play 完成时处理
      } else if (progress < 0.1) {
        // 3%-10% 切歌：扣分
        ratingDelta = -1;
        db.prepare('UPDATE tracks SET rating = rating + ?, last_played = ? WHERE id = ?').run(ratingDelta, Date.now(), Number(id));
      } else {
        // 其他情况，记录播放
        db.prepare('UPDATE tracks SET last_played = ? WHERE id = ?').run(Date.now(), Number(id));
      }
    }

    // 更新播放列表历史
    const { playlistId } = req.body as { playlistId?: number };
    if (playlistId) {
      db.prepare('INSERT INTO play_history (playlist_id, track_id, position, timestamp) VALUES (?, ?, ?, ?)').run(playlistId, Number(id), position || 0, Date.now());
    }

    return { success: true, ratingDelta };
  });

  // 搜索音轨
  app.get('/api/tracks/search', async (req, reply) => {
    const { q } = req.query as { q?: string };

    if (!q) {
      return { tracks: [] };
    }

    const tracks = db.prepare(`
      SELECT * FROM tracks
      WHERE title LIKE ? OR artist LIKE ? OR album LIKE ?
      ORDER BY title
      LIMIT 100
    `).all(`%${q}%`, `%${q}%`, `%${q}%`);

    return { tracks };
  });

  // 获取高分音轨（用于权重随机）
  app.get('/api/tracks/top-rated', async (req, reply) => {
    const { limit = 100 } = req.query as { limit?: number };

    const tracks = db.prepare(`
      SELECT * FROM tracks
      WHERE rating > 0
      ORDER BY rating DESC
      LIMIT ?
    `).all(Number(limit));

    return { tracks };
  });

  // 批量评分
  app.post('/api/tracks/batch-rating', async (req, reply) => {
    const { trackIds, rating } = req.body as { trackIds: number[]; rating: number };

    if (!trackIds || trackIds.length === 0) {
      return reply.code(400).send({ error: '缺少音轨 ID 列表' });
    }

    const updateStmt = db.prepare('UPDATE tracks SET rating = ? WHERE id = ?');
    for (const id of trackIds) {
      updateStmt.run(rating, id);
    }

    return { success: true, updated: trackIds.length };
  });

  // 重置所有评分
  app.post('/api/tracks/reset-rating', async (req, reply) => {
    db.prepare('UPDATE tracks SET rating = 0').run();
    return { success: true };
  });

  // 按 TAG 筛选音轨
  app.get('/api/tracks/filter', async (req, reply) => {
    const { artist, album, title, minRating, maxRating } = req.query as {
      artist?: string;
      album?: string;
      title?: string;
      minRating?: string;
      maxRating?: string;
    };

    let sql = 'SELECT * FROM tracks WHERE 1=1';
    const params: any[] = [];

    if (artist) {
      sql += ' AND artist LIKE ?';
      params.push(`%${artist}%`);
    }
    if (album) {
      sql += ' AND album LIKE ?';
      params.push(`%${album}%`);
    }
    if (title) {
      sql += ' AND title LIKE ?';
      params.push(`%${title}%`);
    }
    if (minRating !== undefined) {
      sql += ' AND rating >= ?';
      params.push(Number(minRating));
    }
    if (maxRating !== undefined) {
      sql += ' AND rating <= ?';
      params.push(Number(maxRating));
    }

    sql += ' ORDER BY title LIMIT 500';

    const tracks = db.prepare(sql).all(...params);
    return { tracks };
  });

  // 删除音轨（从数据库）
  app.delete('/api/tracks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };

    db.prepare('DELETE FROM tracks WHERE id = ?').run(Number(id));
    db.prepare('DELETE FROM play_history WHERE track_id = ?').run(Number(id));
    db.prepare('DELETE FROM skip_history WHERE track_id = ?').run(Number(id));

    return { success: true };
  });

  // 获取低分音轨列表（用于清理）
  app.get('/api/tracks/low-rated', async (req, reply) => {
    const { threshold = -5, limit = 100 } = req.query as { threshold?: string; limit?: string };

    const tracks = db.prepare(`
      SELECT * FROM tracks
      WHERE rating <= ?
      ORDER BY rating ASC
      LIMIT ?
    `).all(Number(threshold), Number(limit));

    return { tracks };
  });

  // =====================
  // 元数据缓存相关 API
  // =====================

  // 获取所有歌曲数据（用于导出给AI）
  app.get('/api/tracks/cache', async (req, reply) => {
    const tracks = db.prepare(`
      SELECT 
        id,
        path,
        title,
        artist,
        album,
        year,
        tags,
        rating,
        play_count
      FROM tracks
      ORDER BY title
    `).all() as any[];

    // 解析 tags
    const result = tracks.map((t: any) => ({
      ...t,
      tags: t.tags ? (typeof t.tags === 'string' ? JSON.parse(t.tags) : t.tags) : []
    }));

    return { tracks: result };
  });

  // 刷新元数据（扫描所有音乐路径）
  app.post('/api/tracks/cache/refresh', async (req, reply) => {
    // 获取音乐路径配置
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'music_paths'").get() as { value: string } | undefined;
    if (!setting) {
      return reply.code(400).send({ error: '未配置音乐路径' });
    }

    const musicPaths = setting.value.split(',').map(p => p.trim()).filter(Boolean);
    
    const stats = {
      scanned: 0,
      inserted: 0,
      updated: 0,
      errors: [] as string[]
    };

    // 支持的音频格式
    const audioExts = ['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav', '.wma', '.ape', '.alac'];

    // 递归扫描函数
    const scanDir = async (dirPath: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch (err) {
        stats.errors.push(`无法读取目录 ${dirPath}: ${err}`);
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!audioExts.includes(ext)) continue;

          stats.scanned++;

          try {
            // 解析元数据
            const metadata = await parseFile(fullPath, { duration: false });
            const fileName = path.basename(fullPath, ext);

            const title = metadata.common.title || fileName;
            const artist = metadata.common.artist || undefined;
            const album = metadata.common.album || undefined;
            const year = metadata.common.year || undefined;

            // 检查是否已存在
            const existing = db.prepare('SELECT id FROM tracks WHERE path = ?').get(fullPath);

            if (existing) {
              // 更新元数据，保留 rating/play_count/tags
              db.prepare(`
                UPDATE tracks 
                SET title = ?, artist = ?, album = ?, year = ?
                WHERE path = ?
              `).run(title, artist || null, album || null, year || null, fullPath);
              stats.updated++;
            } else {
              // 插入新记录
              db.prepare(`
                INSERT INTO tracks 
                (path, title, artist, album, year, tags, duration, rating, play_count, skip_count, date_added)
                VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, 0, 0, ?)
              `).run(
                fullPath, title, artist || null, album || null, year || null, Date.now()
              );
              stats.inserted++;
            }
          } catch (err) {
            stats.errors.push(`${fullPath}: ${err}`);
          }
        }
      }
    };

    // 扫描所有音乐路径
    for (const musicPath of musicPaths) {
      if (fs.existsSync(musicPath)) {
        await scanDir(musicPath);
      } else {
        stats.errors.push(`路径不存在: ${musicPath}`);
      }
    }

    // 扫描 WebDAV 配置
    const webdavConfigs = db.prepare('SELECT * FROM webdav_configs').all() as any[];
    for (const config of webdavConfigs) {
      try {
        const client = createClient(config.url, {
          username: config.username || undefined,
          password: config.password || undefined
        });

        // 递归扫描 WebDAV 目录
        const scanWebdavDir = async (dir: string) => {
          try {
            const contents = await client.getDirectoryContents(dir);
            for (const entry of contents as any[]) {
              if (entry.type === 'directory') {
                await scanWebdavDir(entry.filename);
              } else if (entry.type === 'file') {
                const ext = path.extname(entry.basename).toLowerCase();
                if (!audioExts.includes(ext)) continue;

                stats.scanned++;
                const webdavPath = `webdav://${config.id}${entry.filename}`;
                const fileName = path.basename(entry.basename, ext);

                // 检查是否已存在
                const existing = db.prepare('SELECT id FROM tracks WHERE path = ?').get(webdavPath);

                if (existing) {
                  db.prepare(`
                    UPDATE tracks 
                    SET title = ?
                    WHERE path = ?
                  `).run(fileName, webdavPath);
                  stats.updated++;
                } else {
                  db.prepare(`
                    INSERT INTO tracks 
                    (path, title, artist, album, year, tags, duration, rating, play_count, skip_count, date_added)
                    VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, ?)
                  `).run(webdavPath, fileName, Date.now());
                  stats.inserted++;
                }
              }
            }
          } catch (err) {
            stats.errors.push(`WebDAV 目录 ${dir}: ${err}`);
          }
        };

        await scanWebdavDir(config.base_path || '/');
      } catch (err) {
        stats.errors.push(`WebDAV 配置 ${config.name}: ${err}`);
      }
    }

    return {
      success: true,
      ...stats
    };
  });

  // =====================
  // 标签相关 API
  // =====================

  // 获取未标注标签的歌曲数量
  app.get('/api/tracks/untagged-count', async (req, reply) => {
    const result = db.prepare(`
      SELECT COUNT(*) as count FROM tracks 
      WHERE tags IS NULL OR tags = '' OR tags = '[]'
    `).get() as { count: number };
    return { count: result.count };
  });

  // 获取未标注标签的歌曲列表（分批，每批 limit 个）
  app.get('/api/tracks/untagged', async (req, reply) => {
    const { limit = 500, offset = 0 } = req.query as { limit?: string; offset?: string };
    
    const tracks = db.prepare(`
      SELECT 
        id,
        path,
        title,
        artist,
        album,
        year
      FROM tracks 
      WHERE tags IS NULL OR tags = '' OR tags = '[]'
      ORDER BY title
      LIMIT ? OFFSET ?
    `).all(Number(limit), Number(offset)) as any[];

    return { tracks };
  });

  // 导入标签数据
  app.post('/api/tracks/tags/import', async (req, reply) => {
    const { tags } = req.body as { tags: Array<{ id: number; tags: string[] }> };

    if (!tags || !Array.isArray(tags)) {
      return reply.code(400).send({ error: '缺少标签数据' });
    }

    const updateStmt = db.prepare('UPDATE tracks SET tags = ? WHERE id = ?');
    let updated = 0;

    for (const item of tags) {
      const tagsJson = JSON.stringify(item.tags);
      const result = updateStmt.run(tagsJson, item.id);
      if (result.changes > 0) updated++;
    }

    return { success: true, updated };
  });

  // 获取所有已存在的标签列表
  app.get('/api/tracks/tags/list', async (req, reply) => {
    const rows = db.prepare('SELECT DISTINCT tags FROM tracks WHERE tags IS NOT NULL AND tags != \'[]\'').all() as { tags: string }[];
    
    const tagSet = new Set<string>();
    for (const row of rows) {
      try {
        const tags = JSON.parse(row.tags);
        if (Array.isArray(tags)) {
          tags.forEach(t => {
            if (t && typeof t === 'string') tagSet.add(t);
          });
        }
      } catch {
        // 忽略解析错误
      }
    }
    
    const tagList = Array.from(tagSet).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return { tags: tagList };
  });
}