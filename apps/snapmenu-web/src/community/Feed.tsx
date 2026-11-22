import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUpRight, Bookmark, Check, Clock3, Flame, MessageCircle, Plus, RefreshCw, TrendingUp, WifiOff } from 'lucide-react'
import { Icon } from '../components/ui'
import { COMMUNITIES, communityOf, CommunityError, feed, joinCommunity, memberships, plural, sharePost, type Membership, type PostView, type Sort } from '../lib/community'
import { MoreSheet, PostCard, PostSkeleton } from './parts'
import { usePostActions } from './usePostActions'
import './community.css'

const SORTS = [{ id: 'hot', label: 'Hot', Icon: Flame }, { id: 'new', label: 'New', Icon: Clock3 }, { id: 'top', label: 'Top', Icon: TrendingUp }] as const
function readPref<T>(k: string, d: T): T {
  try { const v = sessionStorage.getItem(k); return v ? (JSON.parse(v) as T) : d } catch { return d }
}
function writePref(k: string, v: unknown) { try { sessionStorage.setItem(k, JSON.stringify(v)) } catch { /* storage blocked */ } }

export function Feed({ onOpen, onCompose, onPlace, toast, refreshKey }: {
  onOpen: (post: PostView) => void; onCompose: (community: string | null) => void; onPlace: (post: PostView) => void; toast: (t: string) => void; refreshKey: number
}) {
  const [community, setCommunityState] = useState<string | null>(() => readPref('snapmenu.feed.c', null))
  const [sort, setSortState] = useState<Sort>(() => readPref('snapmenu.feed.sort', 'hot'))
  const [saved, setSaved] = useState(false)
  const [posts, setPosts] = useState<PostView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [pull, setPull] = useState(0)
  const [joined, setMembership] = useState<Membership[] | null>(null)
  const [membershipError, setMembershipError] = useState(false)
  const [joining, setJoining] = useState(false)
  const [refreshMember, setRefreshMember] = useState(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  const actions = usePostActions((fn) => setPosts((p) => (p ? fn(p) : p)), toast)
  const c = !saved && community ? communityOf(community) : null
  const member = c && joined?.find((m) => m.id === c.id)

  const setCommunity = (id: string | null) => {
    setPosts(null); setError(null); setCommunityState(id); writePref('snapmenu.feed.c', id); setSaved(false); window.scrollTo(0, 0)
  }
  const setSort = (s: Sort) => { if (s === sort) return; setPosts(null); setError(null); setSortState(s); writePref('snapmenu.feed.sort', s) }
  const toggleSaved = () => { setPosts(null); setError(null); setSaved((s) => !s); window.scrollTo(0, 0) }
  const reload = () => { if (!refreshing) { setRefreshing(true); setNonce((n) => n + 1); setRefreshMember((n) => n + 1) } }

  useEffect(() => {
    let live = true
    setError(null)
    feed({ community: saved ? null : community, sort, saved })
      .then((p) => { if (live) setPosts(p) })
      .catch((e) => { if (live) setError(e instanceof CommunityError ? e.message : 'Couldn’t load the feed.') })
      .finally(() => { if (live) setRefreshing(false) })
    return () => { live = false }
  }, [community, sort, saved, refreshKey, nonce])

  useEffect(() => {
    if (!c) return
    let live = true
    setMembershipError(false)
    memberships().then((m) => { if (live) setMembership(m) }).catch(() => { if (live) setMembershipError(true) })
    return () => { live = false }
  }, [c, refreshMember, refreshKey])

  async function toggleJoin() {
    if (!c || joining) return
    setJoining(true)
    try {
      const r = await joinCommunity(c.id, !member?.joined)
      setMembership((m) => m?.map((p) => p.id === c.id ? { ...p, joined: r.joined, members: Math.max(0, p.members + (p.joined === r.joined ? 0 : r.joined ? 1 : -1)) } : p) ?? null)
    } catch (e) { toast((e as Error).message) }
    finally { setJoining(false) }
  }
  const visible = saved ? posts?.filter((p) => p.saved) : posts

  return <main className="screen feed community-feed"
    onTouchStart={(e) => { const t = e.touches[0]; if (t && window.scrollY <= 2 && !(e.target as HTMLElement)?.closest?.('.feed-chips')) start.current = { x: t.clientX, y: t.clientY } }}
    onTouchMove={(e) => { const from = start.current, t = e.touches[0]; if (from && t && window.scrollY <= 2 && Math.abs(t.clientX - from.x) < 45) setPull(Math.min(76, Math.max(0, t.clientY - from.y) * .5)) }}
    onTouchEnd={() => { if (pull >= 52) reload(); start.current = null; setPull(0) }} onTouchCancel={() => { start.current = null; setPull(0) }}>
    <header className="feed-head">
      <div className="community-top">
        {(c || saved) && <button className="community-icon" aria-label="Back to community" onClick={() => saved ? toggleSaved() : setCommunity(null)}><ArrowLeft size={22} /></button>}
        <h1 className="h1">{saved ? 'Saved posts' : c ? c.label : 'Community'}</h1>
        <button className="community-icon" aria-label="Refresh feed" disabled={refreshing} onClick={reload}><RefreshCw size={19} /></button>
        <button className="community-icon" aria-label="Saved posts" aria-pressed={saved} onClick={toggleSaved}><Bookmark size={20} fill={saved ? 'currentColor' : 'none'} /></button>
      </div>
      {!c && !saved && <div className="quick feed-chips" role="group" aria-label="Communities">
        {COMMUNITIES.map((x) => <button key={x.id} className="q-chip c-chip" onClick={() => setCommunity(x.id)}><span className="c-chip__ic" style={{ background: x.tint, color: x.ink }}><Icon name={x.icon} size={13} strokeWidth={2} /></span>{x.label}</button>)}
      </div>}
      {c && <section className="community-hero" aria-label={`${c.label} community`} style={{ '--topic-tint': c.tint, '--topic-ink': c.ink } as React.CSSProperties}>
        <div className="community-banner" aria-hidden="true"><Icon name={c.icon} size={93} strokeWidth={1.25} /></div>
        <div className="community-hero-content"><span className="community-emblem"><Icon name={c.icon} size={25} /></span><div><h2>c/{c.id}</h2><p>{member ? plural(member.members, 'member') : membershipError ? 'Membership unavailable' : <i className="skeleton" style={{ width: 68, height: 9 }} />}</p></div>
          {membershipError ? <button className="community-join" onClick={() => setRefreshMember((n) => n + 1)}>Retry</button> : <button className="community-join" disabled={!member || joining} aria-pressed={Boolean(member?.joined)} onClick={() => void toggleJoin()}>{member?.joined ? <><Check size={15} /> Joined</> : 'Join'}</button>}
        </div>
      </section>}
      {!saved && <div className="community-sorts" role="radiogroup" aria-label="Sort posts">
        {SORTS.map(({ id, label, Icon }) => <button key={id} type="button" role="radio" aria-checked={sort === id} onClick={() => setSort(id)}><Icon size={16} />{label}</button>)}
      </div>}
      {c?.id === 'Delivery' && <span className="sr-only">Posts about meal delivery</span>}
      {(pull > 3 || refreshing) && <div className="community-refresh" role="status" style={{ height: refreshing ? 4 : pull }}>{refreshing ? <i className="skeleton" /> : <ArrowDown size={20} style={{ transform: pull >= 52 ? 'rotate(180deg)' : undefined }} />}</div>}
    </header>
    {error && <div className="community-state" role="alert"><WifiOff size={28} /><h2>Feed didn’t refresh</h2><p>{error}</p><button className="btn btn-secondary btn-sm" onClick={reload}>Try again</button></div>}
    {!error && visible == null && <div className="feed-list" role="status" aria-label="Loading posts"><PostSkeleton /><PostSkeleton /><PostSkeleton /></div>}
    {!error && visible?.length === 0 && <div className="community-state"><span>{saved ? <Bookmark size={27} /> : <MessageCircle size={27} />}</span><h2>{saved ? 'Nothing saved yet' : 'No posts yet'}</h2>{saved ? <p>Save a post to read it later.</p> : <button className="btn btn-primary btn-sm" onClick={() => onCompose(community)}>Start a conversation <ArrowUpRight size={16} /></button>}</div>}
    {visible && visible.length > 0 && <div className="feed-list">{visible.map((p) => <PostCard key={p.id} post={p} onOpen={() => onOpen(p)} onVote={(v) => void actions.onVote(p, v)} onSave={() => void actions.onSave(p)} onMore={() => actions.setMore(p)} onShare={() => void sharePost(p, toast)} onCommunity={() => { if (community !== p.community || saved) setCommunity(p.community) }} {...(p.place ? { onPlace: () => onPlace(p) } : {})} />)}</div>}
    {!saved && <button type="button" className="fab" onClick={() => onCompose(community)} aria-label="New post"><Plus size={23} strokeWidth={2.2} /><span>Post</span></button>}
    {actions.more && <MoreSheet kind="post" mine={actions.more.mine} onClose={() => actions.setMore(null)} onReport={(r) => void actions.onReport(actions.more!, r)} onDelete={() => void actions.onDelete(actions.more!)} />}
  </main>
}
