// 路径工具函数
import path from 'path';
import os from 'os';

// 获取应用数据目录
export function getAppPath(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.moonplayer');
}

export const appPath = getAppPath();

// 确保目录存在
import fs from 'fs';

export function ensureAppDir(): void {
  if (!fs.existsSync(appPath)) {
    fs.mkdirSync(appPath, { recursive: true });
  }
}

// 规范化路径
export function normalizePath(p: string): string {
  return path.resolve(p);
}