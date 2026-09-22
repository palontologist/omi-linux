import type { AgentConfig } from '../../../shared/types'

// Single localStorage key shared with the Settings screen. Kept tiny so the chat
// send path can cheaply read the active LLM provider without importing the whole
// settings UI.
const KEY = 'agent-settings-v1'

export function readAgentSettings(): AgentConfig {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored) return JSON.parse(stored) as AgentConfig
  } catch {
    /* private mode / quota / bad JSON */
  }
  return {}
}

/** True when the chat should run against a local OpenAI-compatible endpoint. */
export function isLocalProviderActive(): boolean {
  return readAgentSettings().llmProvider === 'local'
}
