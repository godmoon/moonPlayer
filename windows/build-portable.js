#!/usr/bin/env node
/**
 * moonPlayer Windows 便携版打包工具
 * 
 * 从项目根目录运行：node windows/build-portable.js
 * 生成包含 server + web 的 Windows 便携版 ZIP 包
 * 
 * 注意：使用 sql.js（纯 JS），无需安装原生模块！
 */

import { existsSync, mkdirSync, cpSync, writeFileSync, rmSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(SCRIPT_DIR, '..');
const BUILD_DIR = join(SCRIPT_DIR, 'build');
const SERVER_DIR = join(PROJECT_ROOT, 'server');
const WEB_DIR = join(PROJECT_ROOT, 'web');
const DIST_NAME = 'moonplayer-win';

console.log('=== moonPlayer Windows 便携版打包 ===\n');

// 清理
if (existsSync(BUILD_DIR)) {
  rmSync(BUILD_DIR, { recursive: true });
}
mkdirSync(join(BUILD_DIR, DIST_NAME), { recursive: true });

const distDir = join(BUILD_DIR, DIST_NAME);

// 1. 复制编译后的 server 代码
console.log('复制 Server 编译结果...');
if (!existsSync(join(SERVER_DIR, 'dist'))) {
  console.error('[ERROR] server/dist 不存在，请先运行: cd server && npm run build');
  process.exit(1);
}
cpSync(join(SERVER_DIR, 'dist'), join(distDir, 'server/dist'), { recursive: true });

// 2. 复制 web 构建结果
console.log('复制 Web 构建结果...');
if (!existsSync(join(WEB_DIR, 'dist'))) {
  console.error('[ERROR] web/dist 不存在，请先运行: cd web && npm run build');
  process.exit(1);
}
cpSync(join(WEB_DIR, 'dist'), join(distDir, 'web/dist'), { recursive: true });

// 3. 复制 node_modules
console.log('复制依赖...');
cpSync(join(SERVER_DIR, 'node_modules'), join(distDir, 'server/node_modules'), { recursive: true });

// 4. 复制 package 文件
copyFileSync(join(SERVER_DIR, 'package.json'), join(distDir, 'server/package.json'));
if (existsSync(join(SERVER_DIR, 'package-lock.json'))) {
  copyFileSync(join(SERVER_DIR, 'package-lock.json'), join(distDir, 'server/package-lock.json'));
}

// 5. 创建启动脚本
console.log('创建启动脚本...');
writeFileSync(join(distDir, 'start.bat'), `@echo off
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
cd server
node dist\\index.js
if errorlevel 1 (
    echo.
    echo [ERROR] Start failed!
    echo Check Node.js is installed (version >= 18)
    pause
    exit /b 1
)
`);

// 6. 创建说明文件
writeFileSync(join(distDir, 'README.txt'), `moonPlayer for Windows
=====================

Requirements:
- Node.js >= 18
  Download: https://nodejs.org/
  Check "Add to PATH" during install

Install Steps:
1. Install Node.js (check "Add to PATH")
2. Extract this folder
3. Double-click start.bat to run

Usage:
1. Run start.bat
2. Open http://localhost:3000

Config:
- Music folder: POST /api/music-paths
- Database: %USERPROFILE%\\.moonplayer\\moonplayer.db
- Port: default 3000, set PORT env var to change

Note: This version uses sql.js (pure JavaScript SQLite),
no native compilation needed!

Troubleshooting:
Q: start.bat failed?
A: Check Node.js is installed (node --version)

Q: Port in use?
A: Create start-8080.bat:
   set PORT=8080
   call start.bat
`);

// 7. 创建 PM2 配置（可选，用于服务化部署）
writeFileSync(join(distDir, 'server/ecosystem.config.js'), `module.exports = {
  apps: [{
    name: 'moonplayer-server',
    script: 'dist/index.js',
    cwd: __dirname,
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
`);

console.log('\n构建完成！');
console.log(`输出目录: ${distDir}`);
console.log('\n使用方法:');
console.log('1. 复制 windows/build 文件夹到 Windows');
console.log('2. 双击 start.bat 启动（需要 Node.js >= 18）');
console.log('\n如需创建压缩包:');
console.log(`  cd "${BUILD_DIR}"`);
console.log(`  zip -r ${DIST_NAME}.zip ${DIST_NAME}`);