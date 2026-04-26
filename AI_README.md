# AI_README.md - moonPlayer 项目快速参考

## 项目概述
Web 端音乐播放器，支持多种播放模式、评分系统、WebDAV 远程存储和有声书功能。

## 技术栈
- **后端**: Node.js + Fastify + sql.js (SQLite WASM)
- **前端**: React + Vite + Tailwind CSS + Zustand
- **音频**: HTML5 Audio API + Media Session API

## 关键文件

### 后端 (server/)
| 文件 | 说明 |
| ---- | ---- |
| `src/index.ts` | 服务入口 + 鉴权中间件 |
| `src/routes/stream.ts` | 音频流传输（含品质转码） |
| `src/routes/tracks.ts` | 音轨 API + AI 标签 |
| `src/routes/files.ts` | 文件浏览 |
| `src/routes/playlists.ts` | 播放列表管理（含异步扫描） |
| `src/db/schema.ts` | 数据库 Schema |
| `src/utils/runtime.ts` | WASM 路径处理（pkg 打包兼容） |

### 前端 (web/)
| 文件 | 说明 |
| ---- | ---- |
| `src/stores/playerStore.ts` | 播放器状态 (Zustand) |
| `src/stores/api.ts` | API 调用封装 |
| `src/components/AudioPlayer/PlayerBar.tsx` | 播放器（含车机多击控制、Media Session、页面可见性处理） |
| `src/components/PlaylistManager/PlaylistDetail.tsx` | 播放列表详情 |
| `src/utils/nativeBridge.ts` | Android/iOS WebView 桥接（注册音频元素获取函数） |
| `src/utils/format.ts` | 路径/文件名处理（兼容 Windows/Unix） |

## 常用命令
```bash
cd server && npm run build # 后端构建
cd web && npm run build    # 前端构建
pm2 restart moonplayer-server # 重启服务
```

## 功能要点

### 播放模式
顺序 / 随机 / 权重随机 / 乱序 / 单曲循环

### 品质模式
`low`(120k) / `medium`(192k) / `high`(320k) / `lossless`

### 评分机制
完整听完+1分，快切-1分，手工👍👎

### 车机模式
- 检测 `navigator.userAgent` 匹配 `car|lixiang|auto|vehicle`
- 单击播放、双击下一曲、三击上一曲
- 播放和暂停共用同一个按钮（切换状态），避免 `onPlay`/`onPause` 死循环

### Android/iOS 通知栏控制
- `nativeBridge.ts` 提供 `MoonPlayerBridge` 接口给原生 App 调用
- `PlayerBar.tsx` 注册音频元素获取函数，解决 WebView 中 `document.querySelector('audio')` 失效问题
- 页面可见性变化时同步状态，后台唤醒后自动恢复播放状态
- Media Session handler 在关键依赖变化时重新绑定

### 异步扫描
- `POST /api/playlists/:id/refresh` 创建扫描任务
- `GET /api/scan/tasks/:taskId` 查询状态
- `GET /api/scan/tasks/:taskId/result` 获取结果

### 有声书
- 片头/片尾跳过（手动设置 + 自动学习）
- 从上次位置继续播放

## 数据存储
- 数据库: `~/.moonplayer/moonplayer.db`
- 缓存: `~/.moonplayer/transcode_cache/`, `~/.moonplayer/webdav_cache/`

## Windows 兼容性
- 路径分隔符统一转换为 `/`（后端 `normalizePath()`，前端 `format.ts`）
- WASM 路径：pkg 打包后内嵌 `/snapshot/...`，外部文件使用 EXE 同目录
- esbuild 打包使用 `--define:import.meta.url=undefined`