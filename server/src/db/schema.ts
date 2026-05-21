// 数据库 Schema 和初始化
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { appPath } from '../utils/path.js';
import crypto from 'crypto';
import { getDirname, getWasmPath } from '../utils/runtime.js';

// 当前目录
const __dirname = getDirname();

// sql.js 数据库实例（主数据库：users, sessions）
let db: SqlJsDatabase | null = null;
let dbPath: string = '';
let SQL: any = null;

// 用户数据库缓存
const userDbs = new Map<number, SqlJsDatabase>();

function getUserDbPath(userId: number): string {
  return path.join(appPath, `moonplayer_${userId}.db`);
}

// 路径标准化（Windows 兼容）
export function normalizePath(p: string): string {
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

// 封装 sql.js 兼容的 API
class DatabaseWrapper {
  private db: SqlJsDatabase;
  private filePath: string;

  constructor(db: SqlJsDatabase, filePath: string) {
    this.db = db;
    this.filePath = filePath;
    db.run('PRAGMA foreign_keys = ON');
  }

  getDb(): SqlJsDatabase { return this.db; }

  // 执行 SQL（无返回）
  exec(sql: string): void {
    this.db.run(sql);
    this.save();
  }

  // 准备语句
  prepare(sql: string): StatementWrapper {
    return new StatementWrapper(this.db, sql, this);
  }

  // 关闭数据库
  close(): void {
    this.save();
  }

  // 保存到文件
  save(): void {
    if (this.filePath) {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.filePath, buffer);
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
    this.wrapper.save();
    return arr.length > 0 ? { changes: arr[0].changes as number, lastInsertRowid: arr[0].lastInsertRowid as number } : { changes: 0, lastInsertRowid: 0 };
  }
}

// 数据库类型
type Database = DatabaseWrapper;

// ========== 主数据库（auth/global 表） ==========

export function getDatabase(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return new DatabaseWrapper(db, dbPath);
}

export function getUserDatabase(userId: number): Database {
  if (!SQL) {
    throw new Error('Database not initialized. Call initDatabaseAsync() first.');
  }

  if (userDbs.has(userId)) {
    return new DatabaseWrapper(userDbs.get(userId)!, getUserDbPath(userId));
  }

  const userDbPath = getUserDbPath(userId);
  const dir = path.dirname(userDbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let userDb: SqlJsDatabase;
  if (fs.existsSync(userDbPath)) {
    const buffer = fs.readFileSync(userDbPath);
    userDb = new SQL.Database(buffer);
  } else {
    userDb = new SQL.Database();
  }

  userDbs.set(userId, userDb);

  const wrapper = new DatabaseWrapper(userDb, userDbPath);
  initUserTables(wrapper);
  migrateUserDatabase(wrapper);
  wrapper.save();

  return new DatabaseWrapper(userDb, userDbPath);
}

// 关闭所有数据库
export function closeAllDatabases(): void {
  if (db) {
    const main = new DatabaseWrapper(db, dbPath);
    main.save();
    db = null;
  }
  for (const [userId, userDb] of userDbs) {
    const wrapper = new DatabaseWrapper(userDb, getUserDbPath(userId));
    wrapper.save();
  }
  userDbs.clear();
}

// 初始化数据库（异步）
export async function initDatabaseAsync(): Promise<void> {
  if (db) return;

  const wasmPath = getWasmPath();

  if (!fs.existsSync(wasmPath)) {
    throw new Error('sql-wasm.wasm not found. Please ensure sql.js is installed.');
  }

  const buffer = fs.readFileSync(wasmPath);
  const wasmBinary = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  SQL = await initSqlJs({
    locateFile: (file: string) => '',
    wasmBinary
  });

  dbPath = path.join(appPath, 'moonplayer.db');

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // 初始化主表结构
  const database = new DatabaseWrapper(db!, dbPath);
  initMainTables(database);
  migrateMainDatabase(database);

  // 迁移：将旧的主库用户数据复制到用户 1 的数据库
  migrateLegacyUserData(database);

  database.save();
}

// ========== 主表（auth/global） ==========

function initMainTables(db: Database) {
  // 用户表
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // 保留旧管理员表（用于迁移兼容）
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
      expires_at INTEGER NOT NULL,
      user_id INTEGER REFERENCES users(id)
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

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip);
    CREATE INDEX IF NOT EXISTS idx_login_attempts_time ON login_attempts(attempt_at)
  `);
}

// ========== 用户数据表（每个用户独享） ==========

function initUserTables(db: Database) {
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
      date_added INTEGER NOT NULL,
      recycled INTEGER DEFAULT 0,
      recycled_at INTEGER
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
      skip_outro REAL DEFAULT 0,
      quality_mode TEXT,
      playback_speed REAL DEFAULT 1.0,
      track_sort TEXT DEFAULT 'name'
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

  // 索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tracks_path ON tracks(path);
    CREATE INDEX IF NOT EXISTS idx_tracks_recycled ON tracks(recycled);
    CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id);
    CREATE INDEX IF NOT EXISTS idx_playlist_items_type ON playlist_items(type);
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
}

// ========== 主数据库迁移（users/sessions） ==========

function migrateMainDatabase(db: Database) {
  // 迁移：从 admin 表复制数据到 users 表
  const adminTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='admin'").get();
  if (adminTableExists) {
    const adminCount = db.prepare('SELECT COUNT(*) as count FROM admin').get() as { count: number };
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    if (adminCount.count > 0 && userCount.count === 0) {
      const admin = db.prepare('SELECT * FROM admin WHERE id = 1').get() as any;
      if (admin) {
        db.prepare('INSERT INTO users (id, username, password_hash, password_salt, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          1, admin.username, admin.password_hash, admin.password_salt, 'admin', admin.created_at || Date.now(), admin.updated_at || Date.now()
        );
      }
    }
  }

  // 迁移：给 sessions 表添加 user_id
  const sessionsInfo = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
  const sessionsColumns = sessionsInfo.map(c => c.name);
  if (!sessionsColumns.includes('user_id')) {
    db.exec('ALTER TABLE sessions ADD COLUMN user_id INTEGER REFERENCES users(id)');
    db.exec("UPDATE sessions SET user_id = 1 WHERE user_id IS NULL");
  }
}

// ========== 用户数据库迁移 ==========

function migrateUserDatabase(db: Database) {
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
  if (!playlistsColumns.includes('playback_speed')) {
    db.exec('ALTER TABLE playlists ADD COLUMN playback_speed REAL DEFAULT 1.0');
  }
  if (!playlistsColumns.includes('track_sort')) {
    db.exec('ALTER TABLE playlists ADD COLUMN track_sort TEXT DEFAULT \'name\'');
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

  // 索引迁移
  db.exec('CREATE INDEX IF NOT EXISTS idx_playlist_items_type ON playlist_items(type)');

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

// ========== 迁移：从旧主库复制用户数据到用户数据库 ==========

function migrateLegacyUserData(mainDb: Database) {
  // 检查旧表是否存在
  const hasTracks = mainDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tracks'").get();
  if (!hasTracks) return;

  // 检查用户 1 的数据库是否已有数据
  const userDbPath = getUserDbPath(1);
  if (fs.existsSync(userDbPath)) {
    // 已经迁移过，直接清除旧表
    dropLegacyUserTables(mainDb);
    return;
  }

  // 创建用户 1 的数据库
  const userDb = getUserDatabase(1);

  // 复制 tracks
  const tracks = mainDb.prepare('SELECT * FROM tracks').all() as any[];
  for (const t of tracks) {
    userDb.prepare(`
      INSERT OR IGNORE INTO tracks (id, path, title, artist, album, year, tags, duration, rating, play_count, skip_count, last_played, date_added)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(t.id, t.path, t.title, t.artist, t.album, t.year, t.tags, t.duration, t.rating, t.play_count, t.skip_count, t.last_played, t.date_added);
  }

  // 复制 playlists
  const playlists = mainDb.prepare('SELECT * FROM playlists').all() as any[];
  for (const p of playlists) {
    userDb.prepare(`
      INSERT OR IGNORE INTO playlists (id, name, created_at, updated_at, is_auto, play_mode, skip_intro, skip_outro, quality_mode, playback_speed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(p.id, p.name, p.created_at, p.updated_at, p.is_auto, p.play_mode || 'sequential', p.skip_intro || 0, p.skip_outro || 0, p.quality_mode || null, p.playback_speed ?? 1.0);
  }

  // 复制 playlist_items
  const items = mainDb.prepare('SELECT * FROM playlist_items').all() as any[];
  for (const i of items) {
    userDb.prepare(`
      INSERT OR IGNORE INTO playlist_items (id, playlist_id, type, path, include_subdirs, filter_regex, filter_artist, filter_album, filter_title, match_field, match_op, match_value, "order")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(i.id, i.playlist_id, i.type, i.path, i.include_subdirs, i.filter_regex, i.filter_artist, i.filter_album, i.filter_title, i.match_field, i.match_op, i.match_value, i.order);
  }

  // 复制 playlist_tracks
  const pt = mainDb.prepare('SELECT * FROM playlist_tracks').all() as any[];
  for (const row of pt) {
    userDb.prepare(`
      INSERT OR IGNORE INTO playlist_tracks (id, playlist_id, track_id, "order")
      VALUES (?, ?, ?, ?)
    `).run(row.id, row.playlist_id, row.track_id, row.order);
  }

  // 复制 play_history
  const ph = mainDb.prepare('SELECT * FROM play_history').all() as any[];
  for (const row of ph) {
    userDb.prepare(`
      INSERT OR IGNORE INTO play_history (id, playlist_id, track_id, position, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(row.id, row.playlist_id, row.track_id, row.position, row.timestamp);
  }

  // 复制 skip_history
  const sh = mainDb.prepare('SELECT * FROM skip_history').all() as any[];
  for (const row of sh) {
    userDb.prepare(`
      INSERT OR IGNORE INTO skip_history (id, track_id, playlist_id, skip_type, position, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(row.id, row.track_id, row.playlist_id, row.skip_type, row.position, row.timestamp);
  }

  // 复制 settings
  const settings = mainDb.prepare('SELECT * FROM settings').all() as any[];
  for (const s of settings) {
    userDb.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(s.key, s.value);
  }

  // 复制 webdav_configs
  const wd = mainDb.prepare('SELECT * FROM webdav_configs').all() as any[];
  for (const row of wd) {
    userDb.prepare(`
      INSERT OR IGNORE INTO webdav_configs (id, name, url, username, password, base_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.name, row.url, row.username, row.password, row.base_path, row.created_at, row.updated_at);
  }

  // 复制 playlist_item_conditions
  const conds = mainDb.prepare('SELECT * FROM playlist_item_conditions').all() as any[];
  for (const row of conds) {
    userDb.prepare(`
      INSERT OR IGNORE INTO playlist_item_conditions (id, item_id, match_field, match_op, match_value, "order")
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(row.id, row.item_id, row.match_field, row.match_op, row.match_value, row.order);
  }

  // 复制 scan_tasks
  const tasks = mainDb.prepare('SELECT * FROM scan_tasks').all() as any[];
  for (const row of tasks) {
    userDb.prepare(`
      INSERT OR IGNORE INTO scan_tasks (id, playlist_id, task_id, status, progress, total, current_path, error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.playlist_id, row.task_id, row.status, row.progress, row.total, row.current_path, row.error, row.created_at, row.updated_at);
  }

  // 清除旧表
  dropLegacyUserTables(mainDb);
}

function dropLegacyUserTables(db: Database) {
  db.exec('DROP TABLE IF EXISTS tracks');
  db.exec('DROP TABLE IF EXISTS playlists');
  db.exec('DROP TABLE IF EXISTS playlist_items');
  db.exec('DROP TABLE IF EXISTS playlist_tracks');
  db.exec('DROP TABLE IF EXISTS play_history');
  db.exec('DROP TABLE IF EXISTS skip_history');
  db.exec('DROP TABLE IF EXISTS settings');
  db.exec('DROP TABLE IF EXISTS webdav_configs');
  db.exec('DROP TABLE IF EXISTS scan_tasks');
  db.exec('DROP TABLE IF EXISTS playlist_item_conditions');
  db.exec('DROP INDEX IF EXISTS idx_tracks_path');
  db.exec('DROP INDEX IF EXISTS idx_tracks_recycled');
  db.exec('DROP INDEX IF EXISTS idx_playlist_items_playlist');
  db.exec('DROP INDEX IF EXISTS idx_playlist_tracks_playlist');
  db.exec('DROP INDEX IF EXISTS idx_play_history_playlist');
  db.exec('DROP INDEX IF EXISTS idx_play_history_timestamp');
  db.exec('DROP INDEX IF EXISTS idx_skip_history_track');
  db.exec('DROP INDEX IF EXISTS idx_item_conditions_item');
  db.exec('DROP INDEX IF EXISTS idx_scan_tasks_playlist');
  db.exec('DROP INDEX IF EXISTS idx_scan_tasks_status');
}

// ========== 密码哈希工具 ==========

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt || crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(password, s, 100000, 64, 'sha512').toString('hex');
  return { hash, salt: s };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const result = hashPassword(password, salt);
  return result.hash === hash;
}

// ========== 用户管理函数（操作主数据库） ==========

// 检查是否需要初始化管理员
export function needsAdminSetup(): boolean {
  const database = getDatabase();
  const admin = database.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  return !admin;
}

// 初始化第一个管理员
export function setupAdmin(username: string, password: string): { success: boolean; error?: string } {
  const database = getDatabase();

  const existing = database.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  if (existing) {
    return { success: false, error: '管理员已存在' };
  }

  if (password.length < 6) {
    return { success: false, error: '密码至少需要6个字符' };
  }

  const { hash, salt } = hashPassword(password);
  const now = Date.now();

  database.prepare(`
    INSERT INTO users (username, password_hash, password_salt, role, created_at, updated_at)
    VALUES (?, ?, ?, 'admin', ?, ?)
  `).run(username, hash, salt, now, now);

  database.save();

  return { success: true };
}

// 创建用户（管理员用）
export function createUser(username: string, password: string, role: 'admin' | 'user'): { success: boolean; error?: string } {
  const database = getDatabase();

  if (password.length < 6) {
    return { success: false, error: '密码至少需要6个字符' };
  }

  const existing = database.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return { success: false, error: '用户名已存在' };
  }

  const { hash, salt } = hashPassword(password);
  const now = Date.now();

  database.prepare(`
    INSERT INTO users (username, password_hash, password_salt, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(username, hash, salt, role, now, now);

  database.save();

  return { success: true };
}

// 获取所有用户
export function listUsers(): any[] {
  const database = getDatabase();
  return database.prepare('SELECT id, username, role, created_at, updated_at FROM users ORDER BY id').all();
}

// 删除用户
export function deleteUser(id: number): { success: boolean; error?: string } {
  const database = getDatabase();

  const user = database.prepare('SELECT id FROM users WHERE id = ?').get(id) as any;
  if (!user) {
    return { success: false, error: '用户不存在' };
  }

  // 不允许删除最后一个管理员
  const adminCount = database.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get() as { count: number };
  const targetUser = database.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string };
  if (adminCount.count <= 1 && targetUser.role === 'admin') {
    return { success: false, error: '至少保留一个管理员账户' };
  }

  database.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  database.prepare('DELETE FROM users WHERE id = ?').run(id);
  database.save();

  // 删除该用户的数据库文件
  const userDbPath = getUserDbPath(id);
  if (fs.existsSync(userDbPath)) {
    try {
      fs.unlinkSync(userDbPath);
    } catch {}
  }

  return { success: true };
}

// 验证用户凭据
export function verifyUserCredentials(username: string, password: string): { success: boolean; error?: string; userId?: number; role?: string } {
  const database = getDatabase();
  const user = database.prepare('SELECT id, username, password_hash, password_salt, role FROM users WHERE username = ?').get(username) as any;

  if (!user) {
    return { success: false, error: '用户名或密码错误' };
  }

  if (!verifyPassword(password, user.password_hash, user.password_salt)) {
    return { success: false, error: '用户名或密码错误' };
  }

  return { success: true, userId: user.id, role: user.role };
}

// 验证用户密码（用于改密码）
export function verifyUserPassword(userId: number, password: string): boolean {
  const database = getDatabase();
  const user = database.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?').get(userId) as any;
  if (!user) return false;
  return verifyPassword(password, user.password_hash, user.password_salt);
}

// 修改用户密码
export function changeUserPassword(userId: number, oldPassword: string, newPassword: string): { success: boolean; error?: string } {
  const database = getDatabase();

  if (!verifyUserPassword(userId, oldPassword)) {
    return { success: false, error: '原密码错误' };
  }

  if (newPassword.length < 6) {
    return { success: false, error: '新密码至少需要6个字符' };
  }

  const { hash, salt } = hashPassword(newPassword);
  const now = Date.now();

  database.prepare(`
    UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?
  `).run(hash, salt, now, userId);

  // 使旧会话失效
  database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

  database.save();

  return { success: true };
}

// 清除所有管理员
export function clearAllAdmins(): { success: boolean; error?: string } {
  const database = getDatabase();

  database.prepare("DELETE FROM users WHERE role = 'admin'").run();
  database.prepare('DELETE FROM sessions').run();
  database.save();

  return { success: true };
}

// 创建会话（带 user_id）
export function createSession(userId: number): string {
  const database = getDatabase();
  const token = crypto.randomBytes(64).toString('hex');
  const now = Date.now();
  const expiresAt = now + 365 * 24 * 60 * 60 * 1000;

  database.prepare('INSERT INTO sessions (token, created_at, expires_at, user_id) VALUES (?, ?, ?, ?)').run(token, now, expiresAt, userId);

  database.save();

  return token;
}

// 验证会话并返回 user_id
export function validateSession(token: string): number | null {
  const database = getDatabase();
  const now = Date.now();

  const session = database.prepare('SELECT id, expires_at, user_id FROM sessions WHERE token = ?').get(token) as { id: number; expires_at: number; user_id: number } | undefined;

  if (!session) return null;
  if (session.expires_at < now) {
    database.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    database.save();
    return null;
  }

  return session.user_id;
}

// 通过会话获取用户信息
export function getUserBySession(token: string): { id: number; username: string; role: string } | null {
  const database = getDatabase();
  const userId = validateSession(token);
  if (!userId) return null;

  const user = database.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId) as any;
  return user || null;
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

// 保存数据库（后向兼容）
export function saveDatabase(): void {
  if (db) {
  const database = new DatabaseWrapper(db!, dbPath);
    database.save();
  }
}

// 关闭数据库（后向兼容）
export function closeDatabase() {
  closeAllDatabases();
}
