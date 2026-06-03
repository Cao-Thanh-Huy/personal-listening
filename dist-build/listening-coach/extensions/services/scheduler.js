/**
 * Scheduler - Schedule engine + SRS
 *
 * Kiểm tra DB mỗi 30s cho câu đến hạn.
 * Gửi event 'schedule:due' về Neutralino để hiện popup.
 */
import { getDueSentence, calculateNextReview } from '../db/queries.js'

export class Scheduler {
  constructor() {
    this.interval = null
    this.skipCount = 0
    this.pausedUntil = null
    this.morningBurstDone = false
  }

  start(intervalMs = 30000) {
    console.log(`⏰ Scheduler started (check every ${intervalMs / 1000}s)`)
    this.interval = setInterval(() => this.check(), intervalMs)

    // Kiểm tra ngay khi start
    setTimeout(() => this.check(), 1000)
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  check() {
    // Check pause
    if (this.pausedUntil && Date.now() < this.pausedUntil) return
    this.pausedUntil = null

    try {
      const due = getDueSentence()
      if (due) {
        this.sendDueEvent(due)
      }
    } catch (err) {
      console.error('Scheduler check error:', err)
    }
  }

  sendDueEvent(sentence) {
    // Gửi về Neutralino qua stdout
    process.stdout.write(JSON.stringify({
      type: 'event',
      event: 'schedule:due',
      data: { sentence, source: { id: sentence.source_id, title: sentence.source_title } },
    }) + '\n')
  }

  onSkip() {
    this.skipCount++
    if (this.skipCount >= 3) {
      this.pausedUntil = Date.now() + 30 * 60 * 1000 // 30 phút
      this.skipCount = 0
      console.log('⏸️ Smart postpone: paused 30 min (3 skips)')
    }
  }

  onMorningBurst() {
    if (this.morningBurstDone) return
    this.morningBurstDone = true
    // TODO: gửi nhiều câu cùng lúc
  }
}
