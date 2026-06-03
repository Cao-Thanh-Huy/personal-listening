/**
 * Groq Service - API calls + Rate Limiter
 *
 * Model chính: llama-3.3-70b-versatile (feedback)
 * Model fallback: qwen-3-32b (classification)
 */
import 'dotenv/config'

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions'
const API_KEY = process.env.GROQ_API_KEY || ''

export class GroqRateLimiter {
  constructor() {
    this.queue = []
    this.processing = false
    this.requestsThisMinute = 0
    this.requestsToday = 0
    this.lastMinuteReset = Date.now()
    this.lastDayReset = Date.now()

    setInterval(() => this.resetMinute(), 60000)
    setInterval(() => this.resetDay(), 86400000)
  }

  resetMinute() { this.requestsThisMinute = 0; this.lastMinuteReset = Date.now() }
  resetDay() { this.requestsToday = 0; this.lastDayReset = Date.now() }

  async call(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject })
      if (!this.processing) this.processQueue()
    })
  }

  async processQueue() {
    this.processing = true
    while (this.queue.length > 0) {
      if (this.requestsThisMinute >= 25) {
        const waitTime = 60000 - (Date.now() - this.lastMinuteReset)
        if (waitTime > 0) await this.sleep(waitTime)
      }
      if (this.requestsToday >= 950) {
        const waitTime = 86400000 - (Date.now() - this.lastDayReset)
        if (waitTime > 0) await this.sleep(Math.min(waitTime, 60000))
      }

      const { fn, resolve, reject } = this.queue.shift()
      try {
        this.requestsThisMinute++
        this.requestsToday++
        const result = await fn()
        resolve(result)
      } catch (err) {
        if (err.status === 429) {
          await this.sleep(15000)
          this.queue.unshift({ fn, resolve, reject })
        } else {
          reject(err)
        }
      }
      await this.sleep(500)
    }
    this.processing = false
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
}

const limiter = new GroqRateLimiter()

export class GroqService {
  constructor() {
    this.model = 'llama-3.3-70b-versatile'
    this.fallbackModel = 'qwen-3-32b'
  }

  async callGroq(prompt, model = this.model) {
    if (!API_KEY) return null

    return limiter.call(async () => {
      const res = await fetch(GROQ_API, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 2000,
          response_format: { type: 'json_object' },
        }),
      })

      if (res.status === 429) {
        const err = new Error('Rate limited')
        err.status = 429
        throw err
      }

      const data = await res.json()
      return JSON.parse(data.choices?.[0]?.message?.content || '{}')
    })
  }

  async classifySentences(sentences) {
    const prompt = `
Classify listening difficulty for these sentences.

RULES:
- easy: ≤5 words, common words, clear
- medium: 6-12 words, some connected speech
- hard: >12 words, fast, reductions, idioms

Sentences:
${sentences.map((s, i) => `${i}: "${s.text}"`).join('\n')}

Return JSON: { "classifications": [{ "index": 0, "difficulty": "easy" }, ...] }
`
    try {
      const result = await this.callGroq(prompt, this.fallbackModel)
      return result.classifications || []
    } catch {
      return this.fallbackClassify(sentences)
    }
  }

  async getFeedback(correctText, userInput, sourceContext) {
    const prompt = `
You are an English listening coach. Explain what the user misheard.

CORRECT: "${correctText}"
USER TYPED: "${userInput}"

Explain in 1-2 sentences what was misheard.
Focus on connected speech, reductions, or sounds the user missed.

Return JSON: { "feedback": "..." }
`
    try {
      const result = await this.callGroq(prompt)
      return result.feedback || 'Hãy nghe lại kỹ hơn.'
    } catch {
      return null
    }
  }

  async summarizeTranscript(fullText) {
    const prompt = `
Summarize this English transcript in 3-5 sentences.
Identify: topic, key points, tone (casual/formal/conversational).

Transcript: ${fullText.slice(0, 5000)}

Return JSON: { summary: "...", topic: "...", tone: "..." }
`
    try {
      return await this.callGroq(prompt)
    } catch {
      return { summary: '', topic: '', tone: '' }
    }
  }

  fallbackClassify(sentences) {
    return sentences.map((s, i) => ({
      index: i,
      difficulty: s.text.split(' ').length > 10 ? 'hard'
        : s.text.split(' ').length > 5 ? 'medium'
        : 'easy',
    }))
  }
}
