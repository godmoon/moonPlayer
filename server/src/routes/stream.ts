// 音频流路由
import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { getDatabase } from '../db/schema.js';
import { parseFile } from 'music-metadata';
import { createClient } from 'webdav';

// 需要 FFmpeg 支持的格式
const NEEDS_TRANSCODE = ['.wma', '.ape', '.flac', '.wav', '.aac'];
const TRANSCODE_FORMAT = '.mp3';

// 转码缓存目录
const TRANSCODE_CACHE_DIR = path.join(os.homedir(), '.moonplayer', 'transcode_cache');

// 确保缓存目录存在
function ensureCacheDir() {
  if (!fs.existsSync(TRANSCODE_CACHE_DIR)) {
    fs.mkdirSync(TRANSCODE_CACHE_DIR, { recursive: true });
  }
}

// 获取缓存文件路径
function getCachePath(filePath: string): string {
  const hash = crypto.createHash('md5').update(filePath).digest('hex');
  return path.join(TRANSCODE_CACHE_DIR, `${hash}.mp3`);
}

export async function streamRoutes(app: FastifyInstance) {
  const db = getDatabase();

  // 流式传输音频文件，支持 Range 请求
  app.get('/api/stream/:id', async (req, reply) => {
    const { id } = req.params as { id: string };

    // 从数据库获取音轨信息
    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(Number(id));
    if (!track) {
      return reply.code(404).send({ error: '音轨不存在' });
    }

    const filePath = (track as any).path;

    // 检查文件是否存在
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
    } catch {
      return reply.code(404).send({ error: '文件不存在' });
    }

    // 检查是否需要转码（浏览器不支持的格式）
    if (needsTranscode(filePath)) {
      ensureCacheDir();
      const cachePath = getCachePath(filePath);
      
      // 检查缓存是否存在且有效
      let useCache = false;
      if (fs.existsSync(cachePath)) {
        try {
          const sourceStat = fs.statSync(filePath);
          const cacheStat = fs.statSync(cachePath);
          // 缓存比源文件新，使用缓存
          if (cacheStat.mtime > sourceStat.mtime) {
            useCache = true;
          }
        } catch {}
      }
      
      // 如果没有有效缓存，执行转码
      if (!useCache) {
        try {
          await transcodeToFile(filePath, cachePath);
        } catch (err) {
          return reply.code(500).send({ error: '转码失败' });
        }
      }
      
      // 现在从缓存文件流式传输（支持完整 Range）
      const stat = fs.statSync(cachePath);
      const fileSize = stat.size;
      
      reply.header('Content-Type', 'audio/mpeg');
      reply.header('Accept-Ranges', 'bytes');
      
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        reply.code(206);
        reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        reply.header('Content-Length', chunkSize);

        const stream = fs.createReadStream(cachePath, { start, end });
        return reply.send(stream);
      }

      // 非 Range 请求，发送整个文件
      reply.header('Content-Length', fileSize);
      return reply.send(fs.createReadStream(cachePath));
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const mimeType = getMimeType(filePath);

    // 处理 Range 请求
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      reply.code(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Content-Length', chunkSize);
      reply.header('Content-Type', mimeType);

      const stream = fs.createReadStream(filePath, { start, end });
      return reply.send(stream);
    }

    // 非 Range 请求，发送整个文件
    reply.header('Content-Length', fileSize);
    reply.header('Content-Type', mimeType);
    reply.header('Accept-Ranges', 'bytes');

    return reply.send(fs.createReadStream(filePath));
  });

  // 获取音频时长 API
  app.get('/api/duration/:id', async (req, reply) => {
    const { id } = req.params as { id: string };

    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(Number(id));
    if (!track) {
      return reply.code(404).send({ error: '音轨不存在' });
    }

    // 如果数据库已有时长，直接返回
    if ((track as any).duration) {
      return { duration: (track as any).duration };
    }

    // 否则获取文件时长
    const filePath = (track as any).path;
    
    // 检查是否是 WebDAV 文件
    if (filePath.startsWith('webdav://')) {
      const match = filePath.match(/^webdav:\/\/(\d+)(.+)$/);
      if (match) {
        const configId = parseInt(match[1], 10);
        const webdavPath = match[2];
        const duration = await getWebdavFileDuration(configId, webdavPath);
        
        if (duration) {
          // 更新数据库
          db.prepare('UPDATE tracks SET duration = ? WHERE id = ?').run(duration, Number(id));
          return { duration };
        }
        return reply.code(500).send({ error: '无法获取 WebDAV 文件时长' });
      }
    }
    
    // 本地文件
    try {
      const duration = await getLocalFileDuration(filePath);
      if (duration) {
        // 更新数据库
        db.prepare('UPDATE tracks SET duration = ? WHERE id = ?').run(duration, Number(id));
        return { duration };
      }
      return reply.code(500).send({ error: '无法获取文件时长' });
    } catch (err) {
      return reply.code(500).send({ error: `获取时长失败: ${(err as Error).message}` });
    }
  });

  // 通过路径直接流式传输（用于未扫描的文件）
  app.get('/api/stream-path', async (req, reply) => {
    const { path: filePath } = req.query as { path?: string };

    if (!filePath) {
      return reply.code(400).send({ error: '缺少路径参数' });
    }

    // 安全检查：确保路径在音乐目录内
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('music_path') as { value: string } | undefined;
    const rootPath = row?.value || '/mnt/music/';

    const resolvedPath = path.resolve(filePath);
    const resolvedRoot = path.resolve(rootPath);

    if (!resolvedPath.startsWith(resolvedRoot)) {
      return reply.code(403).send({ error: '无权访问此文件' });
    }

    // 检查文件是否存在
    try {
      fs.accessSync(resolvedPath, fs.constants.R_OK);
    } catch {
      return reply.code(404).send({ error: '文件不存在' });
    }

    const stat = fs.statSync(resolvedPath);
    const fileSize = stat.size;
    const mimeType = getMimeType(resolvedPath);

    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      reply.code(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Content-Length', chunkSize);
      reply.header('Content-Type', mimeType);

      const stream = fs.createReadStream(resolvedPath, { start, end });
      return reply.send(stream);
    }

    reply.header('Content-Length', fileSize);
    reply.header('Content-Type', mimeType);
    reply.header('Accept-Ranges', 'bytes');

    return reply.send(fs.createReadStream(resolvedPath));
  });
}

