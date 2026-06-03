# 🎧 Listening Coach — Kế hoạch phát triển hoàn chỉnh

> **Mục tiêu:** Ứng dụng desktop giúp luyện nghe tiếng Anh qua YouTube.
> Nghe → Gõ lại → Biết sai ở đâu → Lặp đến khi mastered.

---

## I. TỔNG QUAN KIẾN TRÚC

### Công nghệ

| Thành phần | Công nghệ | Ghi chú |
|---|---|---|
| Framework desktop | **Neutralinojs** | Siêu nhẹ ~2MB, không cần Rust |
| Frontend | **React + TailwindCSS** | UI/UX |
| Sidecar | **Node.js extension** | Xử lý pipeline + DB + schedule |
| Database | **SQLite (better-sqlite3)** | Local, không cần server |
| AI | **Groq API (free tier)** | Llama 3.3 70B, classification + feedback |
| Audio | **HTML5 Audio element** | Seek theo timestamp, không cắt file |
| Transcript | **youtube-transcript-api** | Lấy subtitle YouTube |
| Audio download | **yt-dlp** | Download audio YouTube |
| Popup | **Neutralino.window** | Tạo cửa sổ con |
| Schedule | **setInterval + SQLite query** | Kiểm tra câu đến hạn |
| Scoring | **fuzz.js** | Fuzzy matching local |
| System tray | **Neutralino.os.tray** | Chạy ngầm + context menu |
| Notification | **Neutralino.os.showNotification** | Fallback khi không popup được |

### Luồng dữ liệu

```
User paste URL → Import Pipeline → SQLite DB → Schedule Engine → Popup Challenge → Scoring → Groq Feedback → Mastery Update
```

---

## II. KIẾN TRÚC CHI TIẾT

### 2.1. Database Schema

```sql
CREATE TABLE sources (
  id INTEGER PRIMARY KEY,
  url TEXT UNIQUE,
  title TEXT,
  audio_path TEXT,          -- Đường dẫn đến 1 file audio duy nhất
  summary TEXT,
  topic TEXT,
  tone TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sentences (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  difficulty TEXT CHECK(difficulty IN ('easy','medium','hard')),
  start_time REAL NOT NULL,          -- Giây bắt đầu trong audio
  end_time REAL NOT NULL,            -- Giây kết thúc
  mastery_score INTEGER DEFAULT 0,   -- 0-100, thay thế pass_count
  pass_count INTEGER DEFAULT 0,      -- Giữ lại cho analytics
  fail_count INTEGER DEFAULT 0,      -- Đếm số lần fail (cho SRS ưu tiên)
  mastered BOOLEAN DEFAULT FALSE,
  last_reviewed DATETIME,
  next_review_at DATETIME,           -- SRS: thời điểm review tiếp theo
  xp_earned INTEGER DEFAULT 0,       -- Tổng XP từ câu này
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);
CREATE INDEX idx_sentences_mastered ON sentences(mastered);
CREATE INDEX idx_sentences_srs ON sentences(mastery_score, next_review_at, fail_count);

CREATE TABLE attempts (
  id INTEGER PRIMARY KEY,
  sentence_id INTEGER NOT NULL,
  user_input TEXT NOT NULL,
  score INTEGER NOT NULL,            -- Điểm fuzzy match 0-100
  feedback TEXT,
  mastery_delta INTEGER DEFAULT 0,   -- mastery_score thay đổi (+10 hay -3)
  xp_earned INTEGER DEFAULT 0,       -- XP nhận được từ attempt này
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sentence_id) REFERENCES sentences(id) ON DELETE CASCADE
);
CREATE INDEX idx_attempts_sentence ON attempts(sentence_id);

CREATE TABLE user_stats (
  id INTEGER PRIMARY KEY,
  total_xp INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  total_attempts INTEGER DEFAULT 0,
  total_pass INTEGER DEFAULT 0,
  streak_days INTEGER DEFAULT 0,
  last_active_date TEXT,              -- YYYY-MM-DD
  sentences_mastered_today INTEGER DEFAULT 0
);
```

### 2.2. Mastery System (Score-based)

```
Pass (score ≥ 90) → mastery_score +10  (tối đa 100)
Fail (score < 90) → mastery_score -3   (tối thiểu 0)
Mastered khi mastery_score >= 30 (tương đương 3 lần pass)

Flow mẫu:
   0 → Pass (+10) → 10
  10 → Pass (+10) → 20
  20 → Fail (-3)  → 17  (không reset, chỉ giảm nhẹ)
  17 → Pass (+10) → 27
  27 → Pass (+10) → 30 → Mastered ✅  (vượt ngưỡng 30)

Thang điểm:
┌────────────┬──────────┬──────────────────────────┐
│ mastery    │ Ý nghĩa  │ next_review (SRS)        │
├────────────┼──────────┼──────────────────────────┤
│ 0-9        │ Mới học  │ 30 phút sau              │
│ 10-19      │ Đang nhớ │ 1 ngày sau               │
│ 20-29      │ Gần nhớ  │ 3 ngày sau               │
│ 30-49      │ Đã nhớ   │ 7 ngày sau               │
│ 50-69      │ Nhớ kỹ   │ 14 ngày sau              │
│ 70-100     │ Thuộc    │ 30 ngày sau              │
└────────────┴──────────┴──────────────────────────┘

Khi mastered (≥30) và ngưỡng review tới → vẫn review lại!
Vì mastery kéo dài chứ không kết thúc. Mục tiêu là mastery 100.
```

