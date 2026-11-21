import { useEffect, useState } from 'react'
import { Icon } from '../components/ui'

const STEPS: Array<[number, string]> = [
  [0, 'Reading the dishes'],
  [7, 'Translating'],
  [13, 'Weighing portions'],
  [17, 'Looking up nutrition'],
  [21, 'Ranking for your goal'],
  [32, 'Long menus take up to a minute'],
]

export function Scanning({ photo, onCancel }: { photo: string; onCancel: () => void }) {
  const [t, setT] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const id = setInterval(() => setT((Date.now() - start) / 1000), 250)
    return () => clearInterval(id)
  }, [])
  const active = STEPS.reduce((acc, [s], i) => (t >= s ? i : acc), 0)
  // Eases towards full without ever arriving: the scan ends when the answer does.
  const progress = Math.round(94 * (1 - Math.exp(-t / 14)))

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
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Progress">
          <i style={{ width: `${progress}%` }} />
        </div>
      </div>
    </main>
  )
}
