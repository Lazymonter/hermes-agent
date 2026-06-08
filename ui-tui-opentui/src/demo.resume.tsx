// Headless verifier for SESSION RESUME (BUG 3) — specifically that resumed tool
// calls RENDER (they were dropped: the gateway sends tool rows as {name,context}
// with NO text, and the old loadTranscript read `text` → blank rows).
//
// Drives EventAdapter.loadTranscript() with a synthetic resumed history (the
// exact shape tui_gateway _history_to_messages emits) WITHOUT spawning Python,
// then renders the App and asserts the prior conversation — including the tool
// calls — appears.
//
// Run: bun src/demo.resume.tsx → demo-resume-frame.txt + demo-resume-report.txt
import '@opentui/react/runtime-plugin-support'

import { writeFileSync } from 'node:fs'

import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import React from 'react'

import { App, type Gateway } from './components/app.tsx'
import { EventAdapter } from './gateway/eventAdapter.ts'
import type { Msg } from './model.ts'

const COLS = 90
const ROWS = 36

// EventAdapter only touches the client in attach(); loadTranscript/subscribe do
// not, so a no-op stub is enough to exercise the resume mapping in isolation.
const adapter = new EventAdapter({ off() {}, on() {} } as never)

// Shape mirrors tui_gateway/server.py _history_to_messages: tool rows carry
// { role:'tool', name, context } and NO text.
adapter.loadTranscript(
  [
    { role: 'user', text: 'read the app shell and list the dir' },
    { context: '(app.tsx)', name: 'read_file', role: 'tool' },
    { context: '(ls -a)', name: 'terminal', role: 'tool' },
    { role: 'assistant', text: 'Done — the shell is `app.tsx` and the dir has 12 entries.' },
    { role: 'system', text: '' }, // empty → must be filtered, no blank bubble
    { name: 'unnamed_with_no_context', role: 'tool' } // tool with neither text nor context
  ],
  { assistant: 'Looking…', streaming: true, user: 'now summarize' }
)

let msgs: Msg[] = []
adapter.subscribe(m => {
  msgs = m
})

// Minimal Gateway backed by the pre-seeded adapter (no prompt is active, so the
// PromptGateway members are never invoked — stubbed for the type only).
const gw: Gateway = {
  getStatus: () => adapter.getStatus(),
  onLocalConfirm: () => {},
  respond: async () => undefined,
  send: () => {},
  sessionId: () => null,
  setPrompt: () => {},
  subscribe: fn => adapter.subscribe(fn),
  subscribePrompt: fn => adapter.subscribePrompt(fn)
}

const { renderer, renderOnce, flush, captureCharFrame } = await createTestRenderer({ height: ROWS, width: COLS })
createRoot(renderer).render(<App cols={COLS} gw={gw} rows={ROWS} />)

for (let k = 0; k < 4; k++) {
  await new Promise(r => setTimeout(r, 40))
  await renderOnce()
  await flush()
}

const frame = captureCharFrame()
writeFileSync(new URL('../demo-resume-frame.txt', import.meta.url), frame)

const toolMsgs = msgs.filter(m => m.role === 'tool')
const systemMsgs = msgs.filter(m => m.role === 'system')

const checks: [string, boolean][] = [
  // Mapping: 3 tool rows → 3 tool Msgs with names (NOT dropped, NOT blank).
  ['3 tool rows mapped to tool Msgs', toolMsgs.length === 3],
  ['tool names carried (not text)', toolMsgs[0]?.tool?.name === 'read_file' && toolMsgs[1]?.tool?.name === 'terminal'],
  ['tool context → summary', toolMsgs[0]?.tool?.summary === '(app.tsx)'],
  ['nameless tool falls back to "tool"', toolMsgs[2]?.tool?.name === 'unnamed_with_no_context'],
  ['empty system row filtered out', systemMsgs.length === 0],
  ['inflight user appended', msgs.some(m => m.role === 'user' && m.text === 'now summarize')],
  ['inflight assistant appended + streaming', msgs.some(m => m.role === 'assistant' && m.streaming === true)],
  // Render: the resumed tool calls actually appear on screen.
  ['resumed user msg renders', frame.includes('read the app shell')],
  ['resumed assistant renders', frame.includes('Done — the shell')],
  ['resumed tool #1 renders (⚡ read_file)', frame.includes('read_file')],
  ['resumed tool #2 renders (⚡ terminal)', frame.includes('terminal')],
  ['tool context renders', frame.includes('(app.tsx)')]
]

const fails = checks.filter(([, ok]) => !ok)

const verdict =
  fails.length === 0 ? `PASS: ${checks.length}/${checks.length} resume checks green` : `FAIL: ${fails.length} failed`

const report = [
  '=== Session RESUME (BUG 3) verification ===',
  `rendered ${COLS}x${ROWS}; mapped ${msgs.length} msgs (${toolMsgs.length} tool)`,
  '',
  ...checks.map(([label, ok]) => `  ${ok ? '✓' : '✗'} ${label}`),
  '',
  '--- verdict ---',
  verdict
].join('\n')

writeFileSync(new URL('../demo-resume-report.txt', import.meta.url), report + '\n')
process.stdout.write(report + '\n')

renderer.destroy()
process.exit(fails.length === 0 ? 0 : 1)