> **Tại sao mastery_score tốt hơn pass_count đơn thuần?**
> - Pass +1 / Fail -1: đang 2 mà fail → còn 1 → nản
> - mastery_score: đang 27 fail → còn 17 → vẫn gần mastered → tiếp tục cố
> - Cảm giác progress vẫn còn, không mất hết, tâm lý thoải mái hơn hẳn

### 2.3. Audio Strategy

- **Không cắt audio**: Mỗi nguồn chỉ lưu **1 file MP3** duy nhất.
- Sentence lưu `start_time` và `end_time` (số thực, đơn vị giây).
- Player dùng `HTMLAudioElement.currentTime` seek đến vị trí, tự động stop ở `endTime`.

### 2.4. Spaced Repetition System (SRS)

**Cốt lõi:** mastery_score quyết định khi nào review tiếp → đảm bảo nhớ dài hạn, không học xong là quên.

```javascript
function calculateNextReview(masteryScore, currentLevel) {
  // Số ngày đến lần review tiếp theo
  const delays = {
    0:  0.02,   // 0-9:   ~30 phút
    1:  1,      // 10-19: 1 ngày
    2:  3,      // 20-29: 3 ngày
    3:  7,      // 30-49: 7 ngày
    4:  14,     // 50-69: 14 ngày
    5:  30,     // 70+:   30 ngày
  }
  
  const level = Math.min(Math.floor(masteryScore / 10), 5)
  const days = delays[level]
  
  // Nhân đôi thời gian nếu đã mastered và review lại thành công
  const multiplier = masteryScore >= 30 && currentLevel === level ? 2 : 1
  
  return daysToDate(days * multiplier)
}
```

**Schedule Query (SRS):**

```sql
-- Câu đến hạn review, ưu tiên câu yếu + fail nhiều
SELECT s.*, src.audio_path, src.summary
FROM sentences s
JOIN sources src ON s.source_id = src.id
WHERE (s.next_review_at IS NULL AND s.mastered = 0)
   OR s.next_review_at <= datetime('now')
ORDER BY
  s.mastery_score ASC,      -- Câu yếu trước
  s.fail_count DESC,        -- Câu fail nhiều (khó) trước
  s.next_review_at ASC      -- Lâu chưa review trước
LIMIT 1
```

> **Công thức:**
> - Lần đầu: không có `next_review_at` → ưu tiên cao nhất
> - Sau mỗi lần học: tính `next_review_at` dựa vào `mastery_score`
> - Càng nhớ kỹ (mastery cao) → càng lâu mới review lại
> - Nhưng **vẫn review lại** — không bao giờ "học xong bỏ đấy"

### 2.5. Gamification (XP + Level + Badges)

**Mục tiêu:** Tạo động lực học, cảm giác tiến bộ mỗi ngày.

#### XP System

```text
Easy sentence pass:     +5 XP
Medium sentence pass:  +10 XP
Hard sentence pass:    +20 XP
Fail (any):            +2 XP  (cho sự cố gắng)

Bonus:
- First review hôm nay:   +15 XP
- 5 câu liên tiếp đúng:   +25 XP
- Mastered 1 sentence:    +50 XP  (1 lần duy nhất)
```

#### Level System

```text
Level 1:    0 -   500 XP
Level 2:  500 - 1,500 XP
Level 3: 1,500 - 3,000 XP
Level 4: 3,000 - 5,000 XP
Level 5: 5,000 - 8,000 XP
Level 6: 8,000 - 12,000 XP
...cứ tăng dần...
```

#### Badge System

```text
Mỗi video hoàn thành (100% sentences mastered):
  🏆 "{Video Title} Master"
  Ví dụ: "🏆 AI Podcast Master", "🏆 React Deep Dive Master"

Thành tích khác:
  🎯 100 sentences mastered
  🔥 7-day streak
  ⚡ 1000 câu đúng liên tiếp
```

### 2.6. Review Thresholds (Long Challenge / Full Review)

Khi user đạt tỉ lệ mastered nhất định trên tổng sentences của 1 source, app gợi ý chế độ review đặc biệt:

```text
80% mastered → Gợi ý Long Challenge: nghe 1 đoạn 2-3 phút liên tục
95% mastered → Gợi ý Full Review: nghe lại toàn bộ video
100% mastered → Complete + tặng Badge 🏆
```

### 2.7. Cấu trúc thư mục

