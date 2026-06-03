#!/usr/bin/env node

/**
 * Listening Coach - Neutralino Extension
 *
 * Chạy background cùng Neutralino app.
 * Xử lý: DB operations, schedule engine, Groq API, scoring.
 *
 * Giao tiếp qua stdio với Neutralino (IPC).
 * Frontend gửi events → extension xử lý → gửi kết quả về.
 */
import { initSchema } from './db/schema.js'
import { getDb } from './db/schema.js'
import { getDueSentence, getAllSources, getUserStats, updateMastery, saveAttempt, updateUserStats } from './db/queries.js'
import { GroqService } from './services/groq.js'
import { Scorer } from './services/scoring.js'
import { Scheduler } from './services/scheduler.js'
import { Classifier } from './pipeline/classify.js'
import { Summarizer } from './pipeline/summarize.js'

// ─── Init ───
initSchema()

const groq = new GroqService()
const scorer = new Scorer()
const scheduler = new Scheduler()
const classifier = new Classifier(groq)
const summarizer = new Summarizer(groq)

// Start scheduler khi extension khởi động
scheduler.start(30000)

// ─── Lưu accessToken từ Neutralino ───
let NL_ACCESS_TOKEN = ''

// ─── IPC: xử lý events từ Neutralino ───
let buffer = ''
process.stdin.on('data', async (chunk) => {
  buffer += chunk.toString()
  const lines = buffer.split('\n')
  buffer = lines.pop() || ''

  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const msg = JSON.parse(line.trim())

      // Lưu accessToken từ Neutralino
      if (msg.accessToken) {
        NL_ACCESS_TOKEN = msg.accessToken
      }

      // Xử lý method
      const params = msg.data || msg.params || {}
      switch (msg.method) {
        case 'import:start':
          handleImport(msg.id, params.url || params)
          break

        case 'scoring:submit':
          await handleScoring(msg.id, params)
          break

        case 'schedule:check':
          handleScheduleCheck(msg.id)
          break

        case 'challenge:skip':
          scheduler.onSkip()
          sendResult(msg.id, { ok: true })
          break

        case 'stats:get':
          sendResult(msg.id, getUserStats())
          break

        case 'sources:list':
          sendResult(msg.id, getAllSources())
          break

        case 'settings:save':
          handleSettingsSave(msg.id, params)
          break

        default:
          sendError(msg.id, `Unknown method: ${msg.method}`)
      }
    } catch (err) {
      console.error('IPC error:', err.message)
    }
  }
})

// ─── Handlers ───

