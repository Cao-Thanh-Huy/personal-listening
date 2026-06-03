# Listening Coach — CLAUDE.md

## Project Overview
Ứng dụng desktop luyện nghe tiếng Anh qua YouTube. Nghe → Gõ lại → Biết sai ở đâu → Lặp đến khi mastered.

## Tech Stack
- **Desktop:** Neutralinojs (siêu nhẹ ~2MB, không cần Rust/Go)
- **Frontend:** React + Vite + TailwindCSS
- **Extension:** Node.js (better-sqlite3, fuzzball) — chạy background cùng app
- **Database:** SQLite (`data/listening.db`)
- **AI:** Groq API (free tier) — Llama 3.3 70B Versatile (primary)
- **Audio:** HTML5 Audio + yt-dlp
- **Transcript:** youtube-transcript-api

## Key Architecture Decisions

### Model AI: Llama 3.3 70B Versatile (primary) + Qwen3 32B (fallback)
- **Llama 3.3 70B → feedback + summarize** (việc khó, cần nuance)
- **Qwen3 32B → classification** (việc đơn giản, rate limit cao hơn)
- Lý do: xem `PLAN.md` section về model comparison

### Audio Strategy
- 1 file MP3 / video, không cắt clips
- Sentence lưu `start_time`, `end_time` → seek bằng HTML5 Audio

### Mastery System (Score-based)
- Pass (score ≥ 90): mastery_score **+10** (max 100)
- Fail (score < 90): mastery_score **-3** (min 0)
- Mastered khi mastery_score **≥ 30**
- Cảm giác progress vẫn còn khi fail, không mất hết

### Spaced Repetition (SRS)
- `next_review_at` tính từ `mastery_score`
- 0-9: 30ph | 10-19: 1ngày | 20-29: 3ngày | 30-49: 7ngày | 50-69: 14ngày | 70+: 30ngày
- Mastered rồi vẫn review lại, chỉ间隔 dài hơn

### Gamification
- XP: Easy+5, Medium+10, Hard+20, Fail+2
- Level: 500XP mỗi level (tăng dần)
- Badge: 🏆 khi hoàn thành video

## Commands
```bash
# Development (React + Vite)
npm run dev

# Build frontend
npm run build

# Run Neutralino app (after build)
npx @neutralinojs/neu run

# Build final .exe
npx @neutralinojs/neu build

# Extension (standalone test)
node extensions/index.js

# Database reset
rm data/listening.db && node extensions/db/schema.js
```

## Project Structure
```
listening-coach/
├── extensions/          # Node.js (~500 dòng)
│   ├── pipeline/        # Import pipeline
│   ├── services/        # Groq, scoring, scheduler
│   └── db/              # Schema + queries
├── src/                 # React (~600 dòng)
│   └── components/      # ImportDialog, ChallengePopup, ...
├── audio/               # Audio files
├── data/                # SQLite DB
├── neutralino.config.json
└── package.json
```

## Coding Conventions
- **JavaScript:** ES modules, async/await, JSDoc comments
- **React:** Functional components + hooks, no class components
- **SQL:** UPPERCASE keywords, lowercase column names
- **Error handling:** Always try/catch Groq API calls, always have fallback
- **Naming:** camelCase cho JS/TS, snake_case cho SQL/DB columns
- **File naming:** kebab-case cho files (`challenge-popup.jsx`)

## Groq API Config
- Model mặc định: `llama-3.3-70b-versatile`
- Fallback model: `qwen-3-32b` (cho classification)
- Rate limit: tối đa 25 req/min (buffer 5 so với limit 30)
- Response format: luôn dùng `response_format: { type: 'json_object' }`

## Edge Cases Cần Nhớ
- YouTube video không có transcript → báo lỗi rõ ràng
- Groq API 429 → queue + retry + fallback rules
- Audio file bị xóa → propose re-download
- Popup khi user đang bận → skip + postpone
- Skip 3 lần liên tiếp → auto pause 30 phút (smart postpone)
- DB concurrent access → retry 100ms
- mastery_score clamp: không xuống dưới 0, không lên trên 100
- SRS: câu chưa có next_review_at (NULL) → ưu tiên cao nhất

## Related Files
- `PLAN.md` — Kế hoạch phát triển chi tiết
- `plan-idea.md` — Ý tưởng gốc
