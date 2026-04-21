// 播放历史路由
import type { FastifyInstance } from 'fastify';
import { getDatabase, saveDatabase, normalizePath } from '../db/schema.js';

export async function historyRoutes(app: FastifyInstance) {
  const db = getDatabase();

  // 获取播放列表的最近播放记录
  app.get('/api/history/playlist/:id', async (req, reply) => {
    const { id } = req.params as { id: string };

    const history = db.prepare(`
      SELECT ph.playlist_id, ph.track_id as id, ph.position, ph.timestamp,
             t.path, t.title, t.artist, t.album, t.duration
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
      position: (history as any).position
    };
  });

  // 记录播放历史（先删除旧记录再插入）
  app.post('/api/history', async (req, reply) => {
    const { playlistId, trackId, position } = req.body as {
      playlistId: number;
      trackId: number;
      position: number;
    };

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
    const { id } = req.params as { id: string };
    db.prepare('DELETE FROM play_history WHERE playlist_id = ?').run(Number(id));
    return { success: true };
  });
}