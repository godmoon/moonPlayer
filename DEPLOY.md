# moonPlayer 部署说明

## 快速启动

### 开发模式

```bash
cd /home/moon/ai/moonPlayer/server
npm run dev
```

### 生产模式（PM2）

```bash
# 创建日志目录
mkdir -p ~/.moonplayer/logs

# 启动服务
cd /home/moon/ai/moonPlayer/server
pm2 start ecosystem.config.json

# 查看状态
pm2 status

# 查看日志
pm2 logs moonplayer-server

# 停止服务
pm2 stop moonplayer-server
```

### 开机自启

```bash
pm2 startup
pm2 save
```

## 访问地址

- 本地：http://localhost:3000
- 局域网：http://192.168.230.74:3000

## 配置

### 音乐目录

默认：`/mnt/music/`

可在设置页面修改，或通过 API：

```bash
curl -X POST http://localhost:3000/api/music-path \
  -H "Content-Type: application/json" \
  -d '{"path": "/path/to/music"}'
```

### 数据库位置

`~/.moonplayer/moonplayer.db`

## 故障排查

### 端口被占用

```bash
lsof -i :3000
kill -9 <PID>
```

### 服务无法启动

```bash
# 检查依赖
cd /home/moon/ai/moonPlayer/server
npm install

# 检查日志
pm2 logs moonplayer-server
```