Rất hợp lý! Cả 2 cải tiến đều làm app nhẹ và thực tế hơn.

## 1. Mastery System mới:

```text
Pass = +1 (tối đa 3)
Fail = -1 (tối thiểu 0)
Mastered khi đạt 3

Flow:
0 → Pass → 1
1 → Pass → 2  
2 → Fail → 1
1 → Pass → 2
2 → Pass → 3 → Mastered ✅

Không reset về 0, chỉ giảm 1 bậc.
→ Đỡ nản, vẫn giữ được progress
→ Fail nhiều vẫn phải học lại nhưng không mất hết
```

```javascript
function updateProgress(sentenceId, score) {
  const sentence = db.prepare('SELECT * FROM sentences WHERE id = ?').get(sentenceId)
  
  if (score >= 90) {
    // Pass: +1, max = 3
    const newCount = Math.min(sentence.pass_count + 1, 3)
    const mastered = newCount === 3 ? 1 : 0
    
    db.prepare(`
      UPDATE sentences 
      SET pass_count = ?, mastered = ?, last_reviewed = datetime('now')
      WHERE id = ?
    `).run(newCount, mastered, sentenceId)
    
  } else {
    // Fail: -1, min = 0
    const newCount = Math.max(sentence.pass_count - 1, 0)
    
    db.prepare(`
      UPDATE sentences 
      SET pass_count = ?, mastered = 0, last_reviewed = datetime('now')
      WHERE id = ?
    `).run(newCount, sentenceId)
  }
}
```

---

## 2. Audio từ file gốc, không cắt:

```text
Thay vì:
video_01/
  ├── audio_full.mp3
  └── clips/
      ├── sentence_001.mp3
      ├── sentence_002.mp3
      ├── sentence_003.mp3
      └── ... (1000 files)

Thành:
video_01/
  └── audio_full.mp3 (1 file duy nhất)

Mỗi sentence chỉ lưu: start_time, end_time
Play: seek đến start_time, stop ở end_time
```

```javascript
// Player đơn giản
class SentencePlayer {
  constructor(audioPath) {
    this.audio = new Audio(audioPath)
    this.endTime = 0
  }
  
  play(startTime, endTime) {
    this.audio.currentTime = startTime
    this.endTime = endTime
    
    // Tự stop khi đến endTime
    this.audio.addEventListener('timeupdate', () => {
      if (this.audio.currentTime >= this.endTime) {
        this.audio.pause()
      }
    })
    
    this.audio.play()
  }
  
  setSpeed(rate) {
    this.audio.playbackRate = rate // 0.5, 0.75, 1, 1.25, 1.5
  }
  
  stop() {
    this.audio.pause()
    this.audio.currentTime = 0
  }
}

// Usage:
const player = new SentencePlayer('podcast_01.mp3')
player.play(523.2, 526.7) // Play câu từ giây 523.2 đến 526.7
```

---

## Database Schema cập nhật:

```sql
CREATE TABLE sources (
  id INTEGER PRIMARY KEY,
  url TEXT,
  title TEXT,
  audio_path TEXT,          -- Đường dẫn đến 1 file audio duy nhất
  summary TEXT,
  topic TEXT,
  tone TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sentences (
  id INTEGER PRIMARY KEY,
  source_id INTEGER,
  text TEXT,
  difficulty TEXT,          -- easy/medium/hard
  start_time REAL,          -- Thời điểm bắt đầu trong audio
  end_time REAL,            -- Thời điểm kết thúc
  pass_count INTEGER DEFAULT 0,
  mastered BOOLEAN DEFAULT FALSE,
  last_reviewed DATETIME,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE TABLE attempts (
  id INTEGER PRIMARY KEY,
  sentence_id INTEGER,
  user_input TEXT,
  score INTEGER,
  feedback TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sentence_id) REFERENCES sentences(id)
);
```

---

## FULL SUMMARY - Listening Coach V1

### 🎯 Core Value
> Nghe → Gõ lại → Biết sai ở đâu → Lặp đến khi mastered

### 🔄 User Flow

```text
1. IMPORT: Paste YouTube URL
2. PROCESS: Tự động xử lý (~30s)
3. LEARN: Popup hiện theo schedule
4. SUBMIT: Nghe → Gõ → Chấm điểm
5. FEEDBACK: Biết sai ở đâu, vì sao
6. REPEAT: Đạt 3 pass → Mastered
```

---

## 🛠 Tech Stack

```text
Framework:  Tauri v2 + React + TailwindCSS
Backend:    Node.js sidecar
Database:   SQLite (better-sqlite3)
AI:         Groq API (free tier)
Audio:      HTML5 Audio element (seek theo timestamp)
Transcript: youtube-transcript-api
Audio DL:   yt-dlp (download audio từ YouTube)
Popup:      Tauri Window API
Schedule:   setInterval + SQLite query
Scoring:    Local fuzzy matching (fuzz.js)
```