```
listening-coach/
├── extensions/                  # Node.js extension (thay sidecar)
│   ├── index.js                 # Main extension: DB + schedule + IPC
│   ├── pipeline/
│   │   ├── youtube.js           # YouTube transcript + download
│   │   ├── merge.js             # Ghép chunk → câu
│   │   ├── segment.js           # Chia đoạn thông minh
│   │   ├── classify.js          # Groq classification
│   │   └── summarize.js         # Groq summary
│   ├── db/
│   │   ├── schema.js            # Khởi tạo DB
│   │   └── queries.js           # CRUD operations
│   ├── services/
│   │   ├── groq.js              # Groq API + rate limiter
│   │   ├── scoring.js           # Fuzzy matching
│   │   └── scheduler.js         # Schedule engine + SRS
│   └── package.json
├── src/                        # React Frontend
│   ├── main.jsx
│   ├── App.jsx
│   ├── components/
│   │   ├── ImportDialog.jsx
│   │   ├── LibraryView.jsx
│   │   ├── ChallengePopup.jsx  # Popup luyện tập
│   │   ├── AudioPlayer.jsx
│   │   ├── ProgressBar.jsx
│   │   └── SettingsPanel.jsx
│   ├── hooks/
│   │   ├── useSchedule.js
│   │   └── useAudio.js
│   └── styles/
│       └── index.css
├── audio/                      # Audio files downloaded
├── data/
│   └── listening.db            # SQLite database
├── public/
│   └── icon.png
├── package.json
├── tailwind.config.js
├── vite.config.js
└── README.md
```

---

## III. KẾ HOẠCH PHÁT TRIỂN THEO PHASE

### Phase 0: Thiết lập dự án (Day 1)

**Mục tiêu:** Tạo Neutralinojs + React project, cài đặt dependencies, có cửa sổ chạy được.

- [x] Khởi tạo Neutralinojs project với React + Vite template
- [ ] Cài đặt dependencies:
  - Frontend: `react`, `tailwindcss`, `react-router-dom`, `@neutralinojs/lib`
  - Extension: `better-sqlite3`, `fuzzball` (fuzzy matching), `dotenv`, `youtube-transcript-api`, `yt-dlp`
- [ ] Thiết lập TailwindCSS + theme cơ bản
- [ ] Cấu hình Neutralinojs: `neutralino.config.json`
- [ ] Cấu hình extension: `extensions/extensions.json`
- [ ] DB schema: tạo tables trong extension
- [ ] Script build: React build → Neutralino pack
- [ ] Kiểm tra: app chạy được, extension kết nối DB

### Phase 1: Import Pipeline (Day 1-2)

**Mục tiêu:** Import được video YouTube → transcript + audio → DB.

**Import Flow:**

```
┌─────────┐   ┌──────────┐   ┌────────┐   ┌──────────┐   ┌──────────┐   ┌──────┐
│ Paste   │ → │ Fetch    │ → │ Merge  │ → │ Segment  │ → │ Classify │ → │ Save │
│ URL     │   │Transcript│   │Chunks  │   │Sentences │   │AI+Groq   │   │ DB   │
└─────────┘   └──────────┘   └────────┘   └──────────┘   └──────────┘   └──────┘
                                                    ↓
                                              ┌──────────┐
                                              │Summarize │
                                              │AI+Groq   │
                                              └──────────┘
```

**Chi tiết các bước:**

1. **Fetch Transcript** — `youtube-transcript-api`
   - Parse videoId từ URL
   - Lấy transcript gốc: `[{text, start, duration}, ...]`

2. **Merge Chunks → Sentences**
   - Gộp chunk dựa vào dấu câu `. ! ?`
   - Output: `[{text: "Full sentence.", start: 0.5, end: 4.9}, ...]`

3. **Download Audio**
   - `yt-dlp -x --audio-format mp3 -o "audio/%(id)s.mp3" {url}`
   - Chỉ 1 file MP3 duy nhất

4. **Smart Segmentation** (chia đoạn ~45-90s cho Groq)
   - Gom sentences thành segment dựa vào:
     - Transition words (so, however, first, second...)
     - Natural gaps (pause > 1.5s transcript)
     - Không cắt ngang câu
   - Output: `[[s1, s2, s3], [s4, s5, s6, s7], ...]`

5. **AI Classification** (Groq — từng segment)
   - Prompt phân loại easy/medium/hard
   - 6-8 API calls cho video 10 phút

6. **AI Summarize** (Groq — 1 call)
   - Tóm tắt nội dung, topic, tone

7. **Save to DB**
   - 1 record trong `sources`
   - N records trong `sentences` (với start_time, end_time)

**Kiểm tra:** Import 1 video → DB có dữ liệu, audio file tồn tại.

### Phase 2: Groq Rate Limiter & Resilience (Day 2)

**Mục tiêu:** Đảm bảo không bị 429, có fallback khi API chết.

- [ ] Implement `GroqRateLimiter` class:
  - Queue xử lý tuần tự
  - Buffer an toàn: dừng ở 25/min (thay vì 30)
  - Tự động retry khi 429 (đợi 15s)
  - Delay 500ms giữa các request
- [ ] Fallback classification dựa vào rules:
  - `≤5 từ` → easy
  - `6-12 từ` → medium
  - `>12 từ` → hard
- [ ] Retry logic: max 3 lần, sau đó fallback
- [ ] Monitor: log status mỗi 30s
- [ ] UI progress khi import (hiển thị % + thời gian chờ nếu cần)

