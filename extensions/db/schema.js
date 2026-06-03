/**
 * Database Schema - Listening Coach
 * SQLite schema với Neutralino extension
 */
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.resolve(__dirname, '../../data/listening.db')

let db = null

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
  }
  return db
}

export function initSchema() {
  const db = getDb()

  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY,
      url TEXT UNIQUE,
      title TEXT,
      audio_path TEXT,
      summary TEXT,
      topic TEXT,
      tone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sentences (
      id INTEGER PRIMARY KEY,
      source_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      difficulty TEXT CHECK(difficulty IN ('easy','medium','hard')),
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      mastery_score INTEGER DEFAULT 0,
      pass_count INTEGER DEFAULT 0,
      fail_count INTEGER DEFAULT 0,
      mastered BOOLEAN DEFAULT FALSE,
      last_reviewed DATETIME,
      next_review_at DATETIME,
      xp_earned INTEGER DEFAULT 0,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sentences_srs
      ON sentences(mastery_score, next_review_at, fail_count);

    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY,
      sentence_id INTEGER NOT NULL,
      user_input TEXT NOT NULL,
      score INTEGER NOT NULL,
      feedback TEXT,
      mastery_delta INTEGER DEFAULT 0,
      xp_earned INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sentence_id) REFERENCES sentences(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_attempts_sentence
      ON attempts(sentence_id);

    CREATE TABLE IF NOT EXISTS user_stats (
      id INTEGER PRIMARY KEY,
      total_xp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      total_attempts INTEGER DEFAULT 0,
      total_pass INTEGER DEFAULT 0,
      streak_days INTEGER DEFAULT 0,
      last_active_date TEXT,
      sentences_mastered_today INTEGER DEFAULT 0
    );

    -- Khởi tạo user_stats row nếu chưa có
    INSERT OR IGNORE INTO user_stats (id) VALUES (1);
  `)

  console.log('✅ Database schema initialized')
}

export function closeDb() {
  if (db) {
    db.close()
    db = null
  }
}
