/**
 * Classify - Phân loại độ khó câu bằng Groq API
 *
 * Dùng model qwen-3-32b (nhanh, rẻ)
 * Fallback: rule-based nếu Groq không hoạt động
 */
import { estimateDifficulty } from './segment.js'

export class Classifier {
  constructor(groqService) {
    this.groq = groqService
  }

  async classifySegments(segments, onProgress) {
    const allResults = []

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      const sentences = segment.map(s => s.text)

      if (onProgress) onProgress(i, segments.length)

      try {
        const results = await this.groq.classifySentences(
          segment.map((s, idx) => ({ text: s.text, index: idx }))
        )

        // Map kết quả về đúng sentence
        if (Array.isArray(results) && results.length > 0) {
          for (const r of results) {
            if (segment[r.index]) {
              allResults.push({
                ...segment[r.index],
                difficulty: r.difficulty || estimateDifficulty(segment[r.index].text),
              })
            }
          }
        } else {
          // Fallback nếu API trả về format lạ
          segment.forEach(s => {
            allResults.push({ ...s, difficulty: estimateDifficulty(s.text) })
          })
        }
      } catch {
        // Fallback hoàn toàn nếu API lỗi
        segment.forEach(s => {
          allResults.push({ ...s, difficulty: estimateDifficulty(s.text) })
        })
      }

      // Delay giữa các segment để tránh rate limit
      if (i < segments.length - 1) {
        await new Promise(r => setTimeout(r, 1000))
      }
    }

    return allResults
  }
}
