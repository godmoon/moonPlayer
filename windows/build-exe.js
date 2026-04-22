#!/usr/bin/env node
/**
 * moonPlayer Windows EXE 打包工具
 * 
 * 在 Windows 端运行此脚本打包成单个 EXE 文件
 * 
 * 使用方法：
 * 1. 将 server 和 web 目录复制到 Windows
 * 2. 在 server 目录运行: npm install
 * 3. 在 server 目录运行: node ../windows/build-exe.js
 */

import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(SCRIPT_DIR, '..');
const SERVER_DIR = join(PROJECT_ROOT, 'server');
const WEB_DIR = join(PROJECT_ROOT, 'web');
const OUTPUT_DIR = join(SCRIPT_DIR, 'build-exe');

console.log('=== moonPlayer Windows EXE 打包 ===\n');

// 检查是否在 Windows 上运行
if (process.platform !== 'win32') {
  console.log('[INFO] 此脚本需要在 Windows 上运行');
  console.log('[INFO] 当前平台:', process.platform);
  console.log('\n请将以下目录复制到 Windows 后运行:');
  console.log('  1. server/');
  console.log('  2. web/');
  console.log('  3. windows/build-exe.js');
  console.log('\n然后在 server 目录运行:');
  console.log('  npm install');
  console.log('  node ../windows/build-exe.js');
  process.exit(0);
}

// 1. 检查依赖
console.log('检查依赖...');
try {
  execSync('node -v', { stdio: 'inherit' });
} catch {
  console.error('[ERROR] Node.js 未安装');
  process.exit(1);
}

// 2. 构建 web frontend (必须先构建)
console.log('\n构建 web frontend...');
execSync('npm install', { cwd: WEB_DIR, stdio: 'inherit' });
execSync('npm run build', { cwd: WEB_DIR, stdio: 'inherit' });

// 3. 安装 pkg
console.log('\n安装打包工具...');
execSync('npm install @yao-pkg/pkg --save-dev', { cwd: SERVER_DIR, stdio: 'inherit' });

// 4. 构建 TypeScript
console.log('\n构建 TypeScript...');
execSync('npm run build', { cwd: SERVER_DIR, stdio: 'inherit' });

// 5. 打包 EXE
console.log('\n打包 EXE...');
execSync('npx pkg . --targets node18-win-x64 --output ../moonplayer-server.exe --compress GZip', { 
  cwd: SERVER_DIR, 
  stdio: 'inherit' 
});

// 6. 创建输出目录
console.log('\n准备发布包...');
mkdirSync(OUTPUT_DIR, { recursive: true });

// 复制 EXE
copyFileSync(join(PROJECT_ROOT, 'moonplayer-server.exe'), join(OUTPUT_DIR, 'moonplayer-server.exe'));

// 复制 WASM
copyFileSync(
  join(SERVER_DIR, 'node_modules/sql.js/dist/sql-wasm.wasm'), 
  join(OUTPUT_DIR, 'sql-wasm.wasm')
);

// 复制 web/dist
function copyDir(src: string, dest: string) {
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(src);
  for (const entry of entries) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

const webDistSrc = join(WEB_DIR, 'dist');
const webDistDest = join(OUTPUT_DIR, 'web/dist');
if (existsSync(webDistSrc)) {
  copyDir(webDistSrc, webDistDest);
}

// 7. 创建启动脚本
writeFileSync(join(OUTPUT_DIR, 'start.bat'), `@echo off
chcp 65001 >nul
cd /d "%~dp0"
title moonPlayer Server
echo.
echo ===================================
echo   moonPlayer Server
echo ===================================
echo.
echo Starting...
echo.
moonplayer-server.exe
if errorlevel 1 (
    echo.
    echo [ERROR] Start failed!
    pause
    exit /b 1
)
`);

// 8. 创建说明文件
writeFileSync(join(OUTPUT_DIR, 'README.txt'), `moonPlayer for Windows
=====================

Files:
- moonplayer-server.exe  Main program
- sql-wasm.wasm          SQLite WASM module (required)
- web/dist/              Web frontend
- start.bat              Startup script

Usage:
1. Double-click start.bat
2. Open http://localhost:3000

Config:
- Music folder: Use API POST /api/music-paths
- Database: %USERPROFILE%\\.moonplayer\\moonplayer.db
- Port: default 3000, set PORT env var to change

Requirements: None! (Node.js is bundled in EXE)
`);

console.log('\n===================================');
console.log('  打包完成！');
console.log('===================================');
console.log(`\n输出目录: ${OUTPUT_DIR}`);
console.log('\n发布文件:');
console.log('  - moonplayer-server.exe');
console.log('  - sql-wasm.wasm');
console.log('  - web/dist/');
console.log('  - start.bat');
console.log('  - README.txt');
console.log('\n用户只需双击 start.bat 即可运行，无需安装 Node.js！');