**Kiểm tra:** Import video khi đang gần đạt rate limit → xử lý đúng.

### Phase 3: Audio Player (Day 2)

**Mục tiêu:** Play audio theo timestamp, speed control.

- [ ] Implement `SentencePlayer` class (trong sidecar hoặc frontend):
  - `play(startTime, endTime)` — seek + auto-stop
  - `setSpeed(rate)` — 0.5x, 0.75x, 1x, 1.25x, 1.5x
  - `stop()`, `pause()`, `resume()`
- [ ] React component `AudioPlayer.jsx`:
  - Thanh điều khiển play/pause
  - Nút speed control
  - Progress bar
- [ ] Error handling: file not found, load error

**Kiểm tra:** Chọn sentence → play đúng đoạn audio → auto stop → đổi speed.

### Phase 4: Schedule Engine + SRS (Day 3)

**Mục tiêu:** Schedule dựa trên Spaced Repetition System, mastery_score quyết định thời gian review.

- [ ] Schedule query mỗi 30 giây (SRS):

```sql
SELECT s.*, src.audio_path, src.summary
FROM sentences s
JOIN sources src ON s.source_id = src.id
WHERE (s.next_review_at IS NULL AND s.mastered = 0)
   OR s.next_review_at <= datetime('now')
ORDER BY
  s.mastery_score ASC,      -- Câu yếu trước
  s.fail_count DESC,        -- Câu fail nhiều (khó) trước
  s.next_review_at ASC      -- Lâu chưa review trước
LIMIT 1
```

- [ ] Tính `next_review_at` sau mỗi attempt theo bảng:
  - mastery 0-9: 30 phút
  - mastery 10-19: 1 ngày
  - mastery 20-29: 3 ngày
  - mastery 30-49: 7 ngày → 14 ngày (nếu review lại đúng)
  - mastery 50-69: 14 ngày → 30 ngày
  - mastery 70+: 30 ngày
- [ ] Ưu tiên: `mastery_score thấp → fail_count cao → lâu chưa review`
- [ ] Popup schedule: configurable interval (mặc định 5 phút)
- [ ] Chỉ popup khi có câu đến hạn
- [ ] Không popup khi đang có popup khác (tránh spam)
- [ ] **Smart postpone:** nếu user skip 3 lần liên tiếp → tự tạm dừng 30 phút (đang bận)
- [ ] **Morning burst:** lần đầu mở máy trong ngày → hiện 3-5 câu liên tiếp để khởi động
- [ ] **Windows notification** fallback: nếu app đang ở chế độ không hiện popup được (fullscreen game, focus mode) → fallback ra notification

### Phase 5: Challenge Popup (Day 3-4)

**Mục tiêu:** Popup luyện tập đầy đủ chức năng.

**UI mẫu:**

```
┌──────────────────────────────────┐
│  🎧 Listen & Type           ⏰  │
│                                   │
│  ┌──────────────────────────┐    │
│  │  ▶️ [===●=========] 1.0x │    │
│  └──────────────────────────┘    │
│                                   │
│  Type what you hear:              │
│  ┌──────────────────────────┐    │
│  │                          │    │
│  │                          │    │
│  └──────────────────────────┘    │
│                                   │
│  Speed: [0.5x] [0.75x] [1x]     │
│         [1.25x] [1.5x]           │
│                                   │
│  Source: Video title (segment)   │
│  Progress: ■■□□□ 2/5 sentences  │
│                                   │
│  [Submit] [Skip] [Close]         │
└──────────────────────────────────┘
```

**Chức năng:**
- [ ] Play audio sentence (seek + auto-stop)
- [ ] Repeat button (phát lại)
- [ ] Text input để gõ
- [ ] Speed control buttons
- [ ] Hiển thị source context (video title)
- [ ] Submit button
- [ ] Skip button (bỏ qua, hẹn giờ sau)
- [ ] Close button (tạm tắt)
- [ ] Keyboard shortcuts (Enter = submit, Ctrl+R = repeat, Esc = close)

#### 2 chế độ Popup

Popup có 2 chế độ, user click "+" để mở rộng:

```
⚡ QUICK MODE (mặc định):         📖 FULL MODE (bấm ✚):
┌────────────────────┐           ┌────────────────────────────┐
│ 🎧 [▶] [↻] 1.0x   │           │ 🎧 Listen & Type           │
│ ────────────────── │           │ ┌────────────────────────┐ │
│ Type: [__________] │           │ │ [▶] [====●====] 1.0x  │ │
│ [Submit] [⛌]  ✚ ⚡│           │ └────────────────────────┘ │
└────────────────────┘           │ Type: [__________________] │
                                 │ Speed: [0.5x] [1x] [1.5x] │
                                 │ ─────────────────────────  │
                                 │ Video: "English Podcast 1" │
                                 │ Progress: ■■□□□ 2/5       │
                                 │ ─────────────────────────  │
                                 │ [Submit] [Skip] [✕ Close] │
                                 └────────────────────────────┘
```

