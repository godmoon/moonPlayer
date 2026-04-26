// 音频流路由
import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { getDatabase, saveDatabase, normalizePath } from '../db/schema.js';
import { getFfmpegPath, getFfprobePath, checkFfmpegAvailable } from '../utils/ffmpeg.js';
import { parseFile } from 'music-metadata';
import {
  ensureCacheDir,
  needsTranscode,
  getWebdavCachePath,
  getTranscodeCachePath,
  getWebdavClient,
  getWebdavConfig,
  parseWebdavPath
} from '../utils/webdavCache.js';

// 品质模式对应的比特率
const QUALITY_BITRATES: Record<string, number> = {
  ultra_low: 32,
  very_low: 64,
  low: 128,
  medium: 192,
  high: 320,
  lossless: 0
};

// 品质模式对应的标签
const QUALITY_LABELS: Record<string, string> = {
  ultra_low: '极低',
  very_low: '超低',
  low: '低品质',
  medium: '中品质',
  high: '高品质',
  lossless: '无损'
};

export async function streamRoutes(app: FastifyInstance) {
  const db = getDatabase();

  // 流式传输音频文件，支持 Range 请求
  app.get('/api/stream/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { quality } = req.query as { quality?: string };

    // 从数据库获取音轨信息
    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(Number(id));
    if (!track) {
      return reply.code(404).send({ error: '音轨不存在' });
    }

    const filePath = (track as any).path;

    // 检查是否是 WebDAV 文件
    if (filePath.startsWith('webdav://')) {
      return await handleWebdavStream(req, reply, filePath, quality);
    }

    // 检查本地文件是否存在
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
    } catch {
      return reply.code(404).send({ error: '文件不存在' });
    }

    // 获取品质设置
    const qualityMode = quality || 'lossless';
    const targetBitrate = QUALITY_BITRATES[qualityMode] || 0;

    // 检查是否需要格式转码（浏览器不支持的格式）
    const formatNeedsTranscode = needsTranscode(filePath);
    
    // 检查是否需要品质转码
    const sourceBitrate = await getAudioBitrate(filePath);
    const qualityNeedsTranscode = targetBitrate > 0 && sourceBitrate > targetBitrate;
    
    // 确定转码类型
    const transcodeType = determineTranscodeType(formatNeedsTranscode, qualityNeedsTranscode, qualityMode);
    
    // 如果需要转码
    if (transcodeType.needsTranscode) {
      ensureCacheDir();
      
      // 生成缓存路径（包含品质标识）
      const cachePath = getQualityTranscodeCachePath(filePath, transcodeType.cacheKey);
      
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
          await transcodeWithBitrate(filePath, cachePath, transcodeType.bitrate);
        } catch (err) {
          return reply.code(500).send({ error: '转码失败' });
        }
      }
      
      // 从缓存文件流式传输
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

      reply.header('Content-Length', fileSize);
      return reply.send(fs.createReadStream(cachePath));
    }

    // 无需转码，直接传输原文件
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const mimeType = getMimeType(filePath);

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
        db.prepare('UPDATE tracks SET duration = ? WHERE id = ?').run(duration, Number(id));
        return { duration };
      }
      return reply.code(500).send({ error: '无法获取文件时长' });
    } catch (err) {
      return reply.code(500).send({ error: `获取时长失败: ${(err as Error).message}` });
    }
  });

  // 获取实际音频流比特率（考虑转码设置）
  app.get('/api/stream-bitrate/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { quality } = req.query as { quality?: string };

    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(Number(id));
    if (!track) {
      return reply.code(404).send({ error: '音轨不存在' });
    }

    const filePath = (track as any).path;
    const qualityMode = quality || 'high';

    // 从设置中获取品质配置
    const QUALITY_BITRATES: Record<string, number> = {
      ultra_low: 32,
      very_low: 64,
      low: 128,
      medium: 192,
      high: 320,
      lossless: 0
    };
    const targetBitrate = QUALITY_BITRATES[qualityMode] || 0;

    // 无损模式，获取原始文件实际比特率
    if (qualityMode === 'lossless' || targetBitrate === 0) {
      let actualBitrate = 0;
      if (filePath.startsWith('webdav://')) {
        const match = filePath.match(/^webdav:\/\/(\d+)(.+)$/);
        if (match) {
          const configId = parseInt(match[1], 10);
          const webdavPath = match[2];
          const cachePath = getWebdavCachePath(configId, webdavPath);
          if (cachePath && fs.existsSync(cachePath)) {
            actualBitrate = await getAudioBitrate(cachePath);
            return { bitrate: actualBitrate, sourceBitrate: actualBitrate, needsTranscode: false };
          }
        }
      } else {
        // 本地文件
        if (fs.existsSync(filePath)) {
          actualBitrate = await getAudioBitrate(filePath);
          return { bitrate: actualBitrate, sourceBitrate: actualBitrate, needsTranscode: false };
        }
      }
      return { bitrate: null, sourceBitrate: null, needsTranscode: false };
    }

    // 非无损模式，需要检查原始文件比特率和目标比特率
    let sourceBitrate = 0;
    if (filePath.startsWith('webdav://')) {
      const match = filePath.match(/^webdav:\/\/(\d+)(.+)$/);
      if (match) {
        const configId = parseInt(match[1], 10);
        const webdavPath = match[2];
        // 先尝试从缓存获取
        const cachePath = getWebdavCachePath(configId, webdavPath);
        if (cachePath && fs.existsSync(cachePath)) {
          sourceBitrate = await getAudioBitrate(cachePath);
        }
        // 如果缓存不存在或获取失败，下载到临时文件获取原始比特率
        if (sourceBitrate === 0) {
          try {
            const config = getWebdavConfig(configId);
            if (config) {
              const client = getWebdavClient(config.url, config.username || undefined, config.password || undefined);
              const tempPath = path.join(os.tmpdir(), `moonplayer_temp_${Date.now()}.mp3`);
              await client.downloadFile(webdavPath, tempPath);
              if (fs.existsSync(tempPath)) {
                sourceBitrate = await getAudioBitrate(tempPath);
                fs.unlinkSync(tempPath);
              }
            }
          } catch (e) {
            console.error('获取WebDAV文件比特率失败:', e);
          }
        }
      }
    } else {
      if (fs.existsSync(filePath)) {
        sourceBitrate = await getAudioBitrate(filePath);
      }
    }

    // 如果原始比特率高于目标比特率，返回转码后的比特率
    if (sourceBitrate > targetBitrate) {
      return { bitrate: targetBitrate, sourceBitrate, needsTranscode: true };
    }

    // 否则返回原始比特率（如果获取不到返回null）
    return { bitrate: sourceBitrate || null, sourceBitrate: sourceBitrate || null, needsTranscode: false };
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

// 确定转码类型
function determineTranscodeType(formatNeedsTranscode: boolean, qualityNeedsTranscode: boolean, qualityMode: string): {
  needsTranscode: boolean;
  bitrate: number;
  cacheKey: string;
  qualityLabel: string | null;
} {
  // 优先显示品质标签
  if (qualityNeedsTranscode) {
    return {
      needsTranscode: true,
      bitrate: QUALITY_BITRATES[qualityMode] || 192,
      cacheKey: `quality_${qualityMode}`,
      qualityLabel: QUALITY_LABELS[qualityMode] || null
    };
  }
  
  // 格式转码（浏览器不支持）
  if (formatNeedsTranscode) {
    return {
      needsTranscode: true,
      bitrate: 192, // 格式转码使用默认 192kbps
      cacheKey: 'format',
      qualityLabel: null // 不显示品质标签，前端会显示 [转码]
    };
  }
  
  // 无需转码
  return {
    needsTranscode: false,
    bitrate: 0,
    cacheKey: '',
    qualityLabel: null
  };
}

// 获取带品质标识的转码缓存路径
function getQualityTranscodeCachePath(sourcePath: string, cacheKey: string): string {
  const hash = crypto.createHash('md5').update(`${cacheKey}:${sourcePath}`).digest('hex');
  return path.join(os.homedir(), '.moonplayer', 'transcode_cache', `${hash}.mp3`);
}

// 获取音频文件比特率
async function getAudioBitrate(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const ffprobe = spawn(getFfprobePath(), [
      '-v', 'quiet',
      '-show_entries', 'format=bit_rate',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ]);
    
    let output = '';
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    ffprobe.on('close', (code) => {
      if (code === 0) {
        const bitrate = parseInt(output.trim(), 10);
        if (!isNaN(bitrate) && bitrate > 0) {
          resolve(bitrate / 1000); // 转换为 kbps
          return;
        }
      }
      resolve(999999); // 无法获取时假设是高比特率
    });
    
    ffprobe.on('error', () => resolve(999999));
  });
}

