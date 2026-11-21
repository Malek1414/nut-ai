// "Get Premium early": a quiet sheet, never a paywall. The app is a free beta; whoever wants to hear
// when a paid plan starts leaves an email, optionally a name and what they would pay for.
import { useState } from 'react'
import { BRAND } from '../../../snapmenu-api/src/brand'
import { PREMIUM_CONSENT, PREMIUM_WANTS } from '../../../snapmenu-api/src/social/premium-terms'
import { Icon, Sheet } from '../components/ui'
import { track } from '../lib/api'
import { flags, joinPremium, leavePremium, SocialError } from './client'

const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(v.trim())

export function PremiumSheet({ onClose, toast }: { onClose: () => void; toast: (t: string) => void }) {
  const [joined, setJoined] = useState(() => flags.premiumJoined())
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [wants, setWants] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (id: string) => setWants((w) => (w.includes(id) ? w.filter((x) => x !== id) : [...w, id]))
  const submit = async () => {
    if (busy) return
    if (!looksLikeEmail(email)) { setError('Check the email address.'); return }
    setBusy(true)
    setError(null)
    try {
      await joinPremium({ email: email.trim(), name: name.trim(), wants, note: '' })
      flags.setPremiumJoined(true)
      setJoined(true)
      track('premium_joined', { wants: wants.length })
    } catch (e) {
      setError(e instanceof SocialError ? e.message : 'That did not work. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }
  const leave = async () => {
    if (busy) return
    setBusy(true)
    try {
      await leavePremium()
      flags.setPremiumJoined(false)
      setJoined(false)
      setEmail('')
      toast('Your email is off the list')
    } catch {
      toast('That did not work. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet label="Get Premium early" onClose={onClose} className="so-sheet">
      <div className="so-sheet__head">
        <h2 className="h2">{joined ? 'You are on the list' : 'Get Premium early'}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={20} /></button>
      </div>

      {joined ? (
        <>
          <p className="body">{BRAND.name} stays free while in beta. You hear from us once, when Premium starts.</p>
          <div className="so-sheet__actions">
            <button className="btn btn-primary" onClick={onClose}>Done</button>
            <div className="so-sheet__quiet"><button className="link-btn" disabled={busy} onClick={() => void leave()}>Take my email off the list</button></div>
          </div>
        </>
      ) : (
        <form className="so-premium" onSubmit={(e) => { e.preventDefault(); void submit() }} noValidate>
          <p className="body">{BRAND.name} is free while in beta. Hear first when Premium starts.</p>
          <label className="so-field">
            <span className="small">Email</span>
            <input className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => { setEmail(e.target.value); setError(null) }} placeholder="you@example.com" aria-invalid={Boolean(error)} maxLength={254} />
          </label>
          <label className="so-field">
            <span className="small">Name (optional)</span>
            <input className="input" type="text" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </label>
          <div className="so-field" role="group" aria-label="What would you pay for?">
            <span className="small">What would you pay for?</span>
            <div className="so-wants">
              {PREMIUM_WANTS.map((w) => (
                <button key={w.id} type="button" className="q-chip" aria-pressed={wants.includes(w.id)} onClick={() => toggle(w.id)}>{w.label}</button>
              ))}
            </div>
          </div>
          {error && <p className="banner" role="alert"><Icon name="info" size={18} />{error}</p>}
          <div className="so-sheet__actions">
            {/* The agreement is read before the tap: it sits right above the button. */}
            <p className="small so-consent">{PREMIUM_CONSENT}</p>
            <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>{busy ? 'Saving…' : 'Tell me first'}</button>
          </div>
        </form>
      )}
    </Sheet>
  )
}
