// Native OpenTUI transcript — scrollable list with sticky-to-bottom (chat auto-scroll).
import React from 'react'

import type { Msg } from '../model.ts'
import type { Theme } from '../theme.ts'

import { MessageLine } from './messageLine.tsx'

export function Transcript({ msgs, t, cols }: { msgs: Msg[]; t: Theme; cols: number }) {
  return (
    <scrollbox stickyScroll stickyStart="bottom" style={{ flexGrow: 1, minHeight: 0 }}>
      {msgs.map((m, i) => (
        <MessageLine cols={cols} key={i} msg={m} t={t} />
      ))}
    </scrollbox>
  )
}
