/**
 * Database Queries - Listening Coach
 * CRUD operations + SRS schedule query
 */
import { getDb } from './schema.js'

// ─── Sentences ───

export function getDueSentence() {
  const db = getDb()
  return db.prepare(`
    SELECT s.*, src.audio_path, src.summary, src.title as source_title
    FROM sentences s
    JOIN sources src ON s.source_id = src.id
    WHERE (s.next_review_at IS NULL AND s.mastered = 0)
       OR s.next_review_at <= datetime('now')
    ORDER BY
      s.mastery_score ASC,
      s.fail_count DESC,
      s.next_review_at ASC
    LIMIT 1
  `).get() || null
}

export function getSentenceById(id) {
  const db = getDb()
  return db.prepare(`SELECT * FROM sentences WHERE id = ?`).get(id)
}

export function getSentencesBySource(sourceId) {
  const db = getDb()
  return db.prepare(`
    SELECT * FROM sentences WHERE source_id = ? ORDER BY start_time ASC
  `).all(sourceId)
}

// ─── Scoring & Mastery ───

export function updateMastery(sentenceId, pass, masteryDelta, xp) {
  const db = getDb()
  const sentence = getSentenceById(sentenceId)
  if (!sentence) return null

  const newMastery = Math.max(0, Math.min(100, sentence.mastery_score + masteryDelta))
  const newPassCount = sentence.pass_count + (pass ? 1 : 0)
  const newFailCount = sentence.fail_count + (pass ? 0 : 1)
  const newMastered = newMastery >= 30 ? 1 : 0
  const nextReviewAt = calculateNextReview(newMastery)

  db.prepare(`
    UPDATE sentences SET
      mastery_score = ?,
      pass_count = ?,
      fail_count = ?,
      mastered = ?,
      last_reviewed = datetime('now'),
      next_review_at = ?,
      xp_earned = xp_earned + ?
    WHERE id = ?
  `).run(newMastery, newPassCount, newFailCount, newMastered, nextReviewAt, xp, sentenceId)

  return { newMastery, newMastered, newPassCount }
}

export function saveAttempt(sentenceId, userInput, score, feedback, masteryDelta, xp) {
  const db = getDb()
  db.prepare(`
    INSERT INTO attempts (sentence_id, user_input, score, feedback, mastery_delta, xp_earned)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sentenceId, userInput, score, feedback, masteryDelta, xp)
}

// ─── SRS: tính next_review_at ───

export function calculateNextReview(masteryScore) {
  const now = new Date()

  const delays = {
    0: 30 / (24 * 60),    // 0-9:   30 phút
    1: 1,                  // 10-19: 1 ngày
    2: 3,                  // 20-29: 3 ngày
    3: 7,                  // 30-49: 7 ngày
    4: 14,                 // 50-69: 14 ngày
    5: 30,                 // 70+:   30 ngày
  }

  const level = Math.min(Math.floor(masteryScore / 10), 5)
  const days = delays[level]

  const nextDate = new Date(now)
  nextDate.setDate(nextDate.getDate() + days)

  return nextDate.toISOString().replace('T', ' ').slice(0, 19)
}

// ─── Sources ───

export function getAllSources() {
  const db = getDb()
  return db.prepare(`SELECT * FROM sources ORDER BY created_at DESC`).all()
}

export function getSourceById(id) {
  const db = getDb()
  return db.prepare(`SELECT * FROM sources WHERE id = ?`).get(id)
}

export function deleteSource(id) {
  const db = getDb()
  db.prepare(`DELETE FROM sources WHERE id = ?`).run(id)
}

// ─── User Stats ───

export function getUserStats() {
  const db = getDb()
  return db.prepare(`SELECT * FROM user_stats WHERE id = 1`).get()
}

export function updateUserStats(pass, xp) {
  const db = getDb()
  const today = new Date().toISOString().slice(0, 10)
  const stats = getUserStats()

  const newStreak = stats.last_active_date === today
    ? stats.streak_days
    : stats.last_active_date === yesterday()
      ? stats.streak_days + 1
      : 1

  const newXp = stats.total_xp + xp
  const newLevel = Math.floor(newXp / 500) + 1

  db.prepare(`
    UPDATE user_stats SET
      total_xp = ?,
      level = ?,
      total_attempts = total_attempts + 1,
      total_pass = total_pass + ?,
      streak_days = ?,
      last_active_date = ?,
      sentences_mastered_today = ?
    WHERE id = 1
  `).run(newXp, newLevel, pass ? 1 : 0, newStreak, today, 0)
}

function yesterday() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}
