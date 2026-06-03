/**
 * ChallengePopup - Popup luyện tập nghe + gõ
 *
 * 2 modes: Quick (mini) | Full (mở rộng)
 * Quick mode: AudioPlayer mini + input + submit
 * Full mode: AudioPlayer đầy đủ + context + progress
 */
import { useState, useCallback } from 'react'
import AudioPlayer from './AudioPlayer.jsx'

export default function ChallengePopup({ challenge, onClose, isFullMode: initialFull = false }) {
  const [expanded, setExpanded] = useState(initialFull)
  const [userInput, setUserInput] = useState('')
  const [result, setResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)

  const { sentence, source } = challenge || {}

  // Resolve path cho Neutralino
  const getAudioPath = useCallback(() => {
    if (!sentence?.source_id) return ''
    // audio/<videoId>.mp3
    return `audio/${sentence.source_id}.mp3`
  }, [sentence])

  const handleSubmit = async () => {
    if (!userInput.trim() || submitting) return
    setSubmitting(true)

    try {
      if (window.Neutralino) {
        const response = await Neutralino.extensions.dispatch('listener', 'scoring:submit', {
          sentenceId: sentence.id,
          userInput: userInput.trim(),
        })
        setResult(response)
      } else {
        // Dev mode: mock
        const score = Math.random()
        setResult({
          pass: score > 0.3,
          score: Math.round(score * 100),
          feedback: score > 0.3 ? null : 'Hãy chú ý đến âm cuối.',
          masteryDelta: score > 0.3 ? 10 : -3,
          xp: score > 0.3 ? 10 : 2,
          newMastery: sentence.mastery_score + (score > 0.3 ? 10 : -3),
        })
      }
    } catch (err) {
      console.error('Scoring error:', err)
    } finally {
      setSubmitting(false)
    }
  }

  const handleSkip = () => {
    if (window.Neutralino) {
      Neutralino.events.broadcast('challenge:skip', { sentenceId: sentence.id })
    }
    onClose?.()
  }

  // Quick mode
  if (!expanded) {
    return (
      <div className="bg-[#1a1a2e] border border-[#333] rounded-xl p-4 w-full max-w-xs shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎧</span>
            {result?.pass === true && <span className="text-green-400 text-xs">✅</span>}
            {result?.pass === false && <span className="text-red-400 text-xs">❌</span>}
          </div>
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-[#a0a0b0] hover:text-white cursor-pointer"
          >
            ✚ Full
          </button>
        </div>

        {/* AudioPlayer mini */}
        <div className="mb-3">
          <AudioPlayer
            audioPath={getAudioPath()}
            startTime={sentence?.start_time}
            endTime={sentence?.end_time}
            compact
            onPlayStateChange={setIsPlaying}
          />
        </div>

        {/* Input */}
        <input
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !submitting) handleSubmit()
            if (e.key === 'r' && e.ctrlKey) {
              e.preventDefault()
              // Trigger replay via click on ↻ button — find it
              const replayBtn = document.querySelector('[title="Phát lại"]')
              replayBtn?.click()
            }
          }}
          placeholder="Gõ những gì bạn nghe được..."
          className="w-full bg-[#0f0f23] border border-[#333] rounded-lg px-3 py-2 text-sm text-white mb-3 outline-none focus:border-[#e94560]"
          autoFocus
          disabled={submitting}
        />

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={!userInput.trim() || submitting}
            className="btn btn-primary text-sm flex-1 disabled:opacity-50"
          >
            {submitting ? '⏳' : 'Submit'}
          </button>
          <button onClick={handleSkip} className="btn btn-ghost text-sm" disabled={submitting}>⛌</button>
          <button onClick={onClose} className="btn btn-ghost text-sm" disabled={submitting}>✕</button>
        </div>

        {/* Result feedback */}
        {result && (
          <div className={`mt-3 text-sm p-2 rounded ${
            result.pass
              ? 'bg-green-900/30 text-green-400 border border-green-700/30'
              : 'bg-red-900/30 text-red-400 border border-red-700/30'
          }`}>
            {result.pass ? (
              <div>
                <p className="font-bold">✅ +10 mastery!</p>
                <p className="text-xs mt-1">+{result.xp} XP · mastery: {result.newMastery}</p>
              </div>
            ) : (
              <div>
                <p className="font-bold">❌ -3 mastery</p>
                <p className="text-xs mt-1">{result.feedback || 'Hãy nghe lại và thử!'}</p>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // Full mode
  return (
    <div className="bg-[#1a1a2e] border border-[#333] rounded-xl p-5 w-full max-w-md shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">🎧 Listen & Type</h2>
        <button onClick={onClose} className="text-[#a0a0b0] hover:text-white cursor-pointer">✕</button>
      </div>

      {/* AudioPlayer full */}
      <div className="mb-4">
        <AudioPlayer
          audioPath={getAudioPath()}
          startTime={sentence?.start_time}
          endTime={sentence?.end_time}
          compact={false}
          onPlayStateChange={setIsPlaying}
        />
      </div>

      {/* Input */}
      <input
        value={userInput}
        onChange={(e) => setUserInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !submitting && handleSubmit()}
        placeholder="Gõ những gì bạn nghe được..."
        className="w-full bg-[#0f0f23] border border-[#333] rounded-lg px-3 py-3 text-sm text-white mb-3 outline-none focus:border-[#e94560]"
        autoFocus
        disabled={submitting}
      />

      {/* Context */}
      <div className="text-xs text-[#666] mb-4 space-y-1">
        {source?.title && <p>📺 {source.title}</p>}
        {sentence && (
          <>
            <p>🎯 Difficulty: {sentence.difficulty || 'N/A'} · mastery: {sentence.mastery_score || 0}</p>
            <p>📝 {sentence.text.slice(0, 60)}...</p>
          </>
        )}
      </div>

      {/* Buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={!userInput.trim() || submitting}
          className="btn btn-primary flex-1 disabled:opacity-50"
        >
          {submitting ? '⏳' : 'Submit'}
        </button>
        <button onClick={handleSkip} className="btn btn-ghost" disabled={submitting}>Skip</button>
      </div>

      {/* Result */}
      {result && (
        <div className={`mt-4 text-sm p-3 rounded ${
          result.pass
            ? 'bg-green-900/30 text-green-400 border border-green-700/30'
            : 'bg-red-900/30 text-red-400 border border-red-700/30'
        }`}>
          {result.pass ? (
            <div>
              <p className="font-bold text-base">✅ PASS</p>
              <p className="text-xs mt-1">+10 mastery · +{result.xp} XP · score: {result.score}%</p>
              <p className="text-xs mt-1">🎯 mastery: {result.newMastery}/100</p>
            </div>
          ) : (
            <div>
              <p className="font-bold text-base">❌ FAIL</p>
              <p className="text-xs mt-1">-3 mastery · +2 XP (cố gắng) · score: {result.score}%</p>
              <p className="text-xs mt-2 text-red-300">{result.feedback || 'Hãy nghe lại và chú ý phát âm của người nói.'}</p>
              <button onClick={() => {
                // Trigger replay
                const replayBtn = document.querySelector('[title="Phát lại đoạn này"]')
                replayBtn?.click()
              }} className="text-xs mt-2 text-[#e94560] hover:underline">
                🔄 Nghe lại
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
