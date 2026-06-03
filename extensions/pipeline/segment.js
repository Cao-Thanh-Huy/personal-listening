/**
 * Segment - Chia sentences thành segment ~45-90s cho Groq classification
 *
 * Mỗi segment chứa ~5-15 câu để gửi 1 API call
 */
export function segmentSentences(sentences) {
  const segments = []
  let current = []
  let currentDuration = 0

  for (const sentence of sentences) {
    const duration = sentence.end - sentence.start

    // Bắt đầu segment mới nếu:
    // - Segment hiện tại > 90s
    // - Hoặc có transition words + segment > 45s
    if (shouldStartNewSegment(current, currentDuration, sentence)) {
      if (current.length > 0) {
        segments.push(current)
      }
      current = [sentence]
      currentDuration = duration
    } else {
      current.push(sentence)
      currentDuration += duration
    }
  }

  // Thêm segment cuối
  if (current.length > 0) {
    segments.push(current)
  }

  return segments
}

function shouldStartNewSegment(current, currentDuration, nextSentence) {
  if (current.length === 0) return false
  if (currentDuration > 90) return true

  // Transition words báo hiệu ý mới
  const transitions = [
    'so', 'however', 'but', 'first', 'second', 'third',
    'finally', 'meanwhile', 'therefore', 'moreover',
    'additionally', 'furthermore', 'nevertheless', 'consequently',
    'in conclusion', 'on the other hand', 'as a result',
  ]

  const firstWord = nextSentence.text.toLowerCase().split(' ')[0]
  if (transitions.includes(firstWord) && currentDuration > 45) return true

  return false
}

/** Tính độ khó dựa vào số từ (fallback khi Groq không hoạt động) */
export function estimateDifficulty(text) {
  const words = text.split(/\s+/).length
  if (words <= 5) return 'easy'
  if (words <= 12) return 'medium'
  return 'hard'
}
