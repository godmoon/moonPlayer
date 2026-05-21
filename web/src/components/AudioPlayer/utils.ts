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

/**
 * 跨组件共享的 seek 状态
 *
 * 设计原因：PlaylistDetail/UnifiedPlaylist 需要告诉 PlayerBar
 * 在切歌后跳到指定位置。因为 PlayerBar 是唯一的，使用模块级
 * 单例比 Context/Store 更简单直接。
 *
 * 注意：此处必须保证只有一个 PlayerBar 实例。
 */

interface SeekState {
  pendingPosition: number | null;
  consumed: boolean;
  lockedPosition: number | null;
}

const seekState: SeekState = {
  pendingPosition: null,
  consumed: false,
  lockedPosition: null,
};

export function setPendingSeekPosition(position: number) {
  seekState.pendingPosition = position;
  seekState.lockedPosition = position;
  seekState.consumed = false;
}

export function consumePendingSeekPosition(): number | null {
  if (seekState.consumed) {
    return null;
  }

  const pos = seekState.pendingPosition;
  seekState.pendingPosition = null;
  seekState.consumed = true;

  return pos;
}

export function getLockedPosition(): number | null {
  return seekState.lockedPosition;
}

export function clearLockedPosition() {
  seekState.lockedPosition = null;
}