// WebDAV 文件缓存管理
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { createClient } from 'webdav';
import { getDatabase } from '../db/schema.js';

// WebDAV 客户端缓存
const webdavClients = new Map<string, any>();

// 缓存目录
const WEBDAV_CACHE_DIR = path.join(os.homedir(), '.moonplayer', 'webdav_cache');
const TRANSCODE_CACHE_DIR = path.join(os.homedir(), '.moonplayer', 'transcode_cache');

// 需要 FFmpeg 支持的格式（默认值，可被前端检测结果覆盖）
// 现代浏览器普遍支持 FLAC/WAV/AAC，只有 WMA/APE 基本需要转码
const DEFAULT_NEEDS_TRANSCODE = ['.wma', '.ape'];

// 运行时可被前端检测结果更新
let NEEDS_TRANSCODE = [...DEFAULT_NEEDS_TRANSCODE];

// 根据前端检测结果更新需要转码的格式列表
export function updateTranscodeFormats(browserSupport: {
  flac?: boolean;
  wav?: boolean;
  aac?: boolean;
  m4a?: boolean;
  ogg?: boolean;
  mp3?: boolean;
  wma?: boolean;
  ape?: boolean;
}): void {
  const needs: string[] = [];
  
  // 前端不支持的格式需要转码
  if (!browserSupport.flac) needs.push('.flac');
  if (!browserSupport.wav) needs.push('.wav');
  if (!browserSupport.aac) needs.push('.aac');
  if (!browserSupport.m4a) needs.push('.m4a');
  if (!browserSupport.ogg) needs.push('.ogg');
  if (!browserSupport.mp3) needs.push('.mp3');
  if (!browserSupport.wma) needs.push('.wma');
  if (!browserSupport.ape) needs.push('.ape');
  
  NEEDS_TRANSCODE = needs.length > 0 ? needs : [...DEFAULT_NEEDS_TRANSCODE];
  console.log('[moonPlayer] 更新转码格式列表:', NEEDS_TRANSCODE);
}

// 确保缓存目录存在
export function ensureCacheDir() {
  if (!fs.existsSync(WEBDAV_CACHE_DIR)) {
    fs.mkdirSync(WEBDAV_CACHE_DIR, { recursive: true });
  }
  if (!fs.existsSync(TRANSCODE_CACHE_DIR)) {
    fs.mkdirSync(TRANSCODE_CACHE_DIR, { recursive: true });
  }
}

// 获取 WebDAV 客户端
export function getWebdavClient(url: string, username?: string, password?: string) {
  const key = `${url}|${username || ''}`;
  
  if (!webdavClients.has(key)) {
    const client = createClient(url, {
      username,
      password
    });
    webdavClients.set(key, client);
  }
  
  return webdavClients.get(key)!;
}

// 获取 WebDAV 缓存文件路径
export function getWebdavCachePath(configId: number, filePath: string): string {
  const hash = crypto.createHash('md5').update(`${configId}:${filePath}`).digest('hex');
  const ext = path.extname(filePath);
  return path.join(WEBDAV_CACHE_DIR, `${hash}${ext}`);
}

// 获取转码缓存路径
export function getTranscodeCachePath(sourcePath: string, prefix = ''): string {
  const hash = crypto.createHash('md5').update(`${prefix}${sourcePath}`).digest('hex');
  return path.join(TRANSCODE_CACHE_DIR, `${hash}.mp3`);
}

// 检查是否需要转码
export function needsTranscode(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return NEEDS_TRANSCODE.includes(ext);
}

// WebDAV 配置缓存
const webdavConfigCache = new Map<number, any>();

// 获取 WebDAV 配置
export function getWebdavConfig(configId: number): any | null {
  if (webdavConfigCache.has(configId)) {
    return webdavConfigCache.get(configId);
  }
  
  const db = getDatabase();
  const config = db.prepare('SELECT * FROM webdav_configs WHERE id = ?').get(configId) as any;
  if (config) {
    webdavConfigCache.set(configId, config);
  }
  return config;
}

// 下载 WebDAV 文件到缓存（返回缓存路径和 Buffer）
export async function downloadWebdavFile(configId: number, filePath: string): Promise<{
  cachePath: string;
  buffer: Buffer;
  needsTranscode: boolean;
  transcodeCachePath?: string;
} | null> {
  const config = getWebdavConfig(configId);
  if (!config) return null;
  
  ensureCacheDir();
  
  const cachePath = getWebdavCachePath(configId, filePath);
  const ext = path.extname(filePath).toLowerCase();
  const shouldTranscode = NEEDS_TRANSCODE.includes(ext);
  const transcodeCachePath = shouldTranscode ? getTranscodeCachePath(filePath, `webdav:${configId}:`) : undefined;
  
  const client = getWebdavClient(config.url, config.username || undefined, config.password || undefined);
  
  try {
    // 获取远程文件信息
    const stat = await client.stat(filePath) as any;
    const remoteSize = stat?.size || 0;
    
    // 检查转码缓存是否有效
    if (shouldTranscode && transcodeCachePath && fs.existsSync(transcodeCachePath)) {
      try {
        const cacheStat = fs.statSync(transcodeCachePath);
        // 转码缓存存在且较新，直接返回（不需要重新读取 Buffer）
        if (cacheStat.size > 0) {
          return {
            cachePath: transcodeCachePath,
            buffer: Buffer.alloc(0), // 已经有转码缓存，不需要原始 Buffer
            needsTranscode: true,
            transcodeCachePath
          };
        }
      } catch {}
    }
    
    // 检查原始缓存是否有效
    let buffer: Buffer | null = null;
    let useCache = false;
    
    if (fs.existsSync(cachePath)) {
      try {
        const cacheStat = fs.statSync(cachePath);
        if (cacheStat.size === remoteSize) {
          useCache = true;
          buffer = fs.readFileSync(cachePath);
        }
      } catch {}
    }
    
    // 如果没有有效缓存，下载文件
    if (!buffer) {
      buffer = await client.getFileContents(filePath, { format: 'buffer' }) as Buffer;
      fs.writeFileSync(cachePath, buffer);
    }
    
    return {
      cachePath: shouldTranscode ? cachePath : cachePath,
      buffer,
      needsTranscode: shouldTranscode,
      transcodeCachePath
    };
  } catch (err) {
    console.error(`下载 WebDAV 文件失败 ${filePath}:`, err);
    return null;
  }
}

// 从缓存路径解析 WebDAV 配置 ID 和路径
export function parseWebdavPath(filePath: string): { configId: number; webdavPath: string } | null {
  const match = filePath.match(/^webdav:\/\/(\d+)(.+)$/);
  if (!match) return null;
  return {
    configId: parseInt(match[1], 10),
    webdavPath: match[2]
  };
}