// 数据库 Schema 和初始化
import Database from 'better-sqlite3';
import path from 'path';
import { appPath } from '../utils/path.js';
import crypto from 'crypto';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = path.join(appPath, 'moonplayer.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    initDatabase(db);
    migrateDatabase(db);
  }
  return db;
}

// 密码哈希工具
export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt || crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(password, s, 100000, 64, 'sha512').toString('hex');
  return { hash, salt: s };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const result = hashPassword(password, salt);
  return result.hash === hash;
}

function initDatabase(db: Database.Database) {
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

  // 创建管理员表
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // 创建会话表（用于记住登录状态）
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  // 创建登录尝试表（用于限制暴力破解）
  db.exec(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      attempt_at INTEGER NOT NULL,
      success INTEGER DEFAULT 0
    )
  `);

  // 创建索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip);
    CREATE INDEX IF NOT EXISTS idx_login_attempts_time ON login_attempts(attempt_at)
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
    const result = db.prepare('INSERT INTO playlists (name, created_at, updated_at, is_auto, play_mode) VALUES (?, ?, ?, 0, ?)').run(
      '我喜欢的歌',
      Date.now(),
      Date.now(),
      'weighted'
    );
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('favorites_playlist_id', String(result.lastInsertRowid));
  }
}

// 数据库迁移（新增字段）
function migrateDatabase(db: Database.Database) {
  // 检查并添加 playlists 表的新字段
  const playlistsInfo = db.prepare('PRAGMA table_info(playlists)').all() as { name: string }[];
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
  const itemsInfo = db.prepare('PRAGMA table_info(playlist_items)').all() as { name: string }[];
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

// 检查是否需要初始化管理员
export function needsAdminSetup(): boolean {
  const database = getDatabase();
  const admin = database.prepare('SELECT id FROM admin WHERE id = 1').get();
  return !admin;
}

// 初始化管理员
export function setupAdmin(username: string, password: string): { success: boolean; error?: string } {
  const database = getDatabase();
  
  // 检查是否已有管理员
  const existing = database.prepare('SELECT id FROM admin WHERE id = 1').get();
  if (existing) {
    return { success: false, error: '管理员已存在' };
  }
  
  // 密码强度检查
  if (password.length < 6) {
    return { success: false, error: '密码至少需要6个字符' };
  }
  
  const { hash, salt } = hashPassword(password);
  const now = Date.now();
  
  database.prepare(`
    INSERT INTO admin (id, username, password_hash, password_salt, created_at, updated_at)
    VALUES (1, ?, ?, ?, ?, ?)
  `).run(username, hash, salt, now, now);
  
  return { success: true };
}

// 验证管理员密码
export function verifyAdminPassword(password: string): boolean {
  const database = getDatabase();
  const admin = database.prepare('SELECT password_hash, password_salt FROM admin WHERE id = 1').get() as { password_hash: string; password_salt: string } | undefined;
  
  if (!admin) return false;
  
  return verifyPassword(password, admin.password_hash, admin.password_salt);
}

// 验证管理员用户名和密码
export function verifyAdminCredentials(username: string, password: string): { success: boolean; error?: string } {
  const database = getDatabase();
  const admin = database.prepare('SELECT username, password_hash, password_salt FROM admin WHERE id = 1').get() as { username: string; password_hash: string; password_salt: string } | undefined;
  
  if (!admin) {
    return { success: false, error: '用户名或密码错误' };
  }
  
  if (admin.username !== username) {
    return { success: false, error: '用户名或密码错误' };
  }
  
  if (!verifyPassword(password, admin.password_hash, admin.password_salt)) {
    return { success: false, error: '用户名或密码错误' };
  }
  
  return { success: true };
}

// 修改密码
export function changeAdminPassword(oldPassword: string, newPassword: string): { success: boolean; error?: string } {
  const database = getDatabase();
  
  // 验证原密码
  if (!verifyAdminPassword(oldPassword)) {
    return { success: false, error: '原密码错误' };
  }
  
  // 密码强度检查
  if (newPassword.length < 6) {
    return { success: false, error: '新密码至少需要6个字符' };
  }
  
  const { hash, salt } = hashPassword(newPassword);
  const now = Date.now();
  
  database.prepare(`
    UPDATE admin SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = 1
  `).run(hash, salt, now);
  
  return { success: true };
}

// 清除管理员密码（保留其他数据）
export function clearAdminPassword(): { success: boolean; error?: string } {
  const database = getDatabase();
  
  // 清除管理员
  database.prepare('DELETE FROM admin WHERE id = 1').run();
  
  // 清除所有会话
  database.prepare('DELETE FROM sessions').run();
  
  return { success: true };
}

// 创建会话 token
export function createSession(): string {
  const database = getDatabase();
  const token = crypto.randomBytes(64).toString('hex');
  const now = Date.now();
  // 会话有效期：1年
  const expiresAt = now + 365 * 24 * 60 * 60 * 1000;
  
  database.prepare('INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)').run(token, now, expiresAt);
  
  return token;
}

// 验证会话
export function validateSession(token: string): boolean {
  const database = getDatabase();
  const now = Date.now();
  
  const session = database.prepare('SELECT id, expires_at FROM sessions WHERE token = ?').get(token) as { id: number; expires_at: number } | undefined;
  
  if (!session) return false;
  if (session.expires_at < now) {
    // 清除过期会话
    database.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    return false;
  }
  
  return true;
}

// 清理过期会话
export function cleanExpiredSessions(): void {
  const database = getDatabase();
  const now = Date.now();
  database.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
}

// 记录登录尝试
export function recordLoginAttempt(ip: string, success: boolean): void {
  const database = getDatabase();
  const now = Date.now();
  database.prepare('INSERT INTO login_attempts (ip, attempt_at, success) VALUES (?, ?, ?)').run(ip, now, success ? 1 : 0);
}

// 获取等待时间（秒）
export function getLoginWaitTime(ip: string): number {
  const database = getDatabase();
  const now = Date.now();
  
  // 清理旧的尝试记录（超过1小时的）
  database.prepare('DELETE FROM login_attempts WHERE attempt_at < ?').run(now - 3600000);
  
  // 获取最近1小时内的失败次数
  const result = database.prepare(`
    SELECT COUNT(*) as count FROM login_attempts 
    WHERE ip = ? AND success = 0 AND attempt_at > ?
  `).get(ip, now - 3600000) as { count: number };
  
  const failedCount = result.count;
  
  if (failedCount === 0) return 0;
  if (failedCount < 3) return 0;
  if (failedCount < 5) return 10;
  if (failedCount < 7) return 30;
  if (failedCount < 10) return 60;
  if (failedCount < 15) return 120;
  if (failedCount < 20) return 300;
  if (failedCount < 30) return 600;
  return 3600; // 最高1小时
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}