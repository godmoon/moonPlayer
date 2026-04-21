// 运行时环境检测和路径工具
// 兼容 ESM、CJS、pkg 打包环境

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

let _dirname: string | null = null;

/**
 * 获取当前文件所在目录
 * 兼容 pkg 打包、ESM、CJS 环境
 */
export function getDirname(): string {
  if (_dirname) return _dirname;
  
  // pkg 打包环境
  if ((process as any).pkg) {
    _dirname = path.dirname(process.execPath);
    return _dirname;
  }
  
  // ESM 环境
  // 使用 dynamic import 检测
  try {
    // @ts-ignore
    if (typeof import.meta === 'object' && import.meta.url && typeof import.meta.url === 'string') {
      // @ts-ignore
      let filename = fileURLToPath(import.meta.url);
      // Windows 路径处理
      if (process.platform === 'win32' && filename.startsWith('/')) {
        filename = filename.substring(1);
      }
      _dirname = path.dirname(filename);
      return _dirname;
    }
  } catch {}
  
  // CJS 环境（esbuild 打包后）- __dirname 应该存在
  // @ts-ignore
  if (typeof __dirname === 'string') {
    // @ts-ignore
    _dirname = __dirname;
    return _dirname;
  }
  
  // 兜底：当前工作目录
  _dirname = process.cwd();
  return _dirname;
}

/**
 * 获取应用根目录（server 目录）
 */
export function getAppRoot(): string {
  let dir = getDirname();
  
  // pkg 打包环境：直接返回 exe 所在目录
  if ((process as any).pkg) {
    return dir;
  }
  
  // 向上查找直到找到 package.json 或到达文件系统根目录
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  // 如果在 dist/ 目录下，返回上一级
  if (dir.endsWith('dist') || dir.endsWith('dist' + path.sep)) {
    return path.dirname(dir);
  }
  return dir;
}

/**
 * 获取 WASM 文件路径
 */
export function getWasmPath(): string {
  // pkg 打包环境
  if ((process as any).pkg) {
    // 优先从 exe 同目录加载（外部文件）
    const exeDir = path.dirname(process.execPath);
    const externalWasm = path.join(exeDir, 'sql-wasm.wasm');
    if (fs.existsSync(externalWasm)) {
      return externalWasm;
    }
    // pkg 内嵌路径（assets 配置的 dist/sql-wasm.wasm）
    const snapshotPath = '/snapshot/moonPlayer/server/dist/sql-wasm.wasm';
    if (fs.existsSync(snapshotPath)) {
      return snapshotPath;
    }
    // 返回外部路径（让程序报错显示具体路径）
    return externalWasm;
  }
  
  const root = getAppRoot();
  const possiblePaths = [
    // 开发环境 node_modules/
    path.join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    // 开发环境上级目录
    path.join(root, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    // dist 目录（构建后）
    path.join(root, 'dist', 'sql-wasm.wasm'),
  ];
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  
  // 返回默认路径
  return path.join(root, 'sql-wasm.wasm');
}