// One group: who is in, and what fits them. Planning a meal out, it lists restaurants nearby with a dish
// and a price per person and lets everyone vote. With a scanned menu (table mode) it shows a pick per person.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MemberResult, MemberView, PlaceMatch } from '../../../snapmenu-api/src/group/types'
import { EMPTY_NEEDS } from '../../../snapmenu-api/src/group/needs'
import { Icon, Sheet, Wordmark } from '../components/ui'
import { ApiError, track } from '../lib/api'
import { kcalRange, n0 } from '../lib/format'
import { formatDistance, getPosition, requestPosition } from '../lib/position'
import { store } from '../lib/storage'
import { fetchGroup, forgetGroup, groupLink, inviteText, joinGroup, leaveGroup, rememberGroup, setGroupMenu, voteGroup, whatsappLink, type GroupView, type Needs } from './api'
import { NeedsForm, needsLine, type VoiceSlot } from './NeedsForm'

const COLORS = ['var(--basil)', 'var(--protein)', 'var(--fat)', 'var(--carbs)', 'var(--unsure)', 'var(--ink-2)']

export function Avatar({ name, index, size = 32 }: { name: string; index: number; size?: number }) {
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.44, background: COLORS[index % COLORS.length] }} aria-hidden="true">{(name.trim()[0] ?? '?').toUpperCase()}</span>
}

/** The needs this phone's owner already gave the app, so joining a group is one tap for them. */
function ownNeeds(): Needs {
  const p = store.profile()
  if (!p) return EMPTY_NEEDS
  return {
    diet: p.goal === 'plant_based' ? (p.plantStyle === 'vegetarian' ? 'vegetarian' : 'vegan') : 'any',
    allergies: p.allergies,
    goal: p.goal === 'lose_fat' || p.goal === 'build_muscle' ? p.goal : 'balanced',
    budget: null,
  }
}

/** The open form: for a person of this phone, or for a new one (`n` tells two new ones apart, so a poll never resets what is being typed). */
type Editing = { memberId: string | null; first: boolean; n?: number } | null

