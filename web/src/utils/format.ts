// 格式化工具函数

// 需要 FFmpeg 支持的格式（需要转码）
const NEEDS_TRANSCODE = ['.wma', '.ape', '.flac', '.wav', '.aac'];

// 获取文件名（从路径中提取）
export function getFileName(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] || filePath;
}

// 格式化标题（用于文件列表显示）
export function formatTrackTitle(track: { title: string; path: string }): string {
  const fileName = getFileName(track.path);
  const needsTranscode = NEEDS_TRANSCODE.some(e => track.path.toLowerCase().endsWith(e));
  
  let result = fileName;
  if (needsTranscode) {
    result += ' [转码]';
  }
  return result;
}