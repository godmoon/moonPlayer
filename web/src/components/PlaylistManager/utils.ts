// 播放列表管理相关工具函数和常量

// 排序选项
export const PLAYLIST_SORT_OPTIONS = [
  { value: 'name', label: '名称' },
  { value: 'id', label: '序号' },
  { value: 'random', label: '随机' },
];

export const TRACK_SORT_OPTIONS = [
  { value: 'name', label: '名称' },
  { value: 'number', label: '序号' },
  { value: 'random', label: '随机' },
  { value: 'rating', label: '评分' },
];

// 播放模式选项
export const PLAY_MODES = [
  { value: 'sequential', label: '顺序播放' },
  { value: 'shuffle', label: '随机播放' },
  { value: 'weighted', label: '权重随机' },
  { value: 'random', label: '乱序播放' }
];

// 匹配字段选项
export const MATCH_FIELDS = [
  { value: 'rating', label: '评分', ops: ['>', '<', '>=', '<=', '='] },
  { value: 'year', label: '年份', ops: ['>', '<', '>=', '<=', '='] },
  { value: 'artist', label: '演唱者', ops: ['=', 'contains', 'not_contains'] },
  { value: 'album', label: '专辑', ops: ['=', 'contains', 'not_contains'] },
  { value: 'tags', label: '标签', ops: ['contains', 'not_contains'] },
  { value: 'path', label: '路径', ops: ['contains', 'not_contains'] },
];

export const MATCH_OP_LABELS: Record<string, string> = {
  '>': '大于',
  '<': '小于',
  '>=': '大于等于',
  '<=': '小于等于',
  '=': '等于',
  'contains': '包含',
  'not_contains': '不包含',
};

// 格式化时长
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// 复制文本到剪贴板(兼容非 HTTPS 环境)
export function copyToClipboard(text: string) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text);
  } else {
    // 兼容方案:使用 textarea
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

// 来源类型
export type SourceType = 'directory' | 'file' | 'filter' | 'match';