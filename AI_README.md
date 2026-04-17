# moonPlayer AI 开发指南

> 此文件供 AI 助手快速了解项目架构，以便下次会话快速上手。

## 项目概述

Web 端音乐播放器，支持多种播放模式、评分系统、播放列表管理、WebDAV 远程存储和搜索功能。

## 技术栈

- **后端**: Node.js + Fastify + SQLite (better-sqlite3)
- **前端**: React + Vite + Tailwind CSS + Zustand
- **音频**: HTML5 Audio API + Media Session API

## 核心功能

### 侧边栏导航（可拖拽排序）
- 浏览：本地文件浏览器
- 列表：播放列表管理（整合了历史记录和当前播放功能）
- 搜索：模糊搜索（支持拼音/首字母）
- 评分：评分管理
- 设置：系统设置

### 播放器特性
- 页面标题跟随当前播放歌曲变化（切换歌曲时自动更新）
- Media Session API 支持系统媒体控制
- 睡眠定时器（一次性/重复）

### 播放模式
`sequential`(顺序) | `shuffle`(随机) | `weighted`(权重随机) | `random`(乱序) | `single-loop`(单曲循环)

### 搜索功能
- 支持 title/artist/album/path 四字段搜索
- 前端支持拼音首字母模糊匹配
- 点击搜索结果：自动创建父目录播放列表并播放

### 播放逻辑（浏览/搜索共用）
点击文件 → 扫描入库 → 查找/创建父目录播放列表 → 设置当前播放列表 → 播放目标曲目

### 多格式原生支持
- 前端使用 `canPlayType()` 检测浏览器支持的格式
- 启动时将检测结果发送给后端 (`/api/settings/format-support`)
- 后端根据检测结果决定是否转码：支持的格式直接流式传输，不支持的格式（如 WMA/APE）才转码
- 现代浏览器普遍支持 FLAC/WAV/AAC/M4A/OGG/MP3
- 只有 WMA/APE 等少数格式需要转码

## 开发命令

```bash
# 后端开发
cd server && npm run dev

# 前端开发
cd web && npm run dev

# 生产部署
cd web && npm run build
cd ../server && pm2 restart moonplayer-server
```

## 关键文件

- `server/src/routes/stream.ts` - 音频流传输（含转码逻辑）
- `server/src/routes/tracks.ts` - 音轨 API（含搜索）
- `server/src/routes/playlists.ts` - 播放列表 API
- `server/src/routes/settings.ts` - 设置 API（含格式支持接收）
- `server/src/utils/webdavCache.ts` - 转码判断逻辑（`needsTranscode`）
- `web/src/utils/formatSupport.ts` - 浏览器格式检测（`canPlayType`）
- `web/src/components/AudioPlayer/PlayerBar.tsx` - 播放器组件
- `web/src/components/Sidebar.tsx` - 侧边栏组件
- `web/src/components/SearchView.tsx` - 搜索组件
- `web/src/components/FileBrowser/FileBrowser.tsx` - 文件浏览器

## 数据库

位置: `~/.moonplayer/moonplayer.db`

主要表: `playlists`, `playlist_items`, `playlist_tracks`, `tracks`, `play_history`, `skip_history`

## 注意事项

1. 前端修改后需构建：`cd web && npm run build`
2. 后端修改需重启：`pm2 restart moonplayer-server`
3. 格式支持检测在 App.tsx 启动时自动执行