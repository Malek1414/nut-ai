import { useEffect, useRef, useState } from 'react'
import type { Profile } from '../../../snapmenu-api/src/types'
import { Icon, Wordmark } from '../components/ui'
import { allergySummary, goalLabel } from '../lib/format'

export function Capture({ profile, onPhoto, onEditProfile, onHome, error, note, placeName, onClearPlace }: { profile: Profile; onPhoto: (f: File) => void; onEditProfile: () => void; onHome: () => void; error: string | null; note?: string | null; placeName?: string | null; onClearPlace?: () => void }) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const pickRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setBusy(false), [error])
  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) { setBusy(true); onPhoto(f) }
  }
  const summary = [goalLabel(profile), allergySummary(profile.allergies)].filter(Boolean).join(' · ')
  return <main className="screen with-cta capture">
    <div className="topbar">
      <Wordmark onClick={onHome} />
      <button className="profile-pill" onClick={onEditProfile} aria-label={`Your goal: ${summary}. Change`}><span>{summary}</span><Icon name="edit" size={15} /></button>
    </div>
    <header className="results-head"><h1 className="h1">Scan the menu</h1><p className="body">One page, good light. Any language.</p></header>
    {note && <div className="banner" role="status"><Icon name="check" size={18} /><span>{note}</span></div>}
    {placeName && <div className="banner place-banner"><Icon name="pin" size={18} /><span style={{ flex: 1, minWidth: 0 }}>At <b>{placeName}</b></span>{onClearPlace && <button className="place-banner__x" onClick={onClearPlace} aria-label="Not at this restaurant"><Icon name="close" size={16} /></button>}</div>}
    {error && <div className="banner" role="alert" style={{ background: 'var(--alert-tint)', color: 'var(--alert)' }}><Icon name="alert" /><span>{error}</span></div>}
    <button className="capture-stage" disabled={busy} onClick={() => cameraRef.current?.click()} aria-label="Take a photo of the menu">
      <span className="capture-guide"><Icon name="focus" size={44} /><b>Your menu goes here</b><span>Keep the full page in the frame.</span></span>
      <span className="capture-open"><Icon name="camera" size={18} /> Open camera</span>
    </button>
    <input ref={cameraRef} className="sr-only" type="file" accept="image/*" capture="environment" onChange={handle} tabIndex={-1} aria-hidden="true" />
    <input ref={pickRef} className="sr-only" type="file" accept="image/*" onChange={handle} tabIndex={-1} aria-hidden="true" />
    <div className="cta-bar">
      <button className="btn btn-primary" disabled={busy} onClick={() => cameraRef.current?.click()}><Icon name="camera" size={22} /> {busy ? 'Preparing…' : 'Take a photo'}</button>
      <button className="btn btn-secondary" disabled={busy} onClick={() => pickRef.current?.click()}><Icon name="image" size={20} /> Choose a photo</button>
    </div>
  </main>
}