async function handleImport(id, url) {
  try {
    const db = getDb()

    // Step 1: Extract video ID + fetch transcript
    sendProgress(id, 5, '🔍 Extracting video info...')
    const { extractVideoId, fetchTranscript, downloadAudio, getVideoInfo } = await import('./pipeline/youtube.js')
    const { mergeChunksToSentences } = await import('./pipeline/merge.js')
    const { segmentSentences } = await import('./pipeline/segment.js')

    const videoId = extractVideoId(url)
    sendProgress(id, 10, '📝 Fetching transcript...')

    let chunks, videoInfo
    try {
      ;[chunks, videoInfo] = await Promise.all([
        fetchTranscript(videoId),
        getVideoInfo(videoId),
      ])
    } catch (err) {
      throw new Error('Không thể lấy transcript. Video có thể không có phụ đề.')
    }

    if (!chunks || chunks.length === 0) {
      throw new Error('Video không có transcript hoặc transcript rỗng.')
    }

    // Step 2: Merge chunks → sentences
    sendProgress(id, 25, '🧩 Merging sentences...')
    const sentences = mergeChunksToSentences(chunks)
    if (sentences.length === 0) {
      throw new Error('Không thể merge transcript thành câu hoàn chỉnh.')
    }

    // Step 3: Download audio (1 file)
    sendProgress(id, 40, '⬇️ Downloading audio...')
    let audioPath = ''
    try {
      audioPath = await downloadAudio(videoId, (pct) => {
        sendProgress(id, Math.round(pct), '⬇️ Downloading audio...')
      })
    } catch (err) {
      console.warn('⚠️ Audio download failed (proceeding without audio):', err.message)
      audioPath = ''
    }

    // Step 4: Segment for classification
    sendProgress(id, 55, '📦 Segmenting sentences...')
    const segments = segmentSentences(sentences)

    // Step 5: Groq classify
    sendProgress(id, 60, '🤖 Classifying difficulty (Groq)...')
    const classified = await classifier.classifySegments(segments, (i, total) => {
      const pct = 60 + ((i / total) * 20)
      sendProgress(id, Math.round(pct), `🤖 Classifying ${i + 1}/${total} segments...`)
    })

    // Step 6: Groq summarize
    sendProgress(id, 85, '📝 Summarizing video (Groq)...')
    const fullText = sentences.map(s => s.text).join(' ')
    const summary = await summarizer.summarize(fullText)

    // Step 7: Save to DB
    sendProgress(id, 92, '💾 Saving to database...')

    const dbRun = db.prepare(`
      INSERT OR IGNORE INTO sources (url, title, audio_path, summary, topic, tone)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const result = dbRun.run(
      url,
      videoInfo.title || `Video ${videoId}`,
      audioPath || '',
      summary.summary,
      summary.topic,
      summary.tone,
    )
    const sourceId = result.lastInsertRowid || db.prepare(`SELECT id FROM sources WHERE url = ?`).get(url)?.id

    // Insert sentences
    const insertSentence = db.prepare(`
      INSERT INTO sentences (source_id, text, difficulty, start_time, end_time, next_review_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `)

    const transaction = db.transaction(() => {
      for (const s of classified) {
        insertSentence.run(sourceId, s.text, s.difficulty || 'medium', s.start, s.end)
      }
    })
    transaction()

    sendProgress(id, 100, `✅ Imported ${classified.length} sentences!`)
    sendResult(id, { success: true, sentenceCount: classified.length, sourceId })
  } catch (err) {
    console.error('Import error:', err)
    sendProgress(id, 0, `❌ ${err.message}`)
    sendError(id, err.message)
  }
}

async function handleScoring(id, { sentenceId, userInput }) {
  try {
    const sentence = (await import('./db/queries.js')).getSentenceById(sentenceId)
    if (!sentence) {
      sendError(id, 'Sentence not found')
      return
    }

    // Fuzzy scoring
    const score = scorer.fuzzyMatch(userInput, sentence.text)
    const pass = score >= 90

    // Mastery update: Pass +10, Fail -3
    const masteryDelta = pass ? 10 : -3

    // XP: dựa vào difficulty
    const xpMap = { easy: 5, medium: 10, hard: 20 }
    const xp = pass ? (xpMap[sentence.difficulty] || 10) : 2

    // Update DB
    const update = updateMastery(sentenceId, pass, masteryDelta, xp)

    // Groq feedback (chỉ khi fail)
    let feedback = null
    if (!pass) {
      try {
        feedback = await groq.getFeedback(sentence.text, userInput, sentence.source_id)
      } catch (e) {
        feedback = 'Hãy nghe lại và chú ý phát âm của người nói.'
      }
    }

    // Save attempt
    saveAttempt(sentenceId, userInput, score, feedback, masteryDelta, xp)
    updateUserStats(pass, xp)

    sendResult(id, {
      pass,
      score,
      feedback,
      masteryDelta,
      xp,
      newMastery: update.newMastery,
      mastered: update.newMastered,
    })
  } catch (err) {
    sendError(id, err.message)
  }
}

function handleScheduleCheck(id) {
  const due = getDueSentence()
  sendResult(id, { due })
}

function handleSettingsSave(id, params) {
  // TODO: Save settings to DB / file
  sendResult(id, { success: true })
}

// ─── IPC Helpers ───

function sendResult(id, data) {
  process.stdout.write(JSON.stringify({ id, type: 'result', data }) + '\n')
}

function sendError(id, error) {
  process.stdout.write(JSON.stringify({ id, type: 'error', error }) + '\n')
}

function sendProgress(id, percent, message) {
  process.stdout.write(JSON.stringify({ id, type: 'progress', percent, message }) + '\n')
}

