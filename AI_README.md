# moonPlayer AI 开发指南

> 此文件供 AI 助手快速了解项目架构，以便下次会话快速上手。

## 项目概述

moonPlayer 是一个 Web 端音乐播放器，支持多种播放模式、评分系统、播放列表管理和 WebDAV 远程存储。

## 技术栈

- **后端**: Node.js + Fastify + SQLite (better-sqlite3)
- **前端**: React + Vite + Tailwind CSS + Zustand
- **音频**: HTML5 Audio API + Media Session API

## 核心功能模块

### 播放列表来源类型 (`playlist_items.type`)

播放列表支持 4 种来源类型：

| 类型 | 说明 | 关键字段 |
|------|------|----------|
| `directory` | 目录扫描 | `path`, `include_subdirs` |
| `file` | 单个文件 | `path` |
| `filter` | 正则匹配 | `filter_regex` + 可选 `match_*` 字段 |
| `match` | 属性匹配 | `match_field`, `match_op`, `match_value` |

**`match` 类型字段说明:**
- `match_field`: 匹配字段 (`rating`/`year`/`artist`/`album`/`tags`)
- `match_op`: 操作符 (`>`/`<`/`=`/`contains`/`not_contains` 等)
- `match_value`: 比较值

**注意**: `filter` 和 `match` 类型刷新时会扫描所有音乐目录，依赖 `tracks` 表缓存的元数据。

### 播放模式 (`playlists.play_mode`)

- `sequential`: 顺序播放
- `shuffle`: 随机播放
- `weighted`: 权重随机（按评分）
- `random`: 乱序播放
- `single-loop`: 单曲循环

## 开发命令

```bash
# 后端开发
cd server && npm run dev

# 前端开发
cd web && npm run dev

# 生产部署
cd web && npm run build
cd ../server && pm2 restart ecosystem.config.json
```

## 数据库

- **位置**: `~/.moonplayer/moonplayer.db`
- **主要表**: `playlists`, `playlist_items`, `playlist_tracks`, `tracks`, `history`

## 注意事项

1. **前端构建**: 修改后需 `npm run build`
2. **后端重启**: `pm2 restart moonplayer-server`
3. **数据库**: 使用 WAL 模式，迁移在 `schema.ts` 的 `migrateDatabase()` 中