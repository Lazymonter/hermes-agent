// Headless verifier for the INTERACTIVE app: mounts the app, simulates a user
// submit via the gateway, lets it stream, and captures the resulting 2D frame.
// Proves the Phase-1 submit→stream→render path without a live TTY.
// Run: bun src/demo.tsx → demo-frame.txt + demo-report.txt
import '@opentui/react/runtime-plugin-support'

import { writeFileSync } from 'node:fs'

import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import React from 'react'

import { App } from './components/app.tsx'
import { stripToolEnvelope } from './engine/toolOutput.ts'
import { FakeGateway } from './fakeGateway.ts'

const COLS = 90
// Tall enough that the full seed transcript (incl. the multi-line tool block)
// fits in the seed frame without scrolling the top user line off.
const ROWS = 36

const { renderer, renderOnce, flush, captureCharFrame } = await createTestRenderer({
  width: COLS,
  height: ROWS
})

const gw = new FakeGateway()
const t0 = performance.now()
createRoot(renderer).render(<App cols={COLS} gw={gw} rows={ROWS} />)
await renderOnce()
await flush()
await new Promise(r => setTimeout(r, 150))
await renderOnce()
await flush()
const t1 = performance.now()

// Capture the SEED frame first — before the follow-up submit scrolls the
// sticky-bottom transcript and pushes the seed (incl. the tall tool block) up.
// The seed-content + tool-render assertions are checked against this frame.
const seedFrame = captureCharFrame()

// Simulate a user submitting a message; let the streamed reply complete.
const done = new Promise<void>(resolve => gw.send('does interactive work?', resolve))
await done

// A few render cycles to let the final streamed state settle into the frame.
for (let k = 0; k < 4; k++) {
  await new Promise(r => setTimeout(r, 80))
  await renderOnce()
  await flush()
}

const frame = captureCharFrame()
writeFileSync(new URL('../demo-frame.txt', import.meta.url), frame)

const report = [
  `rendered ${COLS}x${ROWS}; first paint ${(t1 - t0).toFixed(2)}ms`,
  `frame chars: ${frame.length}`,
  `header present: ${seedFrame.includes('hermes')}`,
  // The TOP user line being visible also guards the scroll fix (minHeight:0):
  // before it, the sticky-bottom scrollbox clipped the top of short content.
  `seed transcript present (top not clipped): ${seedFrame.includes('switch the TUI')}`,
  `user submit echoed: ${frame.includes('does interactive work?')}`,
  `streamed reply present: ${frame.includes('Native OpenTUI reply')}`,
  `composer present: ${frame.includes('Ctrl+C') || frame.includes('streaming')}`,
  // BUG 2: compact tool render (checked on the seed frame, before scroll) —
  // name shown, output capped (not dumped), and NO full-width rounded box
  // (we removed the bordered box → no ╭ anywhere in either frame).
  `tool name rendered: ${seedFrame.includes('terminal')}`,
  `tool output capped: ${seedFrame.includes('more line')}`,
  `no full-width tool box (no rounded border): ${!seedFrame.includes('╭') && !frame.includes('╭')}`,
  `envelope strip unit: ${stripToolEnvelope('{"output":"hi","exit_code":0}') === 'hi'}`,
  `literal markdown markers leaked (**): ${(frame.match(/\*\*/g) || []).length}`
].join('\n')

writeFileSync(new URL('../demo-report.txt', import.meta.url), report + '\n')

renderer.destroy()
process.exit(0)
