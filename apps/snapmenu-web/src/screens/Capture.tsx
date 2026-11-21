import { useEffect, useRef, useState } from 'react'
import type { Profile } from '../../../snapmenu-api/src/types'
import { Footer, Icon, Wordmark } from '../components/ui'
import { GOAL_LABEL } from '../lib/format'

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

  const goal = profile.goal === 'plant_based' ? (profile.plantStyle === 'vegetarian' ? 'Vegetarian' : 'Vegan') : GOAL_LABEL[profile.goal]
  const allergyText = profile.allergies.length ? `avoid ${profile.allergies.length === 1 ? profile.allergies[0]!.replace('_', ' ') : `${profile.allergies.length} allergens`}` : 'no allergies'

  return (
    <main className="screen with-cta">
      <div className="topbar">
        <Wordmark onClick={onHome} />
        <span />
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <span className="profile-pill">
          <span>{goal} · {allergyText} · {profile.language}</span>
          <button className="edit" onClick={onEditProfile}>Edit</button>
        </span>
      </div>

      {placeName && (
        <div className="banner place-banner" style={{ marginTop: 12 }}>
          <Icon name="pin" size={18} />
          <span style={{ flex: 1, minWidth: 0 }}>Scanning the menu at <b>{placeName}</b></span>
          {onClearPlace && <button className="place-banner__x" onClick={onClearPlace} aria-label="Not at this restaurant"><Icon name="close" size={16} /></button>}
        </div>
      )}

      <div className="capture-stage" aria-hidden="true">
        <svg viewBox="0 0 400 370" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
          <rect width="400" height="370" fill="#10201A" />
          <g transform="translate(0 -24) scale(.86) translate(32 18) rotate(-3 200 220)" opacity=".9">
            <rect x="92" y="64" width="216" height="300" rx="18" fill="#F3F5EF" />
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <g key={i}>
                <rect x="116" y={100 + i * 36} width={[110, 140, 96, 128, 104, 150, 90][i]} height="10" rx="5" fill="#1E6B4E" opacity=".28" />
                <rect x="256" y={100 + i * 36} width="28" height="10" rx="5" fill="#1E6B4E" opacity=".45" />
              </g>
            ))}
          </g>
           <path d="M72 90V64a22 22 0 0 1 22-22h26M328 90V64a22 22 0 0 0-22-22h-26M72 250v26a22 22 0 0 0 22 22h26M328 250v26a22 22 0 0 1-22 22h-26" fill="none" stroke="#F2B33D" strokeWidth="6" strokeLinecap="round" />
        </svg>
        <div style={{ position: 'absolute', left: 16, right: 16, bottom: 16, textAlign: 'center', color: '#E7EBE1', fontWeight: 600, fontSize: 14 }}>
          Fit the page you are choosing from inside the frame
        </div>
      </div>

      {error && (
        <div className="banner" role="alert" style={{ marginTop: 16, background: 'var(--alert-tint)', color: 'var(--alert)' }}>
          <Icon name="alert" /> <span>{error}</span>
        </div>
      )}

      <div className="tips">
        <div className="tip"><span className="t-ic"><Icon name="sun" size={18} /></span><p className="body"><b style={{ color: 'var(--ink)' }}>Good light, no flash glare.</b> Sharp text gives better results.</p></div>
        <div className="tip"><span className="t-ic"><Icon name="focus" size={18} /></span><p className="body"><b style={{ color: 'var(--ink)' }}>Close and straight.</b> One page at a time works best.</p></div>
        <div className="tip"><span className="t-ic"><Icon name="globe" size={18} /></span><p className="body"><b style={{ color: 'var(--ink)' }}>Any language.</b> German, Italian, Vietnamese, Turkish and more.</p></div>
      </div>
      <Footer />

      <input ref={cameraRef} className="sr-only" type="file" accept="image/*" capture="environment" onChange={handle} tabIndex={-1} aria-hidden="true" />
      <input ref={pickRef} className="sr-only" type="file" accept="image/*" onChange={handle} tabIndex={-1} aria-hidden="true" />
      <div className="cta-bar">
        <button className="btn btn-primary" disabled={busy} onClick={() => cameraRef.current?.click()}>
          <Icon name="camera" size={22} /> {busy ? 'Preparing photo…' : 'Take a photo of the menu'}
        </button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => pickRef.current?.click()}>
          <Icon name="image" size={20} /> Choose a photo
        </button>
      </div>
    </main>
  )
}
