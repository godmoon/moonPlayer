// 音轨路由
import type { FastifyInstance } from 'fastify';
import { getDatabase, saveDatabase, normalizePath, getPathName } from '../db/schema.js';
import { parseFile, parseBuffer } from 'music-metadata';
import { createClient } from 'webdav';
import fs from 'fs';
import path from 'path';
import { parseWebdavPath, downloadWebdavFile, getWebdavCachePath, needsTranscode, ensureCacheDir, getTranscodeCachePath, getWebdavConfig, getWebdavClient } from '../utils/webdavCache.js';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

// 获取当前文件所在目录（兼容 pkg 打包）
function getDirname(): string {
  // pkg 打包环境
  if ((process as any).pkg) {
    return path.dirname(process.execPath);
  }
  // ESM 环境
  if (typeof import.meta === 'object' && import.meta.url && typeof import.meta.url === 'string') {
    let pathname = fileURLToPath(import.meta.url);
    if (process.platform === 'win32' && pathname.startsWith('/')) {
      pathname = pathname.substring(1);
    }
    return path.dirname(pathname);
  }
  // CJS 兜底（esbuild 打包后 bundle.cjs）
  return __dirname;
}

// 获取 __dirname 的兜底逻辑（兼容 pkg 打包）
function getDirnameForImport(): string {
  // pkg 打包环境
  if ((process as any).pkg) {
    return path.dirname(process.execPath);
  }
  // ESM 环境
  try {
    if (typeof import.meta === 'object' && import.meta.url && typeof import.meta.url === 'string') {
      let pathname = fileURLToPath(import.meta.url);
      if (process.platform === 'win32' && pathname.startsWith('/')) {
        pathname = pathname.substring(1);
      }
      return path.dirname(pathname);
    }
  } catch {}
  // CJS 兜底（esbuild 打包后 bundle.cjs）
  // @ts-ignore
  if (typeof __dirname === 'string') {
    // @ts-ignore
    return __dirname;
  }
  // 最终兜底
  return process.cwd();
}

