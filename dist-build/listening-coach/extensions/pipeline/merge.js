/**
 * Merge - Gộp chunk transcript thành câu hoàn chỉnh
 *
 * Input: [{ text, start, duration }, ...]
 * Output: [{ text: "Full sentence.", start: 0.5, end: 4.9 }, ...]
 */
export function mergeChunksToSentences(chunks) {
  const sentences = []
  let current = { texts: [], start: chunks[0]?.start || 0 }
  let hasPunctuation = false

  for (const chunk of chunks) {
    const rawText = chunk.text.replace(/\n/g, ' ').trim()
    if (!rawText) continue

    // Kiểm tra xem transcript có dùng dấu câu không
    if (/[.!?]/.test(rawText)) hasPunctuation = true

    // Xử lý text có thể chứa nhiều câu trong 1 chunk
    const parts = splitBySentenceBoundary(rawText)

    for (const part of parts) {
      const cleaned = part.replace(/[♪♫]/g, '').trim()
      if (!cleaned) continue

      current.texts.push(cleaned)

      // Phát hiện cuối câu
      const isSentenceEnd = hasPunctuation
        ? /[.!?]$/.test(cleaned)
        : cleaned.length > 10

      if (isSentenceEnd) {
        const sentenceText = current.texts.join(' ')
        sentences.push({
          text: sentenceText,
          start: current.start,
          end: chunk.start + chunk.duration,
        })
        current = { texts: [], start: chunk.start + chunk.duration }
      }
    }
  }

  // Xử lý phần còn lại
  if (current.texts.length > 0) {
    const lastChunk = chunks[chunks.length - 1]
    const sentenceText = current.texts.join(' ')
    sentences.push({
      text: sentenceText,
      start: current.start,
      end: lastChunk.start + lastChunk.duration,
    })
  }

  // Lọc câu quá ngắn hoặc quá dài
  return sentences.filter(s => {
    const cleanText = s.text.replace(/[^\w\s]/g, '').trim()
    if (!cleanText) return false
    const wordCount = cleanText.split(/\s+/).length
    return wordCount >= 3 && wordCount <= 50
  })
}

function splitBySentenceBoundary(text) {
  // Nếu có nhiều câu trong 1 chunk
  const parts = text.match(/[^.!?]+[.!?]+/g)
  if (parts && parts.length > 1) return parts.map(p => p.trim())
  return [text]
}
