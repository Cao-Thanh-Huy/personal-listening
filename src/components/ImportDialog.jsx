/**
 * ImportDialog - Import YouTube video
 * Paste URL → Fetch transcript → Download audio → Classify → Save DB
 */
import { useState } from 'react'

export default function ImportDialog({ onComplete, onBack }) {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('idle') // idle | importing | done | error
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')

  const handleImport = async () => {
    if (!url.trim()) return
    setStatus('importing')
    setProgress(0)

    try {
      if (window.Neutralino) {
        // Gửi lệnh import đến extension qua Neutralino IPC
        await Neutralino.extensions.dispatch('listener', 'import:start', { url })

        // Lắng nghe progress events
        Neutralino.events.on('import:progress', (evt) => {
          setProgress(evt.detail.percent)
        })

        Neutralino.events.on('import:complete', () => {
          setStatus('done')
          setTimeout(() => onComplete?.(), 1500)
        })

        Neutralino.events.on('import:error', (evt) => {
          setError(evt.detail.error)
          setStatus('error')
        })
      } else {
        // Dev mode: mock import
        for (let i = 0; i <= 100; i += 20) {
          await new Promise(r => setTimeout(r, 300))
          setProgress(i)
        }
        setStatus('done')
        setTimeout(() => onComplete?.(), 1000)
      }
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  return (
    <div className="flex flex-col h-screen bg-[#0f0f23] p-6">
      <div className="flex items-center mb-6">
        <button onClick={onBack} className="text-[#a0a0b0] hover:text-white mr-3">←</button>
        <h1 className="text-lg font-bold">📥 Import Video</h1>
      </div>

      <div className="flex-1">
        <p className="text-sm text-[#a0a0b0] mb-4">
          Paste YouTube URL để import transcript và audio
        </p>

        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleImport()}
          placeholder="https://youtube.com/watch?v=..."
          className="w-full bg-[#1a1a2e] border border-[#333] rounded-lg px-4 py-3 text-sm text-white mb-4 outline-none focus:border-[#e94560]"
          disabled={status === 'importing'}
        />

        <button
          onClick={handleImport}
          disabled={!url.trim() || status === 'importing'}
          className="btn btn-primary w-full mb-4 disabled:opacity-50"
        >
          {status === 'importing' ? '🔄 Importing...' : '🚀 Import'}
        </button>

        {status === 'importing' && (
          <div className="space-y-2">
            <div className="h-2 bg-[#1a1a2e] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#e94560] rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-[#a0a0b0] text-center">{progress}%</p>
          </div>
        )}

        {status === 'done' && (
          <div className="text-center text-green-400 text-sm">✅ Import thành công!</div>
        )}

        {status === 'error' && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-sm text-red-400">
            ❌ {error}
          </div>
        )}
      </div>
    </div>
  )
}
