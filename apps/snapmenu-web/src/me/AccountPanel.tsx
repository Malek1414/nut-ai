import { useState } from 'react'
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser'
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { Fingerprint, X } from 'lucide-react'
import { Sheet } from '../components/ui'
import { accountApi } from './account'

export function AccountPanel({ onClose, onLink, signupFirst = false }: { onClose: () => void; onLink: () => Promise<void>; signupFirst?: boolean }) {
  const [mode, setMode] = useState<'login' | 'signup'>(signupFirst ? 'signup' : 'login')
  const supports = window.isSecureContext && browserSupportsWebAuthn() && !/^(?:\d+[.:]|\[)/.test(location.hostname)
  const [passwordMode, usePassword] = useState(!supports)
  const [username, setUsername] = useState(() => signupFirst ? 'diner_' + crypto.randomUUID().slice(0, 8) : '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [linked, setLinked] = useState(false)
  const [error, setError] = useState('')
  const signup = mode === 'signup'
  async function submit() {
    if (busy) return
    setBusy(true); setError('')
    try {
      if (!linked) {
        const input = { username: username.trim(), mode }
        if (passwordMode) await accountApi('password', { ...input, password })
        else {
          const { ticket, options } = await accountApi<{ ticket: string; options: PublicKeyCredentialCreationOptionsJSON | PublicKeyCredentialRequestOptionsJSON }>('passkey/options', input)
          const credential = signup
            ? await startRegistration({ optionsJSON: options as PublicKeyCredentialCreationOptionsJSON })
            : await startAuthentication({ optionsJSON: options as PublicKeyCredentialRequestOptionsJSON })
          await accountApi('passkey/verify', { ...input, ticket, credential })
        }
        setPassword(''); setLinked(true)
      }
      await onLink()
      onClose()
    } catch (e) {
      const error = e as Error
      setError(error.name === 'NotAllowedError' || error.name === 'AbortError' ? 'Passkey cancelled. Try again or use a password.' : error.message)
    } finally { setBusy(false) }
  }
  return <Sheet label="PlatePal account" className="account-sheet" onClose={() => { if (!busy && !linked) onClose() }}>
    <header><div className="account-glyph"><Fingerprint size={24} /></div>{!linked && <button className="icon-btn" aria-label="Close" disabled={busy} onClick={onClose}><X size={19} /></button>}</header>
    <h2 className="h2">{linked ? 'Link this device' : signup ? 'Create an account' : 'Welcome back'}</h2>
    <p className="body">Your saved picks, goals and posts go with you.</p>
    {!linked && <div className="seg" role="radiogroup" aria-label="Account mode">
      <button type="button" className="seg__opt" aria-checked={!signup} role="radio" disabled={busy} onClick={() => { setMode('login'); setError(''); setPassword('') }}>Log in</button>
      <button type="button" className="seg__opt" aria-checked={signup} role="radio" disabled={busy} onClick={() => { setMode('signup'); setError(''); setPassword('') }}>Sign up</button>
    </div>}
    <form onSubmit={(e) => { e.preventDefault(); void submit() }}>
      {!linked && <label>Username<input className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]{3,24}" value={username} disabled={busy} onChange={(e) => setUsername(e.target.value)} /></label>}
      {!linked && passwordMode && <label>Password<input className="input" required type="password" autoComplete={signup ? 'new-password' : 'current-password'} minLength={signup ? 12 : 1} maxLength={128} placeholder={signup ? 'At least 12 characters' : undefined} value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} /></label>}
      {error && <p className="account-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>{!linked && !passwordMode && <Fingerprint size={20} />}{busy ? 'One moment…' : linked ? 'Retry linking' : passwordMode ? (signup ? 'Create account' : 'Log in') : (signup ? 'Create a passkey' : 'Log in with a passkey')}</button>
      {linked && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setBusy(true); void accountApi('logout', {}).then(onClose).catch((e: Error) => setError(e.message)).finally(() => setBusy(false)) }}>Continue as guest</button>}
      {!linked && supports && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { usePassword(!passwordMode); setError('') }}>{passwordMode ? 'Use a passkey' : 'Use a password instead'}</button>}
    </form>
  </Sheet>
}
