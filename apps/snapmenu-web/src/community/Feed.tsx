// Community tab: Reddit-style feed with goal and Kiez communities, Hot / New / Top, saved posts.
import { useEffect, useRef, useState } from 'react'
import { Icon, Logo } from '../components/ui'
import { COMMUNITIES, communityOf, CommunityError, feed, type PostView, type Sort } from '../lib/community'
import { MoreSheet, PostCard, PostSkeleton } from './parts'
import { usePostActions } from './usePostActions'

const SORTS: Array<{ id: Sort; label: string; icon: string }> = [
  { id: 'hot', label: 'Hot', icon: 'flame' },
  { id: 'new', label: 'New', icon: 'spark' },
  { id: 'top', label: 'Top', icon: 'chart' },
]

function readPref<T>(k: string, d: T): T {
  try { const v = sessionStorage.getItem(k); return v ? (JSON.parse(v) as T) : d } catch { return d }
}
function writePref(k: string, v: unknown) {
  try { sessionStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ }
}

export function Feed({ onOpen, onCompose, onPlace, toast, refreshKey }: {
  onOpen: (post: PostView) => void
  onCompose: (community: string | null) => void
  onPlace: (post: PostView) => void
  toast: (t: string) => void
  /** Changes after a new post, so the list reloads. */
  refreshKey: number
}) {
  const [community, setCommunityState] = useState<string | null>(() => readPref('snapmenu.feed.c', null))
  const [sort, setSortState] = useState<Sort>(() => readPref('snapmenu.feed.sort', 'hot'))
  const [saved, setSaved] = useState(false)
  const [delivers, setDeliversState] = useState<boolean>(() => readPref('snapmenu.feed.delivers', false))
  const setDelivers = (v: boolean) => { setDeliversState(v); writePref('snapmenu.feed.delivers', v) }
  const [posts, setPosts] = useState<PostView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const actions = usePostActions((fn) => setPosts((p) => (p ? fn(p) : p)), toast)
  const chipsRef = useRef<HTMLDivElement>(null)

  const setCommunity = (c: string | null) => { setCommunityState(c); writePref('snapmenu.feed.c', c); setSaved(false) }
  const setSort = (s: Sort) => { setSortState(s); writePref('snapmenu.feed.sort', s) }

  useEffect(() => {
    let live = true
    setError(null)
    setPosts((p) => (p && p.length ? p : null))
    feed({ community, sort, saved, delivers })
      .then((p) => live && setPosts(p))
      .catch((e) => live && setError(e instanceof CommunityError ? e.message : 'Could not load the feed.'))
    return () => { live = false }
  }, [community, sort, saved, delivers, refreshKey, nonce])

  useEffect(() => {
    const el = chipsRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
    el?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [community])

  const c = community ? communityOf(community) : null

  return (
    <main className="screen feed">
      <header className="feed-head">
        <div className="row" style={{ gap: 10 }}>
          <Logo size={28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="h2">{c ? `c/${c.id}` : 'Community'}</h1>
            <p className="small">{c ? c.blurb : 'Best orders from people eating near you'}</p>
          </div>
          <button className={`icon-btn ${saved ? 'is-on' : ''}`} aria-pressed={saved} aria-label="Saved posts" onClick={() => setSaved((s) => !s)}>
            <Icon name="bookmark" size={19} />
          </button>
        </div>
        <div className="quick feed-chips" ref={chipsRef} role="toolbar" aria-label="Communities">
          <button className="q-chip" aria-pressed={community === null} onClick={() => setCommunity(null)}>All</button>
          {COMMUNITIES.map((x) => (
            <button key={x.id} className="q-chip c-chip" aria-pressed={community === x.id} onClick={() => setCommunity(x.id)}>
              <span className="c-chip__ic" style={{ background: x.tint, color: x.ink }}><Icon name={x.icon} size={12} strokeWidth={2.2} /></span>
              {x.label}
            </button>
          ))}
        </div>
        <div className="feed-tools">
          <div className="seg" role="radiogroup" aria-label="Sort">
            {SORTS.map((s) => (
              <button key={s.id} role="radio" aria-checked={sort === s.id} className="seg__opt" onClick={() => setSort(s.id)}>
                <Icon name={s.icon} size={15} strokeWidth={2} /> {s.label}
              </button>
            ))}
          </div>
          <button className="dl-toggle" aria-pressed={delivers} onClick={() => setDelivers(!delivers)} title="Posts about restaurants that deliver">
            <Icon name="bag" size={16} strokeWidth={2} /> Delivers
          </button>
        </div>
      </header>

      {saved && <p className="eyebrow" style={{ margin: '4px 4px 10px' }}>Your saved posts</p>}

      {error && (
        <div className="state" role="alert" style={{ flex: 'none' }}>
          <span className="s-ic"><Icon name="wifiOff" size={28} /></span>
          <p className="body">{error}</p>
          <button className="btn btn-secondary btn-sm" onClick={() => setNonce((n) => n + 1)}>Try again</button>
        </div>
      )}

      {!error && posts === null && <div className="feed-list"><PostSkeleton /><PostSkeleton /><PostSkeleton /></div>}

      {!error && posts && posts.length === 0 && (
        <div className="state" style={{ flex: 'none' }}>
          <span className="s-ic"><Icon name={saved ? 'bookmark' : 'comment'} size={28} /></span>
          <h2 className="h3">{saved ? 'Nothing saved yet' : delivers ? 'No delivery posts here yet' : 'No posts here yet'}</h2>
          <p className="body" style={{ maxWidth: 300 }}>{saved ? 'Tap the bookmark on a post to keep it here.' : delivers ? 'Ordered something healthy? Share it and tag the app you used.' : 'Be the first: ask a question or share your best order after a scan.'}</p>
          {!saved && <button className="btn btn-primary btn-sm" onClick={() => onCompose(community)}><Icon name="pencil" size={16} /> Write a post</button>}
        </div>
      )}

      {posts && posts.length > 0 && (
        <div className="feed-list">
          {posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              onOpen={() => onOpen(p)}
              onVote={(v) => void actions.onVote(p, v)}
              onSave={() => void actions.onSave(p)}
              onMore={() => actions.setMore(p)}
              {...(p.place ? { onPlace: () => onPlace(p) } : {})}
            />
          ))}
          <p className="small" style={{ textAlign: 'center', padding: '8px 0 0' }}>
            Posts marked Example show how it works and are not real reviews. Be kind; no personal data, no DMs.
          </p>
        </div>
      )}

      <button className="fab" onClick={() => onCompose(community)} aria-label="New post">
        <Icon name="plus" size={22} strokeWidth={2.2} /> <span>Post</span>
      </button>

      {actions.more && (
        <MoreSheet
          kind="post"
          mine={actions.more.mine}
          onClose={() => actions.setMore(null)}
          onReport={(r) => void actions.onReport(actions.more!, r)}
          onDelete={() => void actions.onDelete(actions.more!)}
        />
      )}
    </main>
  )
}
