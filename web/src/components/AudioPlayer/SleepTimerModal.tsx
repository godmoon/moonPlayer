// 睡眠定时器弹窗组件
import { usePlayerStore, SleepTimerMode } from '../../stores/playerStore';
import { SLEEP_TIMER_OPTIONS } from './utils';

interface SleepTimerModalProps {
  onClose: () => void;
}

export function SleepTimerModal({ onClose }: SleepTimerModalProps) {
  const { sleepTimer, setSleepTimer, clearSleepTimer } = usePlayerStore();

  const handleSetSleepTimer = (mode: SleepTimerMode, minutes: number) => {
    setSleepTimer(mode, minutes);
    onClose();
  };

  const handleClearSleepTimer = () => {
    clearSleepTimer();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-800 rounded-lg p-4 w-80 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-white text-lg font-medium mb-4">睡眠定时</h3>
        
        {sleepTimer.mode !== 'off' && (
          <div className="mb-4 p-3 bg-blue-900/50 rounded border border-blue-700">
            <div className="text-blue-300 text-sm">
              当前: {sleepTimer.mode === 'once' ? '一次性' : '重复'}定时
            </div>
            <div className="text-white text-lg font-medium">
              剩余 {sleepTimer.remainingMinutes} 分钟
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className="text-gray-400 text-sm">一次性定时（到时间停止，不自动重启）</div>
          <div className="flex flex-wrap gap-2">
            {SLEEP_TIMER_OPTIONS.map(min => (
              <button
                key={`once-${min}`}
                onClick={() => handleSetSleepTimer('once', min)}
                className={`px-3 py-2 rounded text-sm ${sleepTimer.mode === 'once' && sleepTimer.minutes === min ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              >
                {min}分钟
              </button>
            ))}
          </div>

          <div className="border-t border-gray-700 pt-3 mt-3">
            <div className="text-gray-400 text-sm">重复定时（每次手动播放后重新计时）</div>
            <div className="flex flex-wrap gap-2 mt-2">
              {SLEEP_TIMER_OPTIONS.map(min => (
                <button
                  key={`repeat-${min}`}
                  onClick={() => handleSetSleepTimer('repeat', min)}
                  className={`px-3 py-2 rounded text-sm ${sleepTimer.mode === 'repeat' && sleepTimer.minutes === min ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                >
                  {min}分钟
                </button>
              ))}
            </div>
          </div>
        </div>

        {sleepTimer.mode !== 'off' && (
          <button
            onClick={handleClearSleepTimer}
            className="w-full mt-4 px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded"
          >
            取消定时
          </button>
        )}

        <button
          onClick={onClose}
          className="w-full mt-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
        >
          关闭
        </button>
      </div>
    </div>
  );
}