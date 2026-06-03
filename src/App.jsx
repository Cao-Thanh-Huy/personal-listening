import { useState, useEffect, useCallback } from 'react'
import ImportDialog from './components/ImportDialog.jsx'
import ChallengePopup from './components/ChallengePopup.jsx'
import LibraryView from './components/LibraryView.jsx'
import SettingsPanel from './components/SettingsPanel.jsx'
import Dashboard from './components/Dashboard.jsx'

/**
 * Listening Coach - Main App
 *
 * States:
 * - startup: Mới mở, chưa start
 * - learning: Đã start, chạy ngầm + lắng nghe schedule:due
 * - import: Đang import video
 */
export default function App() {
  const [view, setView] = useState('startup')
  const [activeChallenge, setActiveChallenge] = useState(null)
  const [popupQueue, setPopupQueue] = useState([])
  const [stats, setStats] = useState(null)

  // Lắng nghe events từ extension (Neutralino)
  useEffect(() => {
    if (!window.Neutralino) {
      console.log('Dev mode: Neutralino not available')
      return
    }

    // Schedule: có câu đến hạn → hiện popup
    Neutralino.events.on('schedule:due', (evt) => {
      const challenge = evt.detail
      if (!activeChallenge) {
        setActiveChallenge(challenge)
      } else {
        setPopupQueue(prev => [...prev, challenge])
      }
    })

    // Import progress
    Neutralino.events.on('import:progress', (evt) => {
      // Có thể dispatch event cho ImportDialog
    })

    Neutralino.events.on('import:complete', () => {
      setView('library')
    })

    // Cleanup
    return () => {
      Neutralino.events.off('schedule:due')
      Neutralino.events.off('import:progress')
      Neutralino.events.off('import:complete')
    }
  }, [activeChallenge])

  const handleStartLearning = useCallback(async () => {
    setView('learning')

    if (window.Neutralino) {
      // Ẩn cửa sổ chính xuống tray
      await Neutralino.window.hide()

      // Extension đã tự start scheduler khi khởi động
      // Chỉ cần đợi schedule:due events
    }
  }, [])

  const handleCloseChallenge = useCallback(() => {
    setActiveChallenge(null)
    // Hiện popup tiếp theo trong queue nếu có
    if (popupQueue.length > 0) {
      const next = popupQueue[0]
      setPopupQueue(prev => prev.slice(1))
      setActiveChallenge(next)
    }
  }, [popupQueue])

  const handleOpenFullApp = useCallback(async () => {
    if (window.Neutralino) {
      await Neutralino.window.show()
    }
    setView('library')
  }, [])

  // Startup screen
  if (view === 'startup') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#0f0f23] p-8 select-none">
        <div className="text-6xl mb-6">🎧</div>
        <h1 className="text-3xl font-bold text-white mb-2">Listening Coach</h1>
        <p className="text-[#a0a0b0] text-center mb-8 max-w-xs text-sm">
          Luyện nghe tiếng Anh qua YouTube.<br/>
          Nghe → Gõ → Biết sai ở đâu → Mastered.
        </p>

        <button
          onClick={handleStartLearning}
          className="w-full max-w-xs bg-[#e94560] text-white font-bold py-3 px-6 rounded-xl text-lg
            hover:bg-[#ff6b81] active:scale-[0.98] transition-all shadow-lg shadow-[#e94560]/20"
        >
          ▶ Start Learning
        </button>

        <div className="flex gap-3 mt-6">
          <button onClick={() => setView('import')} className="btn btn-ghost text-sm">
            📥 Import
          </button>
          <button onClick={handleOpenFullApp} className="btn btn-ghost text-sm">
            📚 Library
          </button>
          <button onClick={() => setView('settings')} className="btn btn-ghost text-sm">
            ⚙ Settings
          </button>
        </div>

        <div className="mt-auto mb-4 text-xs text-[#444]">
          v1.0.0 · {stats?.totalSentences || 0} sentences
        </div>
      </div>
    )
  }

  // Learning mode (background)
  if (view === 'learning') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#0f0f23] p-8">
        <div className="text-6xl mb-4">🎧</div>
        <p className="text-[#a0a0b0] mb-1">Listening Coach đang chạy ngầm</p>
        <p className="text-xs text-[#555] mb-6">Popup sẽ xuất hiện khi có câu đến hạn</p>

        {/* Challenge popup khi có schedule:due */}
        {activeChallenge && (
          <ChallengePopup
            challenge={activeChallenge}
            onClose={handleCloseChallenge}
          />
        )}

        <div className="flex gap-3 mt-6">
          <button onClick={handleOpenFullApp} className="btn btn-ghost text-sm">
            📚 Mở Library
          </button>
          <button onClick={() => setView('settings')} className="btn btn-ghost text-sm">
            ⚙ Settings
          </button>
        </div>
      </div>
    )
  }

  if (view === 'import') {
    return (
      <ImportDialog
        onComplete={() => setView('library')}
        onBack={() => setView('startup')}
      />
    )
  }

  if (view === 'settings') {
    return (
      <SettingsPanel onBack={() => setView('startup')} />
    )
  }

  if (view === 'library') {
    return (
      <Dashboard
        stats={stats}
        onImport={() => setView('import')}
        onBack={() => setView('startup')}
        onLearning={() => setView('learning')}
      />
    )
  }

  return null
}
