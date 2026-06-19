// src/renderer/src/lib/deepgramAgentClient.ts
// Deepgram Voice Agent client — mic → STT + LLM → TTS playback
import type { AgentConfig, AgentMessage, AgentAudioMessage } from '../../../shared/types'

export type AgentCallbacks = {
  onConnected?: () => void
  onUserText?: (text: string) => void
  onAgentText?: (text: string) => void
  onAgentSpeaking?: (latency?: { total: number; tts: number; ttt: number }) => void
  onAgentAudioDone?: () => void
  onFunctionCall?: (name: string, args: Record<string, unknown>, result: string) => void
  onError?: (msg: string) => void
  onClosed?: (code: number) => void
}

let nextSessionId = 1
let currentSessionId: string | null = null
let stream: MediaStream | null = null
let audioCtx: AudioContext | null = null
let unsubMsg: (() => void) | null = null
let unsubAudio: (() => void) | null = null

// Audio playback queue for agent TTS
let playbackCtx: AudioContext | null = null
const audioQueue: Float32Array[] = []
let playing = false

function getPlaybackCtx(): AudioContext {
  if (!playbackCtx) {
    playbackCtx = new AudioContext({ sampleRate: 24000 })
  }
  return playbackCtx
}

async function playNextChunk(): Promise<void> {
  if (playing || audioQueue.length === 0) return
  playing = true

  const ctx = getPlaybackCtx()
  const pcm16 = audioQueue.shift()!
  // Convert PCM16 (base64 was decoded to Int16Array by the caller) to Float32
  const float32 = new Float32Array(pcm16.length)
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = (pcm16 as unknown as Int16Array)[i] / 32768
  }

  const buffer = ctx.createBuffer(1, float32.length, 24000)
  buffer.getChannelData(0).set(float32)

  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.onended = () => {
    playing = false
    playNextChunk()
  }
  source.start()
}

export function startAgent(config?: AgentConfig, cb?: AgentCallbacks): string {
  const sessionId = `agent-${Date.now()}-${nextSessionId++}`
  currentSessionId = sessionId

  // Subscribe to messages
  unsubMsg = window.omi.onDeepgramAgentMessage((msg: AgentMessage) => {
    if (msg.sessionId !== sessionId) return
    switch (msg.kind) {
      case 'connected':
        console.log('[agent] connected')
        cb?.onConnected?.()
        break
      case 'settingsApplied':
        console.log('[agent] settings applied, ready for audio')
        break
      case 'conversationText':
        if (msg.role === 'user') {
          console.log('[agent] user said:', msg.content)
          cb?.onUserText?.(msg.content)
        } else {
          console.log('[agent] agent said:', msg.content)
          cb?.onAgentText?.(msg.content)
        }
        break
      case 'agentSpeaking':
        console.log(`[agent] speaking (total=${msg.totalLatency}s, tts=${msg.ttsLatency}s, ttt=${msg.tttLatency}s)`)
        cb?.onAgentSpeaking?.({ total: msg.totalLatency, tts: msg.ttsLatency, ttt: msg.tttLatency })
        break
      case 'agentAudioDone':
        console.log('[agent] audio done')
        cb?.onAgentAudioDone?.()
        break
      case 'functionCall':
        console.log(`[agent] function call: ${msg.name}(${JSON.stringify(msg.args)}) -> ${msg.result}`)
        cb?.onFunctionCall?.(msg.name, msg.args, msg.result)
        break
      case 'error':
        console.error('[agent] error:', msg.message)
        cb?.onError?.(msg.message)
        break
      case 'closed':
        console.log('[agent] closed:', msg.code)
        cb?.onClosed?.(msg.code)
        break
    }
  })

  // Subscribe to audio
  unsubAudio = window.omi.onDeepgramAgentAudio((msg: AgentAudioMessage) => {
    if (msg.sessionId !== sessionId) return
    // Decode base64 to Int16Array
    const raw = atob(msg.audio)
    const int16 = new Int16Array(raw.length / 2)
    for (let i = 0; i < int16.length; i++) {
      int16[i] = (raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8))
    }
    audioQueue.push(int16 as unknown as Float32Array)
    playNextChunk()
  })

  // Start the agent
  window.omi.deepgramAgentStart({ sessionId, config })

  // Start mic capture
  startMicCapture(sessionId)

  return sessionId
}

async function startMicCapture(sessionId: string): Promise<void> {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    audioCtx = new AudioContext({ sampleRate: 16000 })
    const source = audioCtx.createMediaStreamSource(stream)
    const processor = audioCtx.createScriptProcessor(4096, 1, 1)

    source.connect(processor)
    processor.connect(audioCtx.destination)

    processor.onaudioprocess = (e) => {
      if (currentSessionId !== sessionId) return
      const f32 = e.inputBuffer.getChannelData(0)
      const i16 = new Int16Array(f32.length)
      for (let i = 0; i < f32.length; i++) {
        const s = Math.max(-1, Math.min(1, f32[i]))
        i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }
      window.omi.deepgramAgentFeed(sessionId, i16.buffer)
    }
  } catch (e) {
    console.error('[agent] mic capture failed:', e)
  }
}

export function stopAgent(): void {
  const sessionId = currentSessionId
  currentSessionId = null

  unsubMsg?.()
  unsubAudio?.()
  unsubMsg = null
  unsubAudio = null

  if (stream) {
    stream.getTracks().forEach((t) => t.stop())
    stream = null
  }
  if (audioCtx) {
    audioCtx.close()
    audioCtx = null
  }

  // Stop audio playback
  audioQueue.length = 0
  playing = false

  if (sessionId) {
    window.omi.deepgramAgentStop(sessionId)
  }
}

export function isAgentRunning(): boolean {
  return currentSessionId !== null
}
