/**
 * SettingsPanel - Cấu hình app
 * Schedule interval, speed, theme, audio path, Groq API key
 */
import { useState } from 'react'

export default function SettingsPanel({ onBack }) {
  const [settings, setSettings] = useState({
    scheduleInterval: 5,
    defaultSpeed: 1.0,
    theme: 'dark',
    audioPath: '',
    groqApiKey: '',
  })

  const handleSave = async () => {
    if (window.Neutralino) {
      await Neutralino.extensions.dispatch('listener', 'settings:save', settings)
    }
    // TODO: lưu xuống DB / file config
  }

  return (
    <div className="flex flex-col h-screen bg-[#0f0f23] p-6">
      <div className="flex items-center mb-6">
        <button onClick={onBack} className="text-[#a0a0b0] hover:text-white mr-3">←</button>
        <h1 className="text-lg font-bold">⚙ Settings</h1>
      </div>

      <div className="flex-1 space-y-4">
        {/* Schedule */}
        <div className="bg-[#1a1a2e] rounded-xl p-4 border border-[#333]">
          <label className="text-sm font-bold mb-2 block">⏰ Schedule Interval</label>
          <select
            value={settings.scheduleInterval}
            onChange={(e) => setSettings(prev => ({ ...prev, scheduleInterval: Number(e.target.value) }))}
            className="w-full bg-[#0f0f23] border border-[#333] rounded-lg px-3 py-2 text-sm text-white outline-none"
          >
            <option value={5}>5 phút</option>
            <option value={10}>10 phút</option>
            <option value={15}>15 phút</option>
            <option value={30}>30 phút</option>
          </select>
        </div>

        {/* Speed */}
        <div className="bg-[#1a1a2e] rounded-xl p-4 border border-[#333]">
          <label className="text-sm font-bold mb-2 block">🎵 Default Speed</label>
          <div className="flex gap-2">
            {[0.5, 0.75, 1.0, 1.25, 1.5].map((s) => (
              <button
                key={s}
                onClick={() => setSettings(prev => ({ ...prev, defaultSpeed: s }))}
                className={`text-sm px-3 py-1 rounded ${settings.defaultSpeed === s ? 'bg-[#e94560] text-white' : 'bg-[#333] text-[#a0a0b0]'}`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Theme */}
        <div className="bg-[#1a1a2e] rounded-xl p-4 border border-[#333]">
          <label className="text-sm font-bold mb-2 block">🎨 Theme</label>
          <select
            value={settings.theme}
            onChange={(e) => setSettings(prev => ({ ...prev, theme: e.target.value }))}
            className="w-full bg-[#0f0f23] border border-[#333] rounded-lg px-3 py-2 text-sm text-white outline-none"
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>

        {/* Groq API Key */}
        <div className="bg-[#1a1a2e] rounded-xl p-4 border border-[#333]">
          <label className="text-sm font-bold mb-2 block">🤖 Groq API Key</label>
          <input
            type="password"
            value={settings.groqApiKey}
            onChange={(e) => setSettings(prev => ({ ...prev, groqApiKey: e.target.value }))}
            placeholder="gsk_..."
            className="w-full bg-[#0f0f23] border border-[#333] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#e94560]"
          />
          <p className="text-xs text-[#666] mt-1">Free từ groq.com, không cần credit card</p>
        </div>
      </div>

      <button onClick={handleSave} className="btn btn-primary w-full mt-4">
        💾 Lưu Settings
      </button>
    </div>
  )
}
