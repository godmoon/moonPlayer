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
- `src/routes/files.ts` - 文件浏览（支持 Windows/Unix 路径）
- `src/routes/playlists.ts` - 播放列表管理（含异步扫描支持）
- `src/db/schema.ts` - 数据库 Schema（sql.js）

### 前端 (web/)
- `src/stores/playerStore.ts` - 播放器状态
- `src/stores/api.ts` - API 调用封装
- `src/components/AudioPlayer/PlayerBar.tsx` - 播放器组件
- `src/components/FileBrowser/FileBrowser.tsx` - 文件浏览器
- `src/components/PlaylistManager/PlaylistDetail.tsx` - 播放列表详情（含异步扫描）
- `src/utils/format.ts` - 格式化工具（含路径处理）

### Windows 打包 (windows/)
- `build-exe.bat` - Windows EXE 打包脚本（双击运行）
- `build-exe.js` - Windows EXE 打包工具（Node.js 运行）

**注意：** 两个脚本都会先构建 web 前端（`npm run build`），确保每次打包都包含最新代码。

## 常用命令

```bash
cd server && npm run dev          # 后端开发（热重载）
cd server && npm run build        # 后端 TypeScript 编译
cd web && npm run build           # 前端构建
pm2 restart moonplayer-server     # 重启服务
```

## Windows 兼容性注意

### 路径分隔符
- Windows 使用 `\` 反斜杠，Linux/macOS 使用 `/` 正斜杠
- 后端 `schema.ts` 的 `normalizePath()` 函数统一转换为 `/`
- 前端 `format.ts` 的 `getFileName()` 和 `getParentDirName()` 同时处理 `/` 和 `\`
- **不要**用 `split('/')` 分割路径，使用 `getParentDirName()` 或 `getFileName()`

### 显示路径时
- 播放列表名称：使用 `getParentDirName(path)` 提取父目录名
- 文件列表：后端返回完整路径，前端显示时用 `getFileName()` 提取文件名
- 来源列表：使用 `getParentDirName(item.path)` 显示简短名称

### Windows 打包说明

两个脚本都会自动：
1. **构建 web 前端**（必须，否则 web 内容不更新）
2. 安装打包工具
3. 构建 TypeScript
4. 打包 EXE
5. 复制依赖文件到输出目录

#### build-exe.bat（推荐，交互式）

Windows 下双击运行，自动完成全部步骤。

#### build-exe.js（编程式）

在 `server` 目录运行：
```cmd
cd server
node ../windows/build-exe.js
```

#### 输出目录
```
windows/build-exe/
├── moonplayer-server.exe
├── sql-wasm.wasm
├── web/dist/
├── start.bat
└── README.txt
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

## 扫描播放列表（重要）

**问题：** 文件太多时，同步扫描会导致超时失败。

**解决方案：** 使用异步任务队列 + 进度反馈

### 后端实现

1. **新增表** `scan_tasks`：
   ```sql
   CREATE TABLE scan_tasks (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     playlist_id INTEGER NOT NULL,
     task_id TEXT UNIQUE NOT NULL,
     status TEXT NOT NULL CHECK(status IN ('pending', 'scanning', 'complete', 'failed')),
     progress INTEGER DEFAULT 0,
     total INTEGER DEFAULT 0,
     current_path TEXT,
     error TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
   );
   ```

2. **新 API**：
   - `POST /api/playlists/:id/refresh` - 创建扫描任务（立即返回 `task_id`）
   - `GET /api/scan/tasks/:taskId` - 查询任务状态
   - `GET /api/scan/tasks/:taskId/result` - 获取结果（完成后）

3. **支持参数**：
   - `immediate=true`：同步扫描（旧行为）
   - `immediate=false`：异步扫描（默认）

### 前端实现

- `refreshPlaylist(playlistId, immediate)` - 调用 API
- `pollScanTask(taskId)` - 轮询任务状态
- `getScanTaskResult(taskId)` - 获取结果

### UI 变化

- 重新扫描按钮显示 `🔄 重新扫描` → `🔄 扫描中...`
- 状态提示：`扫描中: XX% (XXX 首)`

## AI 开发快速参考

**关键文件:**
- `server/src/routes/stream.ts` - 音频流传输（含品质转码）
- `server/src/routes/tracks.ts` - 音轨 API
- `web/src/stores/playerStore.ts` - 播放器状态
- `web/src/components/AudioPlayer/PlayerBar.tsx` - 播放器组件

**常用命令:**
```bash
cd server && npm run build      # 后端构建
cd web && npm run build         # 前端构建
pm2 restart moonplayer-server  # 重启服务
```

**品质模式:** `low`(120k) / `medium`(192k) / `high`(320k) / `lossless`

**播放模式:** 顺序 / 随机 / 权重随机 / 乱序 / 单曲循环

**评分:** 完整听完+1分，快切-1分，手工👍👎

## License

MIT
