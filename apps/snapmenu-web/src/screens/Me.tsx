import { lazy, Suspense, useState, type ReactNode } from 'react'
import { ArrowRight, Fingerprint, LogOut, MessageCircle, QrCode, UsersRound } from 'lucide-react'
import { Assistant } from '../me/Assistant'
import { UnsyncedChanges, type useAccount } from '../me/account'
import type { View } from '../me/MeSpace'
import { MapPreference } from '../map/preference'
import '../me/round2.css'

const AccountPanel = lazy(() => import('../me/AccountPanel').then((m) => ({ default: m.AccountPanel })))
import type { Profile } from '../../../snapmenu-api/src/types'
import { Fold, Footer, Icon } from '../components/ui'
import { useMeCommunity } from '../community/extras'
import { AdultRow } from '../discover/Drinks'
import type { PostView } from '../lib/community'
import { allergyName, goalLabel, LANGUAGES } from '../lib/format'
import { requestPosition, resetPosition, usePosition } from '../lib/position'
import { SocialRows } from '../social'

/** Nickname, then settings as one quiet list, then saved and own posts. */
export function Me({ profile, onEditProfile, onLanguage, onOpenPost, refreshKey, top, account, onAsk, onFriends, onAccountChange, dashboard, open, back }: {
  /** Today, picks and the rows for targets, taste, favorites and meals (src/me). */
  top?: ReactNode
  account: ReturnType<typeof useAccount>
  onAsk: () => void
  onFriends: () => void
  onAccountChange: () => void
  dashboard: boolean
  open: (v: View) => void
  back: () => void
  profile: Profile | null
  onEditProfile: () => void
  onLanguage: (language: string) => void
  onOpenPost: (p: PostView) => void
  /** Changes after a new post, so the lists reload. */
  refreshKey: number
}) {
  const position = usePosition()
  const { card, lists } = useMeCommunity(onOpenPost, refreshKey, !account.session || dashboard)
  const [showAccount, setShowAccount] = useState(false)
  const [authError, setAuthError] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const [unsynced, setUnsynced] = useState(false)
  async function logOut(discard = false) {
    setSigningOut(true); setAuthError(''); setUnsynced(false)
    try { await account.logout(discard); onAccountChange() }
    catch (e) { setUnsynced(e instanceof UnsyncedChanges); setAuthError((e as Error).message) }
    finally { setSigningOut(false) }
  }
  const accountError = account.message || authError
  const located = position.status === 'granted'
  const list = profile?.allergies.map(allergyName).join(', ') ?? ''
  const allergies = list ? list[0]!.toUpperCase() + list.slice(1) : 'None'
  if (account.session && !dashboard) return <Assistant key={account.session.username} username={account.session.username} profile={profile} onTools={() => open('dashboard')} onToday={() => open('log')} onAsk={onAsk} onFriends={onFriends} />
  return (
    <main className="screen me">
      <header className="me-dash-head"><h1 className="h1">{account.session ? 'Your dashboard' : 'Me'}</h1>{account.session && <button className="icon-btn" aria-label="Back to assistant" onClick={back}><MessageCircle size={19} /></button>}</header>
      {account.loading ? <div className="me-signin" aria-busy="true"><i className="skeleton" style={{ height: 42 }} /><i className="skeleton" style={{ height: 18 }} /></div> : !account.session && !account.message && <section className="me-signin" aria-label="Your PlatePal account">
        <span className="account-glyph"><Fingerprint size={22} /></span><div><b>Your PlatePal account</b><span className="small">Meal assistant and picks across devices.</span></div>
        <button className="btn btn-primary" onClick={() => setShowAccount(true)}>Log in / Sign up <ArrowRight size={16} /></button>
      </section>}
      {accountError && <div className="account-error"><span role="alert">{authError || accountError}</span> {account.message && <button className="link-btn" onClick={() => { setAuthError(''); setUnsynced(false); account.retry() }}>Reload account</button>}{unsynced && <button className="link-btn" onClick={() => void logOut(true)}>Log out without syncing</button>}</div>}
      {showAccount && <Suspense fallback={<div className="me-signin" aria-busy="true"><i className="skeleton" style={{ height: 42 }} /></div>}><AccountPanel onClose={() => setShowAccount(false)} onLink={async () => { await account.link(); if (dashboard) back(); onAccountChange() }} /></Suspense>}
      {top}

      <div className="card-flat list-card set-list">
        <button className="set-row" onClick={onEditProfile}>
          <span className="set-row__ic" style={{ background: 'var(--fat-tint)', color: 'var(--fat)' }}><Icon name="flame" size={18} /></span>
          <span className="set-row__label">Goal</span>
          <span className="set-row__value">{profile ? goalLabel(profile) : 'Set up'}</span>
          <Icon name="chevron" size={18} />
        </button>
        {profile && (
          <button className="set-row" onClick={onEditProfile}>
            <span className="set-row__ic" style={{ background: 'var(--alert-tint)', color: 'var(--alert)' }}><Icon name="shield" size={18} /></span>
            <span className="set-row__label">Allergies</span>
            <span className="set-row__value">{allergies}</span>
            <Icon name="chevron" size={18} />
          </button>
        )}
        {profile && (
          <label className="set-row">
            <span className="set-row__ic" style={{ background: 'var(--basil-tint)', color: 'var(--basil)' }}><Icon name="globe" size={18} /></span>
            <span className="set-row__label">Language</span>
            <select className="set-row__select" value={profile.language} onChange={(e) => onLanguage(e.target.value)} aria-label="Language for translations">
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.native}</option>)}
            </select>
            <Icon name="chevronDown" size={18} />
          </label>
        )}
        <button className="set-row" onClick={() => (located ? resetPosition() : void requestPosition())} disabled={position.status === 'locating'}>
          <span className="set-row__ic" style={{ background: 'var(--protein-tint)', color: 'var(--protein)' }}><Icon name="locate" size={18} /></span>
          <span className="set-row__label">Location</span>
          <span className="set-row__value">{located ? 'On' : position.status === 'locating' ? 'Finding…' : position.status === 'denied' ? 'Blocked in browser' : 'Off'}</span>
          <span className={`switch ${located ? 'is-on' : ''}`} aria-hidden="true" />
        </button>
        <AdultRow />
      </div>

      <SocialRows />
      <div className="card-flat list-card set-list">
        <a className="set-row me-groups" href="/g"><span className="set-row__ic"><UsersRound size={19} /></span><span className="set-row__label">Groups</span><Icon name="chevron" size={18} /></a>
        <button className="set-row" onClick={onFriends}><span className="set-row__ic"><QrCode size={19} /></span><span className="set-row__label">Friend QR</span><Icon name="chevron" size={18} /></button>
        <MapPreference />
        {account.session && <button className="set-row" disabled={signingOut} onClick={() => void logOut()}><span className="set-row__ic"><LogOut size={18} /></span><span className="set-row__label">{signingOut ? 'Logging out…' : 'Log out'}</span><span className="set-row__value">@{account.session.username}</span></button>}
      </div>
      {!account.session && card}
      {lists}

      <Fold title="About the data">
        <ul className="plain-list">
          <li>Accounts are optional. When signed in, saved picks, goals and posts are linked to your account. Your meal log stays on this device.</li>
          <li>We use your location for nearby picks. If you open directions, OpenStreetMap receives your starting point.</li>
          <li>The meal assistant uses OpenAI. Mentioning @PlatePal sends recent chat text and meal options to OpenAI for a reply. Voice notes are shared with the people in your chat.</li>
          <li>Nutrition: USDA FoodData Central and Open Food Facts, through the open Nut AI engine.</li>
          <li>Restaurants: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors, ODbL 1.0.</li>
          <li>Map tiles: OpenFreeMap, © OpenMapTiles.</li>
        </ul>
      </Fold>
      <Footer />
    </main>
  )
}
