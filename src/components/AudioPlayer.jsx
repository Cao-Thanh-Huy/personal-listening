/**
 * AudioPlayer - Component phát audio với seek timestamp
 *
 * Props:
 * - audioPath: đường dẫn đến file MP3
 * - startTime: giây bắt đầu
 * - endTime: giây kết thúc
 * - compact: boolean (true = mini mode cho Quick popup)
 * - onPlayStateChange: callback(isPlaying)
 */
import { useEffect, useCallback } from 'react'
import useAudio from '../hooks/useAudio.js'

export default function AudioPlayer({ audioPath, startTime, endTime, compact = false, onPlayStateChange }) {
  const {
    isPlaying,
    error,
    audioLoaded,
    speed,
    setSpeed,
    loadAudio,
    playSegment,
    replay,
    togglePlay,
  } = useAudio()

  // Load audio khi path thay đổi
  useEffect(() => {
    if (audioPath) {
      loadAudio(audioPath)
    }
  }, [audioPath, loadAudio])

  // Gọi play khi có đủ thông tin
  useEffect(() => {
    if (audioLoaded && audioPath && startTime != null && endTime != null) {
      // Không tự động play — đợi user bấm nút
    }
  }, [audioLoaded, audioPath, startTime, endTime])

  // Thông báo trạng thái play
  useEffect(() => {
    onPlayStateChange?.(isPlaying)
  }, [isPlaying, onPlayStateChange])

  const handlePlay = useCallback(() => {
    playSegment(startTime, endTime)
  }, [playSegment, startTime, endTime])

  const speeds = [0.5, 0.75, 1.0, 1.25, 1.5]

  // Mini mode (cho Quick popup)
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={isPlaying ? togglePlay : handlePlay}
          disabled={!audioLoaded || !!error}
          className="btn btn-primary px-3 py-1 text-sm disabled:opacity-50"
          title={error || 'Play'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        <button
          onClick={replay}
          disabled={!audioLoaded}
          className="text-sm text-[#a0a0b0] hover:text-white disabled:opacity-30"
          title="Phát lại"
        >
          ↻
        </button>

        <select
          value={speed}
          onChange={(e) => setSpeed(parseFloat(e.target.value))}
          className="bg-[#0f0f23] border border-[#333] rounded text-xs px-1 py-0.5 text-[#a0a0b0] outline-none"
        >
          {speeds.map(s => (
            <option key={s} value={s}>{s}x</option>
          ))}
        </select>

        {error && <span className="text-xs text-red-400" title={error}>⚠️</span>}
        {!audioLoaded && !error && <span className="text-xs text-[#666]">⏳</span>}
      </div>
    )
  }

  // Full mode
  return (
    <div className="bg-[#0f0f23] rounded-lg p-3">
      {/* Controls */}
      <div className="flex items-center gap-3 mb-2">
        <button
          onClick={isPlaying ? togglePlay : handlePlay}
          disabled={!audioLoaded || !!error}
          className="btn btn-primary px-4 disabled:opacity-50"
          title={error || (isPlaying ? 'Pause' : 'Play')}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        <button
          onClick={replay}
          disabled={!audioLoaded}
          className="text-sm text-[#a0a0b0] hover:text-white disabled:opacity-30"
          title="Phát lại đoạn này"
        >
          ↻
        </button>

        <div className="flex-1 h-2 bg-[#333] rounded-full overflow-hidden">
          <div className="h-full bg-[#e94560] rounded-full transition-all" style={{ width: '0%' }} />
        </div>
      </div>

      {/* Speed */}
      <div className="flex gap-1">
        {speeds.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            disabled={!audioLoaded}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              speed === s
                ? 'bg-[#e94560] text-white'
                : 'bg-[#1a1a2e] text-[#a0a0b0] hover:bg-[#333]'
            } disabled:opacity-30`}
          >
            {s}x
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-400 mt-2">{error}</p>
      )}
      {!audioLoaded && !error && (
        <p className="text-xs text-[#666] mt-2">⏳ Đang tải audio...</p>
      )}
    </div>
  )
}
