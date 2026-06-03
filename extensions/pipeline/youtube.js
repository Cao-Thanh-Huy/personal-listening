/**
 * YouTube Service - Fetch transcript + download audio
 *
 * Dùng youtube-transcript để lấy phụ đề
 * Dùng @distube/ytdl-core để download audio
 */
import { YoutubeTranscript } from 'youtube-transcript'
import ytdl from '@distube/ytdl-core'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AUDIO_DIR = path.resolve(__dirname, '../../audio')

/** Trích xuất videoId từ URL YouTube */
export function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  throw new Error('Invalid YouTube URL')
}

/** Lấy transcript từ YouTube */
export async function fetchTranscript(videoId) {
  const chunks = await YoutubeTranscript.fetchTranscript(videoId)
  return chunks.map(c => ({
    text: c.text,
    start: c.offset / 1000, // ms → seconds
    duration: c.duration / 1000,
  }))
}

/** Download audio từ YouTube (1 file MP3 duy nhất) */
export async function downloadAudio(videoId, onProgress) {
  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true })
  }

  const outputPath = path.join(AUDIO_DIR, `${videoId}.mp3`)

  // Skip nếu đã tồn tại
  if (fs.existsSync(outputPath)) {
    console.log(`✅ Audio already exists: ${outputPath}`)
    return outputPath
  }

  return new Promise((resolve, reject) => {
    const stream = ytdl(`https://www.youtube.com/watch?v=${videoId}`, {
      quality: 'lowestaudio',
      filter: 'audioonly',
    })

    const writeStream = fs.createWriteStream(outputPath)
    let downloaded = 0

    stream.on('progress', (_, total, downloadedBytes) => {
      downloaded = downloadedBytes
      if (onProgress) onProgress(50 + (downloadedBytes / total) * 30)
    })

    stream.pipe(writeStream)

    writeStream.on('finish', () => {
      console.log(`✅ Audio downloaded: ${outputPath}`)
      resolve(outputPath)
    })

    writeStream.on('error', reject)
    stream.on('error', reject)
  })
}

/** Lấy title video từ metadata */
export async function getVideoInfo(videoId) {
  try {
    const info = await ytdl.getBasicInfo(`https://www.youtube.com/watch?v=${videoId}`)
    return {
      title: info.videoDetails.title,
      author: info.videoDetails.author.name,
      duration: parseInt(info.videoDetails.lengthSeconds),
    }
  } catch {
    return { title: `Video ${videoId}`, author: '', duration: 0 }
  }
}
