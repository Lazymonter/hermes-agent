import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react'
// Native OpenTUI app shell — header + transcript + (prompt overlay) + composer.
// Phase 2: works with BOTH FakeGateway and the real request()-based gateway via
// a generic interface. Phase 4: renders the blocking interactive prompt overlay
// (clarify/approval/sudo/secret/confirm) between the transcript and composer,
// and hides the composer while a prompt is active (mirrors Ink's $isBlocked).
import React, { useCallback, useEffect, useState } from 'react'

import type { Msg, PromptState } from '../model.ts'
import { defaultTheme } from '../theme.ts'

import { Composer } from './composer.tsx'
import { type PromptGateway, PromptOverlay } from './prompts/promptOverlay.tsx'
import { Transcript } from './transcript.tsx'

/** The minimal contract both FakeGateway and RealGateway satisfy. */
export interface Gateway extends PromptGateway {
  subscribe(fn: (msgs: Msg[]) => void): () => void
  send(text: string, onDone?: () => void): void
  /** Subscribe to the blocking-prompt channel. */
  subscribePrompt(fn: (prompt: PromptState | null) => void): () => void
  /** Optional: real transport exposes a status line. */
  getStatus?(): { ready: boolean; text: string }
}

export function App({ gw, cols: colsProp = 80, rows: rowsProp = 24 }: { gw: Gateway; cols?: number; rows?: number }) {
  const t = defaultTheme
  const renderer = useRenderer()
  // BUG 4: read LIVE terminal dimensions so a resize reflows the whole tree
  // (transcript width, messageLine bodyWidth, composer rule, tool char-cap) via
  // Yoga — instead of freezing at the cols/rows passed once at mount. Falls back
  // to the props (the headless test renderer passes explicit dimensions).
  const dims = useTerminalDimensions()
  const cols = dims.width || colsProp
  const rows = dims.height || rowsProp
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const [prompt, setPrompt] = useState<PromptState | null>(null)

  useEffect(() => gw.subscribe(setMsgs), [gw])
  useEffect(() => gw.subscribePrompt(setPrompt), [gw])

  // A blocking prompt is up → composer is hidden and the prompt owns all keys
  // (incl. Ctrl+C, which it maps to deny/cancel so the agent unblocks).
  const blocked = prompt !== null

  // Ctrl+C quits — but ONLY when no prompt is active. While a prompt is up the
  // prompt component handles Ctrl+C (→ deny/cancel RPC); quitting there would
  // strand the blocked Python agent.
  useKeyboard(key => {
    if (blocked) {
      return
    }

    if (key.ctrl && key.name === 'c') {
      renderer.destroy()
      process.exit(0)
    }
  })

  const onSubmit = useCallback(
    (text: string) => {
      if (busy || blocked) {
        return
      }

      setBusy(true)
      gw.send(text, () => setBusy(false))
    },
    [gw, busy, blocked]
  )

  const status = gw.getStatus?.()
  const statusText = blocked ? 'waiting for input…' : busy ? 'streaming…' : (status?.text ?? 'ready')

  const headerH = 1

  return (
    <box style={{ flexDirection: 'column', height: rows, width: cols }}>
      <box
        style={{
          backgroundColor: '#1A1A1A',
          flexDirection: 'row',
          height: headerH,
          paddingLeft: 1,
          paddingRight: 1
        }}
      >
        <text fg={t.color.accent}>
          <b>hermes</b>
        </text>
        <text fg={t.color.muted}>{`  ·  engine=opentui · bun · ${statusText}`}</text>
      </box>

      {/* Body flex-grows to fill whatever the prompt/composer don't take, so a
          tall prompt overlay shrinks the transcript instead of overflowing.
          minHeight:0 is load-bearing — a flex child defaults to min-height:auto
          (won't shrink below its CONTENT), which makes the inner scrollbox size
          to content instead of the viewport and mis-compute its scroll offset
          (top clipped, empty space below). opencode pins minHeight:0 here too. */}
      <box style={{ flexGrow: 1, flexShrink: 1, minHeight: 0 }}>
        <Transcript cols={cols} msgs={msgs} t={t} />
      </box>

      {blocked ? (
        <box style={{ flexShrink: 0 }}>
          <PromptOverlay gw={gw} prompt={prompt} t={t} />
        </box>
      ) : (
        <Composer busy={busy} cols={cols} focused={!busy} onSubmit={onSubmit} t={t} />
      )}
    </box>
  )
}
