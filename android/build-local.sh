#!/bin/bash
# MoonPlayer Android APK 本机构建脚本
# 在本机运行，无需 Android Studio

set -e

# SDK 和 JDK 路径（本机）
ANDROID_HOME="$HOME/android-sdk"
ANDROID_SDK_ROOT="$ANDROID_HOME"
JAVA_HOME="$ANDROID_HOME/jdk/jdk-17.0.9+9"
export ANDROID_HOME ANDROID_SDK_ROOT JAVA_HOME

# 添加到 PATH
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/build-tools/34.0.0:$PATH"

# 进入项目目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "================================"
echo "MoonPlayer Android APK 构建"
echo "================================"
echo "JAVA_HOME: $JAVA_HOME"
echo "ANDROID_HOME: $ANDROID_HOME"
echo ""

# 检查 Java
if [ ! -d "$JAVA_HOME" ]; then
    echo "错误: JDK 未安装"
    echo "请运行: cd ~/android-sdk/jdk && curl -L -o openjdk17.tar.gz 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.9%2B9/OpenJDK17U-jdk_x64_linux_hotspot_17.0.9_9.tar.gz' && tar -xzf openjdk17.tar.gz"
    exit 1
fi

# 检查 SDK
if [ ! -d "$ANDROID_HOME/platforms/android-34" ]; then
    echo "错误: Android SDK 未安装"
    echo "请运行: sdkmanager \"build-tools;34.0.0\" \"platforms;android-34\""
    exit 1
fi

echo "开始构建..."
./gradlew assembleDebug --no-daemon

if [ -f "app/build/outputs/apk/debug/app-debug.apk" ]; then
    cp app/build/outputs/apk/debug/app-debug.apk moonplayer-debug.apk
    echo ""
    echo "================================"
    echo "✓ 构建成功!"
    echo "================================"
    echo "APK: $SCRIPT_DIR/moonplayer-debug.apk"
    ls -lh "$SCRIPT_DIR/moonplayer-debug.apk"
else
    echo "构建失败"
    exit 1
fi