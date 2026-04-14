# moonPlayer 🎵

Web 端音乐播放器，支持多种播放模式和评分系统。

## 功能特性

### 播放控制

- ✅ 5种播放模式：顺序、随机、权重随机、乱序、单曲循环
- ✅ 跳转功能：递增跳转（5→10→30→60→120秒）
- ✅ 硬件快捷键：支持键盘媒体键和系统控制中心
- ✅ 删除并播放下一曲

### 播放列表

- ✅ 文件浏览器：浏览本地音乐目录
- ✅ 播放列表管理：创建、编辑、删除
- ✅ 目录播放：扫描整个目录并播放
- ✅ 播放列表属性：默认播放模式、片头片尾跳过设置

### 评分系统

- ✅ 自动评分：完整听完 +1分，快切扣分
- ✅ 手工评分：👍👎按钮
- ✅ 批量评分：设置评分、重置评分
- ✅ 低分歌曲管理：查看和批量删除

### 有声书功能

- ✅ 片头跳过：手动设置或自动学习
- ✅ 片尾跳过：自动检测并跳过
- ✅ 继续播放：从上次位置恢复

### 历史记录

- ✅ 最近播放列表
- ✅ 一键继续播放

### WebDAV 支持

- ✅ 连接远程存储
- ✅ 浏览远程目录
- ✅ 流式播放远程文件

## 技术栈

**后端：** Node.js + Fastify + SQLite (better-sqlite3)
**前端：** React + Vite + Tailwind CSS + Zustand
**音频：** HTML5 Audio API + Media Session API

## 项目结构

```
moonPlayer/
├── server/                    # 后端服务
│   ├── src/
│   │   ├── index.ts          # 服务入口
│   │   ├── routes/           # API 路由模块
│   │   │   ├── files.ts      # 文件浏览
│   │   │   ├── stream.ts     # 音频流传输
│   │   │   ├── playlists.ts  # 播放列表管理
│   │   │   ├── tracks.ts     # 音轨管理
│   │   │   ├── history.ts    # 播放历史
│   │   │   ├── skip.ts       # 片头片尾跳过
│   │   │   └── webdav.ts     # WebDAV 支持
│   │   ├── db/
│   │   │   └── schema.ts     # 数据库 Schema
│   │   └── utils/
│   │       └── path.ts       # 路径工具
│   ├── package.json
│   ├── tsconfig.json
│   └── ecosystem.config.json # PM2 配置
│
├── web/                       # 前端应用
│   ├── src/
│   │   ├── components/       # UI 组件
│   │   ├── stores/           # Zustand 状态
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts
│
├── shared/                    # 共享类型定义
│   └── types.ts
│
├── README.md                  # 本文件
├── DEPLOY.md                  # 部署说明（简版）
├── TASKS.md                   # 开发任务记录
└── TODO.md                    # 待办事项
```

## 快速开始

### 安装依赖

```bash
# 后端
cd server && npm install

# 前端
cd ../web && npm install && npm run build
```

### 开发模式

```bash
# 后端（热重载）
cd server && npm run dev

# 前端（开发服务器）
cd web && npm run dev
```

### 生产部署

```bash
# 构建前端
cd web && npm run build

# 启动后端（PM2）
cd ../server
mkdir -p ~/.moonplayer/logs
pm2 start ecosystem.config.json

# 开机自启
pm2 startup && pm2 save
```

访问：http://localhost:3000

## 系统要求

| 依赖      | 版本    | 说明                  |
| ------- | ----- | ------------------- |
| Node.js | >= 18 | 运行环境                |
| FFmpeg  | 可选    | 转码 WMA/APE/FLAC 等格式 |

## 配置

### 环境变量

| 变量         | 默认值         | 说明   |
| ---------- | ----------- | ---- |
| `PORT`     | 3000        | 监听端口 |
| `HOST`     | 0.0.0.0     | 监听地址 |
| `NODE_ENV` | development | 运行模式 |

### 音乐目录

默认：`/mnt/music/`

```bash
# 设置多个音乐目录
curl -X POST http://localhost:3000/api/music-paths \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/mnt/music/", "/mnt/audiobooks/"]}'
```

### 数据存储

- 数据库：`~/.moonplayer/moonplayer.db`
- 日志：`~/.moonplayer/logs/`

## API 概览

### 文件浏览

```
GET  /api/roots            # 获取音乐根目录列表
GET  /api/browse?dir=      # 浏览目录
GET  /api/scan?dir=        # 扫描目录音轨
GET  /api/music-paths      # 获取/设置音乐目录
POST /api/music-paths
```

### 播放列表

```
GET    /api/playlists              # 获取所有播放列表
POST   /api/playlists              # 创建播放列表
PUT    /api/playlists/:id          # 更新播放列表
DELETE /api/playlists/:id          # 删除播放列表
POST   /api/playlists/:id/refresh  # 刷新音轨列表
GET    /api/playlists/:id/tracks   # 获取音轨列表
```

### 音轨

```
GET  /api/stream/:id          # 流式播放
GET  /api/stream-path?path=   # 直接路径播放
POST /api/tracks/scan         # 扫描并添加音轨
PUT  /api/tracks/:id/rating   # 更新评分
POST /api/tracks/:id/play     # 记录播放
GET  /api/tracks/search?q=    # 搜索音轨
```

### 播放历史

```
GET  /api/history/playlists      # 最近播放的播放列表
GET  /api/history/playlist/:id   # 播放列表历史位置
POST /api/history                # 记录历史
```

### WebDAV

```
GET    /api/webdav             # 获取所有配置
POST   /api/webdav             # 添加配置
GET    /api/webdav/:id/browse  # 浏览目录
GET    /api/webdav/:id/stream  # 流式播放
```

### 健康检查

```
GET /api/health
```

## 播放模式

| 模式            | 说明          |
| ------------- | ----------- |
| `sequential`  | 顺序播放        |
| `shuffle`     | 随机播放（可重复）   |
| `weighted`    | 权重随机（按评分加权） |
| `random`      | 乱序（打乱后顺序播放） |
| `single-loop` | 单曲循环        |

## 评分机制

- **完整听完**：+1 分
- **快切（<10%）**：-1 分
- **手工评分**：👍👎按钮调整

## 完整部署流程（新机器）

```bash
# 1. 安装后端依赖
cd /path/to/moonPlayer/server
npm install

# 2. 构建前端，在修改代码后需要执行build
cd ../web
npm install
npm run build

# 3. 创建日志目录
mkdir -p ~/.moonplayer/logs

# 4. 启动服务
cd ../server
pm2 start ecosystem.config.json

# 5. 开机自启（可选）
pm2 startup
pm2 save

# 6. 检查服务
pm2 status
curl http://localhost:3000/api/health

# 7. 配置音乐目录
curl -X POST http://localhost:3000/api/music-paths \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/path/to/music"]}'
```

## 故障排查

### 端口被占用

```bash
lsof -i :3000
kill -9 <PID>
```

### better-sqlite3 编译失败

```bash
sudo apt install python3 make g++
npm rebuild better-sqlite3
```

### 查看日志

```bash
pm2 logs moonplayer-server --lines 100
```

## License

MIT