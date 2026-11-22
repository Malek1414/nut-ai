import { useEffect, useState } from 'react'
import { Icon } from '../components/ui'

const STEPS: Array<[number, string]> = [
  [0, 'Reading the dishes'],
  [12, 'A full menu can take a moment.'],
  [35, 'Still reading. Keep this screen open.'],
]

export function Scanning({ photo, onCancel }: { photo: string; onCancel: () => void }) {
  const [t, setT] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const id = setInterval(() => setT((Date.now() - start) / 1000), 250)
    return () => clearInterval(id)
  }, [])
  const active = STEPS.reduce((acc, [s], i) => (t >= s ? i : acc), 0)
  return (
    <main className="screen scanning" aria-busy="true">
      <div className="topbar">
        <button className="icon-btn" onClick={onCancel} aria-label="Cancel"><Icon name="close" /></button>
      </div>
      <div className="scan-photo">
        <img src={photo} alt="Your menu photo" />
        <div className="scan-line" />
      </div>
      <div className="scan-status">
        <h1 className="h2">Reading your menu</h1>
        <p key={active} className="body rise" role="status" aria-live="polite">{STEPS[active]![1]}</p>
        <span className="skeleton scan-pending" aria-hidden="true" />
      </div>
    </main>
  )
}
