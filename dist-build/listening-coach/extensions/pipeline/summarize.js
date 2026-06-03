/**
 * Summarize - Tóm tắt video bằng Groq API
 *
 * Dùng model llama-3.3-70b-versatile (chất lượng cao)
 * Output: { summary, topic, tone }
 */
export class Summarizer {
  constructor(groqService) {
    this.groq = groqService
  }

  async summarize(fullText) {
    try {
      const result = await this.groq.summarizeTranscript(fullText)
      return {
        summary: result.summary || '',
        topic: result.topic || 'general',
        tone: result.tone || 'neutral',
      }
    } catch {
      return { summary: '', topic: 'general', tone: 'neutral' }
    }
  }
}
