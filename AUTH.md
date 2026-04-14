# moonPlayer 鉴权功能

## 功能概述

moonPlayer 现已支持完整的用户鉴权系统，包括：

- ✅ 首次启动设置管理员账户
- ✅ 密码登录
- ✅ 记住登录状态（Cookie 有效期 1 年）
- ✅ 防暴力破解（错误重试等待时间递增）
- ✅ 修改密码功能
- ✅ 后台命令清除密码

## 使用流程

### 1. 首次启动

首次访问 moonPlayer 时，会显示初始化页面，需要设置：
- 管理员用户名（2-32 字符）
- 密码（至少 6 字符）
- 确认密码

设置完成后自动登录。

### 2. 登录

之后访问会显示登录页面，输入密码即可登录。登录状态会保持 1 年（除非清除浏览器 Cookie）。

### 3. 修改密码

登录后进入「设置」页面，点击「修改密码」：
- 输入原密码
- 输入新密码（至少 6 字符）
- 确认新密码

### 4. 退出登录

设置页面点击「退出登录」即可退出。

## 防暴力破解机制

密码错误后，等待时间会递增：

| 失败次数 | 等待时间 |
|---------|---------|
| 1-2 次   | 0 秒    |
| 3-4 次   | 10 秒   |
| 5-6 次   | 30 秒   |
| 7-9 次   | 60 秒   |
| 10-14 次 | 120 秒  |
| 15-19 次 | 300 秒  |
| 20-29 次 | 600 秒  |
| 30+ 次   | 3600 秒 |

## 后台命令

### 清除管理员密码

如果忘记密码，可以在服务器上运行命令清除：

```bash
cd /path/to/moonPlayer/server
npm run cli clear-admin
```

或者直接执行：

```bash
node dist/cli.js clear-admin
```

命令会：
- 清除管理员账户
- 清除所有登录会话
- **保留播放列表、音轨等数据**

下次启动服务时需要重新设置管理员账户。

## 技术实现

### 安全措施

1. **密码加密**：使用 PBKDF2 + SHA-512，100,000 次迭代
2. **会话 Token**：64 字节随机数，HTTP Only Cookie
3. **防暴力破解**：IP 级别的登录限制
4. **防注入**：使用参数化 SQL 查询
5. **Cookie 安全**：
   - HTTP Only（防 XSS 窃取）
   - SameSite=Strict（防 CSRF）
   - 生产环境启用 Secure

### 数据库表结构

```sql
-- 管理员表
CREATE TABLE admin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 会话表
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- 登录尝试表
CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  attempt_at INTEGER NOT NULL,
  success INTEGER DEFAULT 0
);
```

## API 端点

| 端点 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `/api/auth/status` | GET | 检查是否需要初始化 | 否 |
| `/api/auth/setup` | POST | 初始化管理员 | 否 |
| `/api/auth/login` | POST | 登录 | 否 |
| `/api/auth/logout` | POST | 登出 | 是 |
| `/api/auth/check` | GET | 检查登录状态 | 否 |
| `/api/auth/me` | GET | 获取当前用户 | 是 |
| `/api/auth/change-password` | POST | 修改密码 | 是 |

## 常见问题

### Q: 忘记密码怎么办？

A: 登录服务器，运行 `npm run cli clear-admin` 清除密码，然后重新启动服务，会要求重新设置管理员账户。

### Q: 为什么登录后刷新页面又要重新登录？

A: 可能是浏览器禁用了 Cookie。请确保浏览器允许 Cookie。

### Q: 如何在多设备登录？

A: 同一账户可以在多个设备登录，每个设备都会生成独立的会话 Token。

### Q: 如何查看所有登录会话？

A: 目前不支持查看会话列表，会话有效期 1 年，过期自动清理。