---

## 📦 Processing Pipeline

### Bước 1: Lấy transcript
```javascript
const transcript = YoutubeTranscript.fetchTranscript(videoId)
// [{ text: "...", start: 0.5, duration: 2.3 }, ...]
```

### Bước 2: Merge thành câu hoàn chỉnh
```javascript
// Gộp chunk nhỏ → câu dựa vào . ! ?
// [{ text: "Full sentence.", start: 0.5, end: 4.9 }, ...]
```

### Bước 3: Download audio (1 file)
```javascript
// yt-dlp download audio, không cần video
yt-dlp -x --audio-format mp3 -o "audio/%(id)s.mp3" {url}
// Lưu 1 file: audio/abc123.mp3
```

### Bước 4: Chia đoạn thông minh (~45-90s)
```javascript
// Dựa vào:
// - Transition words (so, however, first, second...)
// - Natural gaps (pause > 1.5s)
// - Đảm bảo không cắt ngang câu/ý
// Output: [[sentence1, sentence2, ...], [sentence8, ...], ...]
```

### Bước 5: AI phân loại từng đoạn (Groq)
```javascript
// Prompt cho mỗi đoạn:
classifyPrompt = `
Classify listening difficulty for these sentences.
Segment: ${sentences.length} sentences, ~${duration}s

RULES:
- easy: ≤5 words, common words, clear
- medium: 6-12 words, some connected speech
- hard: >12 words, fast, reductions, idioms

Sentences:
0: "How are you?"
1: "I would've gone there if I'd known"

Return JSON: [{"index": 0, "difficulty": "easy"}, ...]
`

// 6-8 API calls cho video 10 phút
```

### Bước 6: Tóm tắt toàn video (Groq)
```javascript
// 1 API call duy nhất
summarizePrompt = `
Summarize this transcript in 3-5 sentences:
Topic, key points, tone.

Transcript: ${fullText}

Return JSON: { summary: "...", topic: "...", tone: "..." }
`
```

### Bước 7: Lưu SQLite
```javascript
// 1 source → 1 audio file
// Mỗi sentence → start_time + end_time
// Không cần cắt audio
```

---

## 📱 Popup Challenge

```text
Mỗi X phút → Popup xuất hiện:
┌─────────────────────────────┐
│  🎧 Listen & Type           │
│                             │
│  [▶️ Play Audio]            │
│                             │
│  Type what you hear:        │
│  [_____________________]    │
│                             │
│  Speed: [0.5x][0.75x][1x]  │
│         [1.25x][1.5x]      │
│                             │
│  [Submit] [Skip]            │
└─────────────────────────────┘
```

---

## 🎯 Scoring & Mastery

### Scoring (local fuzzy)
```javascript
const score = fuzz.ratio(userInput.toLowerCase(), correctText.toLowerCase())
// score: 0-100
// >= 90: PASS
// < 90: gọi Groq feedback
```

### Mastery System
```text
Pass (+1): score >= 90
Fail (-1): score < 90
Min: 0
Mastered: đạt 3

Ví dụ:
0 → Pass → 1
1 → Pass → 2  
2 → Fail → 1 (không reset về 0)
1 → Pass → 2
2 → Pass → 3 → Mastered ✅
```

### Feedback (Groq, chỉ khi fail)
```javascript
feedbackPrompt = `
VIDEO CONTEXT: ${videoSummary}

CORRECT: "${correctText}"
USER TYPED: "${userInput}"

Explain in 1-2 sentences what was misheard, using context.
Focus on connected speech or reduced sounds.

Return JSON: { score: 85, feedback: "..." }
`
```

---

## 📈 Schedule Logic

```javascript
// Check mỗi 30s, lấy câu đến hạn
setInterval(() => {
  const due = db.prepare(`
    SELECT s.*, src.audio_path, src.summary
    FROM sentences s
    JOIN sources src ON s.source_id = src.id
    WHERE s.mastered = 0 
    AND (s.last_reviewed IS NULL 
         OR s.last_reviewed < datetime('now', '-5 minutes'))
    ORDER BY 
      CASE s.difficulty 
        WHEN 'hard' THEN 1 
        WHEN 'medium' THEN 2 
        WHEN 'easy' THEN 3 
      END,
      s.pass_count ASC,
      s.last_reviewed ASC
    LIMIT 1
  `).get()
  
  if (due) showPopup(due)
}, 30000)

// Ưu tiên: hard → medium → easy
// Trong cùng độ khó: pass_count thấp trước (cần ôn hơn)
// Sau đó: lâu chưa review trước
```

