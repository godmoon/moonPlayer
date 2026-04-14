import { getDatabase } from '../db/schema.js';
import { parseFile } from 'music-metadata';
import fs from 'fs';
import path from 'path';
export async function trackRoutes(app) {
    const db = getDatabase();
    // 扫描文件并添加到数据库
    app.post('/api/tracks/scan', async (req, reply) => {
        const { paths } = req.body;
        if (!paths || paths.length === 0) {
            return reply.code(400).send({ error: '缺少文件路径' });
        }
        const insertedIds = [];
        const existingIds = [];
        const errors = [];
        for (const filePath of paths) {
            try {
                // 检查是否已存在
                const existing = db.prepare('SELECT id FROM tracks WHERE path = ?').get(filePath);
                if (existing) {
                    existingIds.push(existing.id);
                    continue;
                }
                // 获取文件信息
                const stat = fs.statSync(filePath);
                const filename = path.basename(filePath);
                // 尝试解析元数据
                let title = path.basename(filename, path.extname(filename));
                let artist;
                let album;
                let duration;
                try {
                    const metadata = await parseFile(filePath);
                    if (metadata.common.title)
                        title = metadata.common.title;
                    if (metadata.common.artist)
                        artist = metadata.common.artist;
                    if (metadata.common.album)
                        album = metadata.common.album;
                    if (metadata.format.duration)
                        duration = metadata.format.duration;
                }
                catch {
                    // 无法解析元数据，使用文件名
                }
                // 插入数据库
                const result = db.prepare(`
          INSERT INTO tracks (path, title, artist, album, duration, rating, play_count, skip_count, date_added)
          VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?)
        `).run(filePath, title, artist || null, album || null, duration || null, Date.now());
                insertedIds.push(Number(result.lastInsertRowid));
            }
            catch (err) {
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
        const { id } = req.params;
        const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(Number(id));
        if (!track) {
            return reply.code(404).send({ error: '音轨不存在' });
        }
        return track;
    });
    // 更新评分
    app.put('/api/tracks/:id/rating', async (req, reply) => {
        const { id } = req.params;
        const { delta } = req.body;
        db.prepare('UPDATE tracks SET rating = rating + ? WHERE id = ?').run(delta, Number(id));
        const track = db.prepare('SELECT rating FROM tracks WHERE id = ?').get(Number(id));
        return { rating: track.rating };
    });
    // 记录播放
    app.post('/api/tracks/:id/play', async (req, reply) => {
        const { id } = req.params;
        const { completed, position } = req.body;
        const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(Number(id));
        if (!track) {
            return reply.code(404).send({ error: '音轨不存在' });
        }
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
        }
        else {
            // 检查播放进度
            const progress = duration > 0 ? (position || 0) / duration : 0;
            if (progress < 0.01) {
                // < 1% 就切歌：可能是快切
                db.prepare('UPDATE tracks SET skip_count = skip_count + 1, last_played = ? WHERE id = ?').run(Date.now(), Number(id));
                // 如果连续 3 次以上快切，这次听完，额外加分在 play 完成时处理
            }
            else if (progress < 0.1) {
                // 3%-10% 切歌：扣分
                ratingDelta = -1;
                db.prepare('UPDATE tracks SET rating = rating + ?, last_played = ? WHERE id = ?').run(ratingDelta, Date.now(), Number(id));
            }
            else {
                // 其他情况，记录播放
                db.prepare('UPDATE tracks SET last_played = ? WHERE id = ?').run(Date.now(), Number(id));
            }
        }
        // 更新播放列表历史
        const { playlistId } = req.body;
        if (playlistId) {
            db.prepare('INSERT INTO play_history (playlist_id, track_id, position, timestamp) VALUES (?, ?, ?, ?)').run(playlistId, Number(id), position || 0, Date.now());
        }
        return { success: true, ratingDelta };
    });
    // 搜索音轨
    app.get('/api/tracks/search', async (req, reply) => {
        const { q } = req.query;
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
        const { limit = 100 } = req.query;
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
        const { trackIds, rating } = req.body;
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
        const { artist, album, title, minRating, maxRating } = req.query;
        let sql = 'SELECT * FROM tracks WHERE 1=1';
        const params = [];
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
        const { id } = req.params;
        db.prepare('DELETE FROM tracks WHERE id = ?').run(Number(id));
        db.prepare('DELETE FROM play_history WHERE track_id = ?').run(Number(id));
        db.prepare('DELETE FROM skip_history WHERE track_id = ?').run(Number(id));
        return { success: true };
    });
    // 获取低分音轨列表（用于清理）
    app.get('/api/tracks/low-rated', async (req, reply) => {
        const { threshold = -5, limit = 100 } = req.query;
        const tracks = db.prepare(`
      SELECT * FROM tracks
      WHERE rating <= ?
      ORDER BY rating ASC
      LIMIT ?
    `).all(Number(threshold), Number(limit));
        return { tracks };
    });
}
//# sourceMappingURL=tracks.js.map