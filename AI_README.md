# AI_README.md - moonPlayer 项目快速参考

## 项目概述

Web 端音乐播放器，支持多种播放模式、评分系统、WebDAV 远程存储和有声书功能。

## 技术栈

- **后端**: Node.js + Fastify + sql.js (SQLite WASM)
- **前端**: React + Vite + Tailwind CSS + Zustand
- **音频**: HTML5 Audio API + Media Session API

## 关键文件

### 后端 (server/)
- `src/index.ts` - 服务入口 + 鉴权中间件 + 路径兼容处理
- `src/routes/stream.ts` - 音频流传输（含品质转码）
- `src/routes/tracks.ts` - 音轨 API + AI 标签
- `src/db/schema.ts` - 数据库 Schema（sql.js）

### 前端 (web/)
- `src/stores/playerStore.ts` - 播放器状态
- `src/components/AudioPlayer/PlayerBar.tsx` - 播放器组件

### Windows 打包 (windows/)
- `build-exe.bat` - Windows EXE 打包脚本（双击运行）

## 常用命令

```bash
cd server && npm run dev          # 后端开发（热重载）
cd server && npm run build        # 后端 TypeScript 编译
cd web && npm run build           # 前端构建
pm2 restart moonplayer-server     # 重启服务
```

## Windows 打包要点

### 1. ESM/CJS 兼容性

打包时 esbuild 用 `--define:import.meta.url=undefined` 将 ESM 转为 CJS，代码必须检查 `import.meta.url` 是有效字符串后再调用 `fileURLToPath()`：

```typescript
// 正确写法
if (typeof import.meta === 'object' && import.meta.url && typeof import.meta.url === 'string') {
  fileURLToPath(import.meta.url);  // 安全
}
```

**需要此检查的文件：**
- `server/src/index.ts`
- `server/src/routes/tracks.ts`
- `server/src/utils/runtime.ts`

### 2. FFmpeg/FFprobe 路径

Windows 上需要检测 ffmpeg/ffprobe 位置：
- 优先从 EXE 同目录加载 `ffmpeg.exe` / `ffprobe.exe`
- 其次使用系统 PATH
- 工具函数：`src/utils/ffmpeg.ts` 的 `getFfmpegPath()` / `getFfprobePath()`

### 3. WASM 文件路径

sql.js 的 WASM 文件路径由 `src/utils/runtime.ts` 的 `getWasmPath()` 处理：
- pkg 打包后内嵌路径：`/snapshot/moonPlayer/server/dist/sql-wasm.wasm`
- 外部文件：EXE 同目录的 `sql-wasm.wasm`

### 4. 发布目录结构

```
moonplayer/
├── moonplayer-server.exe  # 主程序
├── sql-wasm.wasm          # SQLite WASM（必需）
├── web/dist/              # 前端资源
├── ffmpeg.exe             # 可选，转码需要
├── ffprobe.exe            # 可选，音频信息获取
└── start.bat              # 启动脚本
```

## 数据存储

- 数据库: `~/.moonplayer/moonplayer.db`
- 缓存: `~/.moonplayer/transcode_cache/`, `~/.moonplayer/webdav_cache/`

## 品质/播放模式

- 品质: `low`(120k) / `medium`(192k) / `high`(320k) / `lossless`
- 播放: 顺序 / 随机 / 权重随机 / 乱序 / 单曲循环