/**
 * Dashboard - Tổng quan tiến độ học tập
 * Hiển thị: total sentences, mastered, XP, Level, Streak, Badges
 */
import { useState, useEffect } from 'react'

export default function Dashboard({ stats, onImport, onBack, onLearning }) {
  const [data, setData] = useState(stats || {
    totalSentences: 0,
    mastered: 0,
    inProgress: 0,
    totalXp: 0,
    level: 1,
    streakDays: 0,
    todayAttempts: 0,
    todayPassRate: 0,
  })

  useEffect(() => {
    // Fetch stats từ extension
    if (window.Neutralino) {
      Neutralino.extensions.dispatch('listener', 'stats:get', {})
        .then(setData)
        .catch(console.error)
    }
  }, [])

  const levelProgress = (data.totalXp % 500) / 500 * 100
  const nextLevelXp = (Math.floor(data.totalXp / 500) + 1) * 500

  return (
    <div className="flex flex-col h-screen bg-[#0f0f23] p-6 overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-[#a0a0b0] hover:text-white">←</button>
          <h1 className="text-lg font-bold">📊 Dashboard</h1>
        </div>
        <div className="flex gap-2">
          {onLearning && (
            <button onClick={onLearning} className="btn btn-primary text-xs px-3 py-1">▶ Học</button>
          )}
          <button onClick={onImport} className="btn btn-ghost text-sm">📥 +</button>
        </div>
      </div>

      {/* Level Card */}
      <div className="bg-[#1a1a2e] rounded-xl p-4 mb-4 border border-[#333]">
        <div className="flex items-center justify-between mb-2">
          <div>
            <span className="text-2xl font-bold text-[#f1c40f]">Lv.{data.level}</span>
            <span className="text-xs text-[#a0a0b0] ml-2">{data.totalXp} / {nextLevelXp} XP</span>
          </div>
          <span className="text-sm">🔥 {data.streakDays} days</span>
        </div>
        <div className="h-2 bg-[#333] rounded-full overflow-hidden">
          <div className="h-full bg-[#f1c40f] rounded-full transition-all" style={{ width: `${levelProgress}%` }} />
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-[#1a1a2e] rounded-xl p-4 border border-[#333]">
          <p className="text-2xl font-bold text-[#e94560]">{data.mastered}</p>
          <p className="text-xs text-[#a0a0b0]">Mastered 🏆</p>
        </div>
        <div className="bg-[#1a1a2e] rounded-xl p-4 border border-[#333]">
          <p className="text-2xl font-bold text-[#2ecc71]">{data.totalSentences}</p>
          <p className="text-xs text-[#a0a0b0]">Total Sentences</p>
        </div>
        <div className="bg-[#1a1a2e] rounded-xl p-4 border border-[#333]">
          <p className="text-2xl font-bold text-[#f39c12]">{data.inProgress}</p>
          <p className="text-xs text-[#a0a0b0]">In Progress</p>
        </div>
        <div className="bg-[#1a1a2e] rounded-xl p-4 border border-[#333]">
          <p className="text-2xl font-bold text-white">{data.todayAttempts}</p>
          <p className="text-xs text-[#a0a0b0]">Học hôm nay</p>
        </div>
      </div>

      {/* Today Stats */}
      <div className="bg-[#1a1a2e] rounded-xl p-4 mb-4 border border-[#333]">
        <p className="text-sm font-bold mb-2">Hôm nay</p>
        <div className="flex items-center gap-3 text-xs text-[#a0a0b0]">
          <span>✅ Pass: {data.todayAttempts}</span>
          <span>📊 Rate: {data.todayPassRate}%</span>
        </div>
      </div>

      {/* Badges */}
      <div className="bg-[#1a1a2e] rounded-xl p-4 border border-[#333]">
        <p className="text-sm font-bold mb-2">🏆 Badges</p>
        <p className="text-xs text-[#666]">Hoàn thành video để nhận badge đầu tiên!</p>
      </div>
    </div>
  )
}
