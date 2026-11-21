import { useEffect, useState } from 'react'
import { Icon } from '../components/ui'

const STEPS: Array<[number, string]> = [
  [0, 'Reading every dish on the menu'],
  [7, 'Translating and naming the ingredients'],
  [13, 'Weighing components with the Nut AI engine'],
  [17, 'Looking up USDA and Open Food Facts'],
  [21, 'Checking allergens and ranking for your goal'],
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
    <main className="screen" aria-busy="true">
      <div className="topbar">
        <button className="icon-btn" onClick={onCancel} aria-label="Cancel"><Icon name="close" /></button>
        <span className="eyebrow">Reading your menu</span>
        <span style={{ width: 44 }} />
      </div>
      <div className="scan-photo" style={{ marginTop: 16 }}>
        <img src={photo} alt="Your menu photo" />
        <div className="scan-line" />
        <svg className="scan-corners" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 12V3a3 3 0 0 1 3-3h9M100 12V3a3 3 0 0 0-3-3h-9M0 88v9a3 3 0 0 0 3 3h9M100 88v9a3 3 0 0 1-3 3h-9" fill="none" stroke="#F2B33D" strokeWidth="1.2" vectorEffect="non-scaling-stroke" style={{ strokeWidth: 4 }} />
        </svg>
      </div>

      <div className="scan-steps" role="status" aria-live="polite">
        {STEPS.map(([, label], i) => (
          <div key={label} className={`scan-step ${i < active ? 'done' : i === active ? 'active' : ''}`}>
            <span className="dot">{i < active && <Icon name="check" size={14} strokeWidth={2.5} />}</span>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {t > 32 && (
        <div className="banner" style={{ marginTop: 20 }}>
          <Icon name="info" /> Long menus take up to a minute. Hang on, almost there.
        </div>
      )}

      <div className="stack-12" style={{ marginTop: 24, paddingBottom: 32 }} aria-hidden="true">
        <div className="card" style={{ padding: 20, display: 'grid', gap: 12 }}>
          <div className="skeleton" style={{ height: 18, width: '62%' }} />
          <div className="skeleton" style={{ height: 12, width: '40%' }} />
          <div className="skeleton" style={{ height: 28, width: '50%', marginTop: 8 }} />
          <div className="skeleton" style={{ height: 10, width: '100%', borderRadius: 999 }} />
        </div>
      </div>
    </main>
  )
}
