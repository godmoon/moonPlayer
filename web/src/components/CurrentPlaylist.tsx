// 当前播放列表组件
import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../stores/playerStore';

export function CurrentPlaylist() {
  const { currentTrack, currentPlaylist, playlistTracks, setCurrentTrack, setIsPlaying } = usePlayerStore();
  const currentTrackRef = useRef<HTMLDivElement>(null);

  // 自动滚动到当前播放曲目
  useEffect(() => {
    if (currentTrack && currentTrackRef.current) {
      currentTrackRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentTrack?.id]);

  const handlePlayTrack = (track: typeof currentTrack) => {
    if (track) {
      setCurrentTrack(track);
      setIsPlaying(true);
    }
  };

  if (!currentPlaylist) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="text-4xl mb-2">🎵</div>
          <div>暂无播放列表</div>
          <div className="text-sm mt-1">请从「播放列表」中选择一个列表播放</div>
        </div>
      </div>
    );
  }

  if (playlistTracks.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="text-4xl mb-2">🎵</div>
          <div>当前播放列表为空</div>
        </div>
      </div>
    );
  }

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="p-3 border-b border-gray-700">
        <h2 className="font-medium">{currentPlaylist.name}</h2>
        <div className="text-xs text-gray-500">{playlistTracks.length} 首歌曲</div>
      </div>

      {/* 曲目列表 */}
      <div className="flex-1 overflow-auto p-2">
        {playlistTracks.map((track, index) => {
          const isPlaying = currentTrack?.id === track.id;
          return (
            <div
              key={track.id}
              ref={isPlaying ? currentTrackRef : null}
              onClick={() => handlePlayTrack(track)}
              className={`flex items-center gap-2 p-2 rounded cursor-pointer ${
                isPlaying ? 'bg-purple-600/30 border border-purple-500' : 'hover:bg-gray-700'
              }`}
            >
              <span className={`w-6 text-center ${isPlaying ? 'text-purple-400' : 'text-gray-500'}`}>
                {isPlaying ? '▶' : index + 1}
              </span>
              <span className={isPlaying ? 'text-purple-400' : 'text-green-500'}>🎵</span>
              <div className="flex-1 min-w-0">
                <div className={`truncate ${isPlaying ? 'text-purple-300 font-medium' : ''}`}>
                  {track.title}
                </div>
                <div className={`text-xs ${isPlaying ? 'text-purple-400' : 'text-gray-500'}`}>
                  {isPlaying ? '正在播放' : (track.artist || '未知艺术家')}
                </div>
              </div>
              <span className="text-xs text-gray-600">
                {track.duration ? formatDuration(track.duration) : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}