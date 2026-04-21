# moonPlayer Windows 打包说明

## 方式一：便携版（需要 Node.js）

无需编译原生模块，使用 sql.js（纯 JavaScript SQLite）。

### Linux 端打包

```bash
cd /home/moon/ai/moonPlayer/server && npm run build
cd /home/moon/ai/moonPlayer/web && npm run build
cd /home/moon/ai/moonPlayer/windows && node build-portable.js
```

输出：`windows/build/moonplayer-win/`

### Windows 端使用

1. 安装 Node.js >= 18
2. 解压 moonplayer-win 文件夹
3. 双击 `start.bat`

---

## 方式二：单 EXE（无需 Node.js）

打包成单个可执行文件，用户无需安装 Node.js。

### Windows 端打包

**前提条件：**
- Windows 系统
- Node.js >= 18 已安装

**步骤：**

```cmd
:: 1. 复制 server 和 web 目录到 Windows

:: 2. 在 server 目录安装依赖
cd server
npm install

:: 3. 构建 TypeScript
npm run build

:: 4. 安装打包工具
npm install @yao-pkg/pkg --save-dev

:: 5. 打包 EXE
npx pkg . --targets node18-win-x64 --output moonplayer-server.exe --compress GZip

:: 6. 复制依赖文件
copy node_modules\sql.js\dist\sql-wasm.wasm .
xcopy /E /I /Y ..\web\dist web\dist
```

### 发布包结构

```
发布目录/
├── moonplayer-server.exe    # 主程序（约 40MB）
├── sql-wasm.wasm            # SQLite WASM 模块（约 1MB）
├── web/dist/                # 前端文件（约 5MB）
├── start.bat                # 启动脚本
└── README.txt               # 说明文件
```

### 使用方法

用户只需：
1. 解压发布包
2. 双击 `start.bat`
3. 访问 http://localhost:3000

**无需安装 Node.js！**

---

## 技术说明

### sql.js 替代 better-sqlite3

从本版本开始，使用 sql.js（SQLite 的 WebAssembly 实现）替代 better-sqlite3：

**优点：**
- 纯 JavaScript/WASM，无需编译原生模块
- 支持 pkg 打包成单 exe
- 跨平台兼容，Windows 路径问题已解决

**注意：**
- 数据库会加载到内存，大文件可能占用更多内存
- 写入操作会立即保存到磁盘

### 路径兼容性

所有路径在存储时统一使用正斜杠 `/`：
- Windows 路径 `D:\Music\song.mp3` → `D:/Music/song.mp3`

---

## 一键打包脚本（Windows）

运行 `windows/build-exe.bat`：

```cmd
cd windows
build-exe.bat
```

此脚本会自动：
1. 检查 Node.js 版本
2. 安装打包工具
3. 构建 TypeScript
4. 打包 EXE
5. 复制依赖文件