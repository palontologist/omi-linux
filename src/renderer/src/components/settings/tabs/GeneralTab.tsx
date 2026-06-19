import { useState } from 'react'
import { MessagesSquare, Mic, Volume2, Bot, FileText, User } from 'lucide-react'
import { getPreferences, setPreferences } from '../../../lib/preferences'
import { SettingRow } from '../SettingRow'
import { speak, stop as stopTTS } from '../../../lib/ttsService'
import { startAgent, stopAgent, isAgentRunning } from '../../../lib/deepgramAgentClient'
import { extractSummary, type SummaryResult } from '../../../lib/summaryClient'
import { liveConversation } from '../../../lib/liveConversation'
import type { AgentConfig } from '../../../../shared/types'
import {
  getMonologurSettings,
  saveMonologurSettings,
  startMonologur,
  stopMonologur
} from '../../../lib/monologurEngine'

function loadAgentSettings(): AgentConfig {
  try {
    const stored = localStorage.getItem('agent-settings-v1')
    if (stored) return JSON.parse(stored)
  } catch { /* ignore */ }
  return {}
}

function saveAgentSettings(config: AgentConfig): void {
  localStorage.setItem('agent-settings-v1', JSON.stringify(config))
}

export function GeneralTab(): React.JSX.Element {
  const [chatHistoryMode, setChatHistoryMode] = useState(getPreferences().chatHistoryMode)
  const [monologurEnabled, setMonologurEnabled] = useState(() => getMonologurSettings().enabled)
  const [ttsProvider, setTtsProvider] = useState<'web' | 'deepgram'>(() => getMonologurSettings().ttsProvider)
  const [agentActive, setAgentActive] = useState(isAgentRunning())
  const [summaryResult, setSummaryResult] = useState<SummaryResult | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)

  const [agentName, setAgentName] = useState(() => loadAgentSettings().agentName || 'friend')
  const [personality, setPersonality] = useState(() => loadAgentSettings().personality || 'warm, curious, and helpful')
  const [activationMode, setActivationMode] = useState<'wake-word' | 'always'>(() => loadAgentSettings().activationMode || 'wake-word')
  const [clarificationEnabled, setClarificationEnabled] = useState(() => loadAgentSettings().clarificationEnabled !== false)

  return (
    <>
      <SettingRow
        icon={MessagesSquare}
        title="Chat history"
        subtitle="By default, one ongoing conversation (shared with the floating bar) that persists across launches — scroll up in chat to load older messages. Or start a fresh conversation each launch."
        keywords="conversation thread floating bar history infinite"
        control={
          <select
            value={chatHistoryMode}
            onChange={(e) => {
              const v = e.target.value as 'per-launch' | 'infinite'
              setChatHistoryMode(v)
              setPreferences({ chatHistoryMode: v })
            }}
            className="rounded-md bg-white/10 px-2 py-1.5 text-sm text-white focus:outline-none"
          >
            <option value="infinite" className="bg-neutral-900">
              One ongoing conversation (default)
            </option>
            <option value="per-launch" className="bg-neutral-900">
              New conversation each launch
            </option>
          </select>
        }
      />

      <SettingRow
        icon={Mic}
        title="Monologur"
        subtitle="Always-listening AI assistant that provides real-time guidance and suggestions via text-to-speech based on your ongoing conversations."
        keywords="monologur always listening tts speech proactive"
        control={
          <div className="flex items-center gap-2">
            <select
              value={ttsProvider}
              onChange={(e) => {
                const v = e.target.value as 'web' | 'deepgram'
                setTtsProvider(v)
                saveMonologurSettings({ ttsProvider: v })
              }}
              className="rounded-md bg-white/10 px-2 py-1.5 text-sm text-white focus:outline-none"
            >
              <option value="web" className="bg-neutral-900">
                Web TTS
              </option>
              <option value="deepgram" className="bg-neutral-900">
                Deepgram Aura
              </option>
            </select>
            <button
              onClick={() => {
                const newValue = !monologurEnabled
                setMonologurEnabled(newValue)
                saveMonologurSettings({ enabled: newValue })
                if (newValue) {
                  startMonologur()
                } else {
                  stopMonologur()
                }
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                monologurEnabled
                  ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                  : 'bg-white/10 text-white/60 hover:bg-white/20'
              }`}
            >
              {monologurEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        }
      />

      <SettingRow
        icon={Volume2}
        title="Test TTS"
        subtitle="Speak a sample sentence to verify text-to-speech is working."
        keywords="tts test speech speak audio"
        control={
          <button
            onClick={() => {
              stopTTS()
              speak(
                'Hello! This is a test of the text to speech system. The weather today is sunny with a high of twenty five degrees.',
                { enabled: true, rate: 1.0, pitch: 1.0, volume: 1.0, voiceName: null },
                { onEnd: () => console.log('[tts] test complete') }
              )
            }}
            className="rounded-md bg-blue-500/20 px-3 py-1.5 text-sm font-medium text-blue-400 hover:bg-blue-500/30"
          >
            Speak Test
          </button>
        }
      />

      <SettingRow
        icon={Bot}
        title="Voice Agent"
        subtitle="Full voice pipeline with personality. Speak to the mic and the AI responds with voice."
        keywords="voice agent deepgram stt tts llm conversation personality"
        control={
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={agentName}
                onChange={(e) => {
                  setAgentName(e.target.value)
                  saveAgentSettings({ agentName: e.target.value, personality, activationMode, clarificationEnabled })
                }}
                placeholder="Agent name"
                className="w-24 rounded-md bg-white/10 px-2 py-1.5 text-sm text-white focus:outline-none"
              />
              <button
                onClick={() => {
                  if (agentActive) {
                    stopAgent()
                    setAgentActive(false)
                  } else {
                    const config: AgentConfig = {
                      agentName,
                      personality,
                      activationMode,
                      clarificationEnabled,
                      ttsVoice: 'aura-2-thalia-en'
                    }
                    startAgent(config, {
                      onConnected: () => console.log('[voice-agent] connected'),
                      onUserText: (t) => console.log('[voice-agent] user:', t),
                      onAgentText: (t) => console.log('[voice-agent] agent:', t),
                      onClosed: () => setAgentActive(false),
                      onError: (e) => { console.error('[voice-agent] error:', e); setAgentActive(false) }
                    })
                    setAgentActive(true)
                  }
                }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  agentActive
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                    : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                }`}
              >
                {agentActive ? 'Stop' : 'Start'}
              </button>
            </div>
            <div className="flex gap-2 text-xs">
              <select
                value={activationMode}
                onChange={(e) => {
                  const v = e.target.value as 'wake-word' | 'always'
                  setActivationMode(v)
                  saveAgentSettings({ agentName, personality, activationMode: v, clarificationEnabled })
                }}
                className="rounded-md bg-white/10 px-2 py-1 text-white focus:outline-none"
              >
                <option value="wake-word" className="bg-neutral-900">Say "{agentName}" to activate</option>
                <option value="always" className="bg-neutral-900">Always respond</option>
              </select>
              <label className="flex items-center gap-1 text-white/60">
                <input
                  type="checkbox"
                  checked={clarificationEnabled}
                  onChange={(e) => {
                    setClarificationEnabled(e.target.checked)
                    saveAgentSettings({ agentName, personality, activationMode, clarificationEnabled: e.target.checked })
                  }}
                  className="rounded"
                />
                Ask when unsure
              </label>
            </div>
            <input
              type="text"
              value={personality}
              onChange={(e) => {
                setPersonality(e.target.value)
                saveAgentSettings({ agentName, personality: e.target.value, activationMode, clarificationEnabled })
              }}
              placeholder="Personality traits"
              className="w-full rounded-md bg-white/10 px-2 py-1.5 text-xs text-white/70 focus:outline-none"
            />
          </div>
        }
      />

      <SettingRow
        icon={FileText}
        title="Summarize Transcript"
        subtitle="Extract summary, tasks, and key points from the current transcript using Gemini."
        keywords="summary tasks key points extract transcript"
        control={
          <div className="flex flex-col items-end gap-2">
            <button
              onClick={async () => {
                const segments = liveConversation.getSegments()
                if (segments.length === 0) {
                  setSummaryResult({ summary: 'No transcript yet. Start recording first.', tasks: [], keyPoints: [] })
                  return
                }
                setSummaryLoading(true)
                try {
                  const result = await extractSummary(segments)
                  setSummaryResult(result)
                } catch (e) {
                  setSummaryResult({ summary: `Error: ${(e as Error).message}`, tasks: [], keyPoints: [] })
                } finally {
                  setSummaryLoading(false)
                }
              }}
              disabled={summaryLoading}
              className="rounded-md bg-purple-500/20 px-3 py-1.5 text-sm font-medium text-purple-400 hover:bg-purple-500/30 disabled:opacity-50"
            >
              {summaryLoading ? 'Summarizing...' : 'Summarize'}
            </button>
            {summaryResult && (
              <div className="mt-2 w-full rounded-md bg-white/5 p-3 text-xs text-white/70">
                <p className="mb-1 font-medium text-white/90">Summary</p>
                <p>{summaryResult.summary}</p>
                {summaryResult.tasks.length > 0 && (
                  <div className="mt-2">
                    <p className="mb-1 font-medium text-white/90">Tasks</p>
                    <ul className="list-disc pl-4">
                      {summaryResult.tasks.map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                  </div>
                )}
                {summaryResult.keyPoints.length > 0 && (
                  <div className="mt-2">
                    <p className="mb-1 font-medium text-white/90">Key Points</p>
                    <ul className="list-disc pl-4">
                      {summaryResult.keyPoints.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        }
      />
    </>
  )
}
