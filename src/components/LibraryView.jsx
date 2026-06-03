/**
 * LibraryView - Danh sách video đã import
 */
import { useState, useEffect } from 'react'

export default function LibraryView({ onBack, onSelectSource }) {
  const [sources, setSources] = useState([])

  useEffect(() => {
    if (window.Neutralino) {
      Neutralino.extensions.dispatch('listener', 'sources:list', {})
        .then(setSources)
        .catch(() => setSources([]))
    }
  }, [])

  return (
    <div className="flex flex-col h-screen bg-[#0f0f23] p-6 overflow-y-auto">
      <div className="flex items-center mb-6">
        <button onClick={onBack} className="text-[#a0a0b0] hover:text-white mr-3">←</button>
        <h1 className="text-lg font-bold">📚 Library</h1>
      </div>

      {sources.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-[#666]">
          <p className="text-4xl mb-3">📚</p>
          <p className="text-sm">Chưa có video nào</p>
          <p className="text-xs mt-1">Import video YouTube để bắt đầu!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sources.map((src) => (
            <div
              key={src.id}
              onClick={() => onSelectSource?.(src)}
              className="bg-[#1a1a2e] border border-[#333] rounded-xl p-4 cursor-pointer hover:border-[#e94560] transition-colors"
            >
              <p className="font-bold text-sm mb-1">{src.title || 'Untitled'}</p>
              <div className="flex items-center gap-3 text-xs text-[#a0a0b0]">
                <span>🎯 {src.topic || 'N/A'}</span>
                <span>📅 {src.created_at?.slice(0, 10) || 'N/A'}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
