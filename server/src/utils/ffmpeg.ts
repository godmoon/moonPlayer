// FFmpeg/FFprobe 路径工具函数
// 处理 Windows 上 ffmpeg/ffprobe 的路径检测

import { spawn, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

let ffmpegPath: string | null = null;
let ffprobePath: string | null = null;
let pathChecked = false;

/**
 * 检测并返回 ffmpeg 可执行文件路径
 * 检测顺序：
 * 1. EXE 同目录的 ffmpeg.exe (Windows) 或 ffmpeg (Unix)
 * 2. 系统 PATH 中的 ffmpeg
 */
export function getFfmpegPath(): string {
  if (ffmpegPath !== null) {
    return ffmpegPath;
  }

  // Windows 平台
  if (process.platform === 'win32') {
    // 1. 检查 EXE 同目录
    const exeDir = getExeDir();
    if (exeDir) {
      const localPath = path.join(exeDir, 'ffmpeg.exe');
      if (fs.existsSync(localPath)) {
        ffmpegPath = localPath;
        return ffmpegPath;
      }
    }
    
    // 2. 使用系统 PATH
    // 在 Windows 上，直接使用 'ffmpeg' 会自动搜索 PATH
    ffmpegPath = 'ffmpeg';
    return ffmpegPath;
  }

  // Unix 平台（Linux/macOS）
  // 直接使用系统 PATH
  ffmpegPath = 'ffmpeg';
  return ffmpegPath;
}

/**
 * 检测并返回 ffprobe 可执行文件路径
 * 检测顺序同 getFfmpegPath()
 */
export function getFfprobePath(): string {
  if (ffprobePath !== null) {
    return ffprobePath;
  }

  // Windows 平台
  if (process.platform === 'win32') {
    // 1. 检查 EXE 同目录
    const exeDir = getExeDir();
    if (exeDir) {
      const localPath = path.join(exeDir, 'ffprobe.exe');
      if (fs.existsSync(localPath)) {
        ffprobePath = localPath;
        return ffprobePath;
      }
    }
    
    // 2. 使用系统 PATH
    ffprobePath = 'ffprobe';
    return ffprobePath;
  }

  // Unix 平台
  ffprobePath = 'ffprobe';
  return ffprobePath;
}

/**
 * 获取 EXE 所在目录
 * 支持 pkg 打包环境和普通 Node.js 环境
 */
function getExeDir(): string | null {
  // pkg 打包环境
  if ((process as any).pkg) {
    return path.dirname(process.execPath);
  }
  
  // 普通 Node.js 环境
  // 返回 null，让调用者使用默认 PATH
  return null;
}

/**
 * 检查 ffmpeg 是否可用
 * 首次调用时会检测并缓存结果
 */
export function checkFfmpegAvailable(): boolean {
  if (pathChecked) {
    return ffmpegPath !== null && ffprobePath !== null;
  }
  
  pathChecked = true;
  
  try {
    // 尝试获取 ffmpeg 版本
    const result = spawnSync(getFfmpegPath(), ['-version'], {
      timeout: 5000,
      encoding: 'utf-8'
    });
    
    if (result.status !== 0) {
      console.warn('[moonPlayer] ffmpeg 不可用，转码功能将受限');
      return false;
    }
    
    // 也检查 ffprobe
    const probeResult = spawnSync(getFfprobePath(), ['-version'], {
      timeout: 5000,
      encoding: 'utf-8'
    });
    
    if (probeResult.status !== 0) {
      console.warn('[moonPlayer] ffprobe 不可用，音频信息获取将受限');
      return false;
    }
    
    console.log('[moonPlayer] ffmpeg/ffprobe 已就绪');
    return true;
  } catch (err) {
    console.warn('[moonPlayer] ffmpeg 检测失败:', (err as Error).message);
    return false;
  }
}

/**
 * 创建 ffmpeg 进程（使用正确的路径）
 */
export function spawnFfmpeg(args: string[]): ReturnType<typeof spawn> {
  return spawn(getFfmpegPath(), args);
}

/**
 * 创建 ffprobe 进程（使用正确的路径）
 */
export function spawnFfprobe(args: string[]): ReturnType<typeof spawn> {
  return spawn(getFfprobePath(), args);
}