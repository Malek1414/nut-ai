import { useState } from 'react'
import { MapPinned } from 'lucide-react'

// One preference controls the layout and basemap. Change the default here to roll back for everyone.
const DEFAULT_MAP: 'classic' | 'liberty' = 'liberty'
const KEY = 'platepal.map.style'
export function readMapStyle(): 'classic' | 'liberty' {
  try { const saved = localStorage.getItem(KEY); if (saved === 'classic' || saved === 'liberty') return saved } catch { /* storage blocked */ }
  return DEFAULT_MAP
}
export function MapPreference() {
  const [value, setValue] = useState(readMapStyle)
  return <label className="set-row map-pref"><span className="set-row__ic"><MapPinned size={18} /></span><span className="set-row__label">Map style</span><select className="set-row__select" aria-label="Map style" value={value} onChange={(e) => { const value = e.target.value === 'classic' ? 'classic' : 'liberty'; try { localStorage.setItem(KEY, value) } catch { return }; setValue(value) }}><option value="liberty">Explore</option><option value="classic">Classic</option></select></label>
}
