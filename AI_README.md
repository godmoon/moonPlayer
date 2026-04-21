# AI_README.md - moonPlayer 项目快速参考

## 项目概述

Web 端音乐播放器，支持多种播放模式、评分系统、WebDAV 远程存储和有声书功能。

## 技术栈

- **后端**: Node.js + Fastify + SQLite (better-sqlite3)
- **前端**: React + Vite + Tailwind CSS + Zustand
- **音频**: HTML5 Audio API + Media Session API
- **Android**: WebView 容器 + MediaSession 通知栏控制

## 关键文件

### 后端 (server/)
- `src/index.ts` - 服务入口 + 鉴权中间件
- `src/routes/auth.ts` - 登录/登出/会话管理
- `src/routes/stream.ts` - 音频流传输（含品质转码）
- `src/routes/tracks.ts` - 音轨 API
- `src/db/schema.ts` - 数据库 Schema

### 前端 (web/)
- `src/App.tsx` - 主应用入口
- `src/stores/playerStore.ts` - 播放器状态
- `src/components/AudioPlayer/PlayerBar.tsx` - 播放器组件（含快进/快退逻辑）
- `src/components/AudioPlayer/utils.ts` - 播放器工具函数

### Android (android/)
- `app/src/main/java/com/moon/moonplayer/MainActivity.java` - WebView 主页面 + 通知栏控制
- `app/src/main/java/com/moon/moonplayer/ConnectActivity.java` - 启动页，输入服务器地址
- `app/src/main/res/drawable/ic_forward.xml` - 前进按钮图标
- `app/src/main/res/drawable/ic_backward.xml` - 后退按钮图标

## Android 通知栏控制

通知栏按钮顺序：后退 ← 上一曲 ← 播放/暂停 → 下一曲 → 前进

按钮通过 `MoonPlayerBridge` 与 WebView 通信：
- `forward()` - 快进（递增跳转：5→10→30→60→120秒）
- `backward()` - 快退（递增跳转：5→10→30→60→120秒）
- `next()` / `prev()` - 切换曲目

## 快进/快退递增逻辑

短时间（<3秒）内连续点击快进/快退，跳转时间会递增：
- 第一次：5秒
- 第二次：10秒
- 第三次：30秒
- 第四次：60秒
- 第五次：120秒

3秒后重置为 5 秒。

## 常用命令

```bash
# 后端
cd server && npm run build && pm2 restart moonplayer-server

# 前端
cd web && npm run build

# Android APK
cd android && bash build-local.sh
# 输出: android/moonplayer-debug.apk
```

## 数据存储

- 数据库: `~/.moonplayer/moonplayer.db`
- 日志: `~/.moonplayer/logs/`
- WebDAV 缓存: `~/.moonplayer/webdav_cache/`
- 转码缓存: `~/.moonplayer/transcode_cache/`

## 播放模式

| 模式 | 说明 |
|------|------|
| `sequential` | 顺序播放 |
| `shuffle` | 随机播放（可重复） |
| `weighted` | 权重随机（按评分加权） |
| `random` | 乱序（打乱后顺序播放） |
| `single-loop` | 单曲循环 |

## 品质模式

| 模式 | 码率 |
|------|------|
| `low` | 120k |
| `medium` | 192k |
| `high` | 320k |
| `lossless` | 无损 |

## 格式支持

- 原生支持: MP3, M4A, OGG, WAV
- 自动转码: FLAC, WMA, APE, AAC (需要 FFmpeg)