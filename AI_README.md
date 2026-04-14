# moonPlayer AI 开发指南

> 此文件供 AI 助手快速了解项目，以便下次会话能快速上手开发。

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
│   │   ├── routes/
│   │   │   ├── auth.ts       # 鉴权路由 (登录/设置/改密码)
│   │   │   ├── files.ts      # 文件浏览
│   │   │   ├── stream.ts     # 音频流传输
│   │   │   ├── playlists.ts  # 播放列表管理
│   │   │   ├── tracks.ts     # 音轨管理
│   │   │   ├── history.ts    # 播放历史
│   │   │   ├── skip.ts       # 片头片尾跳过
│   │   │   └── webdav.ts     # WebDAV 支持
│   │   ├── db/
│   │   │   └── schema.ts     # 数据库 Schema + 鉴权相关函数
│   │   └── utils/
│   │       └── path.ts       # 路径工具
│   ├── package.json
│   └── ecosystem.config.json # PM2 配置
│
├── web/                       # 前端应用
│   ├── src/
│   │   ├── components/
│   │   │   ├── App.tsx       # 主应用 + 鉴权状态检查
│   │   │   ├── Login.tsx     # 登录页面
│   │   │   ├── Setup.tsx     # 初始化设置页面
│   │   │   ├── Settings.tsx  # 设置页 (含修改密码)
│   │   │   ├── Sidebar.tsx   # 侧边栏导航
│   │   │   ├── FileBrowser.tsx
│   │   │   ├── PlaylistManager.tsx
│   │   │   ├── AudioPlayer.tsx
│   │   │   └── ...           # 其他组件
│   │   └── stores/
│   │       ├── api.ts        # API 请求封装
│   │       └── playerStore.ts # 播放器状态 (Zustand)
│   ├── package.json
│   └── vite.config.ts
│
├── shared/                    # 共享类型定义
│   └── types.ts
│
├── README.md                  # 用户文档
├── AUTH.md                    # 鉴权功能说明
└── AI_README.md               # 本文件
```

## 关键功能实现

### 鉴权系统 (2026-04-14 新增)

- **数据库表**: `admin` (管理员), `sessions` (会话), `login_attempts` (防暴力)
- **密码加密**: PBKDF2 + SHA-512, 100,000 次迭代
- **会话有效期**: 1 年 (Cookie: `moonplayer_session`)
- **防暴力破解**: 失败次数递增等待时间 (最高 3600 秒)
- **API 端点**: `/api/auth/*` (status, setup, login, logout, check, change-password)
- **中间件**: `index.ts` 中的 `onRequest` hook 检查所有非公开路径
- **公开路径**: `/api/auth/*`, `/api/health`, 静态资源

### 命令行工具

```bash
cd /path/to/moonPlayer/server
npm run cli clear-admin    # 清除管理员密码（不删除数据）
```

## 开发命令

```bash
# 后端开发
cd server
npm install
npm run dev      # 开发模式 (热重载)
npm run build    # 编译 TypeScript
npm start        # 生产模式运行

# 前端开发
cd web
npm install
npm run dev      # 开发服务器
npm run build    # 构建生产版本

# 生产部署
cd server
pm2 start ecosystem.config.json
pm2 logs moonplayer-server
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3000 | 监听端口 |
| `HOST` | 0.0.0.0 | 监听地址 |
| `NODE_ENV` | development | 运行模式 (production 启用安全 Cookie) |

## 数据存储

- 数据库: `~/.moonplayer/moonplayer.db`
- 日志: `~/.moonplayer/logs/`

## API 概览

### 鉴权 (无需认证)

- `GET /api/auth/status` - 检查是否需要初始化
- `POST /api/auth/setup` - 初始化管理员
- `POST /api/auth/login` - 登录
- `GET /api/auth/check` - 检查登录状态

### 鉴权 (需要认证)

- `POST /api/auth/logout` - 登出
- `GET /api/auth/me` - 获取当前用户
- `POST /api/auth/change-password` - 修改密码
- 所有其他 API 端点

### 文件浏览

- `GET /api/roots` - 获取音乐根目录列表
- `GET /api/browse?dir=` - 浏览目录
- `GET /api/music-paths` - 获取/设置音乐目录

### 播放列表

- `GET/POST /api/playlists` - 播放列表 CRUD
- `POST /api/playlists/:id/refresh` - 刷新音轨列表

### 音轨

- `GET /api/stream/:id` - 流式播放
- `PUT /api/tracks/:id/rating` - 更新评分
- `POST /api/tracks/:id/play` - 记录播放

## 常见修改场景

### 添加新的 API 端点

1. 在 `server/src/routes/` 创建或修改路由文件
2. 在 `server/src/index.ts` 中注册路由
3. 如果需要认证，确保不在 `PUBLIC_PATHS` 中

### 添加新的数据库表

1. 在 `server/src/db/schema.ts` 的 `initDatabase()` 中添加表
2. 如有需要，在 `migrateDatabase()` 中添加迁移逻辑

### 添加前端页面

1. 在 `web/src/components/` 创建组件
2. 在 `web/src/App.tsx` 中添加路由逻辑
3. 如需认证保护，组件会自动被 App.tsx 的鉴权检查保护

## 注意事项

1. **Cookie 安全**: 生产环境 (`NODE_ENV=production`) 启用 Secure 标志
2. **密码强度**: 最少 6 个字符
3. **会话清理**: 每小时自动清理过期会话
4. **数据库**: 使用 WAL 模式提升并发性能
5. **静态资源**: 前端构建后放在 `web/dist/`，后端自动服务

## 最近更新

### 2026-04-14: WebDAV 文件播放支持进度条拖动

- **问题**: WebDAV 路径下播放的文件不支持拖动进度条
- **原因**: WebDAV stream 接口直接返回流，没有处理 HTTP Range 请求
- **解决方案**:
  - 首次播放时将 WebDAV 文件下载到本地缓存 `~/.moonplayer/webdav_cache/`
  - 后续播放直接流式传输缓存文件，支持完整 Range 请求
  - 缓存文件以 `configId:filePath` 的 MD5 命名
  - 修改 `server/src/routes/webdav.ts` 的 `/api/webdav/:id/stream` 接口
  - 修改 `server/src/routes/stream.ts` 新增 `handleWebdavStream` 函数
  - `/api/stream/:id` 接口现在也能正确处理 `webdav://` 开头的路径
  - WebDAV 文件也支持转码（FLAC/WMA/APE 等格式转 MP3）

### 2026-04-14: 历史记录恢复播放位置（修复）

- **问题**: 从历史记录选择播放列表时，切换播放列表后播放位置恢复不稳定，大部分情况从头播放
- **原因**: 
  - 使用 `useRef` 存储 pendingSeekPosition，React 组件重渲染时可能出问题
  - `react-h5-audio-player` 的 `onLoadedMetaData` 事件触发时机不确定
  - 切换音轨时全局状态可能被其他事件覆盖
- **解决方案**:
  - 使用模块级变量 `globalPendingSeekPosition` 存储待恢复位置，不依赖 React ref
  - 导出 `setPendingSeekPosition()` 函数供 HistoryView 直接调用
  - 同时保存 `globalPendingSeekTrackId` 用于调试（实际逻辑中跳过检查）
  - 新增 `onCanPlay` 事件作为备用恢复时机
  - `handleLoadedMetadata` 和 `handleCanPlay` 都调用 `consumePendingSeekPosition(0)` 跳过 trackId 检查
  - 异步获取时长时也尝试恢复位置

### 2026-04-14: 导航栏拖拽排序

- **功能**: Web 端左侧导航栏支持上下拖动排序，默认打开网页时进入排第一的导航
- **实现**:
  - 后端新增 `settings` 表的 `nav_order` 字段存储导航顺序
  - 后端新增路由文件 `server/src/routes/settings.ts`
    - `GET /api/settings/nav-order` 获取导航顺序
    - `PUT /api/settings/nav-order` 设置导航顺序
  - 前端修改 `Sidebar.tsx`，使用 HTML5 Drag and Drop API 实现拖拽排序
  - 前端修改 `App.tsx`，登录后从后端获取导航顺序，默认激活第一项
  - 前端新增 `api.ts` 的 `getNavOrder()` 和 `setNavOrder()` 函数

### 2026-04-14: 播放列表目录来源支持修改子目录设置

- **功能**: 在播放列表来源列表中，目录类型的来源右侧显示"包含子目录"勾选框
- **实现**:
  - 后端新增 `PUT /api/playlists/:id/items/:itemId` 接口，支持更新 `include_subdirs` 字段
  - 前端修改来源列表，目录来源从只读显示改为可编辑的勾选框
  - 变更后自动触发重新扫描

### 2026-04-14: FLAC/WMA/APE 等格式播放修复

- **问题**: FLAC 等浏览器不支持的格式在播放器中不显示总时长，进度条无法拖动
- **原因**: 转码流直接输出 MP3，不支持 HTTP Range 请求
- **解决方案**: 实现转码缓存机制
  - 首次播放时将 FLAC/WMA/APE/WAV/AAC 转码为 MP3 缓存到 `~/.moonplayer/transcode_cache/`
  - 后续播放直接流式传输缓存文件，支持完整 Range 请求
  - 缓存文件以源文件路径 MD5 命名，源文件更新后自动重新转码
  - 使用 192kbps MP3 作为转码格式
- **新增文件**: `os` 和 `crypto` 模块用于缓存路径和文件名处理
- **新增函数**: `ensureCacheDir()`, `getCachePath()`, `transcodeToFile()`

### 2026-04-14: 移动端适配优化

- **侧边栏 (Sidebar)**: 移动端 (<768px) 默认收起，响应式调整内边距和字体大小
- **播放器 (AudioPlayer)**: 移动端竖屏布局重构
  - 高度从 24 增加到 28 (h-28)
  - 桌面端保持原单行布局 (md:flex)
  - 移动端改为三行布局：
    - 第一行：曲目信息 + 快捷控制按钮 (快退/快进/删除/收藏)
    - 第二行：播放器进度条
    - 第三行：播放模式 + 评分按钮
  - 使用 Tailwind 的 `md:` 前缀实现响应式切换

### 2026-04-14: 鉴权系统 + Cookie 修复

- 新增管理员账户系统
- 新增登录/登出功能
- 新增密码修改功能
- 新增防暴力破解机制
- 新增命令行清除密码工具
- 前端添加 Login/Setup 组件
- 所有 API 添加鉴权保护
- **修复**: 前端 axios 和 fetch 添加 `credentials: 'include'`，后端 CORS 添加 `credentials: true`
  - 原因：跨域请求默认不发送 Cookie，需要显式启用
  - 影响：登录成功后请求仍然返回 401 的问题已修复

## 常见问题排查

### 登录后请求仍返回 401

检查点：
1. 前端所有 fetch 和 axios 请求必须设置 `credentials: 'include'`
2. 后端 CORS 配置必须包含 `credentials: true`
3. Cookie 的 sameSite 属性设为 'lax'（允许同站和顶级导航）

### 音乐目录设置失败

- 目录必须真实存在且可访问
- 路径格式：`/mnt/music/` 或 `/mnt/music` 都可以
- 存储位置：数据库 `settings` 表的 `music_paths` 键（多个路径用 `|` 分隔）

---

*此文件由 AI 助手维护，用于快速了解项目结构。如需更详细说明，请阅读 README.md 和 AUTH.md。*