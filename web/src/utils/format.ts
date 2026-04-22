// 格式化工具函数

// 获取文件名（从路径中提取，兼容 Windows 和 Unix 路径）
export function getFileName(filePath: string): string {
  // 同时处理 / 和 \ 分隔符
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || filePath;
}

// 获取父目录名（从路径中提取，兼容 Windows 和 Unix 路径）
export function getParentDirName(filePath: string): string {
  // 同时处理 / 和 \\ 分隔符
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  // 返回倒数第二个部分（父目录名），如果没有则返回路径本身
  return parts.length > 1 ? parts[parts.length - 2] : parts[0] || filePath;
}

// 需要 FFmpeg 支持的格式（浏览器不原生支持）
const NEEDS_TRANSCODE_FORMATS = ['.wma', '.ape'];

// 判断文件是否需要格式转码（浏览器不支持）
export function needsFormatTranscode(filePath: string): boolean {
  const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  return NEEDS_TRANSCODE_FORMATS.includes(ext);
}

// 格式化标题（用于文件列表显示）
export function formatTrackTitle(track: { title: string; path: string }, qualityMode?: string): string {
  const fileName = getFileName(track.path);
  
  // 如果设置了省流模式且不是无损，显示品质标签
  if (qualityMode && qualityMode !== 'lossless') {
    const labels: Record<string, string> = {
      low: '低品质',
      medium: '中品质',
      high: '高品质'
    };
    return `${fileName} [${labels[qualityMode] || ''}]`;
  }
  
  // 如果文件需要格式转码，显示转码标签
  if (needsFormatTranscode(track.path)) {
    return `${fileName} [转码]`;
  }
  
  // 无需转码，直接显示文件名
  return fileName;
}