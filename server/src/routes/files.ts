// 文件浏览路由
import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { getDatabase, saveDatabase, normalizePath } from '../db/schema.js';

export async function filesRoutes(app: FastifyInstance) {
  const db = getDatabase();

  // 获取配置的音乐目录列表
  app.get('/api/music-paths', async () => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('music_paths') as { value: string } | undefined;
    const paths = row?.value ? row.value.split('|').filter(Boolean) : ['/mnt/music/'];
    return { paths };
  });

  // 设置音乐目录列表
  app.post('/api/music-paths', async (req, reply) => {
    const { paths } = req.body as { paths: string[] };
    if (!paths || !Array.isArray(paths)) {
      return reply.code(400).send({ error: 'paths 必须是数组' });
    }
    
    // 验证每个目录存在
    for (const p of paths) {
      try {
        const stat = fs.statSync(p);
        if (!stat.isDirectory()) {
          return reply.code(400).send({ error: `${p} 不是目录` });
        }
      } catch {
        return reply.code(400).send({ error: `${p} 不存在` });
      }
    }
    
    const value = paths.filter(Boolean).join('|');
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('music_paths', value);
    return { success: true, paths };
  });

  // 获取根目录列表（多路径）
  app.get('/api/roots', async () => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('music_paths') as { value: string } | undefined;
    const paths = row?.value ? row.value.split('|').filter(Boolean) : ['/mnt/music/'];
    const roots = paths.map((p: string) => ({
      name: p.split('/').filter(Boolean).pop() || p,
      path: p
    }));
    return { roots };
  });

  // 浏览目录
  app.get('/api/browse', async (req, reply) => {
    const { dir } = req.query as { dir?: string };

    // 获取音乐根目录列表
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('music_paths') as { value: string } | undefined;
    const rootPaths = row?.value ? row.value.split('|').filter(Boolean) : ['/mnt/music/'];

    // 如果没有指定目录，返回根目录列表
    if (!dir) {
      const roots = rootPaths.map((p: string) => {
        const name = p.split('/').filter(Boolean).pop() || p;
        try {
          const stat = fs.statSync(p);
          return {
            name,
            path: p,
            isDirectory: true,
            valid: stat.isDirectory()
          };
        } catch {
          return { name, path: p, isDirectory: true, valid: false };
        }
      });
      return {
        currentPath: '',
        rootPath: '',
        parentPath: null,
        directories: roots.filter((r: any) => r.valid),
        files: [],
        isRootsView: true
      };
    }

    const targetPath = dir;

    // 安全检查：确保在某个音乐目录内
    const resolvedPath = path.resolve(targetPath);
    const normalizedResolved = normalizePath(resolvedPath);
    const isInAllowedPath = rootPaths.some((rp: string) => {
      const resolvedRoot = normalizePath(path.resolve(rp));
      return normalizedResolved.startsWith(resolvedRoot) || normalizedResolved === resolvedRoot;
    });
    
    if (!isInAllowedPath) {
      return reply.code(403).send({ error: '无权访问此目录' });
    }

    // 找到当前路径所属的根目录
    const currentRoot = rootPaths.find((rp: string) => {
      const resolvedRoot = normalizePath(path.resolve(rp));
      return normalizedResolved.startsWith(resolvedRoot);
    }) || rootPaths[0];

    try {
      const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });

      // 分离目录和文件
      const directories = entries
        .filter(e => e.isDirectory())
        .map(e => ({
          name: e.name,
          path: path.join(resolvedPath, e.name),
          isDirectory: true
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const files = entries
        .filter(e => e.isFile())
        .filter(e => /\.(mp3|flac|wav|ogg|m4a|aac|wma|ape)$/i.test(e.name))
        .map(e => ({
          name: e.name,
          path: path.join(resolvedPath, e.name),
          isDirectory: false
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      // 判断是否在根目录
      const resolvedRoot = normalizePath(path.resolve(currentRoot));
      const normalizedCurrent = normalizePath(resolvedPath);
      const parentPath = normalizedCurrent !== resolvedRoot ? path.dirname(resolvedPath) : null;

      return {
        currentPath: resolvedPath,
        rootPath: resolvedRoot,
        parentPath,
        directories,
        files,
        isRootsView: false
      };
    } catch (err) {
      return reply.code(500).send({ error: '读取目录失败' });
    }
  });

  // 扫描目录获取所有音轨
  app.get('/api/scan', async (req, reply) => {
    const { dir, recursive = 'true' } = req.query as { dir?: string; recursive?: string };

    if (!dir) {
      return reply.code(400).send({ error: '缺少目录参数' });
    }

    const resolvedPath = path.resolve(dir);
    const isRecursive = recursive === 'true';
    const audioExtensions = /\.(mp3|flac|wav|ogg|m4a|aac|wma|ape)$/i;

    const tracks: string[] = [];

    function scanDirectory(dirPath: string) {
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          if (entry.isDirectory() && isRecursive) {
            scanDirectory(fullPath);
          } else if (entry.isFile() && audioExtensions.test(entry.name)) {
            tracks.push(fullPath);
          }
        }
      } catch {
        // 忽略无法访问的目录
      }
    }

    scanDirectory(resolvedPath);

    return {
      path: resolvedPath,
      recursive: isRecursive,
      count: tracks.length,
      tracks
    };
  });
}