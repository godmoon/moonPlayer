// 音频播放器相关常量和工具函数

export type PlayMode = 'sequential' | 'shuffle' | 'weighted' | 'random';

export const PLAY_MODES: PlayMode[] = ['sequential', 'shuffle', 'weighted', 'random'];

export const PLAY_MODE_LABELS: Record<PlayMode, { icon: string; label: string }> = {
  sequential: { icon: '➡️', label: '顺序播放' },
  shuffle: { icon: '🔀', label: '随机播放' },
  weighted: { icon: '⚖️', label: '权重随机' },
  random: { icon: '🎲', label: '乱序播放' }
};

export const SKIP_AMOUNTS = [5, 10, 30, 60, 120];

export const SLEEP_TIMER_OPTIONS = [15, 30, 45, 60, 90, 120];

// 从共享位置导出
export { formatTrackTitle } from '../../utils/format';
let globalPendingSeekPosition: number | null = null;
let globalIsSeekConsumed = false;
let globalLockedPosition: number | null = null;

export function setPendingSeekPosition(position: number) {
  globalPendingSeekPosition = position;
  globalLockedPosition = position;
  globalIsSeekConsumed = false;
}

export function consumePendingSeekPosition(): number | null {
  if (globalIsSeekConsumed) {
    return null;
  }

  const pos = globalPendingSeekPosition;
  globalPendingSeekPosition = null;
  globalIsSeekConsumed = true;

  return pos;
}

export function getLockedPosition(): number | null {
  return globalLockedPosition;
}

export function clearLockedPosition() {
  globalLockedPosition = null;
}