/** "Tom", "Tom and Lena", "Tom, Lena and 2 more". */
function namesLine(names: string[]): string {
  const shown = names.length > 3 ? [...names.slice(0, 2), `${names.length - 2} more`] : names
  return shown.length < 2 ? shown.join('') : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`
}

export function GroupPage({ id, go, toast, voice }: { id: string; go: (path: string, replace?: boolean) => void; toast: (t: string) => void; voice?: VoiceSlot | undefined }) {
  const [group, setGroup] = useState<GroupView | null>(null)
  const [missing, setMissing] = useState(false)
  const [offline, setOffline] = useState(false)
  const [editing, setEditing] = useState<Editing>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [locating, setLocating] = useState(false)
  const updated = useRef(0)

  const show = useCallback((g: GroupView) => {
    updated.current = g.updated
    setGroup(g)
    rememberGroup(g, g.table ? g.table.restaurant ?? 'Your table' : g.name || 'Meal out')
  }, [])

  // Load, then ask every few seconds whether anything changed (one cheap request while nothing did).
  useEffect(() => {
    let live = true
    const load = async (since?: number) => {
      try {
        const g = await fetchGroup(id, since)
        if (!live) return
        setOffline(false)
        if (g) show(g)
      } catch (e) {
        if (!live) return
        if (e instanceof ApiError && e.status === 404) { setMissing(true); forgetGroup(id) } else setOffline(true)
      }
    }
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(updated.current || undefined) }, 5000)
    const onVisible = () => { if (document.visibilityState === 'visible') void load(updated.current || undefined) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { live = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [id, show])

  const mine = group?.members.filter((m) => m.mine) ?? []
  const me = mine[0] ?? null
  // Whoever opens the link adds themselves first.
  const form: Editing = editing ?? (group && !me ? { memberId: null, first: true } : null)

  const save = async (name: string, needs: Needs) => {
    if (!group || !form) return
    setBusy(true)
    setFormError(null)
    try {
      const pos = getPosition()
      const out = await joinGroup({ id, name, needs, ...(form.memberId ? { memberId: form.memberId } : {}), ...(pos.status === 'granted' ? pos.position : {}) })
      show(out.group)
      setEditing(null)
      window.scrollTo({ top: 0 })
      if (!form.memberId) track('group_joined', { kind: group.kind })
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'That did not work. Try again.')
    } finally {
      setBusy(false)
    }
  }
  const remove = async (memberId: string) => {
    setBusy(true)
    try { show((await leaveGroup(id, memberId)).group); setEditing(null) } catch (e) { setFormError(e instanceof Error ? e.message : 'That did not work.') } finally { setBusy(false) }
  }
  const vote = async (placeId: string) => {
    if (!group || !me) return
    const mineNow = group.matches.find((m) => m.voters.includes(me.id))?.place.id
    const next = mineNow === placeId ? null : placeId
    // Show the tap at once; the answer from the server replaces it.
    setGroup({ ...group, matches: group.matches.map((m) => ({ ...m, voters: [...m.voters.filter((v) => v !== me.id), ...(m.place.id === next ? [me.id] : [])] })) })
    try { show((await voteGroup(id, me.id, next)).group) } catch { toast('Could not save your vote') }
  }
  /** Nobody shared where they are yet: this person does, and the search moves there. */
  const locate = async () => {
    if (!me) return
    setLocating(true)
    try {
      const pos = await requestPosition()
      if (pos.status !== 'granted') { toast(pos.status === 'denied' ? 'Location is blocked for this page' : 'Could not find your location'); return }
      show((await joinGroup({ id, memberId: me.id, name: me.name, needs: me.needs, ...pos.position })).group)
    } catch {
      toast('That did not work')
    } finally {
      setLocating(false)
    }
  }
  const backToPlaces = async () => {
    try { show((await setGroupMenu(id, null)).group) } catch { toast('That did not work') }
  }

  if (missing) {
    return (
      <main className="screen with-cta">
        <div className="topbar"><Wordmark onClick={() => window.location.assign('/')} /></div>
        <div className="state" role="alert">
          <span className="s-ic"><Icon name="users" size={32} /></span>
          <h1 className="h2">This link no longer works</h1>
          <p className="body" style={{ maxWidth: 280 }}>Groups close after a while. Start a new one, it takes a moment.</p>
        </div>
        <div className="cta-bar"><button className="btn btn-primary" onClick={() => go('/g', true)}>Start a new one</button></div>
      </main>
    )
  }

  if (!group) {
    return (
      <main className="screen" aria-busy="true">
        <div className="topbar"><Wordmark onClick={() => window.location.assign('/')} /></div>
        {offline
          ? <div className="state" role="alert"><span className="s-ic"><Icon name="wifiOff" size={32} /></span><h1 className="h2">You are offline</h1><p className="body">Check your connection. This page tries again by itself.</p></div>
          : <div className="g-loading">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: i === 0 ? 40 : 132, width: i === 0 ? '60%' : '100%' }} />)}</div>}
      </main>
    )
  }

  if (form) {
    const member = form.memberId ? group.members.find((m) => m.id === form.memberId) : null
    const others = group.members.filter((m) => m.id !== form.memberId).map((m) => m.name)
    return (
      <NeedsForm
        key={form.memberId ?? (form.first ? 'first' : `new-${form.n ?? 0}`)}
        title={member ? member.name : form.first ? 'What do you eat?' : 'Who else is eating?'}
        lead={member ? undefined : form.first && others.length ? `${namesLine(others)} ${others.length === 1 ? 'is' : 'are'} in. Now you.` : undefined}
        initial={member ? { name: member.name, needs: member.needs } : { name: '', needs: form.first ? ownNeeds() : EMPTY_NEEDS }}
        submitLabel={member ? 'Save' : form.first ? 'Join' : 'Add'}
        busy={busy}
        error={formError}
        onSubmit={(name, needs) => void save(name, needs)}
        onBack={form.first ? undefined : () => { setEditing(null); setFormError(null) }}
        onRemove={member ? () => void remove(member.id) : undefined}
        voice={voice}
      />
    )
  }

  const index = (memberId: string) => Math.max(0, group.members.findIndex((m) => m.id === memberId))
  const nameOf = (memberId: string) => group.members[index(memberId)]?.name ?? ''
  const table = group.table
  const all = group.members.length
  const fitsAll = group.matches.filter((m) => m.fits === all)
  const fitsSome = group.matches.filter((m) => m.fits < all && m.fits > 0)

  return (
    <main className="screen with-cta g-page">
      <div className="topbar">
        <Wordmark onClick={() => window.location.assign('/')} />
        {table && <button className="icon-btn" onClick={() => setSharing(true)} aria-label="Invite with a link"><Icon name="share" /></button>}
      </div>

      <header className="g-head">
        <p className="eyebrow">{table ? `At the table · ${table.dishes} dishes` : 'Eating together'}</p>
        <h1 className="h1">{table ? table.restaurant ?? 'Your table' : group.name || 'Where should we eat?'}</h1>
      </header>

      {!table && (
        <div className="g-people" role="group" aria-label="People">
          {group.members.map((m, i) => (
            <button key={m.id} className="g-person" disabled={!m.mine} onClick={() => setEditing({ memberId: m.id, first: false })} aria-label={m.mine ? `${m.name}: change` : m.name}>
              <Avatar name={m.name} index={i} size={28} />
              <span>{m.name}</span>
              {m.mine && <Icon name="edit" size={13} />}
            </button>
          ))}
        </div>
      )}

      {table ? (
        <section className="g-list" aria-label="A pick per person">
          {table.results.map((r) => <Seat key={r.memberId} result={r} member={group.members[index(r.memberId)]!} index={index(r.memberId)} onEdit={(m) => setEditing({ memberId: m.id, first: false })} />)}
          {group.kind === 'group' && <button className="link-btn" style={{ justifySelf: 'center' }} onClick={() => void backToPlaces()}><Icon name="back" size={16} /> Back to restaurants</button>}
        </section>
      ) : (
        <>
          {all < 2 && (
            <section className="g-invite">
              <span className="me-ic"><Icon name="users" size={20} /></span>
              <div><b>Now invite your friends</b><p className="small">They add what they eat in seconds. No app, no account.</p></div>
            </section>
          )}

          {!group.located && (
            <button className="g-where" onClick={() => void locate()} disabled={locating}>
              <Icon name="locate" size={18} />
              <span>Places around <b>Berlin Mitte</b></span>
              <b className="g-where__go">{locating ? 'Locating…' : 'Use my location'}</b>
            </button>
          )}

          {group.conflicts.map((c) => (
            <div key={c.memberId} className="g-conflict" role="status">
              <Avatar name={nameOf(c.memberId)} index={index(c.memberId)} size={28} />
              <span>{c.text}</span>
            </div>
          ))}
          {group.noPlaceForAll && group.conflicts.length === 0 && group.matches.length > 0 && (
            <div className="g-conflict g-conflict--soft" role="status"><Icon name="info" size={20} /><span>No single place has a dish for everyone. The closest matches come first.</span></div>
          )}

          {group.matches.length === 0 ? (
            <section className="g-empty">
              <span className="s-ic"><Icon name="pin" size={28} /></span>
              <b>No scanned menus around here yet</b>
              <p className="small">Scan the menu where you are and everyone gets a pick from it.</p>
              <button className="btn btn-secondary btn-sm" onClick={() => go(`/g/${id}/scan`)}><Icon name="camera" size={18} /> Scan a menu</button>
            </section>
          ) : (
            <section className="g-list" aria-label="Restaurants">
              {group.wide && <p className="small g-note">Nothing scanned close by. These are a bit further away.</p>}
              {fitsAll.length > 0 && <h2 className="eyebrow g-list__title">{all > 1 ? `Fits all ${all} of you` : 'Fits you'}</h2>}
              {fitsAll.map((m, i) => <PlaceCard key={m.place.id} match={m} rank={i + 1} group={group} meId={me?.id ?? null} index={index} nameOf={nameOf} onVote={vote} />)}
              {fitsSome.length > 0 && <h2 className="eyebrow g-list__title">Fits some of you</h2>}
              {fitsSome.map((m, i) => <PlaceCard key={m.place.id} match={m} rank={fitsAll.length + i + 1} group={group} meId={me?.id ?? null} index={index} nameOf={nameOf} onVote={vote} />)}
              <button className="link-btn" style={{ justifySelf: 'center' }} onClick={() => go(`/g/${id}/scan`)}><Icon name="camera" size={16} /> Already there? Scan the menu</button>
            </section>
          )}
        </>
      )}

      <footer className="footer g-foot">
        <span>Allergy notes are hints from the menu's words, never a guarantee. Confirm with the restaurant.</span>
        {!table && group.matches.length > 0 && <span>{group.attribution}</span>}
      </footer>

      <div className="cta-bar">
        {table
          ? <button className="btn btn-primary" onClick={() => setEditing({ memberId: null, first: false, n: Date.now() })}><Icon name="plus" size={20} /> Add a friend</button>
          : <button className="btn btn-primary" onClick={() => setSharing(true)}><Icon name="share" size={20} /> Invite friends</button>}
      </div>

      {sharing && <ShareSheet group={group} onClose={() => setSharing(false)} toast={toast} />}
    </main>
  )
}

/** One restaurant: who has a dish here, which one, what it costs, and who is left out. */
function PlaceCard({ match, rank, group, meId, index, nameOf, onVote }: {
  match: PlaceMatch; rank: number; group: GroupView; meId: string | null
  index: (memberId: string) => number; nameOf: (memberId: string) => string; onVote: (placeId: string) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const voted = meId !== null && match.voters.includes(meId)
  const all = group.members.length
  return (
    <article className="card g-place">
      <header className="g-place__head">
        <span className={`rank ${rank > 1 ? 'r2' : ''}`}>{rank}</span>
        <div className="g-place__name">
          <h3 className="h3">{match.place.name}</h3>
          <p className="small g-place__meta"><span>{[formatDistance(match.distanceM), match.place.cuisine].filter(Boolean).join(' · ')}</span>{match.example && <span className="example-badge">Example</span>}</p>
        </div>
        <button className="g-vote" aria-pressed={voted} onClick={() => onVote(match.place.id)} disabled={!meId} aria-label={`${voted ? 'Take back your vote for' : 'Vote for'} ${match.place.name}. ${match.voters.length} ${match.voters.length === 1 ? 'vote' : 'votes'}`}>
          <Icon name="up" size={16} />{match.voters.length > 0 ? <span className="num">{match.voters.length}</span> : <span>Vote</span>}
        </button>
      </header>
      {all > 1 && match.fits < all && <p className="g-fit">Fits {match.fits} of {all}</p>}
      <ul className="g-picks">
        {match.results.map((r) => <PickRow key={r.memberId} r={r} name={nameOf(r.memberId)} index={index(r.memberId)} open={open === r.memberId} onToggle={() => setOpen(open === r.memberId ? null : r.memberId)} />)}
      </ul>
    </article>
  )
}

function PickRow({ r, name, index, open, onToggle }: { r: MemberResult; name: string; index: number; open: boolean; onToggle: () => void }) {
  if (!r.pick) {
    return (
      <li className="g-pick g-pick--none">
        <Avatar name={name} index={index} size={28} />
        <span className="g-pick__text"><span className="g-pick__out">{r.conflict ?? `Nothing here for ${name}.`}</span></span>
      </li>
    )
  }
  const p = r.pick
  return (
    <li>
      <button className="g-pick" aria-expanded={open} onClick={onToggle}>
        <Avatar name={name} index={index} size={28} />
        <span className="g-pick__text">
          <b>{p.dish.name}</b>
          <span className="small">{[name, ...p.checks].join(' · ')}</span>
        </span>
        <span className="g-pick__price num">{p.dish.price ?? ''}</span>
      </button>
      {open && (
        <div className="g-pick__more">
          <p className="g-nums"><b className="num">{kcalRange(p.dish.kcal)}</b> kcal<i /> <b className="num g-protein">{n0(p.dish.protein)} g</b> protein</p>
          <p className="small">{p.why}</p>
          {p.checks.length > 0 && <p className="g-checks">{p.checks.map((c) => <span key={c}><Icon name="check" size={13} strokeWidth={2.6} />{c}</span>)}</p>}
        </div>
      )}
    </li>
  )
}

/** Table mode: one person, their pick from the scanned menu. */
function Seat({ result, member, index, onEdit }: { result: MemberResult; member: MemberView; index: number; onEdit: (m: MemberView) => void }) {
  const p = result.pick
  const limits = needsLine(member.needs)
  return (
    <article className="card g-seat">
      <header className="g-seat__who">
        <Avatar name={member.name} index={index} size={36} />
        <div className="g-seat__name"><b>{member.name}</b>{limits && <span className="small">{limits}</span>}</div>
        {member.mine && <button className="icon-btn g-seat__edit" onClick={() => onEdit(member)} aria-label={`Change what ${member.name} eats`}><Icon name="edit" size={18} /></button>}
      </header>
      {p ? (
        <>
          <div className="g-seat__dish">
            <div><h3 className="h2">{p.dish.name}</h3>{p.dish.translated && <p className="small">{p.dish.translated}</p>}</div>
            {p.dish.price && <span className="price num">{p.dish.price}</span>}
          </div>
          <p className="g-nums g-nums--big"><b className="num">{kcalRange(p.dish.kcal)}</b> kcal<i /> <b className="num g-protein">{n0(p.dish.protein)} g</b> protein</p>
          <p className="best__why">{p.why}</p>
          {p.checks.length > 0 && <p className="g-checks">{p.checks.map((c) => <span key={c}><Icon name="check" size={13} strokeWidth={2.6} />{c}</span>)}</p>}
          {p.alsoFits.length > 0 && <p className="small g-also">Also fits: {p.alsoFits.map((d) => d.name).join(' · ')}</p>}
        </>
      ) : (
        <div className="g-seat__none" role="status"><Icon name="alert" size={20} /><span>{result.conflict ?? `Nothing on this menu for ${member.name} yet.`}</span></div>
      )}
    </article>
  )
}

function ShareSheet({ group, onClose, toast }: { group: GroupView; onClose: () => void; toast: (t: string) => void }) {
  const text = inviteText(group)
  const link = groupLink(group.id)
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast('Link copied') } catch { toast(link) }
    track('group_share', { how: 'copy' })
    onClose()
  }
  const more = async () => {
    track('group_share', { how: 'system' })
    try { await navigator.share({ text }) } catch { /* closed without sharing */ }
    onClose()
  }
  return (
    <Sheet label="Invite friends" onClose={onClose} className="g-share">
      <h2 className="h2">Invite friends</h2>
      <p className="body">One link. Everyone adds what they eat.</p>
      <div className="dl-links">
        <a className="dl-link" href={whatsappLink(text)} target="_blank" rel="noreferrer" onClick={() => { track('group_share', { how: 'whatsapp' }); onClose() }}>
          <span className="dl-dot" style={{ background: '#25d366', color: '#25d366' }} /><b>WhatsApp</b><span className="dl-link__go"><Icon name="external" size={18} /></span>
        </a>
        <button className="dl-link" onClick={() => void copy()}>
          <Icon name="copy" size={18} /><b>Copy link</b><span className="dl-link__go g-share__link">{link.replace(/^https?:\/\//, '')}</span>
        </button>
        {typeof navigator.share === 'function' && (
          <button className="dl-link" onClick={() => void more()}><Icon name="share" size={18} /><b>More</b><span className="dl-link__go"><Icon name="chevron" size={18} /></span></button>
        )}
      </div>
    </Sheet>
  )
}
