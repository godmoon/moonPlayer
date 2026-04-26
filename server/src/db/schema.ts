// 数据库 Schema 和初始化
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { appPath } from '../utils/path.js';
import crypto from 'crypto';
import { getDirname, getWasmPath } from '../utils/runtime.js';

// 当前目录
const __dirname = getDirname();

// sql.js 数据库实例
let db: SqlJsDatabase | null = null;
let dbPath: string = '';

// 路径标准化（Windows 兼容）
export function normalizePath(p: string): string {
  // 统一使用正斜杠
  return p.replace(/\\/g, '/');
}

// 获取路径的最后一部分名称（兼容 Windows 和 Unix）
export function getPathName(p: string): string {
  const normalized = p.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || p;
}

// 将查询结果转换为数组
function resultsToArray(results: any[]): any[] {
  if (!results || results.length === 0) return [];
  // sql.js exec 返回 [{columns: string[], values: any[][]}]
  const result = results[0];
  if (!result || !result.columns || !result.values) return [];
  return result.values.map((row: any[]) => {
    const obj: Record<string, any> = {};
    result.columns.forEach((col: string, i: number) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

// 封装 better-sqlite3 兼容的 API
class DatabaseWrapper {
  private db: SqlJsDatabase;
  
  constructor(db: SqlJsDatabase) {
    this.db = db;
  }
  
  // 执行 SQL（无返回）
  exec(sql: string): void {
    this.db.run(sql);
    // 写入后自动保存
    this.save();
  }
  
  // 准备语句
  prepare(sql: string): StatementWrapper {
    return new StatementWrapper(this.db, sql, this);
  }
  
  // 关闭数据库
  close(): void {
    // sql.js 需要手动保存
    this.save();
  }
  
  // 保存到文件
  save(): void {
    if (dbPath) {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
    }
  }
}

// 语句封装
class StatementWrapper {
  private db: SqlJsDatabase;
  private sql: string;
  private wrapper: DatabaseWrapper;
  
  constructor(db: SqlJsDatabase, sql: string, wrapper: DatabaseWrapper) {
    this.db = db;
    this.sql = sql;
    this.wrapper = wrapper;
  }
  
  // 执行并返回所有结果
  all(...params: any[]): any[] {
    const results = this.db.exec(this.sql, params);
    return resultsToArray(results);
  }
  
  // 执行并返回第一行
  get(...params: any[]): any | undefined {
    const results = this.db.exec(this.sql, params);
    const arr = resultsToArray(results);
    return arr.length > 0 ? arr[0] : undefined;
  }
  
  // 执行并返回变化信息
  run(...params: any[]): { changes: number; lastInsertRowid: number } {
    this.db.run(this.sql, params);
    const info = this.db.exec("SELECT changes() as changes, last_insert_rowid() as lastInsertRowid");
    const arr = resultsToArray(info);
    // 写入后自动保存
    this.wrapper.save();
    return arr.length > 0 ? { changes: arr[0].changes as number, lastInsertRowid: arr[0].lastInsertRowid as number } : { changes: 0, lastInsertRowid: 0 };
  }
}

// 数据库类型
type Database = DatabaseWrapper;

export function getDatabase(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return new DatabaseWrapper(db);
}

// 初始化数据库（异步）
export async function initDatabaseAsync(): Promise<void> {
  if (db) return;
  
  // 获取 WASM 文件路径
  const wasmPath = getWasmPath();
  
  if (!fs.existsSync(wasmPath)) {
    throw new Error('sql-wasm.wasm not found. Please ensure sql.js is installed.');
  }
  
  // 读取 WASM 文件
  const buffer = fs.readFileSync(wasmPath);
  const wasmBinary = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  
  const SQL = await initSqlJs({
    locateFile: (file: string) => {
      // 返回空字符串，使用 wasmBinary
      return '';
    },
    wasmBinary
  });
  
  dbPath = path.join(appPath, 'moonplayer.db');
  
  // 确保目录存在
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // 尝试加载现有数据库
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  
  // 初始化表结构
  const database = new DatabaseWrapper(db);
  initTables(database);
  migrateDatabase(database);
  
  // 保存初始状态
  database.save();
}

// 同步初始化（兼容旧代码，但需要先调用 initDatabaseAsync）
function initDatabase(database: Database) {
  initTables(database);
  migrateDatabase(database);
}

function initTables(db: Database) {
  // 音轨表
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      artist TEXT,
      album TEXT,
      year INTEGER,
      tags TEXT,
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

  // 播放列表项表
  db.exec(`
    CREATE TABLE IF NOT EXISTS playlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('directory', 'file', 'filter', 'match')),
      path TEXT NOT NULL,
      include_subdirs INTEGER DEFAULT 0,
      filter_regex TEXT,
      filter_artist TEXT,
      filter_album TEXT,
      filter_title TEXT,
      match_field TEXT,
      match_op TEXT,
      match_value TEXT,
      "order" INTEGER DEFAULT 0,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
    )
  `);

  // 播放列表音轨表
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

  // 跳转历史表
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

  // WebDAV 配置表
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

  // 管理员表
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

  // 会话表
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  // 登录尝试表
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
    ['favorites_playlist_id', '0'],
    ['nav_order', 'browse,playlists,current,history,ratings,settings']
  ];

  for (const [key, value] of defaultSettings) {
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);
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
  
  // 来源条件表
  db.exec(`
    CREATE TABLE IF NOT EXISTS playlist_item_conditions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      match_field TEXT NOT NULL,
      match_op TEXT NOT NULL,
      match_value TEXT NOT NULL,
      "order" INTEGER DEFAULT 0,
      FOREIGN KEY (item_id) REFERENCES playlist_items(id) ON DELETE CASCADE
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_item_conditions_item ON playlist_item_conditions(item_id)`);

  // 扫描任务表
  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL,
      task_id TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'scanning', 'complete', 'failed')),
      progress INTEGER DEFAULT 0,
      total INTEGER DEFAULT 0,
      current_path TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_tasks_playlist ON scan_tasks(playlist_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_tasks_status ON scan_tasks(status)`);
}

// 数据库迁移
function migrateDatabase(db: Database) {
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
  if (!playlistsColumns.includes('quality_mode')) {
    db.exec('ALTER TABLE playlists ADD COLUMN quality_mode TEXT');
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
  if (!itemsColumns.includes('match_field')) {
    db.exec('ALTER TABLE playlist_items ADD COLUMN match_field TEXT');
  }
  if (!itemsColumns.includes('match_op')) {
    db.exec('ALTER TABLE playlist_items ADD COLUMN match_op TEXT');
  }
  if (!itemsColumns.includes('match_value')) {
    db.exec('ALTER TABLE playlist_items ADD COLUMN match_value TEXT');
  }

  // 检查并添加 tracks 表的新字段
  const tracksInfo = db.prepare('PRAGMA table_info(tracks)').all() as { name: string }[];
  const tracksColumns = tracksInfo.map(c => c.name);

  if (!tracksColumns.includes('year')) {
    db.exec('ALTER TABLE tracks ADD COLUMN year INTEGER');
  }
  if (!tracksColumns.includes('tags')) {
    db.exec('ALTER TABLE tracks ADD COLUMN tags TEXT');
  }
  if (!tracksColumns.includes('recycled')) {
    db.exec('ALTER TABLE tracks ADD COLUMN recycled INTEGER DEFAULT 0');
  }
  if (!tracksColumns.includes('recycled_at')) {
    db.exec('ALTER TABLE tracks ADD COLUMN recycled_at INTEGER');
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_tracks_recycled ON tracks(recycled)`);
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

// 检查是否需要初始化管理员
export function needsAdminSetup(): boolean {
  const database = getDatabase();
  const admin = database.prepare('SELECT id FROM admin WHERE id = 1').get();
  return !admin;
}

// 初始化管理员
export function setupAdmin(username: string, password: string): { success: boolean; error?: string } {
  const database = getDatabase();
  
  const existing = database.prepare('SELECT id FROM admin WHERE id = 1').get();
  if (existing) {
    return { success: false, error: '管理员已存在' };
  }
  
  if (password.length < 6) {
    return { success: false, error: '密码至少需要6个字符' };
  }
  
  const { hash, salt } = hashPassword(password);
  const now = Date.now();
  
  database.prepare(`
    INSERT INTO admin (id, username, password_hash, password_salt, created_at, updated_at)
    VALUES (1, ?, ?, ?, ?, ?)
  `).run(username, hash, salt, now, now);
  
  // 保存数据库
  database.save();
  
  return { success: true };
}

// 验证管理员密码
export function verifyAdminPassword(password: string): boolean {
  const database = getDatabase();
  const admin = database.prepare('SELECT password_hash, password_salt FROM admin WHERE id = 1').get() as { password_hash: string; password_salt: string } | undefined;
  
  if (!admin) return false;
  
  return verifyPassword(password, admin.password_hash, admin.password_salt);
}

// 验证管理员凭据
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
  
  if (!verifyAdminPassword(oldPassword)) {
    return { success: false, error: '原密码错误' };
  }
  
  if (newPassword.length < 6) {
    return { success: false, error: '新密码至少需要6个字符' };
  }
  
  const { hash, salt } = hashPassword(newPassword);
  const now = Date.now();
  
  database.prepare(`
    UPDATE admin SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = 1
  `).run(hash, salt, now);
  
  database.save();
  
  return { success: true };
}

// 清除管理员密码
export function clearAdminPassword(): { success: boolean; error?: string } {
  const database = getDatabase();
  
  database.prepare('DELETE FROM admin WHERE id = 1').run();
  database.prepare('DELETE FROM sessions').run();
  
  database.save();
  
  return { success: true };
}

// 创建会话
export function createSession(): string {
  const database = getDatabase();
  const token = crypto.randomBytes(64).toString('hex');
  const now = Date.now();
  const expiresAt = now + 365 * 24 * 60 * 60 * 1000;
  
  database.prepare('INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)').run(token, now, expiresAt);
  
  database.save();
  
  return token;
}

// 验证会话
export function validateSession(token: string): boolean {
  const database = getDatabase();
  const now = Date.now();
  
  const session = database.prepare('SELECT id, expires_at FROM sessions WHERE token = ?').get(token) as { id: number; expires_at: number } | undefined;
  
  if (!session) return false;
  if (session.expires_at < now) {
    database.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    database.save();
    return false;
  }
  
  return true;
}

// 清理过期会话
export function cleanExpiredSessions(): void {
  const database = getDatabase();
  const now = Date.now();
  database.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  database.save();
}

// 记录登录尝试
export function recordLoginAttempt(ip: string, success: boolean): void {
  const database = getDatabase();
  const now = Date.now();
  database.prepare('INSERT INTO login_attempts (ip, attempt_at, success) VALUES (?, ?, ?)').run(ip, now, success ? 1 : 0);
  database.save();
}

// 获取等待时间
export function getLoginWaitTime(ip: string): number {
  const database = getDatabase();
  const now = Date.now();
  
  database.prepare('DELETE FROM login_attempts WHERE attempt_at < ?').run(now - 3600000);
  
  const result = database.prepare(`
    SELECT COUNT(*) as count FROM login_attempts 
    WHERE ip = ? AND success = 0 AND attempt_at > ?
  `).get(ip, now - 3600000) as { count: number } | undefined;
  
  const failedCount = result?.count || 0;
  
  if (failedCount === 0) return 0;
  if (failedCount < 3) return 0;
  if (failedCount < 5) return 10;
  if (failedCount < 7) return 30;
  if (failedCount < 10) return 60;
  if (failedCount < 15) return 120;
  if (failedCount < 20) return 300;
  if (failedCount < 30) return 600;
  return 3600;
}

// 保存数据库
export function saveDatabase(): void {
  if (db) {
    const database = new DatabaseWrapper(db);
    database.save();
  }
}

// 关闭数据库
export function closeDatabase() {
  if (db) {
    const database = new DatabaseWrapper(db);
    database.save();
    db = null;
  }
}