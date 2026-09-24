import { useEffect, useRef, useState } from 'react'
import { auth } from '../lib/firebase'
import { invalidateConversationsCache } from '../lib/pageCache'
import { gatherLocalContext } from '../lib/localAgent'
import { readCurrentScreen } from '../lib/screenContext'
import { looksLikeAction, looksLikeRawPlan, planActions } from '../lib/actionPlanner'
import { callAgentLLM } from '../lib/agentLLM'
import type { AutomationPlan } from '../../../shared/types'
import { getPreferences } from '../lib/preferences'
import { readAgentSettings, isLocalProviderActive } from '../lib/agentSettings'
import { planFromDecision, requestLocalBrain } from '../lib/localBrain'
import { parseRemoteDesktopTask } from '../lib/remoteDesktopTask'
import { resolveChatId, mergeChatMessages } from '../lib/chatConversation'

export type ChatMsg = { id?: string; role: 'user' | 'assistant'; content: string }

const OMI_BASE = import.meta.env.VITE_OMI_API_BASE as string

export type UseChat = {
  history: ChatMsg[]
  sending: boolean
  // `send` takes the message text. The draft input is intentionally NOT stored
  // here: this hook lives in the app-wide AppStateProvider, so keeping the
  // per-keystroke input in it would re-render the entire app shell (and every
  // mounted page) on every character. The draft is local component state in the
  // chat bar; only the persisted history/sending live here.
  // `send` is the single consent entry point for BOTH typed chat and any future
  // voice transcript. When it classifies a message as an action and builds a valid
  // plan, approval + execution happen via a NATIVE Windows dialog (main process),
  // so it works identically from the main window and the floating overlay.
  send: (text: string) => Promise<void>
  /**
   * Consider an INBOUND shared-conversation message for a phone→desktop task
   * proposal. Only acts on a valid `omi_desktop_task` envelope; ordinary chat
   * text is ignored (returns false), so remote messages can't inject actions
   * unless they use the explicit envelope. A proposal still goes through the
   * same `tryPlan` + native-confirm gate as `send`. Returns true if handled.
   */
  handleRemoteProposal: (text: string) => Promise<boolean>
  /** Clear the thread to a fresh conversation (used by the overlay's Esc). */
  reset: () => void
}

/**
 * Omi chat backed by streaming `/v2/messages`. The thread is persisted as a
 * local conversation (kind='chat') in real time — created the moment a message
 * is sent and upserted as the reply streams — so it shows up in the
 * Conversations list immediately. One conversation per hook lifetime (i.e. per
 * Home mount / app launch).
 */
