@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo.
echo ===================================
echo   moonPlayer Windows EXE Builder
echo ===================================
echo.

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not installed!
    echo Please install Node.js 18+ from https://nodejs.org/
    pause
    exit /b 1
)

:: Check ffmpeg
where ffmpeg >nul 2>&1
if errorlevel 1 (
    echo [WARNING] ffmpeg not found in PATH!
    echo Audio transcoding will not work.
    echo To enable transcoding, copy ffmpeg.exe and ffprobe.exe to:
    echo   %~dp0build-exe\ffmpeg.exe
    echo   %~dp0build-exe\ffprobe.exe
    echo.
    echo You can download ffmpeg from: https://ffmpeg.org/download.html
    echo.
)

echo.
echo [0/5] Stopping existing moonPlayer server...

tasklist | findstr /I "moonplayer-server.exe" >nul
if %errorlevel%==0 (
    taskkill /F /IM moonplayer-server.exe /T >nul 2>&1
    echo Existing server stopped.
) else (
    echo No running server found.
)

:: Switch to server directory
cd /d "%~dp0..\server"

:: Install dependencies
echo [1/5] Installing dependencies...
call npm install
if errorlevel 1 (
    echo [ERROR] npm install failed
    pause
    exit /b 1
)

:: Install esbuild and pkg
echo.
echo [2/5] Installing build tools...
call npm install esbuild @yao-pkg/pkg --save-dev
if errorlevel 1 (
    echo [ERROR] install failed
    pause
    exit /b 1
)

:: Build web frontend first (must be done before bundling)
echo.
echo [2.5] Building web frontend...
cd /d "..\web"
call npm install
if errorlevel 1 (
    echo [ERROR] Web npm install failed
    pause
    exit /b 1
)
call npm run build
if errorlevel 1 (
    echo [ERROR] Web build failed
    pause
    exit /b 1
)
cd /d "..\server"

:: Build TypeScript first
echo.
echo [3/5] Building TypeScript...
call npx tsc
if errorlevel 1 (
    echo [ERROR] TypeScript build failed
    pause
    exit /b 1
)

:: Bundle with esbuild (CommonJS format for pkg)
echo.
echo [4/5] Bundling with esbuild...
call npx esbuild dist/index.js --bundle --platform=node --target=node18 --format=cjs --outfile=dist/bundle.cjs --external:sql.js --define:import.meta.url=undefined --define:import.meta=undefined
if errorlevel 1 (
    echo [ERROR] esbuild bundle failed
    pause
    exit /b 1
)

:: Copy WASM file
copy /Y "node_modules\sql.js\dist\sql-wasm.wasm" "dist\sql-wasm.wasm" >nul

:: Create pkg config
(
echo {
echo   "pkg": {
echo     "assets": ["dist/sql-wasm.wasm", "../web/dist/**/*"]
echo   }
echo }
) > "pkg-bundle.json"

:: Create output directory
if not exist "..\windows\build-exe" mkdir "..\windows\build-exe"

:: Package with pkg
echo.
echo [5/5] Packaging EXE...
call npx pkg dist/bundle.cjs --config pkg-bundle.json --targets node18-win-x64 --output "..\windows\build-exe\moonplayer-server.exe" --compress GZip
if errorlevel 1 (
    echo [ERROR] pkg packaging failed
    pause
    exit /b 1
)

:: Copy additional files
echo.
echo Copying additional files...

:: Copy WASM to output
copy /Y "node_modules\sql.js\dist\sql-wasm.wasm" "..\windows\build-exe\sql-wasm.wasm" >nul

:: Copy web/dist (from server directory, so it's ..\web\dist)
if exist "..\web\dist" (
    if not exist "..\windows\build-exe\web\dist" mkdir "..\windows\build-exe\web\dist"
    xcopy /E /I /Y "..\web\dist\*" "..\windows\build-exe\web\dist\" >nul
)

if not exist "..\windows\build-exe\start.bat" (
    (
    echo @echo off
    echo chcp 65001 ^>nul
    echo cd /d "%%~dp0"
    echo title moonPlayer Server
    echo echo.
    echo echo Starting moonPlayer...
    echo set PORT=3000
    echo moonplayer-server.exe
    echo if errorlevel 1 ^(
    echo     echo [ERROR] Start failed!
    echo     pause
    echo     exit /b 1
    echo ^)
    ) > "..\windows\build-exe\start.bat"
)

if not exist "..\windows\build-exe\run_hidden.vbs" (
    (
        echo Set WshShell = CreateObject^("WScript.Shell"^)
        echo Set fso = CreateObject^("Scripting.FileSystemObject"^)
        echo currentDir = fso.GetParentFolderName^(WScript.ScriptFullName^)
        echo PORT = "3000"
        echo exePath = """" ^& currentDir ^& "\moonplayer-server.exe"""
        echo logPath = """" ^& currentDir ^& "\run.log"""
        echo cmd = "cmd /c set PORT=" ^& PORT ^& " && " ^& exePath ^& " > " ^& logPath ^& " 2>&1"
        echo WshShell.Run cmd, 0, False
    ) > "..\windows\build-exe\run_hidden.vbs"
)


:: Create README
(
echo moonPlayer for Windows
echo ====================
echo.
echo Files:
echo   - moonplayer-server.exe  Main program
echo   - sql-wasm.wasm          SQLite module ^(required^)
echo   - web\dist\              Web frontend
echo   - start.bat              Startup script
echo.
echo Usage:
echo   1. Double-click start.bat
echo   2. Open http://localhost:3000
echo.
echo No Node.js installation required!
) > "..\windows\build-exe\README.txt"

echo.
echo ===================================
echo   Build Complete!
echo ===================================
echo.
echo Output: ..\windows\build-exe\
echo.

:: Run hidden startup script
set "SCRIPT_DIR=%~dp0"
set "VBS_PATH=%SCRIPT_DIR%..\windows\build-exe\run_hidden.vbs"

echo Checking: %VBS_PATH%

if exist "%VBS_PATH%" (
    echo Found VBS, launching...
    cscript "%VBS_PATH%"
    echo Done.
) else (
    echo [ERROR] VBS not found!
)

pause
