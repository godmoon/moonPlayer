# moonPlayer 🎵

Web 端音乐播放器，支持多种播放模式、评分系统、WebDAV 远程存储和有声书功能。

## 功能特性

### 播放控制

- ✅ 5种播放模式：顺序、随机、权重随机、乱序、单曲循环
- ✅ 跳转功能：递增跳转（5→10→30→60→120秒）
- ✅ 硬件快捷键：支持键盘媒体键和系统控制中心
- ✅ 删除并播放下一曲
- ✅ 睡眠定时：一次性定时 / 重复定时

### 播放列表

- ✅ 文件浏览器：浏览本地音乐目录
- ✅ 播放列表管理：创建、编辑、删除
- ✅ 目录播放：扫描整个目录并播放
- ✅ 播放列表属性：默认播放模式、片头片尾跳过设置
- ✅ 匹配类型播放列表：按评分、年份、演唱者、专辑、标签筛选
- ✅ 播放列表排序：名称、序号、随机
- ✅ 音轨排序：名称、序号（数字开头）、随机、评分
- ✅ 上次播放高亮：自动滚动到上次播放位置

### AI 标签功能

- ✅ 批量标注歌曲标签（1-30个标签）
- ✅ 与外部 AI 配合：生成提示词 → AI 返回 → 导入标签
- ✅ 支持自定义每批处理数量

### 评分系统

- ✅ 自动评分：完整听完 +1分，快切扣分
- ✅ 手工评分：👍👎按钮
- ✅ 批量评分：设置评分、重置评分
- ✅ 低分歌曲管理：查看和批量删除

### 有声书功能

- ✅ 片头跳过：手动设置或自动学习
- ✅ 片尾跳过：自动检测并跳过
- ✅ 继续播放：从上次位置恢复
- ✅ 历史记录：最近播放列表，一键继续播放

### WebDAV 支持

- ✅ 连接远程存储
- ✅ 浏览远程目录
- ✅ 流式播放远程文件
- ✅ 支持 Range 请求（进度条可拖动）

### 鉴权系统

- ✅ 管理员账户
- ✅ 登录/登出
- ✅ 密码修改
- ✅ 防暴力破解（失败次数递增等待时间）
- ✅ 命令行清除密码工具

### 导航排序

- ✅ 左侧导航栏支持拖拽排序
- ✅ 默认打开排第一的导航

### 格式支持

- ✅ FLAC/WMA/APE/WAV/AAC 自动转码为 MP3
- ✅ 转码缓存，后续播放直接使用缓存

## 技术栈

**后端：** Node.js + Fastify + SQLite (better-sqlite3)
**前端：** React + Vite + Tailwind CSS + Zustand
**音频：** HTML5 Audio API + Media Session API

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
│       │   ├── PlaylistManager/  # 播放列表管理
│       │   ├── FileBrowser/      # 文件浏览器
│       │   ├── AudioPlayer/      # 播放器
│       │   └── ...
│       └── stores/           # Zustand 状态
│
└── README.md
```

## 快速开始

### 安装依赖

```bash
cd server && npm install
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
cd web && npm run build
cd ../server
mkdir -p ~/.moonplayer/logs
pm2 start ecosystem.config.json
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

### 修改端口

**Linux/Mac (PM2):**
1. 修改 `server/ecosystem.config.json` 中的 `env.PORT`
2. 或命令行：`PORT=3001 pm2 start ...`

**Windows (EXE):**
1. 修改 `start.bat`，添加 `set PORT=3001`
2. 或命令行启动：`set PORT=3001 && moonplayer-server.exe`

**其他需调整的位置：**
- 前端开发代理（如有）：`web/vite.config.ts` 中的 proxy target
- 文档示例：README.md 中的 `localhost:3000` 示例 URL

### 音乐目录

```bash
curl -X POST http://localhost:3000/api/music-paths \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/mnt/music/", "/mnt/audiobooks/"]}'
```

### 数据存储

- 数据库：`~/.moonplayer/moonplayer.db`
- 日志：`~/.moonplayer/logs/`
- WebDAV 缓存：`~/.moonplayer/webdav_cache/`
- 转码缓存：`~/.moonplayer/transcode_cache/`

## 命令行工具

```bash
cd server
npm run cli clear-admin    # 清除管理员密码
```

## API 概览

### 鉴权

- `GET /api/auth/status` - 检查是否需要初始化
- `POST /api/auth/setup` - 初始化管理员
- `POST /api/auth/login` - 登录
- `POST /api/auth/logout` - 登出
- `GET /api/auth/check` - 检查登录状态
- `POST /api/auth/change-password` - 修改密码

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
- `GET /api/tracks/untagged-count` - 未标注歌曲数量
- `GET /api/tracks/untagged` - 未标注歌曲列表
- `POST /api/tracks/tags/import` - 导入标签

### 历史记录

- `GET /api/history/playlists` - 最近播放列表

### WebDAV

- `GET /api/webdav` - 获取配置列表
- `POST /api/webdav` - 添加配置
- `GET /api/webdav/:id/browse` - 浏览目录
- `GET /api/webdav/:id/stream` - 流式播放

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