---

## 💰 API Cost (Groq Free)

```text
Groq free tier: 30 req/min, 1000 req/day

1 video 10 phút:
- Classify: 7-9 calls (1 lần khi import)
- Summarize: 1 call (1 lần khi import)
Total import: ~10 calls

Học hàng ngày (100 challenges):
- 90 câu đúng: 0 API call
- 10 câu sai: 10 calls
Total daily: ~10 calls

→ GROQ FREE QUÁ ĐỦ cho personal use
```

---

## 📊 Database Schema

```sql
CREATE TABLE sources (
  id INTEGER PRIMARY KEY,
  url TEXT,
  title TEXT,
  audio_path TEXT,
  summary TEXT,
  topic TEXT,
  tone TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sentences (
  id INTEGER PRIMARY KEY,
  source_id INTEGER,
  text TEXT,
  difficulty TEXT,
  start_time REAL,
  end_time REAL,
  pass_count INTEGER DEFAULT 0,
  mastered BOOLEAN DEFAULT FALSE,
  last_reviewed DATETIME,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE TABLE attempts (
  id INTEGER PRIMARY KEY,
  sentence_id INTEGER,
  user_input TEXT,
  score INTEGER,
  feedback TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sentence_id) REFERENCES sentences(id)
);
```

---

## 🏗 Cấu trúc thư mục

```text
listening-coach/
├── audio/
│   ├── abc123.mp3      # 1 file/video
│   └── def456.mp3
├── data/
│   └── listening.db     # SQLite
├── src/
│   ├── import.js        # Pipeline import
│   ├── player.js        # Audio player (seek)
│   ├── popup.js         # Popup UI
│   ├── schedule.js      # Schedule engine
│   └── scoring.js       # Fuzzy + mastery
└── package.json
```

---

## ✅ MVP Scope

```text
CÓ:
✅ YouTube import
✅ 1 audio file/video, seek theo timestamp
✅ Smart segmentation
✅ AI difficulty classification
✅ AI tóm tắt video
✅ Popup schedule
✅ Audio speed control
✅ Local fuzzy scoring
✅ AI feedback khi sai (kèm context)
✅ Mastery: Pass +1, Fail -1, Mastered = 3
✅ SQLite local storage

CHƯA CÓ (thêm sau nếu cần):
❌ Phát âm / Speaking
❌ Grammar lessons
❌ Vocabulary lists
❌ Cloud sync
❌ Mobile app
```

---

**Tổng: ~500-800 dòng code, build 3-5 ngày, 0 đồng, nhẹ, gọn, dùng ngon.** 🎯



Đúng rồi! Groq free có rate limit. Phải handle cẩn thận không là lỗi 429.

## Groq Rate Limit Handler

### Groq Free Tier Limits:
```text
- 30 requests/phút
- 1000 requests/ngày
- Nếu vượt → 429 Too Many Requests
```

---

### Implementation:

```javascript
class GroqRateLimiter {
  constructor() {
    this.queue = []
    this.processing = false
    this.requestsThisMinute = 0
    this.requestsToday = 0
    this.lastMinuteReset = Date.now()
    this.lastDayReset = Date.now()
    
    // Tự reset counter mỗi phút
    setInterval(() => this.resetMinute(), 60000)
    // Tự reset counter mỗi ngày  
    setInterval(() => this.resetDay(), 86400000)
  }
  
  resetMinute() {
    this.requestsThisMinute = 0
    this.lastMinuteReset = Date.now()
    console.log('🔄 Reset minute counter')
  }
  
  resetDay() {
    this.requestsToday = 0
    this.lastDayReset = Date.now()
    console.log('🔄 Reset daily counter')
  }
  
  async callWithLimit(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject })
      if (!this.processing) {
        this.processQueue()
      }
    })
  }
  
  async processQueue() {
    this.processing = true
    
    while (this.queue.length > 0) {
      // Check rate limit
      if (this.requestsThisMinute >= 25) { // Để buffer 5 requests
        const waitTime = 60000 - (Date.now() - this.lastMinuteReset)
        console.log(`⏳ Rate limit gần đạt, đợi ${Math.round(waitTime/1000)}s...`)
        await this.sleep(waitTime)
      }
      
      if (this.requestsToday >= 950) { // Để buffer 50 requests
        const waitTime = 86400000 - (Date.now() - this.lastDayReset)
        console.log(`⏳ Daily limit gần đạt, đợi ${Math.round(waitTime/1000/3600)}h...`)
        await this.sleep(waitTime)
      }
      
      // Lấy request tiếp theo
      const { fn, resolve, reject } = this.queue.shift()
      
      try {
        this.requestsThisMinute++
        this.requestsToday++
        
        console.log(`📡 API Call #${this.requestsToday} today (${this.requestsThisMinute}/min)`)
        
        const result = await fn()
        resolve(result)
        
      } catch (error) {
        if (error.status === 429) {
          // Rate limited → đợi rồi thử lại
          console.log('⚠️ Rate limited (429), đợi 15s rồi thử lại...')
          await this.sleep(15000)
          
          // Đẩy lại vào queue
          this.queue.unshift({ fn, resolve, reject })
          
        } else {
          reject(error)
        }
      }
      
      // Delay nhẹ giữa các request để tránh burst
      await this.sleep(500)
    }
    
    this.processing = false
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// Singleton
const groqLimiter = new GroqRateLimiter()
```

---

### Sử dụng:

```javascript
// Wrap Groq API call
async function callGroq(prompt) {
  return groqLimiter.callWithLimit(async () => {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 4000,
        response_format: { type: 'json_object' }
      })
    })
    
    if (response.status === 429) {
      const error = new Error('Rate limited')
      error.status = 429
      throw error
    }
    
    return response.json()
  })
}
```

---

### Xử lý trong pipeline import:

```javascript
async function processVideo(url) {
  // ... steps 1-3 ...
  
  // Bước 4: Classify từng segment (có rate limit)
  console.log(`🤖 Phân loại ${segments.length} đoạn...`)
  
  const classifiedSentences = []
  for (let i = 0; i < segments.length; i++) {
    console.log(`  Đoạn ${i+1}/${segments.length}...`)
    
    const result = await callGroq(classifyPrompt(segments[i]))
    classifiedSentences.push(...result.sentences)
    
    // Nếu còn segment và sắp hết quota phút này
    if (i < segments.length - 1 && groqLimiter.requestsThisMinute >= 25) {
      console.log('  ⏸️ Tạm dừng để đợi quota phút mới...')
    }
  }
  
  // Bước 5: Summarize
  console.log('📝 Tạo tóm tắt...')
  const summary = await callGroq(summarizePrompt(allText))
  
  // ...
}
```

---

### Monitor đơn giản:

```javascript
function showRateLimitStatus() {
  console.log(`
📊 Rate Limit Status:
  Phút này: ${groqLimiter.requestsThisMinute}/30
  Hôm nay:  ${groqLimiter.requestsToday}/1000
  Queue:    ${groqLimiter.queue.length} requests đang đợi
  `)
}

// Check mỗi 30s
setInterval(showRateLimitStatus, 30000)
```

---

### UI Feedback khi đợi:

```javascript
// Trong quá trình import, nếu phải đợi:
function showImportProgress(segments, currentIndex) {
  const progress = Math.round((currentIndex / segments.length) * 100)
  
  if (groqLimiter.requestsThisMinute >= 28) {
    const secondsLeft = Math.round(
      (60000 - (Date.now() - groqLimiter.lastMinuteReset)) / 1000
    )
    return `⏳ Đang xử lý... ${progress}% (Đợi quota mới: ${secondsLeft}s)`
  }
  
  return `🔄 Đang xử lý... ${progress}%`
}
```

---

### Backup: Nếu API fail hoàn toàn:

```javascript
function fallbackClassify(sentences) {
  // Phân loại đơn giản dựa vào rules nếu Groq chết
  return sentences.map(s => ({
    ...s,
    difficulty: s.text.split(' ').length > 10 ? 'hard' 
              : s.text.split(' ').length > 5 ? 'medium' 
              : 'easy'
  }))
}

async function classifyWithRetry(segment, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await callGroq(classifyPrompt(segment))
    } catch (error) {
      if (attempt === maxRetries) {
        console.warn(`⚠️ Groq failed after ${maxRetries} attempts, using fallback`)
        return fallbackClassify(segment.sentences)
      }
      console.log(`Retry ${attempt}/${maxRetries}...`)
      await groqLimiter.sleep(5000)
    }
  }
}
```

---

### Tổng kết:

```text
✅ Queue system: xử lý tuần tự, không bắn burst
✅ Buffer: dừng ở 25/min thay vì 30 (an toàn)
✅ Auto retry: nếu 429 → đợi 15s → thử lại
✅ Fallback: nếu fail hoàn toàn → dùng rules đơn giản
✅ Monitor: log status để debug
✅ User feedback: hiển thị progress + thời gian đợi

→ Không bao giờ bị mất dữ liệu vì rate limit
→ Import 1 video 10p: ~10 calls, < 1 phút (dưới limit)
→ Học daily: ~10 calls, không vấn đề
```

**Vậy là yên tâm không lo 429 nữa!** 🎯