- **Quick mode:** Popup nhỏ gọn, chỉ play + input + submit — học nhanh khi đang làm việc
- **Full mode:** Popup lớn hơn, hiện context video, speed control, progress tracking — học kỹ khi rảnh
- Mặc định là Quick mode, user bấm nút ✚ để mở rộng

### Phase 6: Scoring & Feedback (Day 4)

**Mục tiêu:** Chấm điểm, mastery_score, XP, SRS schedule sau mỗi lần submit.

**Flow scoring mới:**

```
User Submit
    │
    ├── Fuzzy match (fuzz.ratio) vs correct text
    │
    ├── Score ≥ 90 ────────────────→ PASS
    │                                  │
    │                                  ├── mastery_score += 10
    │                                  ├── pass_count += 1
    │                                  ├── XP += 5/10/20 (theo difficulty)
    │                                  └── Kiểm tra mastery ≥ 30? → Mastered ✅
    │
    └── Score < 90 ────────────────→ FAIL
                                       │
                                       ├── mastery_score -= 3 (min 0)
                                       ├── fail_count += 1
                                       ├── XP += 2 (cho sự cố gắng)
                                       └── Gọi Groq feedback (kèm context)
                                               ↓
                                       "You wrote 'I would go' but the speaker said
                                       'I would've gone' — 'would've' is reduced to
                                       /ˈwʊdəv/ in fast speech."

    Sau cùng: Tính next_review_at dựa vào mastery_score mới
    Lưu attempt + mastery_delta + xp_earned vào DB
```

- [ ] Fuzzy matching với fuzzball.js (`fuzz.ratio`)
- [ ] Cập nhật `mastery_score` (+10 pass / -3 fail)
- [ ] Tính `next_review_at` theo SRS sau mỗi attempt
- [ ] Tính XP dựa vào difficulty + pass/fail
- [ ] Update `user_stats` (total_xp, level, streak)
- [ ] Groq feedback prompt có context video (chỉ khi fail)
- [ ] Hiển thị kết quả ngay trong popup:
  - PASS: xanh, "+10 mastery", XP nhận được, "Next review: 3 ngày"
  - FAIL: đỏ, "-3 mastery", feedback text, audio hint
- [ ] Lưu mọi attempt vào DB để tracking

### Phase 7: Dashboard & Library (Day 4-5)

**Mục tiêu:** Quản lý nguồn học, theo dõi tiến độ.

- [ ] **Library View — danh sách video đã import:**
  - Title, topic, tone, difficulty distribution
  - Progress: X/Y sentences mastered
  - Import date, last reviewed
  - Nút xóa source

- [ ] **Dashboard — tổng quan:**
  - Total sentences / mastered / in progress
  - Học hôm nay: attempts, pass rate
  - **XP & Level:** Level hiện tại, progress bar lên level tiếp theo
  - **Streak:** số ngày học liên tục 🔥
  - **Badges:** những badge đã đạt được 🏆
  - Biểu đồ đơn giản (activity trong 7 ngày)
  - **Review threshold:** gợi ý Long Challenge / Full Review khi đạt 80%/95% mastered

- [ ] **Sentence Browser (cho từng video):**
  - Danh sách câu với difficulty, mastery_score, xp_earned, mastered badge
  - Click để nghe thử + xem feedback history + lịch sử mastery_score
  - Filter: mastered / not mastered / by difficulty
  - Sort: by mastery_score, by next_review_at

### Phase 8: Background App & System Tray (Day 5)

**Mục tiêu:** App chạy ngầm, tự động popup, quản lý qua system tray.

#### User Flow tổng thể

```
Mở app → [▶ Start Learning] → App ẩn vào system tray
                                    ↓
                        Mỗi 5 phút (hoặc theo schedule)
                                    ↓
                           Popup Quick Mode hiện lên
                                    ↓
              ┌─────────────────────┼─────────────────────┐
              ↓                     ↓                     ↓
   ✏️ Nhập + Submit ngay     👆 Bấm ✚ mở Full mode    ⛌ Skip
   → Popup tắt               → Học kỹ hơn              → Hẹn sau
   → Đợi popup tiếp theo     → Tự động popup tiếp      → Nếu skip 3 lần
                                                         → Pause 30p
```

#### System Tray

- [ ] **Neutralino.os.tray** — icon nhỏ trên khay hệ thống
- [ ] **Minimize to tray** — bấm ✕ không tắt app, chỉ ẩn xuống tray
- [ ] **Right-click context menu:**
  - `▶ Study Now` — học ngay 1 câu (bỏ qua schedule)
  - `⏭ Skip Next` — bỏ qua popup kế tiếp
  - `⏸ Pause 1h` — tạm dừng 1 tiếng
  - `📊 Open Full App` — mở cửa sổ chính
  - `✕ Quit` — tắt hẳn app
- [ ] **Double-click tray icon** → mở full app

#### Schedule & Popup Behavior

