#!/usr/bin/env node
// Headless smoke test for the desktop local tool-agent (the same loop the app
// runs in main via `local-agent:run`). Fires the EXACT request the app sends —
// OpenAI-compatible /chat/completions with the same tool schemas — so you can
// verify your local model is reachable AND tool-capable without launching Electron.
//
// Usage:
//   node scripts/test-local-agent.mjs --base http://localhost:8080/v1 --model qwen2.5
//   (or env LOCAL_BASE / LOCAL_MODEL)
//
// Requires a running OpenAI-compatible server with a CHAT + tool-capable model:
//   llama-server -m <chat.gguf> --port 8080 --jinja
//   (an embedding-only GGUF like nomic-embed-text cannot chat or call tools)

const args = process.argv.slice(2)
const getArg = (flag) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}
const BASE = (getArg('--base') || process.env.LOCAL_BASE || 'http://localhost:8080/v1').replace(/\/$/, '')
const MODEL = getArg('--model') || process.env.LOCAL_MODEL || 'local-model'

// Mirror of AGENT_TOOL_SCHEMAS in src/main/ipc/deepgramAgent.ts (trim to the
// side-effect-free ones so a wrong answer can't write files/open URLs during a test).
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_time',
      description: 'Get the current date and time.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: 'Perform a mathematical calculation.',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string', description: 'e.g. "12 * 9"' } },
        required: ['expression']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current information.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The search query' } },
        required: ['query']
      }
    }
  }
]

const MESSAGES = [
  {
    role: 'system',
    content:
      'You are Omi, a helpful local assistant. Use a tool when it helps, then answer briefly.'
  },
  { role: 'user', content: 'What time is it, and what is 12 times 9?' }
]

async function main() {
  console.log(`Local-agent smoke test → ${BASE}/chat/completions  (model: ${MODEL})`)
  let res
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: MESSAGES, tools: TOOLS, tool_choice: 'auto', temperature: 0 }),
      signal: AbortSignal.timeout(45000)
    })
  } catch (e) {
    console.error(`\n✗ Could not reach the server: ${e.message}`)
    console.error('  Start one: llama-server -m <chat.gguf> --port 8080 --jinja')
    console.error('  (or enable LM Studio\'s developer server on :1234 and pass --base http://localhost:1234/v1)')
    process.exit(2)
  }

  if (!res.ok) {
    console.error(`\n✗ HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    process.exit(3)
  }

  const data = await res.json()
  const msg = data?.choices?.[0]?.message ?? {}
  const calls = msg.tool_calls ?? []

  if (calls.length) {
    console.log('\n✓ Model is reachable AND tool-calling works. It asked to run:')
    for (const c of calls) {
      console.log(`    - ${c.function?.name}(${c.function?.arguments || '{}'})`)
    }
    console.log('\nPASS: the app\'s local-agent loop can drive this model end to end.')
    return
  }

  if (msg.content) {
    console.log('\n△ Reachable, answered in prose but issued NO tool call:')
    console.log(`    "${String(msg.content).slice(0, 200)}"`)
    console.log('  The request worked, but this model may not reliably emit tool calls.')
    console.log('  Tip: use a tool-capable chat GGUF (e.g. Qwen2.5-Instruct) and llama-server --jinja.')
    return
  }

  console.log('\n✗ Reachable but returned neither tool calls nor content. Check the model/server.')
  process.exit(4)
}

void main()
