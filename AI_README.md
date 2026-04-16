# moonPlayer AI 开发指南

> 此文件供 AI 助手快速了解项目架构，以便下次会话快速上手。

## 项目概述

moonPlayer 是一个 Web 端音乐播放器，支持多种播放模式、评分系统、播放列表管理和 WebDAV 远程存储。

## 技术栈

- **后端**: Node.js + Fastify + SQLite (better-sqlite3)
- **前端**: React + Vite + Tailwind CSS + Zustand
- **音频**: HTML5 Audio API + Media Session API

## 项目结构

```
moonPlayer/
├── server/                    # 后端服务
│   ├── src/
│   │   ├── index.ts          # 服务入口 + 鉴权中间件
│   │   ├── cli.ts            # 命令行工具 (clear-admin)
│   │   ├── routes/           # API 路由
│   │   │   ├── auth.ts       # 鉴权路由
│   │   │   ├── files.ts      # 文件浏览
│   │   │   ├── stream.ts     # 音频流传输
│   │   │   ├── playlists.ts  # 播放列表管理
│   │   │   ├── tracks.ts     # 音轨管理 + AI 标签
│   │   │   ├── history.ts    # 播放历史
│   │   │   ├── skip.ts       # 片头片尾跳过
│   │   │   ├── webdav.ts     # WebDAV 支持
│   │   │   └── settings.ts   # 导航排序设置
│   │   └── db/
│   │       └── schema.ts     # 数据库 Schema
│   └── ecosystem.config.json # PM2 配置
│
├── web/                       # 前端应用
│   └── src/
│       ├── components/        # UI 组件
│       │   ├── PlaylistManager/  # 播放列表管理（拆分）
│       │   │   ├── PlaylistManager.tsx
│       │   │   ├── PlaylistDetail.tsx
│       │   │   ├── AddSourceModal.tsx
│       │   │   ├── AITaggerModal.tsx
│       │   │   └── utils.ts
│       │   ├── FileBrowser/      # 文件浏览器（拆分）
│       │   │   ├── FileBrowser.tsx
│       │   │   ├── AddToPlaylistModal.tsx
│       │   │   └── utils.ts
│       │   ├── AudioPlayer/      # 播放器（拆分）
│       │   │   ├── PlayerBar.tsx
│       │   │   ├── SleepTimerModal.tsx
│       │   │   └── utils.ts
│       │   ├── App.tsx           # 主应用
│       │   ├── Sidebar.tsx       # 侧边栏
│       │   ├── Settings.tsx      # 设置页
│       │   ├── HistoryView.tsx   # 历史记录
│       │   ├── RatingManager.tsx # 评分管理
│       │   └── ...
│       └── stores/
│           ├── api.ts           # API 请求封装
│           └── playerStore.ts   # 播放器状态 (Zustand)
│
└── shared/                    # 共享类型定义
    └── types.ts
```

## 数据库

- **位置**: `~/.moonplayer/moonplayer.db`
- **表**: `playlists`, `playlist_items`, `tracks`, `history`, `admin`, `sessions`, `settings`

## 开发命令

```bash
# 后端开发
cd server && npm run dev

# 前端开发
cd web && npm run dev

# 生产部署
cd web && npm run build
cd ../server && pm2 start ecosystem.config.json
```

## 环境变量

| 变量         | 默认值         | 说明                            |
| ---------- | ----------- | ----------------------------- |
| `PORT`     | 3000        | 监听端口                          |
| `HOST`     | 0.0.0.0     | 监听地址                          |
| `NODE_ENV` | development | 运行模式 (production 启用安全 Cookie) |

## 常见修改场景

### 添加新的 API 端点

1. 在 `server/src/routes/` 创建或修改路由文件
2. 在 `server/src/index.ts` 中注册路由

### 添加前端组件

1. 在 `web/src/components/` 创建组件
2. 大组件拆分为子目录，每个文件 <10KB
3. 导出放在 `index.ts`

### 添加数据库表

在 `server/src/db/schema.ts` 的 `initDatabase()` 中添加

## 注意事项

1. **Cookie 安全**: 生产环境启用 Secure 标志
2. **会话清理**: 每小时自动清理过期会话
3. **数据库**: 使用 WAL 模式
4. **前端构建**: 修改后需 `npm run build`