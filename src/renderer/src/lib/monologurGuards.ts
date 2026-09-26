import type { TranscriptLine } from '../../../shared/types'

/**
 * Privacy + injection guardrails for Monologur, kept as pure functions (no
 * network/window) so they're unit-testable and easy to reason about.
 */

/** Max characters of any single transcript line fed to the model. */
export const MAX_LINE_CHARS = 500

/**
 * Neutralise untrusted speech-to-text before it reaches the model: strip control
 * characters and zero-width/bidi tricks, redact common prompt-injection phrases,
 * and bound the length. Transcript content is DATA, never instructions.
 */
export function sanitizeTranscriptText(text: string, maxLength: number = MAX_LINE_CHARS): string {
  let cleaned = text
    // eslint-disable-next-line no-control-regex -- intentionally strip C0/C1 control chars
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2063\uFEFF]/g, '')
    .replace(
      /\b(ignore\s+(previous\s+)?instructions|system\s*:\s*|assistant\s*:\s*|user\s*:\s*|role\s*:\s*|output\s+only|forget\s+everything|ignore\s+all\s+prior)\b/gi,
      '[redacted]'
    )
    .replace(/<\|.*?\|>/g, '[redacted]')
    .trim()
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength) + '…'
  }
  return cleaned
}

/**
 * The ENROLLED USER's recent speech only — sanitised and joined. Bystander lines
 * (isUser !== true) are excluded so a nearby conversation can neither trigger
 * Monologur nor become its prompt context. Returns '' when the user hasn't spoken.
 */
export function userSpeech(segments: TranscriptLine[], last = 10): string {
  return segments
    .filter((s) => s.isUser === true)
    .slice(-last)
    .map((s) => sanitizeTranscriptText(s.text))
    .join('\n')
    .trim()
}

/** Word count of a transcript string (used for the min-words gate). */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
