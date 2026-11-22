import { useState } from 'react'
import { MapPinned } from 'lucide-react'

// Start a new preference generation. Old installations also start on Classic,
// and choosing Explore again survives reloads and future visits.
const KEY = 'platepal.map.style.v2'
export function readMapStyle(): 'classic' | 'liberty' {
  try {
    if (localStorage.getItem(KEY) === 'liberty') return 'liberty'
  } catch { /* Storage unavailable. Use the default. */ }
  return 'classic'
}
export function MapPreference() {
  const [value, setValue] = useState(readMapStyle)
  function changeStyle(style: string) {
    const next = style === 'liberty' ? 'liberty' : 'classic'
    try {
      localStorage.setItem(KEY, next)
      setValue(next)
    } catch { /* Keep displaying the effective style if saving fails. */ }
  }
  return <label className="set-row map-pref">
    <span className="set-row__ic"><MapPinned size={18} /></span>
    <span className="set-row__label">Map style</span>
    <select className="set-row__select" aria-label="Map style" value={value} onChange={e => changeStyle(e.target.value)}>
      <option value="classic">Classic</option>
      <option value="liberty">Explore</option>
    </select>
  </label>
}
