/**
 * useAudio - Hook for audio playback with seek-to-timestamp
 *
 * Trong Neutralino, audio files được load từ filesystem.
 * Hỗ trợ: play(start, end), speed control, auto-stop
 */
import { useState, useRef, useCallback, useEffect } from 'react'

export default function useAudio() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState(1.0)
  const [error, setError] = useState(null)
  const [audioLoaded, setAudioLoaded] = useState(false)

  const audioRef = useRef(null)
  const endTimeRef = useRef(0)
  const startTimeRef = useRef(0)
  const rafRef = useRef(null)

  // Khởi tạo Audio element một lần
  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'auto'
    audioRef.current = audio

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
      // Auto-stop khi đến endTime
      if (endTimeRef.current > 0 && audio.currentTime >= endTimeRef.current) {
        audio.pause()
        setIsPlaying(false)
      }
    }

    const onLoaded = () => {
      setDuration(audio.duration)
      setAudioLoaded(true)
      setError(null)
    }

    const onError = (e) => {
      const mediaError = audio.error
      let msg = 'Không thể load audio'
      if (mediaError) {
        switch (mediaError.code) {
          case MediaError.MEDIA_ERR_NETWORK: msg = 'Lỗi mạng khi tải audio'; break
          case MediaError.MEDIA_ERR_DECODE: msg = 'Audio không decode được'; break
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: msg = 'File audio không hỗ trợ'; break
        }
      }
      setError(msg)
      setAudioLoaded(false)
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('canplay', onLoaded)
    audio.addEventListener('error', onError)

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('canplay', onLoaded)
      audio.removeEventListener('error', onError)
      audio.pause()
      audio.src = ''
    }
  }, [])

  // Cập nhật speed
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed
    }
  }, [speed])

  /** Load audio từ file path */
  const loadAudio = useCallback(async (audioPath) => {
    setError(null)
    setAudioLoaded(false)

    try {
      let src = ''

      if (window.Neutralino) {
        // Trong Neutralino: đọc file qua filesystem API
        const binaryData = await Neutralino.filesystem.readBinaryFile(audioPath)
        const blob = new Blob([binaryData], { type: 'audio/mpeg' })
        src = URL.createObjectURL(blob)
      } else {
        // Dev mode (Vite): dùng đường dẫn tương đối
        src = audioPath
      }

      if (audioRef.current) {
        // Revoke URL cũ nếu có
        if (audioRef.current.dataset.blobUrl) {
          URL.revokeObjectURL(audioRef.current.dataset.blobUrl)
        }
        audioRef.current.src = src
        audioRef.current.dataset.blobUrl = src.startsWith('blob:') ? src : ''
        audioRef.current.load()
      }
    } catch (err) {
      setError(`Không thể load audio: ${err.message}`)
    }
  }, [])

  /** Play 1 đoạn từ start đến end (giây) */
  const playSegment = useCallback((startTime, endTime) => {
    const audio = audioRef.current
    if (!audio || !audio.src) return

    startTimeRef.current = startTime
    endTimeRef.current = endTime

    audio.currentTime = startTime
    audio.playbackRate = speed
    audio.play()
    setIsPlaying(true)
  }, [speed])

  /** Phát lại từ đầu */
  const replay = useCallback(() => {
    if (startTimeRef.current > 0 && endTimeRef.current > 0) {
      playSegment(startTimeRef.current, endTimeRef.current)
    }
  }, [playSegment])

  /** Toggle play/pause */
  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return

    if (audio.paused) {
      audio.play()
      setIsPlaying(true)
    } else {
      audio.pause()
      setIsPlaying(false)
    }
  }, [])

  /** Dừng và reset */
  const stop = useCallback(() => {
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.currentTime = 0
      setIsPlaying(false)
    }
  }, [])

  return {
    isPlaying,
    currentTime,
    duration,
    speed,
    error,
    audioLoaded,
    setSpeed,
    loadAudio,
    playSegment,
    replay,
    togglePlay,
    stop,
  }
}
