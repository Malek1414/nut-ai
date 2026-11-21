import { useEffect, useRef, useState } from 'react'
import type { Profile } from '../../../snapmenu-api/src/types'
import { Icon, Wordmark } from '../components/ui'
import { allergySummary, goalLabel } from '../lib/format'

export function Capture({ profile, onPhoto, onEditProfile, onHome, error, placeName, onClearPlace }: { profile: Profile; onPhoto: (f: File) => void; onEditProfile: () => void; onHome: () => void; error: string | null; placeName?: string | null; onClearPlace?: () => void }) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const pickRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setBusy(false), [error])

  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) {
      setBusy(true)
      onPhoto(f)
    }
  }

  const summary = [goalLabel(profile), allergySummary(profile.allergies)].filter(Boolean).join(' · ')

  return (
    <main className="screen with-cta capture">
      <div className="topbar">
        <Wordmark onClick={onHome} />
        <button className="profile-pill" onClick={onEditProfile} aria-label={`Your goal: ${summary}. Change`}>
          <span>{summary}</span>
          <Icon name="edit" size={15} />
        </button>
      </div>

      <header className="results-head">
        <h1 className="h1">Snap the menu</h1>
        <p className="body">One page, good light. Any language.</p>
      </header>

      {placeName && (
        <div className="banner place-banner">
          <Icon name="pin" size={18} />
          <span style={{ flex: 1, minWidth: 0 }}>At <b>{placeName}</b></span>
          {onClearPlace && <button className="place-banner__x" onClick={onClearPlace} aria-label="Not at this restaurant"><Icon name="close" size={16} /></button>}
        </div>
      )}

      {error && (
        <div className="banner" role="alert" style={{ background: 'var(--alert-tint)', color: 'var(--alert)' }}>
          <Icon name="alert" /> <span>{error}</span>
        </div>
      )}

      <button className="capture-stage" disabled={busy} onClick={() => cameraRef.current?.click()} aria-label="Take a photo of the menu">
        <svg viewBox="0 0 400 400" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <rect width="400" height="400" fill="#10201A" />
          <g transform="rotate(-3 200 200)" opacity=".92">
            <rect x="104" y="62" width="192" height="276" rx="16" fill="#F3F5EF" />
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <g key={i}>
                <rect x="124" y={92 + i * 33} width={[96, 124, 84, 112, 92, 130, 78][i]} height="9" rx="4.5" fill="#1E6B4E" opacity=".28" />
                <rect x="252" y={92 + i * 33} width="24" height="9" rx="4.5" fill="#1E6B4E" opacity=".45" />
              </g>
            ))}
          </g>
          <path d="M64 96V70a22 22 0 0 1 22-22h26M336 96V70a22 22 0 0 0-22-22h-26M64 304v26a22 22 0 0 0 22 22h26M336 304v26a22 22 0 0 1-22 22h-26" fill="none" stroke="#F2B33D" strokeWidth="6" strokeLinecap="round" />
        </svg>
      </button>

      <input ref={cameraRef} className="sr-only" type="file" accept="image/*" capture="environment" onChange={handle} tabIndex={-1} aria-hidden="true" />
      <input ref={pickRef} className="sr-only" type="file" accept="image/*" onChange={handle} tabIndex={-1} aria-hidden="true" />
      <div className="cta-bar">
        <button className="btn btn-primary" disabled={busy} onClick={() => cameraRef.current?.click()}>
          <Icon name="camera" size={22} /> {busy ? 'Preparing…' : 'Take a photo'}
        </button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => pickRef.current?.click()}>
          <Icon name="image" size={20} /> Choose a photo
        </button>
      </div>
    </main>
  )
}