- [ ] **Schedule interval:** 5 phút (mặc định), configurable trong Settings
- [ ] **Morning burst:** Lần đầu mở máy trong ngày → hiện 3-5 câu liên tiếp để warm up
- [ ] **Smart postpone:** Skip 3 lần liên tiếp → auto pause 30 phút (đang bận)
- [ ] **Windows notification fallback:** Nếu app ở focus mode/fullscreen → gửi notification thay vì popup

#### Settings

- [ ] **Schedule interval** (5/10/15/30 phút)
- [ ] **Default speed** (0.5x → 1.5x)
- [ ] **Theme** (light/dark)
- [ ] **Audio download location**
- [ ] **Auto-start với Windows** (tùy chọn)

---

## IV. TIMELINE

| Phase | Nội dung | Thời gian | Nỗ lực |
|---|---|---|---|
| **Phase 0** | Thiết lập dự án | Day 1 (sáng) | ~3h |
| **Phase 1** | Import Pipeline | Day 1-2 | ~6h |
| **Phase 2** | Groq Rate Limiter | Day 2 (chiều) | ~3h |
| **Phase 3** | Audio Player | Day 2 (tối) | ~2h |
| **Phase 4** | Schedule Engine | Day 3 (sáng) | ~3h |
| **Phase 5** | Challenge Popup | Day 3-4 | ~6h |
| **Phase 6** | Scoring & Feedback | Day 4 (tối) | ~4h |
| **Phase 7** | Dashboard & Library | Day 4-5 | ~5h |
| **Phase 8** | Settings & Polish | Day 5 | ~4h |
| **Buffer** | Bug fixes, test | - | ~4h |
| | **Tổng** | **5 ngày** | **~40h** |

---

## V. STATE MANAGEMENT (FRONTEND)

```javascript
// Global state shape
{
  sources: [],              // Danh sách video đã import
  currentChallenge: null,   // { sentence, source } hiện tại
  schedule: {
    isEnabled: true,
    interval: 5,            // phút
    isPopupOpen: false,
    nextDueAt: null,
  },
  audio: {
    isPlaying: false,
    currentSpeed: 1.0,
    volume: 1.0,
    error: null,
  },
  stats: {
    totalSentences: 0,
    mastered: 0,
    todayAttempts: 0,
    todayPassRate: 0,
  },
  settings: {
    groqApiKey: '...',
    scheduleInterval: 5,
    defaultSpeed: 1.0,
    theme: 'dark',
    autoStart: false,
  },
}
```

---

## VI. API INTERFACES (FRONTEND ↔ EXTENSION)

### Commands từ Frontend → Extension (qua `Neutralino.extensions.dispatch`):

| Command | Payload | Response |
|---|---|---|
| `import:video` | `{ url }` | `{ sourceId, sentenceCount }` |
| `db:getDueSentence` | `{}` | `{ sentence, source }` hoặc `null` |
| `db:submitAttempt` | `{ sentenceId, userInput, score, feedback }` | `{ passCount, mastered }` |
| `db:getStats` | `{}` | `{ total, mastered, todayAttempts, todayPassRate }` |
| `db:getSources` | `{}` | `[{ id, title, ... }]` |
| `db:deleteSource` | `{ sourceId }` | `{ ok: true }` |
| `settings:get` | `{}` | `{ groqApiKey, ... }` |
| `settings:set` | `{ key, value }` | `{ ok: true }` |

### Events từ Extension → Frontend (qua `Neutralino.events.broadcast`):

| Event | Payload | Khi nào |
|---|---|---|
| `import:progress` | `{ percent, message }` | Trong lúc import |
| `import:complete` | `{ sourceId, sentenceCount }` | Import xong |
| `import:error` | `{ error }` | Import lỗi |
| `schedule:due` | `{ sentence, source }` | Có câu đến hạn |

---

## VII. GROQ COST ANALYSIS

| Hoạt động | API Calls | Ghi chú |
|---|---|---|
| Import 1 video 10 phút | ~10 calls | 1 lần duy nhất |
| Classify segments | 7-9 calls | 1 lần khi import |
| Summarize | 1 call | 1 lần khi import |
| Học 100 challenges/ngày | ~10 calls | Chỉ gọi khi sai |
| Tổng daily | ~10-30 calls | Trong limit free |

> **Groq Free Tier:** 30 req/min, 1000 req/day → **Quá đủ cho personal use.**

---

## VIII. MODEL AI COMPARISON & RECOMMENDATION

### Các model free trên Groq phù hợp cho app

| Model | Tham số | Tok/s | RPM Free | TPD Free | Giá (paid) | JSON Mode |
|---|---|---|---|---|---|---|
| **Llama 3.3 70B Versatile** ⭐ | 70B | ~394 | 30 | 100K | $0.59/$0.79 | ✅ Tốt nhất |
| **Qwen3 32B** | 32B | ~662 | **60** | **500K** | $0.29/$0.59 | ✅ Tốt |
| **GPT-OSS 120B** | 120B | ~500 | 30 | 100K | $0.15/$0.60 | ✅ Khá |
| **Llama 4 Scout** (MoE) | 17B×16E | ~594 | 30 | 100K | $0.11/$0.34 | ✅ Tốt |
| **Mixtral 8x7B** | 46.7B | ~400 | 30 | 100K | $0.24/$0.24 | ⚠️ Trung bình |

