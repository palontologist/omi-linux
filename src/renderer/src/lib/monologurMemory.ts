// Monologur memory bridge.
//
// Monologur taps the same memory the Omi agent uses for READ context so its
// suggestions feel personal:
//   - READ: pull a bounded slice of the user's saved memories (/v3/memories) and
//     rank the few most relevant against the current conversation.
//   - LOCAL WRITE ONLY: Monologur's own insights are kept in a local ring buffer
//     (localStorage). It does NOT auto-write to the shared memory store — writing
//     a memory/task is always an explicit, user-initiated action elsewhere.
//
// All calls are best-effort and never block the proactive loop.

import { omiApi } from './apiClient'
import { rankMemories } from './memoryRank'
import type { Memory } from '../hooks/useMemories'

const CACHE_TTL_MS = 5 * 60 * 1000
const LOCAL_INSIGHTS_KEY = 'monologur-local-insights-v1'
const LOCAL_INSIGHTS_MAX = 50
// Bounded read: never pull the whole store into the prompt. Page size + ranked
// top-K are both small; the model sees at most MEMORY_TOP_K lines.
const MEMORY_FETCH_LIMIT = 200
const MEMORY_TOP_K = 5

let memoryCache: { at: number; memories: Memory[] } | null = null

async function fetchMemories(force = false): Promise<Memory[]> {
  const now = Date.now()
  if (!force && memoryCache && now - memoryCache.at < CACHE_TTL_MS) {
    return memoryCache.memories
  }
  try {
    const r = await omiApi.get('/v3/memories', { params: { limit: MEMORY_FETCH_LIMIT, offset: 0 } })
    const list = (Array.isArray(r.data) ? r.data : (r.data?.memories ?? [])) as Memory[]
    memoryCache = { at: now, memories: list }
    return list
  } catch {
    return memoryCache?.memories ?? []
  }
}

/**
 * Build a short, ranked memory-context block for the proactive prompt. Returns an
 * empty string when there's nothing worth injecting (keeps the LLM call cheap).
 */
export async function getMonologurMemoryContext(conversationText: string): Promise<string> {
  const memories = await fetchMemories()
  if (memories.length === 0) return ''
  const ranked = rankMemories(memories, conversationText, MEMORY_TOP_K)
  if (ranked.length === 0) return ''
  return [
    'Relevant memories about the user:',
    ...ranked.map((m) => `- ${m}`)
  ].join('\n')
}

/**
 * Store a Monologur insight LOCAL ONLY (localStorage ring buffer). This never
 * touches the shared /v3/memories store, so a proactive surface cannot write
 * account memory/tasks behind the user's back. Read back for continuity.
 */
export function saveMonologurLocalInsight(text: string): void {
  const clean = text.trim()
  if (!clean) return
  try {
    const raw = localStorage.getItem(LOCAL_INSIGHTS_KEY)
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : []
    const key = clean.toLowerCase().replace(/\s+/g, ' ')
    if (list.some((x) => x.toLowerCase().replace(/\s+/g, ' ') === key)) return
    list.unshift(clean)
    localStorage.setItem(LOCAL_INSIGHTS_KEY, JSON.stringify(list.slice(0, LOCAL_INSIGHTS_MAX)))
  } catch {
    /* localStorage unavailable / quota — best-effort, never break the loop */
  }
}

/** Recent local-only Monologur insights (for display/continuity). */
export function getMonologurLocalInsights(): string[] {
  try {
    const raw = localStorage.getItem(LOCAL_INSIGHTS_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}
