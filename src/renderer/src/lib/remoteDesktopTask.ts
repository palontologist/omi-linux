/**
 * Remote desktop-task envelope — a phone-to-desktop "run this on my computer"
 * proposal. The phone posts a JSON envelope into the SAME shared conversation the
 * desktop already reads; this module recognises ONLY that explicit, marked
 * envelope and returns a natural-language *goal*. It never carries UI steps or
 * element refs — the desktop plans against its own screen snapshot and, critically,
 * execution stays behind the existing single native-confirm gate
 * (`useChat.tryPlan` -> `automationConfirmRun`), so a phone can only *propose*.
 *
 * This is a fork prototype. The security posture (that any account member who can
 * post to your shared thread may send you a proposal you must actively approve,
 * and whether it should be gated behind an explicit pairing/opt-in) is the
 * open product/security decision — see the linked RFC issue.
 */

export const REMOTE_TASK_MAX_GOAL = 400

/** A recognised, well-formed remote desktop-task proposal. */
export interface RemoteDesktopTask {
  goal: string
}

/**
 * Parse a shared-conversation message body for a remote-task envelope. Returns the
 * goal only when the message is an explicit, well-formed `omi_desktop_task`
 * envelope; `null` for anything else (chat, prose, malformed, oversized, or a
 * look-alike that isn't a real envelope). Pure and side-effect free.
 */
export function parseRemoteDesktopTask(body: string): RemoteDesktopTask | null {
  const raw = typeof body === 'string' ? body.trim() : ''
  // Only parse when it looks like our fenced envelope — cheap guard so ordinary
  // chat text (including adversarial text mentioning the key) never parses.
  if (!raw.startsWith('{') || !raw.includes('"omi_desktop_task"')) return null
  if (raw.length > REMOTE_TASK_MAX_GOAL + 64) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const obj = parsed as Record<string, unknown>
  // Unknown keys are ignored; the envelope must carry exactly our marker.
  if (obj.type !== 'omi_desktop_task') return null
  const goal = obj.goal
  if (typeof goal !== 'string') return null

  const clean = goal.trim()
  if (clean.length === 0 || clean.length > REMOTE_TASK_MAX_GOAL) return null
  return { goal: clean }
}