*Tất cả đều FREE trên Groq free tier (giá paid chỉ cho developer tier có rate limit cao hơn)*

### Benchmark cho app Listening Coach

| Tiêu chí | Llama 3.3 70B | Qwen3 32B | GPT-OSS 120B |
|---|---|---|---|
| **Instruction following** | 🥇 Xuất sắc | 🥈 Tốt | 🥈 Tốt |
| **JSON output reliability** | 🥇 Xuất sắc | 🥈 Tốt | 🥈 Tốt |
| **English nuance (feedback)** | 🥇 Xuất sắc | 🥉 Khá | 🥈 Tốt |
| **Tốc độ** | 🥈 ~394 tok/s | 🥇 ~662 tok/s | 🥉 ~500 tok/s |
| **Rate limit** | 🥉 30 RPM | 🥇 60 RPM | 🥉 30 RPM |
| **Daily token budget** | 🥉 100K | 🥇 500K | 🥉 100K |
| **Hiểu connected speech** | 🥇 Xuất sắc | 🥈 Tốt | 🥈 Tốt |

### Kết luận: Dùng cả 2 model cho từng việc

```text
┌─────────────────────────────────────────────────────┐
│                                                     │
│   🥇 PRIMARY: Llama 3.3 70B Versatile              │
│      → Feedback generation (cần nuance nhất)        │
│      → Summarize video (cần hiểu context)           │
│      → Lý do: instruction following tốt nhất,       │
│        hiểu connected speech/reductions rất giỏi    │
│                                                     │
│   🥈 SECONDARY: Qwen3 32B                           │
│      → Classification easy/medium/hard              │
│      → Fallback khi Llama hết quota                 │
│      → Lý do: rate limit gấp đôi (60 RPM),          │
│        nhanh hơn, task đơn giản không cần 70B       │
│                                                     │
│   🥉 BACKUP: GPT-OSS 120B                           │
│      → Dùng khi cả 2 model kia đều hết quota        │
│      → 120B tham số nên chất lượng ổn               │
│                                                     │
│   ❌ Không dùng: Mixtral, Gemma, Llama 4 Scout      │
│      → JSON mode không ổn định, hoặc quá nhỏ        │
└─────────────────────────────────────────────────────┘
```

### Chi phí thực tế (free = $0)

| Tác vụ | Số calls | Model dùng | Tốn token | Tổng phí |
|---|---|---|---|---|
| Import 1 video (classify) | 7-9 calls | Qwen3 32B | ~3K tokens | **$0** ✅ |
| Import 1 video (summarize) | 1 call | Llama 3.3 70B | ~2K tokens | **$0** ✅ |
| Học 100 challenge (10 fail) | 10 calls | Llama 3.3 70B | ~1K tokens | **$0** ✅ |
| **Tổng daily** | **~20 calls** | **Mixed** | **~6K tokens** | **$0** 🎉 |

> **Kết luận:** Groq free tier quá đủ cho personal use. Dùng Llama 3.3 70B cho feedback (chất lượng cao nhất), Qwen3 32B cho classification (nhanh + rate limit cao). $0 đồng.

---

## IX. MVP CHECKLIST

### ✅ CÓ TRONG MVP

| Tính năng | Phase | Ưu tiên |
|---|---|---|
| YouTube import (paste URL) | P1 | 🔴 Cao |
| Transcript tự động | P1 | 🔴 Cao |
| 1 audio file/video, seek timestamp | P3 | 🔴 Cao |
| Smart segmentation | P1 | 🔴 Cao |
| AI difficulty classification | P1 | 🔴 Cao |
| AI tóm tắt video | P1 | 🟡 Trung bình |
| Popup schedule luyện tập (Quick + Full mode) | P4, P5 | 🔴 Cao |
| Audio speed control | P3 | 🟡 Trung bình |
| Local fuzzy scoring | P6 | 🔴 Cao |
| AI feedback khi sai (kèm context) | P6 | 🟡 Trung bình |
| **Mastery Score (0-100)** — Pass +10 / Fail -3 | P6 | 🔴 Cao |
| **Spaced Repetition (SRS)** — next_review_at theo mastery | P4 | 🔴 Cao |
| **XP + Level** — Gamification | P6, P7 | 🟡 Trung bình |
| **Badge** — Khi hoàn thành video | P7 | 🟢 Thấp |
| **Review Thresholds** — Long Challenge / Full Review | P7 | 🟢 Thấp |
| SQLite local storage | P0 | 🔴 Cao |
| Dashboard & thống kê (kèm XP, streak, level) | P7 | 🟡 Trung bình |
| Library quản lý video | P7 | 🟡 Trung bình |
| Settings (schedule interval, speed, theme) | P8 | 🟡 Trung bình |
| System tray — chạy ngầm, context menu | P8 | 🟡 Trung bình |
| Smart postpone — skip 3 lần → pause 30p | P4 | 🟢 Thấp |
| Morning burst — 5 câu đầu ngày | P4 | 🟢 Thấp |

### ❌ CHƯA CÓ (post-MVP)

