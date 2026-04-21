# moonPlayer AI 开发指南
> 此文件供 AI 助手快速了解项目架构。

## 核心架构
- **后端**: Node.js + Fastify + SQLite (better-sqlite3)
- **前端**: React + Vite + Tailwind CSS + Zustand

## 常用命令
```bash
cd server && npm run build      # 后端构建
cd web && npm run build         # 前端构建
pm2 restart moonplayer-server  # 重启服务
```

## 关键文件
- `server/src/routes/tracks.ts` - 音轨 API（播放、评分、统计、搜索、筛选）
- `server/src/routes/playlists.ts` - 播放列表 API
- `server/src/db/schema.ts` - 数据库结构
- `web/src/stores/playerStore.ts` - 播放器状态（含播放模式逻辑）
- `web/src/components/AudioPlayer/PlayerBar.tsx` - 播放器组件（含跳转逻辑）
- `web/src/components/SearchView.tsx` - 搜索组件（搜索+筛选）

## 播放模式
| 模式 | 说明 |
|------|------|
| sequential | 顺序播放 |
| shuffle | 随机播放（可重复） |
| weighted | 权重随机（每多1分增加10%概率） |
| random | 乱序（打乱后顺序播放） |
| single-loop | 单曲循环 |

**权重随机规则**: 基础权重10，每增加1评分权重+1。
- 评分0: 权重10（基准）
- 评分5: 权重15（概率高50%）
- 评分10: 权重20（概率高100%）

## 评分机制
- 完整听完 +1分
- 快切（<10%） -1分
- 手工评分 👍👎 按钮

## 数据库核心字段 (tracks 表)
- `play_count` - 播放次数（完整听完 +1）
- `skip_count` - 快切次数
- `rating` - 评分（听完 +1，快切 -1）
- `last_played` - 最后播放时间戳
- `recycled` - 是否在回收站

## API 概览
- `POST /api/tracks/:id/play` - 记录播放（自动更新 play_count、rating）
- `GET /api/tracks/play-stats` - 播放统计（按播放次数排序）
- `GET /api/tracks/most-played` - 播放最多的歌曲
- `GET /api/tracks/tags/list` - 所有标签列表
- `GET /api/tracks/all` - 获取所有歌曲（限制100条，用于空搜索默认显示）
- `POST /api/tracks/filter-by-conditions` - 按筛选条件获取歌曲（服务端筛选）
- `GET /api/tracks/search?q=关键词` - 搜索歌曲（支持拼音）

## 有声书跳转逻辑
- 前进跳转超出当前文件时：切换到下一曲，从头播放
- 后退跳转超出当前文件时：切换到上一曲，从末尾往前算
- 例如：当前 115 的 00:30，后退 120 秒 → 跳到 114 从末尾往前 90 秒
- 如果上一曲不够长，最多跳过一个文件（不会跳到 113）

## 搜索功能
- **空搜索**: 默认显示所有歌曲（限制100条）
- **有搜索词**: 按标题/艺术家/路径搜索，支持拼音首字母
- **筛选条件**: 服务端处理，支持评分、年份、标签等多条件 AND 筛选
- 组合使用：搜索词 + 筛选条件，搜索结果再在前端二次筛选