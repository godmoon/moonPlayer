// 格式化工具函数

// 获取文件名（从路径中提取）
export function getFileName(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] || filePath;
}

// 格式化标题（用于文件列表显示）
export function formatTrackTitle(track: { title: string; path: string }): string {
  // 直接返回文件名，不再显示转码标签
  // 转码状态在播放器界面显示
  return getFileName(track.path);
}