import { getDatabase } from '../db/schema.js';
export async function skipRoutes(app) {
    const db = getDatabase();
    // 记录跳过片头
    app.post('/api/skip/intro', async (req, reply) => {
        const { trackId, playlistId, position } = req.body;
        db.prepare('INSERT INTO skip_history (track_id, playlist_id, skip_type, position, timestamp) VALUES (?, ?, ?, ?, ?)').run(trackId, playlistId, 'intro', position, Date.now());
        // 计算移动平均值并更新播放列表的 skip_intro
        const history = db.prepare(`
      SELECT position FROM skip_history
      WHERE playlist_id = ? AND skip_type = 'intro'
      ORDER BY timestamp DESC
      LIMIT 10
    `).all(playlistId);
        if (history.length > 0) {
            // 移动平均，越新的权重越高
            let avgPosition = 0;
            let totalWeight = 0;
            history.forEach((h, i) => {
                const weight = Math.pow(0.8, i); // 最新权重 0.8，依次递减
                avgPosition += h.position * weight;
                totalWeight += weight;
            });
            avgPosition /= totalWeight;
            db.prepare('UPDATE playlists SET skip_intro = ?, updated_at = ? WHERE id = ?').run(avgPosition, Date.now(), playlistId);
        }
        return { success: true };
    });
    // 记录跳过片尾
    app.post('/api/skip/outro', async (req, reply) => {
        const { trackId, playlistId, position } = req.body;
        db.prepare('INSERT INTO skip_history (track_id, playlist_id, skip_type, position, timestamp) VALUES (?, ?, ?, ?, ?)').run(trackId, playlistId, 'outro', position, Date.now());
        // 计算移动平均值并更新播放列表的 skip_outro
        const history = db.prepare(`
      SELECT position FROM skip_history
      WHERE playlist_id = ? AND skip_type = 'outro'
      ORDER BY timestamp DESC
      LIMIT 10
    `).all(playlistId);
        if (history.length > 0) {
            let avgPosition = 0;
            let totalWeight = 0;
            history.forEach((h, i) => {
                const weight = Math.pow(0.8, i);
                avgPosition += h.position * weight;
                totalWeight += weight;
            });
            avgPosition /= totalWeight;
            db.prepare('UPDATE playlists SET skip_outro = ?, updated_at = ? WHERE id = ?').run(avgPosition, Date.now(), playlistId);
        }
        return { success: true };
    });
    // 获取播放列表的跳过设置
    app.get('/api/playlists/:id/skip-settings', async (req, reply) => {
        const { id } = req.params;
        const playlist = db.prepare('SELECT skip_intro, skip_outro FROM playlists WHERE id = ?').get(Number(id));
        if (!playlist) {
            return reply.code(404).send({ error: '播放列表不存在' });
        }
        return {
            skipIntro: playlist.skip_intro || 0,
            skipOutro: playlist.skip_outro || 0
        };
    });
    // 手动设置跳过参数
    app.put('/api/playlists/:id/skip-settings', async (req, reply) => {
        const { id } = req.params;
        const { skipIntro, skipOutro } = req.body;
        const updates = [];
        const values = [];
        if (skipIntro !== undefined) {
            updates.push('skip_intro = ?');
            values.push(skipIntro);
        }
        if (skipOutro !== undefined) {
            updates.push('skip_outro = ?');
            values.push(skipOutro);
        }
        if (updates.length > 0) {
            updates.push('updated_at = ?');
            values.push(Date.now());
            values.push(Number(id));
            db.prepare(`UPDATE playlists SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        }
        return { success: true };
    });
}
//# sourceMappingURL=skip.js.map