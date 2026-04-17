// 浏览器音频格式支持检测
// 使用 HTML5 Audio 的 canPlayType 方法检测浏览器原生支持

export interface FormatSupport {
  flac: boolean;
  wav: boolean;
  aac: boolean;
  m4a: boolean;
  ogg: boolean;
  mp3: boolean;
  wma: boolean;   // 通常不支持
  ape: boolean;   // 通常不支持
}

// 缓存检测结果
let cachedSupport: FormatSupport | null = null;

/**
 * 检测浏览器是否支持特定 MIME 类型
 * canPlayType 返回值:
 * - "probably": 浏览器相当确信支持
 * - "maybe": 浏览器可能支持
 * - "": 不支持
 */
function checkSupport(mimeType: string): boolean {
  try {
    const audio = document.createElement('audio');
    const result = audio.canPlayType(mimeType);
    return result === 'probably' || result === 'maybe';
  } catch {
    return false;
  }
}

/**
 * 检测浏览器对所有格式的支持情况
 */
export function detectFormatSupport(): FormatSupport {
  if (cachedSupport) {
    return cachedSupport;
  }

  cachedSupport = {
    // FLAC: 现代浏览器普遍支持
    flac: checkSupport('audio/flac') || checkSupport('audio/x-flac'),
    
    // WAV: 广泛支持
    wav: checkSupport('audio/wav') || checkSupport('audio/x-wav'),
    
    // AAC: 广泛支持
    aac: checkSupport('audio/aac') || checkSupport('audio/mp4'),
    
    // M4A (AAC in MP4 container)
    m4a: checkSupport('audio/mp4') || checkSupport('audio/x-m4a'),
    
    // OGG Vorbis/Opus
    ogg: checkSupport('audio/ogg') || checkSupport('audio/ogg; codecs="vorbis"') || checkSupport('audio/ogg; codecs="opus"'),
    
    // MP3: 几乎所有浏览器支持
    mp3: checkSupport('audio/mpeg') || checkSupport('audio/mp3'),
    
    // WMA: 浏览器基本不支持，需要转码
    wma: checkSupport('audio/x-ms-wma'),
    
    // APE: 浏览器基本不支持，需要转码
    ape: checkSupport('audio/x-ape'),
  };

  return cachedSupport;
}

/**
 * 获取需要转码的格式列表（浏览器不原生支持的）
 */
export function getTranscodeNeededFormats(): string[] {
  const support = detectFormatSupport();
  const needsTranscode: string[] = [];

  if (!support.flac) needsTranscode.push('.flac');
  if (!support.wav) needsTranscode.push('.wav');
  if (!support.aac) needsTranscode.push('.aac');
  if (!support.m4a) needsTranscode.push('.m4a');
  if (!support.ogg) needsTranscode.push('.ogg');
  if (!support.mp3) needsTranscode.push('.mp3');
  
  // WMA 和 APE 几乎总需要转码
  if (!support.wma) needsTranscode.push('.wma');
  if (!support.ape) needsTranscode.push('.ape');

  return needsTranscode;
}

/**
 * 判断指定文件是否需要转码
 */
export function needsTranscode(filePath: string): boolean {
  const ext = getFileExtension(filePath).toLowerCase();
  const support = detectFormatSupport();

  switch (ext) {
    case '.flac': return !support.flac;
    case '.wav': return !support.wav;
    case '.aac': return !support.aac;
    case '.m4a': return !support.m4a;
    case '.ogg': return !support.ogg;
    case '.mp3': return !support.mp3;
    case '.wma': return !support.wma;  // 几乎总为 true
    case '.ape': return !support.ape;   // 几乎总为 true
    default: return true; // 未知格式默认转码
  }
}

/**
 * 获取文件的 MIME 类型
 */
export function getMimeType(filePath: string): string {
  const ext = getFileExtension(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.wma': 'audio/x-ms-wma',
    '.ape': 'audio/x-ape',
  };
  return mimeTypes[ext] || 'audio/mpeg';
}

/**
 * 从文件路径获取扩展名
 */
function getFileExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filePath.substring(lastDot).toLowerCase();
}

/**
 * 将格式支持信息编码为简短字符串，用于 API 请求
 */
export function encodeFormatSupport(): string {
  const support = detectFormatSupport();
  // 格式: "flac=1&wav=1&aac=1&m4a=1&ogg=1&mp3=1&wma=0&ape=0"
  const parts: string[] = [];
  parts.push(`flac=${support.flac ? 1 : 0}`);
  parts.push(`wav=${support.wav ? 1 : 0}`);
  parts.push(`aac=${support.aac ? 1 : 0}`);
  parts.push(`m4a=${support.m4a ? 1 : 0}`);
  parts.push(`ogg=${support.ogg ? 1 : 0}`);
  parts.push(`mp3=${support.mp3 ? 1 : 0}`);
  parts.push(`wma=${support.wma ? 1 : 0}`);
  parts.push(`ape=${support.ape ? 1 : 0}`);
  return parts.join('&');
}

/**
 * 在页面加载时预检测并输出结果（调试用）
 */
export function logFormatSupport(): void {
  const support = detectFormatSupport();
  console.log('[moonPlayer] 浏览器格式支持检测:');
  console.log(`  FLAC: ${support.flac ? '✅' : '❌'}`);
  console.log(`  WAV:  ${support.wav ? '✅' : '❌'}`);
  console.log(`  AAC:  ${support.aac ? '✅' : '❌'}`);
  console.log(`  M4A:  ${support.m4a ? '✅' : '❌'}`);
  console.log(`  OGG:  ${support.ogg ? '✅' : '❌'}`);
  console.log(`  MP3:  ${support.mp3 ? '✅' : '❌'}`);
  console.log(`  WMA:  ${support.wma ? '✅' : '❌ (需要转码)'}`);
  console.log(`  APE:  ${support.ape ? '✅' : '❌ (需要转码)'}`);
}