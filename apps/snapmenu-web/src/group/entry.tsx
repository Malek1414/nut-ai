// The ways into "eating together" from the rest of the app. Small on purpose: App.tsx places them.
import { useState } from 'react'
import type { MenuResult } from '../../../snapmenu-api/src/types'
import { Icon } from '../components/ui'
import { track } from '../lib/api'
import { seatTable } from './TableScan'
import './group.css'

/** A quiet pill for the top of a screen: opens the start page of eating together. */
export function GroupPill() {
  return (
    <a className="g-pill" href="/g" onClick={() => track('group_entry', { from: 'pill' })}>
      <Icon name="users" size={18} /> With friends
    </a>
  )
}

/** After a scan: the same menu for everyone at the table. Opens a table from this scan, no second photo. */
export function TableEntry({ result, onToast }: { result: MenuResult; onToast?: (t: string) => void }) {
  const [busy, setBusy] = useState(false)
  const open = async () => {
    setBusy(true)
    try {
      const id = await seatTable(result, null)
      track('group_entry', { from: 'results' })
      window.location.assign(`/g/${id}`)
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'That did not work. Try again.')
      setBusy(false)
    }
  }
  return (
    <button className="post-prompt g-entry" onClick={() => void open()} disabled={busy}>
      <span className="me-ic">{busy ? <span className="attach__spin" /> : <Icon name="users" size={18} />}</span>
      <b>Pick for the whole table</b>
      <Icon name="chevron" size={20} />
    </button>
  )
}
