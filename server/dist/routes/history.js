import { getDatabase } from '../db/schema.js';
export async function historyRoutes(app) {
    const db = getDatabase();
    // 获取最近播放的播放列表（每个播放列表只保留最新一条记录）
    app.get('/api/history/playlists', async (req, reply) => {
        const { limit = 20 } = req.query;
        const history = db.prepare(`
      SELECT p.id as playlist_id, p.name as playlist_name, 
             ph.track_id, ph.position, ph.timestamp,
             t.title as track_title, t.artist as track_artist, t.duration as track_duration
      FROM play_history ph
      JOIN playlists p ON ph.playlist_id = p.id
      JOIN tracks t ON ph.track_id = t.id
      WHERE ph.id IN (
        SELECT MAX(id) FROM play_history GROUP BY playlist_id
      )
      ORDER BY ph.timestamp DESC
      LIMIT ?
    `).all(Number(limit));
        return history;
    });
    // 获取播放列表的最近播放记录
    app.get('/api/history/playlist/:id', async (req, reply) => {
        const { id } = req.params;
        const history = db.prepare(`
      SELECT ph.*, t.path, t.title, t.artist, t.album, t.duration
      FROM play_history ph
      JOIN tracks t ON ph.track_id = t.id
      WHERE ph.playlist_id = ?
      ORDER BY ph.timestamp DESC
      LIMIT 1
    `).get(Number(id));
        if (!history) {
            return { lastTrack: null, position: 0 };
        }
        return {
            lastTrack: history,
            position: history.position
        };
    });
    // 记录播放历史（先删除旧记录再插入）
    app.post('/api/history', async (req, reply) => {
        const { playlistId, trackId, position } = req.body;
        // 先删除该播放列表的旧记录，再插入新记录
        db.prepare('DELETE FROM play_history WHERE playlist_id = ?').run(playlistId);
        db.prepare('INSERT INTO play_history (playlist_id, track_id, position, timestamp) VALUES (?, ?, ?, ?)').run(playlistId, trackId, position, Date.now());
        return { success: true };
    });
    // 清除历史
    app.delete('/api/history', async (req, reply) => {
        db.prepare('DELETE FROM play_history').run();
        return { success: true };
    });
    // 删除单个播放列表的历史记录
    app.delete('/api/history/playlist/:id', async (req, reply) => {
        const { id } = req.params;
        db.prepare('DELETE FROM play_history WHERE playlist_id = ?').run(Number(id));
        return { success: true };
    });
}
//# sourceMappingURL=history.js.map