// 获取文件时长（用于转码流的 Range 支持）
// 已弃用，改用缓存文件方案
// async function getFileDuration(filePath: string): Promise<number | null> {
//   return getDurationViaFfprobe(filePath);
// }

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.wma': 'audio/x-ms-wma',
    '.ape': 'audio/x-ape'
  };
  return mimeTypes[ext] || 'audio/mpeg';
}

// 检查是否需要转码
function needsTranscode(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return NEEDS_TRANSCODE.includes(ext);
}

// 转码到文件（缓存）
function transcodeToFile(filePath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', filePath,
      '-f', 'mp3',
      '-ab', '192k',
      '-vn',
      '-y', // 覆盖已存在文件
      outputPath
    ];
    
    const ffmpeg = spawn('ffmpeg', args);
    
    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg 转码失败 (code ${code}): ${stderr}`));
      }
    });
    
    ffmpeg.on('error', (err) => {
      reject(new Error(`FFmpeg 启动失败: ${err.message}`));
    });
  });
}

// 使用 FFmpeg 转码流（保留用于流式转码场景）
function transcodeStream(filePath: string, start?: number): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', filePath,
      '-f', 'mp3',
      '-ab', '192k',
      '-vn', // 不包含视频
    ];
    
    if (start) {
      args.push('-ss', String(start / 1000)); // 跳转到指定位置
    }
    
    args.push('-'); // 输出到 stdout
    
    const ffmpeg = spawn('ffmpeg', args);
    
    ffmpeg.on('error', (err) => {
      reject(new Error(`FFmpeg 启动失败: ${err.message}`));
    });
    
    // 等待 FFmpeg 开始输出
    setTimeout(() => {
      resolve(ffmpeg.stdout);
    }, 100);
  });
}

// WebDAV 客户端缓存
const webdavClients = new Map<string, any>();

function getWebdavClient(url: string, username?: string, password?: string) {
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

// 获取本地文件时长
async function getLocalFileDuration(filePath: string): Promise<number | null> {
  try {
    // 先尝试 music-metadata
    const metadata = await parseFile(filePath);
    if (metadata.format.duration) {
      return metadata.format.duration;
    }
  } catch {}
  
  // 备用：使用 ffprobe
  return await getDurationViaFfprobe(filePath);
}

// 使用 ffprobe 获取时长
async function getDurationViaFfprobe(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ]);
    
    let output = '';
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    ffprobe.on('close', (code) => {
      if (code === 0) {
        const duration = parseFloat(output.trim());
        if (!isNaN(duration)) {
          resolve(duration);
          return;
        }
      }
      resolve(null);
    });
    
    ffprobe.on('error', () => resolve(null));
  });
}

// WebDAV 客户端缓存（复用 webdav.ts 中的逻辑）
const webdavClientsCache = new Map<string, any>();

async function getWebdavClientCached(configId: number): Promise<any> {
  const db = getDatabase();
  const config = db.prepare('SELECT * FROM webdav_configs WHERE id = ?').get(configId) as any;
  if (!config) return null;
  
  const key = String(configId);
  if (!webdavClientsCache.has(key)) {
    const client = createClient(config.url, {
      username: config.username || undefined,
      password: config.password || undefined
    });
    webdavClientsCache.set(key, client);
  }
  
  return webdavClientsCache.get(key);
}

// 获取 WebDAV 文件时长
async function getWebdavFileDuration(configId: number, filePath: string): Promise<number | null> {
  try {
    const client = await getWebdavClientCached(configId);
    if (!client) return null;
    
    // 下载文件头部并用 ffprobe 解析
    // 先尝试获取文件属性（部分 WebDAV 服务器可能返回时长）
    const stat = await client.stat(filePath) as any;
    if (stat?.duration) {
      return stat.duration;
    }
    
    // 获取文件大小
    const size = stat?.size || 0;
    
    // 下载前 512KB 用于分析
    const chunkSize = Math.min(512 * 1024, size);
    const buffer = await client.getFileContents(filePath, {
      format: 'buffer',
      start: 0,
      length: chunkSize
    });
    
    // 使用 music-metadata 解析 Buffer
    const metadata = await parseBuffer(buffer as Buffer, { mimeType: getMimeType(filePath) });
    if (metadata.format.duration) {
      return metadata.format.duration;
    }
    
    // 无法从部分数据获取时长，需要完整下载
    // 对于 WebDAV，先下载到临时文件再用 ffprobe
    return await getWebdavDurationViaDownload(configId, filePath);
  } catch (err) {
    console.error('获取 WebDAV 文件时长失败:', err);
    return null;
  }
}

// 解析 Buffer 的音频元数据

async function parseBuffer(buffer: Buffer, options?: { mimeType?: string }): Promise<any> {
  try {
    const { parseBuffer } = await import('music-metadata');
    return await parseBuffer(buffer, options?.mimeType ? { mimeType: options.mimeType } : {});
  } catch {
    return { format: {} };
  }
}

// 下载 WebDAV 文件并用 ffprobe 获取时长
async function getWebdavDurationViaDownload(configId: number, filePath: string): Promise<number | null> {
  return new Promise(async (resolve) => {
    try {
      const client = await getWebdavClientCached(configId);
      if (!client) {
        resolve(null);
        return;
      }
      
      // 创建临时管道
      const stream = await client.createReadStream(filePath);
      
      const ffprobe = spawn('ffprobe', [
        '-v', 'quiet',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        '-i', 'pipe:0'
      ]);
      
      stream.pipe(ffprobe.stdin);
      
      let output = '';
      ffprobe.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      ffprobe.on('close', (code) => {
        if (code === 0) {
          const duration = parseFloat(output.trim());
          if (!isNaN(duration)) {
            resolve(duration);
            return;
          }
        }
        resolve(null);
      });
      
      ffprobe.on('error', () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}