- Phát âm / Speaking
- Grammar lessons
- Vocabulary lists
- Cloud sync / Auth
- Mobile app
- Multiple choice mode

---

## IX. EDGE CASES & ERROR HANDLING

### Import
- **Không có transcript** → Báo lỗi "Video không có phụ đề"
- **Video quá dài (>2h)** → Cảnh báo, đề xuất cắt ngắn
- **YouTube rate limit** → Retry với exponential backoff
- **Network fail** → Báo lỗi, cho retry
- **URL không hợp lệ** → Validate ngay khi paste
- **Duplicate URL** → Báo "Đã import rồi", hỏi có muốn import lại không

### Audio
- **File không tồn tại** → Hiển thị error, đề xuất download lại
- **Audio lỗi** → Retry playback 1 lần
- **Seek quá gần end** → Không play (sentence ngắn <0.5s)

### Popup
- **User đang bận** → Skip + postpone 5 phút
- **Spam popup** → Chỉ 1 popup tại 1 thời điểm
- **App minimized** → Show notification thay vì popup
- **User fullscreen game / focus mode** → Notification fallback, không popup che màn hình
- **Skip 3 lần liên tiếp** → Smart postpone: tự pause 30 phút
- **Không còn câu để học** → Ẩn schedule, hiển thị "All done! 🎉"
- **User nhập rỗng** → Không cho submit, nhắc "Hãy nhập gì đó"

### Groq API
- **429 Rate Limit** → Queue + retry + fallback
- **API key invalid** → Báo lỗi, mở settings
- **Response timeout** → Retry 3 lần, fallback
- **Invalid JSON response** → Parse lại, nếu fail thì dùng fallback
- **Quota daily hết** → Fallback rules, không dùng AI

### Schedule & SRS
- **DB locked** (concurrent access) → Retry sau 100ms
- **Nhiều popup cùng lúc** → Queue, hiển thị tuần tự
- **App vừa mở** → Check ngay, không đợi 30s
- **SRS next_review_at quá xa** → Vẫn ưu tiên câu chưa review (next_review_at IS NULL)
- **mastery_score âm** → Clamp về 0, không bao giờ âm
- **mastery_score > 100** → Clamp về 100
- **Fail liên tục** → mastery_score giảm nhưng không về 0 ngay (chỉ -3/lần)

---

## X. UI/UX DESIGN PRINCIPLES

1. **Tối giản**: Mỗi popup chỉ có 1 hành động chính (gõ câu nghe được)
2. **Feedback ngay lập tức**: Khi submit, biết kết quả trong <1s
3. **Context là key**: Luôn hiển thị video title, segment context
4. **Không gián đoạn**: Popup nhỏ gọn (Quick mode), dễ tắt, không làm phiền khi đang làm việc
5. **Keyboard-first**: Mọi thao tác đều có keyboard shortcut
6. **Progress visible**: Luôn biết mình đang ở đâu, còn bao nhiêu câu
7. **Chạy ngầm**: App ẩn vào system tray, không chiếm taskbar, popup là điểm chạm duy nhất
8. **Tôn trọng sự tập trung**: Skip 3 lần → tự pause, không spam khi đang bận

---

## XI. TESTING STRATEGY

### Test thủ công (chính)
1. Import video YouTube → kiểm tra DB
2. Play từng sentence → đúng timestamp
3. Submit pass/fail → mastery đúng
4. Schedule popup → đúng giờ, đúng thứ tự ưu tiên
5. Settings → lưu được, apply được
6. Speed control → âm thanh thay đổi đúng

### Test biên
1. Import khi không có mạng
2. Import video không có transcript
3. Submit với input rỗng
4. API key sai
5. Rate limit đầy

---

## XII. FILE SẢN PHẨM CUỐI CÙNG

```
listening-coach/
├── extensions/                  # ~500 dòng Node.js
│   ├── index.js                 # Main extension: DB + schedule + IPC
│   ├── pipeline/
│   │   ├── youtube.js
│   │   ├── merge.js
│   │   ├── segment.js
│   │   ├── classify.js
│   │   └── summarize.js
│   ├── services/
│   │   ├── groq.js
│   │   ├── scoring.js
│   │   └── scheduler.js
│   └── db/
│       ├── schema.js
│       └── queries.js
├── src/                        # ~600 dòng React
│   ├── main.jsx
│   ├── App.jsx
│   ├── components/
│   │   ├── ImportDialog.jsx
│   │   ├── LibraryView.jsx
│   │   ├── ChallengePopup.jsx
│   │   ├── AudioPlayer.jsx
│   │   ├── ProgressBar.jsx
│   │   └── SettingsPanel.jsx
│   └── styles/
│       └── index.css
├── audio/
├── data/
│   └── listening.db
├── neutralino.config.json
├── package.json
├── tailwind.config.js
├── vite.config.js
└── README.md
```

> **Tổng ~1200 dòng code, 5 ngày, 0 đồng, nhẹ, gọn, dùng ngon.** 🎯

---

*Plan generated from `plan-idea.md` — cập nhật lần cuối: 2026-06-03*