// 带比特率的转码
function transcodeWithBitrate(filePath: string, outputPath: string, bitrate: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', filePath,
      '-f', 'mp3',
      '-ab', `${bitrate}k`,
      '-vn',
      '-y',
      outputPath
    ];
    
    const ffmpeg = spawn(getFfmpegPath(), args);
    
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

// 获取本地文件时长
async function getLocalFileDuration(filePath: string): Promise<number | null> {
  try {
    const metadata = await parseFile(filePath);
    if (metadata.format.duration) {
      return metadata.format.duration;
    }
  } catch {}
  
  return await getDurationViaFfprobe(filePath);
}

// 使用 ffprobe 获取时长
async function getDurationViaFfprobe(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const ffprobe = spawn(getFfprobePath(), [
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

// 获取 WebDAV 文件时长
async function getWebdavFileDuration(configId: number, filePath: string): Promise<number | null> {
  try {
    const config = getWebdavConfig(configId);
    if (!config) return null;
    
    const client = getWebdavClient(config.url, config.username || undefined, config.password || undefined);
    
    const stat = await client.stat(filePath) as any;
    if (stat?.duration) {
      return stat.duration;
    }
    
    const size = stat?.size || 0;
    const chunkSize = Math.min(512 * 1024, size);
    const buffer = await client.getFileContents(filePath, {
      format: 'buffer',
      start: 0,
      length: chunkSize
    });
    
    const { parseBuffer } = await import('music-metadata');
    const metadata = await parseBuffer(buffer as Buffer, { mimeType: getMimeType(filePath) });
    if (metadata.format.duration) {
      return metadata.format.duration;
    }
    
    return await getWebdavDurationViaDownload(configId, filePath);
  } catch (err) {
    console.error('获取 WebDAV 文件时长失败:', err);
    return null;
  }
}

// 下载 WebDAV 文件并用 ffprobe 获取时长
async function getWebdavDurationViaDownload(configId: number, filePath: string): Promise<number | null> {
  return new Promise(async (resolve) => {
    try {
      const config = getWebdavConfig(configId);
      if (!config) {
        resolve(null);
        return;
      }
      
      const client = getWebdavClient(config.url, config.username || undefined, config.password || undefined);
      const stream = await client.createReadStream(filePath);
      
      const ffprobe = spawn(getFfprobePath(), [
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

// 处理 WebDAV 文件流（支持 Range 请求和品质转码）
async function handleWebdavStream(req: any, reply: any, filePath: string, quality?: string) {
  const parsed = parseWebdavPath(filePath);
  if (!parsed) {
    return reply.code(400).send({ error: '无效的 WebDAV 路径格式' });
  }
  
  const { configId, webdavPath } = parsed;
  const config = getWebdavConfig(configId);
  if (!config) {
    return reply.code(404).send({ error: 'WebDAV 配置不存在' });
  }
  
  try {
    const client = getWebdavClient(config.url, config.username || undefined, config.password || undefined);
    
    ensureCacheDir();
    const cachePath = getWebdavCachePath(configId, webdavPath);
    
    // 获取远程文件信息
    const stat = await client.stat(webdavPath) as any;
    const remoteSize = stat?.size || 0;
    
    // 检查缓存是否存在且有效
    let useCache = false;
    if (fs.existsSync(cachePath)) {
      try {
        const cacheStat = fs.statSync(cachePath);
        if (cacheStat.size === remoteSize) {
          useCache = true;
        }
      } catch {}
    }
    
    // 如果没有有效缓存，下载文件
    if (!useCache) {
      const buffer = await client.getFileContents(webdavPath, { format: 'buffer' }) as Buffer;
      fs.writeFileSync(cachePath, buffer);
    }
    
    // 获取品质设置
    const qualityMode = quality || 'lossless';
    const targetBitrate = QUALITY_BITRATES[qualityMode] || 0;
    
    // 检查是否需要格式转码
    const formatNeedsTranscode = needsTranscode(webdavPath);
    
    // 检查是否需要品质转码
    const sourceBitrate = await getAudioBitrate(cachePath);
    const qualityNeedsTranscode = targetBitrate > 0 && sourceBitrate > targetBitrate;
    
    // 确定转码类型
    const transcodeType = determineTranscodeType(formatNeedsTranscode, qualityNeedsTranscode, qualityMode);
    
    let finalCachePath = cachePath;
    let mimeType = getMimeType(webdavPath);
    
    if (transcodeType.needsTranscode) {
      // 需要转码
      const transcodeCachePath = getQualityTranscodeCachePath(webdavPath, `webdav:${configId}:${transcodeType.cacheKey}`);
      
      let useTranscodeCache = false;
      if (fs.existsSync(transcodeCachePath)) {
        try {
          const sourceStat = fs.statSync(cachePath);
          const transcodeStat = fs.statSync(transcodeCachePath);
          if (transcodeStat.mtime > sourceStat.mtime) {
            useTranscodeCache = true;
          }
        } catch {}
      }
      
      if (!useTranscodeCache) {
        await transcodeWithBitrate(cachePath, transcodeCachePath, transcodeType.bitrate);
      }
      
      finalCachePath = transcodeCachePath;
      mimeType = 'audio/mpeg';
      
    }
    
    // 从缓存文件流式传输
    const fileStat = fs.statSync(finalCachePath);
    const fileSize = fileStat.size;
    
    reply.header('Content-Type', mimeType);
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

      const stream = fs.createReadStream(finalCachePath, { start, end });
      return reply.send(stream);
    }
    
    reply.header('Content-Length', fileSize);
    return reply.send(fs.createReadStream(finalCachePath));
  } catch (err) {
    return reply.code(500).send({ error: `获取 WebDAV 文件失败: ${(err as Error).message}` });
  }
}