export function useChat(opts?: { surface?: 'main' | 'overlay' }): UseChat {
  const surface = opts?.surface ?? 'main'
  const mode = getPreferences().chatHistoryMode

  const [history, setHistory] = useState<ChatMsg[]>([])
  const [sending, setSending] = useState(false)

  // Resolve the conversation id once for this hook's lifetime, based on the mode.
  // 'infinite' shares one stable id across launches AND across the main/overlay
  // windows (stored in localStorage); 'per-launch' is fresh per mount.
  const chatIdRef = useRef<string | null>(null)
  if (chatIdRef.current === null) {
    chatIdRef.current = resolveChatId(
      mode,
      {
        get: () => localStorage.getItem('omi-chat-infinite-id'),
        set: (id) => {
          try {
            localStorage.setItem('omi-chat-infinite-id', id)
          } catch {
            /* private mode / quota */
          }
        }
      },
      () => `chat-${crypto.randomUUID()}`
    )
  }
  const startedAtRef = useRef<number>(0)
  // Synchronous mirror of `sending` for the re-entrancy guard. The `sending` state
  // captured in a `send` closure can be stale (e.g. a queued/auto-sent voice
  // message firing right as a previous reply finishes), which would wrongly drop
  // the new send; the ref is always current.
  const sendingRef = useRef(false)

  // In infinite mode the MAIN window shows the ongoing thread, so load it once on
  // mount (and backfill ids on any legacy id-less messages so the merge can match
  // them). The overlay never loads — it opens fresh and only appends.
  useEffect(() => {
    if (mode !== 'infinite' || surface !== 'main' || !chatIdRef.current) return
    let cancelled = false
    void window.omi
      .getLocalConversation(chatIdRef.current)
      .then((c) => {
        // Skip if a send already started before this async load resolved —
        // otherwise we'd overwrite the in-flight bubble (sendingRef is set
        // synchronously at the top of send()).
        if (cancelled || sendingRef.current || !c?.messages) return
        startedAtRef.current = c.startedAt || Date.now()
        setHistory(
          c.messages.map((m) => ({
            id: m.id ?? crypto.randomUUID(),
            role: m.role,
            content: m.content
          }))
        )
      })
      .catch(() => {
        /* no prior conversation — start empty */
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persistChat = async (thread: ChatMsg[]): Promise<void> => {
    if (!chatIdRef.current) {
      chatIdRef.current = `chat-${crypto.randomUUID()}`
    }
    if (!startedAtRef.current) startedAtRef.current = Date.now()

    // In infinite mode the main window and overlay both write this id, so read the
    // current stored thread and MERGE by message id instead of overwriting — that
    // preserves the other window's messages and updates (not duplicates) a streamed
    // assistant message. Per-launch keeps the simple single-writer replace path.
    // NOTE: this read-modify-write isn't atomic, so two windows streaming at the
    // EXACT same instant can have one cycle's write land second and drop the other's
    // in-flight content. It self-heals on the next persist, and each send's final
    // persist (in `finally`) reconciles — acceptable given simultaneous cross-window
    // streaming is a niche case (accepted in the design spec).
    let toStore = thread
    if (mode === 'infinite') {
      try {
        const existing = await window.omi.getLocalConversation(chatIdRef.current)
        if (existing?.startedAt) startedAtRef.current = existing.startedAt
        toStore = mergeChatMessages(existing?.messages ?? [], thread)
      } catch {
        /* fall back to writing just this thread */
      }
    }

    const transcript = toStore
      .map((m) => `${m.role === 'user' ? 'You' : 'Omi'}: ${m.content}`)
      .join('\n\n')
    try {
      await window.omi.insertLocalConversation({
        id: chatIdRef.current,
        startedAt: startedAtRef.current,
        endedAt: Date.now(),
        transcript,
        createdAt: startedAtRef.current,
        kind: 'chat',
        messages: toStore
      })
      invalidateConversationsCache() // this renderer's cache (immediate)
      // …and tell every OTHER window (main ↔ overlay) to refresh too, since each
      // renderer has its own per-process conversations cache.
      window.omi.notifyConversationsChanged()
    } catch (e) {
      console.error('Failed to persist chat conversation:', e)
    }
  }

  // Desktop-automation pre-step. Returns:
  //   'planned' — produced a valid plan (parked in pendingPlan for approval);
  //               the user message is added here and normal chat is skipped.
  //   'error'   — the message looked like an action but we couldn't reach/parse
  //               the planner (e.g. backend 429, snapshot failed); the caller
  //               surfaces that instead of silently answering it as chat.
  //   'chat'    — not an action (or no keyword hint) → fall through to chat.
  // Snapshots the last non-Omi foreground window so we plan against the app the
  // user was actually using, not Omi itself.
  type PlanVerdict =
    | { kind: 'planned'; plan: AutomationPlan }
    | { kind: 'error' }
    | { kind: 'chat' }
  const tryPlan = async (text: string): Promise<PlanVerdict> => {
    // Desktop automation requires BOTH the OMI_AUTOMATION env kill-switch (on
    // unless OMI_AUTOMATION=0) and the user's onboarding opt-in. Until the user
    // grants the Automation step, every message falls straight through to normal
    // chat.
    if (!window.omi.automationEnabled) return { kind: 'chat' }
    if (!getPreferences().automationConsentedAt) return { kind: 'chat' }
    if (!looksLikeAction(text)) return { kind: 'chat' }
    try {
      const handle = await window.omi.automationTargetWindow().catch(() => null)
      const result = await planActions(text, {
        getSnapshot: () => window.omi.automationSnapshot(handle ?? undefined),
        callLLM: callAgentLLM
      })
      if (result.ok) return { kind: 'planned', plan: result.plan }
      return { kind: result.kind }
    } catch {
      return { kind: 'error' }
    }
  }

  // A phone→desktop proposal that arrives in the shared conversation. Only the
  // explicit envelope counts; a valid goal then goes through the SAME plan +
  // native-confirm gate as a locally typed action (never a silent remote run).
  const handleRemoteProposal = async (text: string): Promise<boolean> => {
    const task = parseRemoteDesktopTask(text)
    if (!task) return false
    // Don't race an in-flight send.
    if (sendingRef.current) return false

    const goal = task.goal
    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: 'user', content: `📱 ${goal}` }
    const baseHistory = history
    setHistory((h) => [...h, userMsg])

    const verdict = await tryPlan(goal)
    if (verdict.kind === 'planned') {
      const r = await window.omi.automationConfirmRun(verdict.plan)
      const outMsg: ChatMsg = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: r.canceled
          ? 'I left that remote request unapproved.'
          : r.ok
            ? 'Done.'
            : `I couldn't finish that: ${r.message ?? 'a step failed'}`
      }
      setHistory((h) => [...h, outMsg])
      void persistChat([...baseHistory, userMsg, outMsg])
      return true
    }
    const note: ChatMsg = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content:
        verdict.kind === 'error'
          ? "I couldn't turn that remote request into a safe action, so I didn't do anything."
          : "That remote request didn't look like a desktop action I can run, so I ignored it."
    }
    setHistory((h) => [...h, note])
    void persistChat([...baseHistory, userMsg, note])
    return true
  }

  const send = async (text: string): Promise<void> => {
    // Re-entrancy latch (sendingRef is the always-current mirror of `sending`).
    if (!text.trim() || sendingRef.current) return
    sendingRef.current = true
    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: 'user', content: text }
    const baseHistory = history
    // Show the user's message immediately, BEFORE the (potentially ~2s) action-
    // planner snapshot+LLM round-trip, so the chat never appears to hang. The
    // planner then decides: park a plan, surface an error, or fall through to chat.
    setHistory((h) => [...h, userMsg])

    const verdict = await tryPlan(text)
    if (verdict.kind === 'planned') {
      // Consent + execution happen in a NATIVE Windows dialog (main process), so
      // this works the same from the main window and the floating overlay. We
      // don't stream a reply — just post the outcome.
      const r = await window.omi.automationConfirmRun(verdict.plan)
      const outMsg: ChatMsg = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: r.canceled
          ? "Okay, I won't do that."
          : r.ok
            ? 'Done.'
            : `I couldn't finish that: ${r.message ?? 'a step failed'}`
      }
      setHistory((h) => [...h, outMsg])
      void persistChat([...baseHistory, userMsg, outMsg])
      sendingRef.current = false
      return
    }
    if (verdict.kind === 'error') {
      const errMsg: ChatMsg = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content:
          "I couldn't turn that into an action I could run safely, so I didn't do anything. Try rephrasing it, or try again in a moment."
      }
      setHistory((h) => [...h, errMsg])
      void persistChat([...baseHistory, userMsg, errMsg])
      sendingRef.current = false
      return
    }
    const assistantId = crypto.randomUUID()
    const buildThread = (assistant: string): ChatMsg[] => [
      ...baseHistory,
      userMsg,
      { id: assistantId, role: 'assistant', content: assistant }
    ]
    setHistory((h) => [...h, { id: assistantId, role: 'assistant', content: '' }])
    setSending(true)

    let assistantText = ''

    // Local route: when the provider is a local OpenAI-compatible endpoint
    // (llama-server / LM Studio / Ollama), run the on-device tool agent in the
    // main process instead of the metered cloud /v2/messages. Bounded tool loop,
    // transcripts never leave the machine. Falls back to the cloud path on error.
    const localCfg = readAgentSettings()
    const hasLocalLLM = Boolean(localCfg.llmBaseUrl) || isLocalProviderActive()
    const prior = baseHistory.slice(-8).map((m) => ({ role: m.role, content: m.content }))

    // Runs the local OpenAI tool-agent and renders it; returns true if it handled
    // the turn (success OR surfaced error), false to let the caller fall back.
    const runLocalAnswer = async (): Promise<boolean> => {
      const r = await window.omi.localAgentRun({
        baseUrl: localCfg.llmBaseUrl || 'http://localhost:8080/v1',
        model: localCfg.llmModel || 'local-model',
        userText: userMsg.content,
        history: prior
      })
      if (!r.error) {
        const used = r.tools.map((t) => t.name)
        assistantText =
          r.text +
          (used.length
            ? `\n\n_${used.length} tool${used.length > 1 ? 's' : ''}: ${used.join(', ')}_`
            : '')
      } else {
        assistantText = `⚠️ Local model failed: ${r.error}\n(Start it with: llama-server -m <model.gguf> --port 8080 --jinja, or turn the local route off in Settings.)`
      }
      setHistory((h) => {
        const next = [...h]
        next[next.length - 1] = { id: assistantId, role: 'assistant', content: assistantText }
        return next
      })
      void persistChat(buildThread(assistantText))
      sendingRef.current = false
      setSending(false)
      return true
    }

    // Explicit "Local" provider always runs local.
    if (isLocalProviderActive()) {
      await runLocalAnswer()
      return
    }

    // Local "brain" router (Laya sidecar): opt-in. Asks a cheap local classifier
    // whether the turn can be handled locally (tools / small local LLM) before
    // spending a metered cloud call. Any error/timeout/unknown -> cloud (default).
    if (localCfg.localBrainEnabled && hasLocalLLM) {
      const decision = await requestLocalBrain(
        localCfg.localBrainUrl || 'http://127.0.0.1:8765',
        userMsg.content
      )
      const plan = planFromDecision(decision, hasLocalLLM)
      if (plan.kind === 'local_tools' || plan.kind === 'local_llm') {
        await runLocalAnswer()
        return
      }
      if (plan.kind === 'confirm') {
        assistantText =
          'That looks like it touches something sensitive, so I didn’t run it. Ask again and I’ll confirm the specifics first.'
        setHistory((h) => {
          const next = [...h]
          next[next.length - 1] = { id: assistantId, role: 'assistant', content: assistantText }
          return next
        })
        void persistChat(buildThread(assistantText))
        sendingRef.current = false
        setSending(false)
        return
      }
      // plan.kind === 'cloud' -> fall through to the metered path.
    }

    void persistChat(buildThread(''))
    let lastPersist = Date.now()

    try {
      const token = await auth.currentUser?.getIdToken()
      // Hybrid pre-step: gather context to PREPEND to the text we send (not what we
      // persist). Both are best-effort ('' on failure) and run concurrently so the
      // send isn't serialized behind them:
      //   • current screen — the current screen's OCR text, attached as ambient
      //     context to EVERY message. It's framed so the model ignores it unless the
      //     message is actually about the screen, so it doesn't bloat answers. This
      //     is an instant hot-cache read, so normal messages don't pay a capture cost;
      //   • local KG/file context — apps/projects/tech the chat is grounded in.
      const [screenContext, localContext] = await Promise.all([
        readCurrentScreen(),
        gatherLocalContext(userMsg.content)
      ])
      const contextParts = [screenContext, localContext].filter(Boolean)
      const textToSend = contextParts.length
        ? `${contextParts.join('\n\n')}\n\n${userMsg.content}`
        : userMsg.content
      const res = await fetch(`${OMI_BASE}/v2/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ text: textToSend })
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      // Each SSE line arrives as `data: <chunk>` (with `done:` marking the end).
      // Strip the field prefix before appending, otherwise the literal "data:"
      // leaks into the rendered reply. The backend also (a) emits ephemeral
      // "thinking" status events whose payload starts with `think:` ("Checking
      // action items", "Searching memories") — those aren't part of the reply,
      // so drop them — and (b) encodes reply newlines as the literal token
      // `__CRLF__` so they survive single-line SSE framing; restore those.
      const parseChunk = (line: string): string | null => {
        if (!line || line.startsWith('done:')) return null
        const content = line.startsWith('data:') ? line.slice(5).replace(/^ /, '') : line
        if (content.startsWith('think:')) return null
        return content.replace(/__CRLF__/g, '\n')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const chunk = parseChunk(line)
          if (chunk === null) continue
          assistantText += chunk
          setHistory((h) => {
            const next = [...h]
            next[next.length - 1] = { id: assistantId, role: 'assistant', content: assistantText }
            return next
          })
        }
        if (Date.now() - lastPersist > 1500) {
          lastPersist = Date.now()
          void persistChat(buildThread(assistantText))
        }
      }
      const tail = parseChunk(buffer)
      if (tail !== null) {
        assistantText += tail
        setHistory((h) => {
          const next = [...h]
          next[next.length - 1] = { id: assistantId, role: 'assistant', content: assistantText }
          return next
        })
      }
      // The conversational backend sometimes answers an action-intent message
      // with raw plan JSON (when it reached chat WITHOUT our planner — e.g. a
      // keyword-less follow-up like "again"). Don't render that raw in the thread.
      if (looksLikeRawPlan(assistantText)) {
        assistantText =
          'It looks like you want me to do something in an app. Phrase it as a direct command (e.g. "type report in the search box") with that app focused, and I\'ll show you a plan to approve.'
        setHistory((h) => {
          const next = [...h]
          next[next.length - 1] = { id: assistantId, role: 'assistant', content: assistantText }
          return next
        })
      }
    } catch (e) {
      assistantText = `Error: ${(e as Error).message}`
      setHistory((h) => {
        const next = [...h]
        next[next.length - 1] = { id: assistantId, role: 'assistant', content: assistantText }
        return next
      })
    } finally {
      sendingRef.current = false
      setSending(false)
      await persistChat(buildThread(assistantText))
    }
  }

  // Start a fresh thread: drop the history and forget the persisted-conversation
  // id so the next send creates a new local conversation. A reply still streaming
  // when this is called will keep writing into the (now-empty) history — Esc-reset
  // mid-stream is a rare edge we don't guard against here.
  const reset = (): void => {
    setHistory([])
    setSending(false)
    sendingRef.current = false
    // Always create a fresh conversation ID so the next send starts a new thread.
    chatIdRef.current = null
    startedAtRef.current = 0
    // Re-resolve the id immediately so the next send picks up the new one.
    chatIdRef.current = resolveChatId(
      mode,
      {
        get: () => localStorage.getItem('omi-chat-infinite-id'),
        set: (id) => {
          try {
            localStorage.setItem('omi-chat-infinite-id', id)
          } catch {
            /* private mode / quota */
          }
        }
      },
      () => `chat-${crypto.randomUUID()}`
    )
  }

  return { history, sending, send, handleRemoteProposal, reset }
}
