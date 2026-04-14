// 数据库 Schema 和初始化
import Database from 'better-sqlite3';
import path from 'path';
import { appPath } from '../utils/path.js';
let db = null;
export function getDatabase() {
    if (!db) {
        const dbPath = path.join(appPath, 'moonplayer.db');
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        initDatabase(db);
        migrateDatabase(db);
    }
    return db;
}
function initDatabase(db) {
    // 音轨表
    db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      artist TEXT,
      album TEXT,
      duration REAL,
      rating INTEGER DEFAULT 0,
      play_count INTEGER DEFAULT 0,
      skip_count INTEGER DEFAULT 0,
      last_played INTEGER,
      date_added INTEGER NOT NULL
    )
  `);
    // 播放列表表
    db.exec(`
    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      is_auto INTEGER DEFAULT 0,
      play_mode TEXT DEFAULT 'sequential',
      skip_intro REAL DEFAULT 0,
      skip_outro REAL DEFAULT 0
    )
  `);
    // 播放列表项表 - 定义播放列表的来源（目录/文件）
    db.exec(`
    CREATE TABLE IF NOT EXISTS playlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('directory', 'file', 'filter')),
      path TEXT NOT NULL,
      include_subdirs INTEGER DEFAULT 0,
      filter_regex TEXT,
      filter_artist TEXT,
      filter_album TEXT,
      filter_title TEXT,
      "order" INTEGER DEFAULT 0,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
    )
  `);
    // 播放列表音轨表 - 存储播放列表中的实际音轨
    db.exec(`
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL,
      track_id INTEGER NOT NULL,
      "order" INTEGER DEFAULT 0,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
      UNIQUE(playlist_id, track_id)
    )
  `);
    // 播放历史表
    db.exec(`
    CREATE TABLE IF NOT EXISTS play_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL,
      track_id INTEGER NOT NULL,
      position REAL NOT NULL DEFAULT 0,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
    )
  `);
    // 跳转历史表（用于学习片头片尾）
    db.exec(`
    CREATE TABLE IF NOT EXISTS skip_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id INTEGER NOT NULL,
      playlist_id INTEGER NOT NULL,
      skip_type TEXT NOT NULL CHECK(skip_type IN ('intro', 'outro')),
      position REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
    )
  `);
    // 配置表
    db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
    // 创建索引
    db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tracks_path ON tracks(path);
    CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id);
    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id);
    CREATE INDEX IF NOT EXISTS idx_play_history_playlist ON play_history(playlist_id);
    CREATE INDEX IF NOT EXISTS idx_play_history_timestamp ON play_history(timestamp);
    CREATE INDEX IF NOT EXISTS idx_skip_history_track ON skip_history(track_id);
  `);
    // 创建 WebDAV 配置表
    db.exec(`
    CREATE TABLE IF NOT EXISTS webdav_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      username TEXT,
      password TEXT,
      base_path TEXT DEFAULT '/',
      created_at INTEGER,
      updated_at INTEGER
    )
  `);
    // 初始化默认配置
    const defaultSettings = [
        ['music_paths', '/mnt/music/'],
        ['default_play_mode', 'sequential'],
        ['volume', '80'],
        ['favorites_playlist_id', '0']
    ];
    const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of defaultSettings) {
        insertSetting.run(key, value);
    }
    // 创建默认"我喜欢的歌"播放列表
    const existingFavorites = db.prepare("SELECT id FROM playlists WHERE name = '我喜欢的歌'").get();
    if (!existingFavorites) {
        const result = db.prepare('INSERT INTO playlists (name, created_at, updated_at, is_auto, play_mode) VALUES (?, ?, ?, 0, ?)').run('我喜欢的歌', Date.now(), Date.now(), 'weighted');
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('favorites_playlist_id', String(result.lastInsertRowid));
    }
}
// 数据库迁移（新增字段）
function migrateDatabase(db) {
    // 检查并添加 playlists 表的新字段
    const playlistsInfo = db.prepare('PRAGMA table_info(playlists)').all();
    const playlistsColumns = playlistsInfo.map(c => c.name);
    if (!playlistsColumns.includes('play_mode')) {
        db.exec('ALTER TABLE playlists ADD COLUMN play_mode TEXT DEFAULT \'sequential\'');
    }
    if (!playlistsColumns.includes('skip_intro')) {
        db.exec('ALTER TABLE playlists ADD COLUMN skip_intro REAL DEFAULT 0');
    }
    if (!playlistsColumns.includes('skip_outro')) {
        db.exec('ALTER TABLE playlists ADD COLUMN skip_outro REAL DEFAULT 0');
    }
    // 检查并添加 playlist_items 表的新字段
    const itemsInfo = db.prepare('PRAGMA table_info(playlist_items)').all();
    const itemsColumns = itemsInfo.map(c => c.name);
    if (!itemsColumns.includes('filter_regex')) {
        db.exec('ALTER TABLE playlist_items ADD COLUMN filter_regex TEXT');
    }
    if (!itemsColumns.includes('filter_artist')) {
        db.exec('ALTER TABLE playlist_items ADD COLUMN filter_artist TEXT');
    }
    if (!itemsColumns.includes('filter_album')) {
        db.exec('ALTER TABLE playlist_items ADD COLUMN filter_album TEXT');
    }
    if (!itemsColumns.includes('filter_title')) {
        db.exec('ALTER TABLE playlist_items ADD COLUMN filter_title TEXT');
    }
    // 创建 playlist_tracks 表（如果不存在）
    db.exec(`
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL,
      track_id INTEGER NOT NULL,
      "order" INTEGER DEFAULT 0,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
      UNIQUE(playlist_id, track_id)
    )
  `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id)`);
    // 更新 type 约束（需要重建表）
    // SQLite 不支持直接修改 CHECK 约束，这里简化处理
}
export function closeDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}
//# sourceMappingURL=schema.js.map