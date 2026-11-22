import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Copy, ScanLine, X } from 'lucide-react'
import { Sheet } from '../components/ui'
import { chatsApi } from '../chats/client'
import { friendLink } from './link'
import { Scanner } from './Scanner'
import './friends.css'

async function inviteRequest<T>(route: string, body: object = {}): Promise<T> {
  return chatsApi<T>('/invite' + route, body)
}

interface Invite { token: string; expiresAt: number }
function PersonalCode({ username }: { username: string }) {
  const [invite, setInvite] = useState<Invite | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const initial = useRef<Promise<Invite> | null>(null)
  useEffect(() => {
    let active = true
    initial.current ??= inviteRequest<Invite>('')
    initial.current.then(value => { if (active) setInvite(value) }, err => { if (active) setError(err.message) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!invite) return
    const expiry = window.setTimeout(() => { setInvite(null); setStatus('Your code expired.') }, Math.max(0, invite.expiresAt - Date.now()))
    return () => clearTimeout(expiry)
  }, [invite])
  async function update(revoke: boolean) {
    setBusy(true); setError(''); setStatus('')
    try {
      if (revoke) { await inviteRequest('/revoke'); setInvite(null); setStatus('Your friend code was revoked.') }
      else setInvite(await inviteRequest<Invite>(''))
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return <>
    <div className="friend-ticket">
      {invite ? <QRCodeSVG value={friendLink(invite.token)} size={202} marginSize={4} fgColor="#163b2c" title={'Friend QR for @' + username} /> : <span className="friend-code-placeholder">{busy ? 'Getting your code…' : 'No active code'}</span>}
      <strong>@{username}</strong>
      {invite && <small>One use · Expires at {new Date(invite.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>}
    </div>
    {error && <p className="account-error" role="alert">{error}</p>}
    {status && <p className="small" role="status">{status}</p>}
    {invite ? <>
      <button className="btn btn-secondary" onClick={async () => {
        try { await navigator.clipboard.writeText(friendLink(invite.token)); setStatus('Friend link copied.') }
        catch { setStatus('Select and copy your friend link below.') }
      }}><Copy size={16} />Copy friend link</button>
      {status.startsWith('Select') && <input className="input" aria-label="Your friend link" readOnly onFocus={e => e.target.select()} value={friendLink(invite.token)} />}
      <button className="link-btn" disabled={busy} onClick={() => void update(true)}>Revoke code</button>
    </> : <button className="btn btn-secondary" disabled={busy} onClick={() => void update(false)}>Create a new code</button>}
  </>
}

function ConfirmFriend({ token, onAdded }: { token: string; onAdded: (username: string) => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    inviteRequest<{username: string}>('/preview', { token }).then(friend => {
      if (active) setName(friend.username)
    }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [token])
  async function confirm() {
    setBusy(true); setError('')
    try { const { friend } = await inviteRequest<{friend: {username: string}}>('/redeem', { token }); onAdded(friend.username) }
    catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return <>
    {name ? <p>Add <b>@{name}</b> to your friends? You’ll be able to message each other and plan meals together.</p> : !error && <p role="status">Checking friend code…</p>}
    {error && <p role="alert" className="account-error">{error}</p>}
    {name && <button className="btn btn-primary" disabled={busy} onClick={() => void confirm()}><Check size={18} />{busy ? 'Adding…' : 'Add friend'}</button>}
  </>
}

export function FriendSheet({ username, token, onToken, onAccount, onClose, onAdded }: {
  username: string | null; token: string | null; onToken: (token: string) => void
  onAccount: () => void; onClose: () => void; onAdded: (name: string) => void
}) {
  const [scan, setScan] = useState(false)
  const title = token ? 'Add a friend' : scan ? 'Scan friend' : 'Your friend QR'
  return <Sheet label={title} onClose={onClose} className="friend-sheet">
    <header><h2 className="h2">{title}</h2><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={19} /></button></header>
    {!username ? <><p>Create a PlatePal account to add friends and plan meals together.</p><button className="btn btn-primary" onClick={onAccount}>Sign up to add friends</button></>
      : token ? <ConfirmFriend key={token} token={token} onAdded={onAdded} />
      : scan ? <Scanner onFound={onToken} />
      : <><PersonalCode username={username} /><button className="btn btn-primary" onClick={() => setScan(true)}><ScanLine size={18} />Scan friend</button></>}
  </Sheet>
}
