// 播放列表路由
import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../db/schema.js';
import { parseFile } from 'music-metadata';
import fs from 'fs';
import path from 'path';
import { createClient } from 'webdav';

export async function playlistRoutes(app: FastifyInstance) {
  const db = getDatabase();

  // 获取所有播放列表
  app.get('/api/playlists', async () => {
    const playlists = db.prepare(`
      SELECT p.*, COUNT(pi.id) as item_count
      FROM playlists p
      LEFT JOIN playlist_items pi ON p.id = pi.playlist_id
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `).all();
    return playlists;
  });

  // 获取单个播放列表详情
  app.get('/api/playlists/:id', async (req, reply) => {
    const { id } = req.params as { id: string };

    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(Number(id));
    if (!playlist) {
      return reply.code(404).send({ error: '播放列表不存在' });
    }

    const items = db.prepare('SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY "order"').all(Number(id));

    return { ...playlist, items };
  });

  // 创建播放列表
  app.post('/api/playlists', async (req, reply) => {
    const { name, items = [], isAuto = false, playMode = 'sequential' } = req.body as {
      name: string;
      items?: Array<{
        type: 'directory' | 'file' | 'filter';
        path: string;
        includeSubdirs?: boolean;
        filterRegex?: string;
        filterArtist?: string;
        filterAlbum?: string;
        filterTitle?: string;
      }>;
      isAuto?: boolean;
      playMode?: string;
    };

    if (!name || !name.trim()) {
      return reply.code(400).send({ error: '播放列表名称不能为空' });
    }

    const now = Date.now();
    const result = db.prepare(
      'INSERT INTO playlists (name, created_at, updated_at, is_auto, play_mode) VALUES (?, ?, ?, ?, ?)'
    ).run(name, now, now, isAuto ? 1 : 0, playMode);
    const playlistId = result.lastInsertRowid;

    // 添加项目
    if (items.length > 0) {
      const insertItem = db.prepare(
        'INSERT INTO playlist_items (playlist_id, type, path, include_subdirs, filter_regex, filter_artist, filter_album, filter_title, "order") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      items.forEach((item, index) => {
        insertItem.run(
          playlistId,
          item.type,
          item.path,
          item.includeSubdirs ? 1 : 0,
          item.filterRegex || null,
          item.filterArtist || null,
          item.filterAlbum || null,
          item.filterTitle || null,
          index
        );
      });
    }

    return {
      id: playlistId,
      name,
      created_at: now,
      updated_at: now,
      is_auto: isAuto ? 1 : 0,
      play_mode: playMode,
      items
    };
  });

  // 更新播放列表
  app.put('/api/playlists/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { name, items, playMode, skipIntro, skipOutro } = req.body as {
      name?: string;
      items?: Array<{
        type: 'directory' | 'file' | 'filter';
        path: string;
        includeSubdirs?: boolean;
        filterRegex?: string;
        filterArtist?: string;
        filterAlbum?: string;
        filterTitle?: string;
      }>;
      playMode?: string;
      skipIntro?: number;
      skipOutro?: number;
    };

    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(Number(id));
    if (!playlist) {
      return reply.code(404).send({ error: '播放列表不存在' });
    }

    const now = Date.now();

    // 更新基本信息
    if (name !== undefined || playMode !== undefined || skipIntro !== undefined || skipOutro !== undefined) {
      const updates: string[] = [];
      const values: any[] = [];

      if (name !== undefined) {
        updates.push('name = ?');
        values.push(name);
      }
      if (playMode !== undefined) {
        updates.push('play_mode = ?');
        values.push(playMode);
      }
      if (skipIntro !== undefined) {
        updates.push('skip_intro = ?');
        values.push(skipIntro);
      }
      if (skipOutro !== undefined) {
        updates.push('skip_outro = ?');
        values.push(skipOutro);
      }

      updates.push('updated_at = ?');
      values.push(now);
      values.push(Number(id));

      db.prepare(`UPDATE playlists SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    // 更新项目
    if (items !== undefined) {
      db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(Number(id));

      const insertItem = db.prepare(
        'INSERT INTO playlist_items (playlist_id, type, path, include_subdirs, filter_regex, filter_artist, filter_album, filter_title, "order") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      items.forEach((item, index) => {
        insertItem.run(
          Number(id),
          item.type,
          item.path,
          item.includeSubdirs ? 1 : 0,
          item.filterRegex || null,
          item.filterArtist || null,
          item.filterAlbum || null,
          item.filterTitle || null,
          index
        );
      });
    }

    return { success: true };
  });

  // 删除播放列表
  app.delete('/api/playlists/:id', async (req, reply) => {
    const { id } = req.params as { id: string };

    db.prepare('DELETE FROM playlists WHERE id = ?').run(Number(id));
    return { success: true };
  });

  // 刷新播放列表（扫描所有项获取音轨列表）
  app.post('/api/playlists/:id/refresh', async (req, reply) => {
    const { id } = req.params as { id: string };

    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(Number(id)) as any;
    if (!playlist) {
      return reply.code(404).send({ error: '播放列表不存在' });
    }

    const items = db.prepare('SELECT * FROM playlist_items WHERE playlist_id = ?').all(Number(id)) as any[];

    const audioExtensions = /\.(mp3|flac|wav|ogg|m4a|aac|wma|ape)$/i;
    const trackPaths: string[] = [];

    // WebDAV 客户端缓存
    const webdavClients = new Map<number, any>();
    
    async function getWebdavClient(configId: number) {
      if (!webdavClients.has(configId)) {
        const config = db.prepare('SELECT * FROM webdav_configs WHERE id = ?').get(configId) as any;
        if (config) {
          const client = createClient(config.url, {
            username: config.username || undefined,
            password: config.password || undefined
          });
          webdavClients.set(configId, client);
        }
      }
      return webdavClients.get(configId);
    }

    for (const item of items) {
      if (item.type === 'file') {
        if (audioExtensions.test(item.path)) {
          trackPaths.push(item.path);
        }
      } else if (item.type === 'directory') {
        const dirPath = item.path;
        const includeSubdirs = item.include_subdirs === 1;
        
        // 检查是否是 WebDAV 路径
        const webdavMatch = dirPath.match(/^webdav:\/\/(\d+)(.*)$/);
        if (webdavMatch) {
          // WebDAV 目录扫描
          const configId = parseInt(webdavMatch[1], 10);
          const webdavDir = webdavMatch[2];
          const client = await getWebdavClient(configId);
          
          if (client) {
            async function scanWebdavDir(dir: string) {
              try {
                const contents = await client.getDirectoryContents(dir);
                for (const entry of contents as any[]) {
                  if (entry.type === 'directory' && includeSubdirs) {
                    await scanWebdavDir(entry.filename);
                  } else if (entry.type === 'file' && audioExtensions.test(entry.basename)) {
                    trackPaths.push(`webdav://${configId}${entry.filename}`);
                  }
                }
              } catch (err) {
                // 忽略无法读取的目录
              }
            }
            await scanWebdavDir(webdavDir);
          }
        } else {
          // 本地目录扫描
          function scanDir(dir: string) {
            try {
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                if (entry.isDirectory() && includeSubdirs) {
                  scanDir(path.join(dir, entry.name));
                } else if (entry.isFile() && audioExtensions.test(entry.name)) {
                  trackPaths.push(path.join(dir, entry.name));
                }
              }
            } catch (err) {
              // 忽略无法读取的目录
            }
          }
          scanDir(dirPath);
        }
      } else if (item.type === 'filter' || item.type === 'match') {
        // 正则/匹配/过滤器：遍历所有音乐目录
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('music_paths') as { value: string } | undefined;
        const musicPaths = row?.value ? row.value.split('|').filter(Boolean) : ['/mnt/music/'];
        
        const filterRegex = item.filter_regex ? new RegExp(item.filter_regex, 'i') : null;
        const filterArtist = item.filter_artist;
        const filterAlbum = item.filter_album;
        const filterTitle = item.filter_title;
        const matchField = item.match_field;
        const matchOp = item.match_op;
        const matchValue = item.match_value;
        // 是否为纯匹配类型（无正则）
        const isPureMatch = item.type === 'match' || (matchField && !filterRegex);

        // 扫描所有音乐目录
        for (const musicPath of musicPaths) {
          function scanForFilter(dir: string) {
            try {
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                if (entry.isDirectory()) {
                  scanForFilter(path.join(dir, entry.name));
                } else if (entry.isFile() && audioExtensions.test(entry.name)) {
                  const filePath = path.join(dir, entry.name);
                  const fileName = entry.name;
                  
                  // 检查是否匹配所有过滤条件
                  let match = true;
                  
                  // 正则匹配（非纯匹配类型才检查正则）
                  if (!isPureMatch && filterRegex && !filterRegex.test(filePath) && !filterRegex.test(fileName)) {
                    match = false;
                  }
                  
                  // 匹配类型过滤
                  if (match && matchField && matchOp && matchValue !== null) {
                    // 查询 tracks 获取元数据
                    const cached = db.prepare('SELECT * FROM tracks WHERE path = ?').get(filePath) as any;
                    
                    if (cached) {
                      const fieldValue = cached[matchField];
                      const numValue = parseFloat(matchValue);
                      
                      switch (matchOp) {
                        case '>':
                          if (typeof fieldValue === 'number') match = fieldValue > numValue;
                          else match = false;
                          break;
                        case '<':
                          if (typeof fieldValue === 'number') match = fieldValue < numValue;
                          else match = false;
                          break;
                        case '>=':
                          if (typeof fieldValue === 'number') match = fieldValue >= numValue;
                          else match = false;
                          break;
                        case '<=':
                          if (typeof fieldValue === 'number') match = fieldValue <= numValue;
                          else match = false;
                          break;
                        case '=':
                          match = String(fieldValue || '') === String(matchValue);
                          break;
                        case 'contains':
                          if (matchField === 'tags') {
                            try {
                              const tags = cached.tags ? JSON.parse(cached.tags) : [];
                              match = tags.some((t: string) => t.includes(matchValue));
                            } catch { match = false; }
                          } else {
                            match = String(fieldValue || '').includes(matchValue);
                          }
                          break;
                        case 'not_contains':
                          if (matchField === 'tags') {
                            try {
                              const tags = cached.tags ? JSON.parse(cached.tags) : [];
                              match = !tags.some((t: string) => t.includes(matchValue));
                            } catch { match = true; }
                          } else {
                            match = !String(fieldValue || '').includes(matchValue);
                          }
                          break;
                        default:
                          match = false;
                      }
                    } else {
                      // 没有缓存数据，不匹配
                      match = false;
                    }
                  }
                  
                  if (match) {
                    trackPaths.push(filePath);
                  }
                }
              }
            } catch (err) {
              // 忽略无法读取的目录
            }
          }
          scanForFilter(musicPath);
        }
      }
    }

    // 插入或更新音轨
    const insertTrack = db.prepare('INSERT OR IGNORE INTO tracks (path, title, date_added) VALUES (?, ?, ?)');
    const getTrack = db.prepare('SELECT id, duration, artist, album FROM tracks WHERE path = ?') as any;
    const updateTrack = db.prepare('UPDATE tracks SET title = ?, artist = ?, album = ?, duration = ? WHERE id = ?');
    const trackIds: number[] = [];

    for (const trackPath of trackPaths) {
      // WebDAV 文件路径格式: webdav://{configId}{filePath}
      const webdavMatch = trackPath.match(/^webdav:\/\/(\d+)(.*)$/);
      
      // 提取标题（去掉扩展名）
      let title: string;
      if (webdavMatch) {
        // WebDAV 文件：从路径提取文件名
        title = path.basename(webdavMatch[2]).replace(/\.[^.]+$/, '');
      } else {
        title = path.basename(trackPath).replace(/\.[^.]+$/, '');
      }
      
      insertTrack.run(trackPath, title, Date.now());
      const track = getTrack.get(trackPath) as { id: number; duration: number | null; artist: string | null; album: string | null } | undefined;
      if (track) {
        // 本地文件且 duration 为空，解析元数据
        // WebDAV 文件不在此处解析元数据（播放时再获取）
        if (track.duration === null && !webdavMatch) {
          try {
            const metadata = await parseFile(trackPath);
            const metaTitle = metadata.common.title || title;
            const artist = metadata.common.artist || null;
            const album = metadata.common.album || null;
            const duration = metadata.format.duration || null;
            updateTrack.run(metaTitle, artist, album, duration, track.id);
          } catch {
            // 解析失败，保持原样
          }
        }
        trackIds.push(track.id);
      }
    }

    // 清空旧的音轨关联，插入新的
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(Number(id));
    const insertPlaylistTrack = db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, "order") VALUES (?, ?, ?)');
    trackIds.forEach((trackId, index) => {
      insertPlaylistTrack.run(Number(id), trackId, index);
    });

    // 更新播放列表时间
    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), Number(id));

    // 返回音轨列表
    const tracks = db.prepare(`
      SELECT t.id, t.path, t.title, t.artist, t.album, t.duration, t.rating, t.play_count, t.skip_count, t.last_played, t.date_added
      FROM tracks t
      JOIN playlist_tracks pt ON t.id = pt.track_id
      WHERE pt.playlist_id = ?
      ORDER BY pt."order"
    `).all(Number(id));

    return { playlist, tracks };
  });

  // 获取播放列表的音轨列表
  app.get('/api/playlists/:id/tracks', async (req, reply) => {
    const { id } = req.params as { id: string };

    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(Number(id)) as any;
    if (!playlist) {
      return reply.code(404).send({ error: '播放列表不存在' });
    }

    const tracks = db.prepare(`
      SELECT t.id, t.path, t.title, t.artist, t.album, t.duration, t.rating, t.play_count, t.skip_count, t.last_played, t.date_added
      FROM tracks t
      JOIN playlist_tracks pt ON t.id = pt.track_id
      WHERE pt.playlist_id = ?
      ORDER BY pt."order"
    `).all(Number(id));

    return { playlist, tracks };
  });

  // 添加项目到播放列表
  app.post('/api/playlists/:id/items', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { type, path: itemPath, includeSubdirs = false, filterRegex, filterArtist, filterAlbum, filterTitle, matchField, matchOp, matchValue } = req.body as {
      type: 'directory' | 'file' | 'filter' | 'match';
      path: string;
      includeSubdirs?: boolean;
      filterRegex?: string;
      filterArtist?: string;
      filterAlbum?: string;
      filterTitle?: string;
      matchField?: string;
      matchOp?: string;
      matchValue?: string;
    };

    // 检查是否已存在相同的来源项
    const existing = db.prepare(
      'SELECT id FROM playlist_items WHERE playlist_id = ? AND type = ? AND path = ?'
    ).get(Number(id), type, itemPath);

    if (existing) {
      // 已存在，返回已存在的项目
      return {
        id: (existing as any).id,
        type,
        path: itemPath,
        include_subdirs: includeSubdirs,
        alreadyExists: true
      };
    }

    // 获取当前最大 order
    const maxOrder = db.prepare('SELECT MAX("order") as max_order FROM playlist_items WHERE playlist_id = ?').get(Number(id)) as { max_order: number | null };
    const order = (maxOrder?.max_order ?? -1) + 1;

    const result = db.prepare(
      'INSERT INTO playlist_items (playlist_id, type, path, include_subdirs, filter_regex, filter_artist, filter_album, filter_title, match_field, match_op, match_value, "order") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(Number(id), type, itemPath, includeSubdirs ? 1 : 0, filterRegex || null, filterArtist || null, filterAlbum || null, filterTitle || null, matchField || null, matchOp || null, matchValue || null, order);

    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), Number(id));

    return {
      id: result.lastInsertRowid,
      type,
      path: itemPath,
      include_subdirs: includeSubdirs,
      filter_regex: filterRegex,
      filter_artist: filterArtist,
      filter_album: filterAlbum,
      filter_title: filterTitle,
      order
    };
  });

  // 更新播放列表项
  app.put('/api/playlists/:id/items/:itemId', async (req, reply) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    const { includeSubdirs, filterRegex, filterArtist, filterAlbum, filterTitle, matchField, matchOp, matchValue } = req.body as {
      includeSubdirs?: boolean;
      filterRegex?: string;
      filterArtist?: string;
      filterAlbum?: string;
      filterTitle?: string;
      matchField?: string;
      matchOp?: string;
      matchValue?: string;
    };

    const item = db.prepare('SELECT * FROM playlist_items WHERE id = ? AND playlist_id = ?').get(Number(itemId), Number(id)) as any;
    if (!item) {
      return reply.code(404).send({ error: '来源项不存在' });
    }

    const updates: string[] = [];
    const values: any[] = [];

    if (includeSubdirs !== undefined) {
      updates.push('include_subdirs = ?');
      values.push(includeSubdirs ? 1 : 0);
    }
    if (filterRegex !== undefined) {
      updates.push('filter_regex = ?');
      values.push(filterRegex || null);
    }
    if (filterArtist !== undefined) {
      updates.push('filter_artist = ?');
      values.push(filterArtist || null);
    }
    if (filterAlbum !== undefined) {
      updates.push('filter_album = ?');
      values.push(filterAlbum || null);
    }
    if (filterTitle !== undefined) {
      updates.push('filter_title = ?');
      values.push(filterTitle || null);
    }
    if (matchField !== undefined) {
      updates.push('match_field = ?');
      values.push(matchField || null);
    }
    if (matchOp !== undefined) {
      updates.push('match_op = ?');
      values.push(matchOp || null);
    }
    if (matchValue !== undefined) {
      updates.push('match_value = ?');
      values.push(matchValue || null);
    }

    if (updates.length > 0) {
      values.push(Number(itemId));
      db.prepare(`UPDATE playlist_items SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    return { success: true };
  });

  // 删除播放列表项
  app.delete('/api/playlists/:id/items/:itemId', async (req, reply) => {
    const { id, itemId } = req.params as { id: string; itemId: string };

    db.prepare('DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?').run(Number(itemId), Number(id));
    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), Number(id));

    return { success: true };
  });

  // 获取"我喜欢的歌"播放列表 ID
  app.get('/api/favorites-playlist', async () => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('favorites_playlist_id') as { value: string } | undefined;
    return { playlistId: row ? Number(row.value) : null };
  });

  // 导入 AI 生成的播放列表
  app.post('/api/playlists/import-ai', async (req, reply) => {
    const { playlists } = req.body as {
      playlists: Array<{
        name: string;
        description?: string;
        tracks: string[]; // 文件路径列表
      }>;
    };

    if (!playlists || !Array.isArray(playlists) || playlists.length === 0) {
      return reply.code(400).send({ error: '播放列表数据无效' });
    }

    const created: any[] = [];
    const now = Date.now();

    for (const pl of playlists) {
      if (!pl.name || !pl.tracks || pl.tracks.length === 0) continue;

      // 创建播放列表
      const result = db.prepare(
        'INSERT INTO playlists (name, created_at, updated_at, is_auto, play_mode) VALUES (?, ?, ?, 0, ?)'
      ).run(pl.name, now, now, 'shuffle');
      const playlistId = result.lastInsertRowid;

      // 为每个音轨路径创建 playlist_items 和 tracks 记录
      for (const trackPath of pl.tracks) {
        // 确保音轨存在于 tracks 表
        let track = db.prepare('SELECT id FROM tracks WHERE path = ?').get(trackPath) as { id: number } | undefined;
        if (!track) {
          // 插入新音轨
          const title = path.basename(trackPath).replace(/\.[^.]+$/, '');
          const insertResult = db.prepare(
            'INSERT INTO tracks (path, title, date_added) VALUES (?, ?, ?)'
          ).run(trackPath, title, now);
          track = { id: Number(insertResult.lastInsertRowid) };
        }

        // 关联音轨到播放列表
        db.prepare(
          'INSERT INTO playlist_tracks (playlist_id, track_id, "order") VALUES (?, ?, ?)'
        ).run(playlistId, track.id, 0);
      }

      // 添加一个来源项记录（标记为 filter 类型，路径为 *）
      db.prepare(
        'INSERT INTO playlist_items (playlist_id, type, path, "order") VALUES (?, ?, ?, ?)'
      ).run(playlistId, 'filter', '*', 0);

      created.push({
        id: playlistId,
        name: pl.name,
        track_count: pl.tracks.length
      });
    }

    return { created: created.length, playlists: created };
  });

  // 查找匹配目录的播放列表
  app.get('/api/find-playlist-for-dir', async (req) => {
    const { dir } = req.query as { dir?: string };
    if (!dir) {
      return { playlist: null };
    }

    // 查找所有播放列表项
    const items = db.prepare(`
      SELECT pi.playlist_id, pi.path, pi.include_subdirs, p.name, p.play_mode, p.skip_intro, p.skip_outro
      FROM playlist_items pi
      JOIN playlists p ON pi.playlist_id = p.id
      WHERE pi.type = 'directory'
    `).all() as any[];

    // 检查是否有匹配的播放列表（目录路径匹配，不限 include_subdirs）
    for (const item of items) {
      const normalizedItemPath = path.resolve(item.path).replace(/\/$/, '');
      const normalizedDir = path.resolve(dir).replace(/\/$/, '');
      
      // 检查路径是否匹配
      if (normalizedItemPath === normalizedDir) {
        // 检查这个播放列表是否只有这一个项
        const itemCount = db.prepare('SELECT COUNT(*) as count FROM playlist_items WHERE playlist_id = ?').get(item.playlist_id) as { count: number };
        if (itemCount.count === 1) {
          return {
            playlist: {
              id: item.playlist_id,
              name: item.name,
              play_mode: item.play_mode,
              skip_intro: item.skip_intro,
              skip_outro: item.skip_outro
            }
          };
        }
      }
    }

    return { playlist: null };
  });
}