const __dirname = getDirnameForImport();

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
        const normalizedPath = normalizePath(filePath);
        
        // 检查是否已存在
        const existing = db.prepare('SELECT id FROM tracks WHERE path = ?').get(normalizedPath);
        if (existing) {
          existingIds.push((existing as any).id);
          continue;
        }

        // 获取文件信息
        const stat = fs.statSync(filePath);
        const filename = getPathName(filePath);

        // 尝试解析元数据
        let title = path.posix.basename(filename, path.extname(filename));
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
        `).run(normalizedPath, title, artist || null, album || null, duration || null, Date.now());

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

    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(Number(id)) as any;
    if (!track) {
      return reply.code(404).send({ error: '音轨不存在' });
    }

    // 尝试从文件读取元数据（如果数据库中缺少这些信息）
    await enrichTrackMetadata(track);

    const duration = track.duration || 0;
    const rating = track.rating;
    const playCount = track.play_count;
    const skipCount = track.skip_count;

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

  // 获取所有音轨（搜索为空时使用，限制100条）
  app.get('/api/tracks/all', async (req, reply) => {
    const tracks = db.prepare(`
      SELECT * FROM tracks 
      WHERE recycled = 0
      ORDER BY title
      LIMIT 100
    `).all();

    return { tracks };
  });

  // 按筛选条件获取音轨（服务端筛选）
  app.post('/api/tracks/filter-by-conditions', async (req, reply) => {
    const { conditions } = req.body as { 
      conditions: Array<{ match_field: string; match_op: string; match_value: string }> 
    };

    if (!conditions || conditions.length === 0) {
      // 无条件返回全部（最多100条）
      const tracks = db.prepare(`
        SELECT * FROM tracks 
        WHERE recycled = 0
        ORDER BY title
        LIMIT 100
      `).all();
      return { tracks };
    }

    // 先获取所有音轨（限制10000条避免内存问题）
    const allTracks = db.prepare(`
      SELECT * FROM tracks 
      WHERE recycled = 0
      LIMIT 10000
    `).all() as any[];

    // 服务端筛选
    const checkCondition = (track: any, cond: { match_field: string; match_op: string; match_value: string }): boolean => {
      const fieldValue = track[cond.match_field];
      const condValue = cond.match_value;
      const numValue = parseFloat(condValue);

      switch (cond.match_op) {
        case '>':
          return typeof fieldValue === 'number' && fieldValue > numValue;
        case '<':
          return typeof fieldValue === 'number' && fieldValue < numValue;
        case '>=':
          return typeof fieldValue === 'number' && fieldValue >= numValue;
        case '<=':
          return typeof fieldValue === 'number' && fieldValue <= numValue;
        case '=':
          return String(fieldValue || '') === String(condValue);
        case 'contains':
          if (cond.match_field === 'tags') {
            try {
              const tagList = track.tags ? (typeof track.tags === 'string' ? JSON.parse(track.tags) : track.tags) : [];
              return tagList.some((t: string) => t.includes(condValue));
            } catch { return false; }
          }
          return String(fieldValue || '').includes(condValue);
        case 'not_contains':
          if (cond.match_field === 'tags') {
            try {
              const tagList = track.tags ? (typeof track.tags === 'string' ? JSON.parse(track.tags) : track.tags) : [];
              return !tagList.some((t: string) => t.includes(condValue));
            } catch { return true; }
          }
          return !String(fieldValue || '').includes(condValue);
        default:
          return false;
      }
    };

    // 所有条件都必须满足 (AND)
    const filtered = allTracks.filter(track => {
      for (const cond of conditions) {
        if (!checkCondition(track, cond)) {
          return false;
        }
      }
      return true;
    });

    return { tracks: filtered };
  });

  // 搜索音轨
  app.get('/api/tracks/search', async (req, reply) => {
    const { q } = req.query as { q?: string };

    if (!q) {
      return { tracks: [] };
    }

    // 使用 pinyin-pro 做拼音转换
    const { pinyin } = await import('pinyin-pro');
    
    // 获取搜索词的拼音首字母（去掉空格）
    const queryInitials = pinyin(q, { toneType: 'none', pattern: 'first' }).replace(/\s+/g, '').toLowerCase();
    // 获取搜索词的完整拼音（去掉空格）
    const queryPinyin = pinyin(q, { toneType: 'none' }).replace(/\s+/g, '').toLowerCase();
    
    // 子序列匹配函数：检查 query 是否是 target 的子序列
    const isSubsequence = (query: string, target: string): boolean => {
      let i = 0, j = 0;
      while (i < query.length && j < target.length) {
        if (query[i] === target[j]) {
          i++;
        }
        j++;
      }
      return i === query.length;
    };
    
    // 先做基本的 LIKE 搜索（中文直接匹配）
    const likeTracks = db.prepare(`
      SELECT * FROM tracks
      WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? OR path LIKE ?
      LIMIT 100
    `).all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    
    if (likeTracks.length > 0) {
      return { tracks: likeTracks };
    }
    
    // 拼音搜索：需要遍历更多数据
    const allTracks = db.prepare(`SELECT * FROM tracks LIMIT 10000`).all();
    
    // 分类存储匹配结果
    const exactMatches: any[] = [];      // 精确匹配
    const initialMatches: any[] = [];   // 首字母匹配
    const subseqMatches: any[] = [];    // 子序列匹配
    
    for (const track of allTracks) {
      const t = track as any;
      const title = t.title || '';
      const artist = t.artist || '';
      const path = t.path || '';
      
      // 获取各字段的拼音首字母和完整拼音
      const titlePinyin = pinyin(title, { toneType: 'none' }).replace(/\s+/g, '').toLowerCase();
      const artistPinyin = pinyin(artist, { toneType: 'none' }).replace(/\s+/g, '').toLowerCase();
      const pathPinyin = pinyin(path, { toneType: 'none' }).replace(/\s+/g, '').toLowerCase();
      
      const titleInitials = pinyin(title, { toneType: 'none', pattern: 'first' }).replace(/\s+/g, '').toLowerCase();
      const artistInitials = pinyin(artist, { toneType: 'none', pattern: 'first' }).replace(/\s+/g, '').toLowerCase();
      const pathInitials = pinyin(path, { toneType: 'none', pattern: 'first' }).replace(/\s+/g, '').toLowerCase();
      
      // 1. 精确匹配（最高优先级）
      if (titlePinyin.includes(queryPinyin) || artistPinyin.includes(queryPinyin) || pathPinyin.includes(queryPinyin)) {
        exactMatches.push(t);
        continue;
      }
      
      // 2. 首字母精确包含
      if (titleInitials.includes(queryInitials) || artistInitials.includes(queryInitials) || pathInitials.includes(queryInitials)) {
        initialMatches.push(t);
        continue;
      }
      
      // 3. 子序列匹配
      if (isSubsequence(queryPinyin, titlePinyin) || isSubsequence(queryPinyin, artistPinyin) || isSubsequence(queryPinyin, pathPinyin)) {
        subseqMatches.push(t);
        continue;
      }
      
      // 4. 首字母子序列匹配
      if (isSubsequence(queryInitials, titleInitials) || isSubsequence(queryInitials, artistInitials) || isSubsequence(queryInitials, pathInitials)) {
        subseqMatches.push(t);
      }
    }
    
    // 按优先级合并结果
    const tracks = [...exactMatches, ...initialMatches, ...subseqMatches];

    return { tracks: tracks.slice(0, 100) };
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

  // 删除音轨（标记为回收站）
  app.delete('/api/tracks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };

    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(Number(id)) as any;
    if (!track) {
      return reply.code(404).send({ error: '音轨不存在' });
    }

    // 标记为回收站
    db.prepare('UPDATE tracks SET recycled = 1, recycled_at = ? WHERE id = ?').run(Date.now(), Number(id));

    return { success: true };
  });

  // 从所有播放列表中移除该音轨（回收站文件不参与播放）
  app.delete('/api/tracks/:id/remove-from-playlists', async (req, reply) => {
    const { id } = req.params as { id: string };

    db.prepare('DELETE FROM playlist_tracks WHERE track_id = ?').run(Number(id));
    db.prepare('DELETE FROM play_history WHERE track_id = ?').run(Number(id));
    db.prepare('DELETE FROM skip_history WHERE track_id = ?').run(Number(id));

    return { success: true };
  });

  // 获取回收站音轨列表
  app.get('/api/tracks/recycled', async (req, reply) => {
    const tracks = db.prepare(`
      SELECT * FROM tracks
      WHERE recycled = 1
      ORDER BY recycled_at DESC
    `).all();

    return { tracks };
  });

  // 恢复回收站音轨
  app.post('/api/tracks/:id/restore', async (req, reply) => {
    const { id } = req.params as { id: string };

    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(Number(id)) as any;
    if (!track) {
      return reply.code(404).send({ error: '音轨不存在' });
    }

    db.prepare('UPDATE tracks SET recycled = 0, recycled_at = NULL WHERE id = ?').run(Number(id));

    return { success: true };
  });

  // 彻底删除音轨（删除物理文件）
  app.delete('/api/tracks/:id/permanent', async (req, reply) => {
    const { id } = req.params as { id: string };

    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(Number(id)) as any;
    if (!track) {
      return reply.code(404).send({ error: '音轨不存在' });
    }

    const filePath = track.path;
    let deleteError: string | null = null;

    // WebDAV 文件
    if (filePath.startsWith('webdav://')) {
      const parsed = parseWebdavPath(filePath);
      if (parsed) {
        const config = getWebdavConfig(parsed.configId);
        if (config) {
          try {
            const client = getWebdavClient(config.url, config.username || undefined, config.password || undefined);
            await client.deleteFile(parsed.webdavPath);
            // 删除成功后清理缓存
            const cachePath = getWebdavCachePath(parsed.configId, parsed.webdavPath);
            if (fs.existsSync(cachePath)) {
              fs.unlinkSync(cachePath);
            }
            const transcodePath = getTranscodeCachePath(filePath, `webdav:${parsed.configId}:`);
            if (fs.existsSync(transcodePath)) {
              fs.unlinkSync(transcodePath);
            }
          } catch (err) {
            deleteError = `WebDAV 删除失败: ${(err as Error).message}`;
          }
        } else {
          deleteError = 'WebDAV 配置不存在';
        }
      } else {
        deleteError = '无效的 WebDAV 路径';
      }
    } else {
      // 本地文件
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        deleteError = `文件删除失败: ${(err as Error).message}`;
      }
    }

    if (deleteError) {
      return reply.code(500).send({ error: deleteError });
    }

    // 删除数据库记录
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
            const fileName = getPathName(fullPath).replace(/\.[^.]+$/, '');

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
                // WebDAV entry.basename 已经是文件名（不含路径）
                const fileName = entry.basename.replace(/\.[^.]+$/, '');

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

  // =====================
  // 播放统计 API
  // =====================

  // 获取播放次数统计
  app.get('/api/tracks/play-stats', async (req, reply) => {
    const { limit = 100, offset = 0, orderBy = 'play_count', order = 'DESC' } = req.query as {
      limit?: string;
      offset?: string;
      orderBy?: string;
      order?: string;
    };

    // 验证排序字段
    const validOrderFields = ['play_count', 'title', 'artist', 'rating', 'last_played'];
    const validOrders = ['ASC', 'DESC'];
    
    const sortField = validOrderFields.includes(orderBy) ? orderBy : 'play_count';
    const sortOrder = validOrders.includes(order.toUpperCase()) ? order.toUpperCase() : 'DESC';

    const tracks = db.prepare(`
      SELECT 
        id,
        path,
        title,
        artist,
        album,
        play_count,
        skip_count,
        last_played,
        rating
      FROM tracks
      WHERE recycled = 0
      ORDER BY ${sortField} ${sortOrder}
      LIMIT ? OFFSET ?
    `).all(Number(limit), Number(offset)) as any[];

    // 获取总数
    const total = db.prepare('SELECT COUNT(*) as count FROM tracks WHERE recycled = 0').get() as { count: number };

    return {
      tracks,
      total: total.count,
      limit: Number(limit),
      offset: Number(offset)
    };
  });

  // 获取播放次数最多的歌曲
  app.get('/api/tracks/most-played', async (req, reply) => {
    const { limit = 50 } = req.query as { limit?: string };

    const tracks = db.prepare(`
      SELECT 
        id,
        path,
        title,
        artist,
        album,
        play_count,
        last_played,
        rating
      FROM tracks
      WHERE recycled = 0 AND play_count > 0
      ORDER BY play_count DESC, last_played DESC
      LIMIT ?
    `).all(Number(limit));

    return { tracks };
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

// 从文件读取并更新元数据（如果数据库中缺少这些信息）
async function enrichTrackMetadata(track: any) {
  const filePath = track.path;
  
  // 检查是否需要更新元数据
  const needsArtist = !track.artist;
  const needsAlbum = !track.album;
  const needsYear = !track.year;
  const needsDuration = !track.duration;
  
  // 如果都有数据，不需要读取
  if (!needsArtist && !needsAlbum && !needsYear && !needsDuration) {
    return;
  }
  
  let buffer: Buffer | null = null;
  let localPath: string | null = null;
  
  // 处理 WebDAV 文件
  if (filePath.startsWith('webdav://')) {
    const parsed = parseWebdavPath(filePath);
    if (!parsed) return;
    
    try {
      const result = await downloadWebdavFile(parsed.configId, parsed.webdavPath);
      if (!result) return;
      
      // 如果需要转码，检查转码缓存是否有效
      if (result.needsTranscode && result.transcodeCachePath) {
        ensureCacheDir();
        if (fs.existsSync(result.transcodeCachePath)) {
          // 转码缓存已存在，需要原始文件来读取元数据
          // 使用原始缓存路径
          localPath = result.cachePath;
          buffer = result.buffer.length > 0 ? result.buffer : fs.readFileSync(result.cachePath);
        } else {
          // 需要转码但缓存不存在，使用下载的 Buffer
          localPath = result.cachePath;
          buffer = result.buffer;
          // 写入缓存文件（如果还没有）
          if (!fs.existsSync(result.cachePath)) {
            fs.writeFileSync(result.cachePath, buffer);
          }
        }
      } else {
        // 不需要转码，直接使用下载的文件
        localPath = result.cachePath;
        buffer = result.buffer.length > 0 ? result.buffer : fs.readFileSync(result.cachePath);
      }
    } catch (err) {
      console.error(`下载 WebDAV 文件失败 ${filePath}:`, err);
      return;
    }
  } else {
    // 本地文件
    localPath = filePath;
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
    } catch {
      return; // 文件不存在或无法读取
    }
  }
  
  try {
    let metadata;
    
    if (buffer && buffer.length > 0) {
      // 从 Buffer 解析元数据
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.mp3': 'audio/mpeg',
        '.flac': 'audio/flac',
        '.m4a': 'audio/mp4',
        '.ogg': 'audio/ogg',
        '.wav': 'audio/wav',
        '.wma': 'audio/x-ms-wma',
        '.ape': 'audio/x-ape',
        '.aac': 'audio/aac'
      };
      metadata = await parseBuffer(buffer, { mimeType: mimeTypes[ext] });
    } else if (localPath) {
      // 从文件解析元数据
      metadata = await parseFile(localPath, { duration: needsDuration });
    } else {
      return;
    }
    
    const common = metadata.common;
    
    // 构建更新字段
    const updates: { field: string; value: any }[] = [];
    
    if (needsArtist && common.artist) {
      updates.push({ field: 'artist', value: common.artist });
    }
    if (needsAlbum && common.album) {
      updates.push({ field: 'album', value: common.album });
    }
    if (needsYear && common.year) {
      updates.push({ field: 'year', value: common.year });
    }
    if (needsDuration && metadata.format.duration) {
      updates.push({ field: 'duration', value: metadata.format.duration });
    }
    
    // 执行更新
    if (updates.length > 0) {
      const database = getDatabase();
      const setClause = updates.map(u => `${u.field} = ?`).join(', ');
      const values = updates.map(u => u.value);
      values.push(track.id);
      
      database.prepare(`UPDATE tracks SET ${setClause} WHERE id = ?`).run(...values);
    }
  } catch (err) {
    // 元数据读取失败，静默忽略
    console.error(`读取元数据失败 ${filePath}:`, err);
  }
}