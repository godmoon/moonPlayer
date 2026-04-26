// 歌曲信息弹窗组件
import { usePlayerStore } from '../../stores/playerStore';

interface TrackInfoModalProps {
  onClose: () => void;
  streamBitrate?: number | null;
  sourceBitrate?: number | null;
  needsTranscode?: boolean;
}

export function TrackInfoModal({ onClose, streamBitrate, sourceBitrate, needsTranscode }: TrackInfoModalProps) {
  const { currentTrack } = usePlayerStore();

  if (!currentTrack) return null;

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleString('zh-CN');
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-800 rounded-lg p-4 w-80 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-white text-lg font-medium mb-4">歌曲信息</h3>

        <div className="space-y-3 text-sm">
          <div className="border-b border-gray-700 pb-3">
            <div className="text-gray-400 text-xs">标题</div>
            <div className="text-white">{currentTrack.title}</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-gray-400 text-xs">艺术家</div>
              <div className="text-white">{currentTrack.artist || '-'}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs">专辑</div>
              <div className="text-white">{currentTrack.album || '-'}</div>
            </div>
          </div>

          <div className="border-t border-gray-700 pt-3">
            <div className="text-gray-400 text-xs">评分</div>
            <div className="text-white">{currentTrack.rating ? `${currentTrack.rating > 0 ? '+' : ''}${currentTrack.rating}` : '0'}</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-gray-400 text-xs">播放次数</div>
              <div className="text-white">{currentTrack.playCount || 0}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs">跳过次数</div>
              <div className="text-white">{currentTrack.skipCount || 0}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-gray-400 text-xs">时长</div>
              <div className="text-white">{formatDuration(currentTrack.duration)}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs">添加日期</div>
              <div className="text-white text-xs">{formatDate(currentTrack.dateAdded)}</div>
            </div>
          </div>

          <div className="border-t border-gray-700 pt-3">
            <div className="text-gray-400 text-xs">音频比特率</div>
            <div className="text-white">
              {sourceBitrate ? `${sourceBitrate}kbps` : '未知'}
              {needsTranscode && streamBitrate ? ` → ${streamBitrate}kbps` : ''}
            </div>
          </div>

          <div className="border-t border-gray-700 pt-3">
            <div className="text-gray-400 text-xs">文件路径</div>
            <div className="text-white text-xs break-all">{currentTrack.path}</div>
          </div>

          {currentTrack.lastPlayed && (
            <div>
              <div className="text-gray-400 text-xs">最后播放</div>
              <div className="text-white text-xs">{formatDate(currentTrack.lastPlayed)}</div>
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="w-full mt-4 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
        >
          关闭
        </button>
      </div>
    </div>
  );
}