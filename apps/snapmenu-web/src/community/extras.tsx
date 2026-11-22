// Community pieces that live on other tabs: posts in a restaurant sheet, the post prompt after a scan,
// and the Me tab's nickname, own posts and saved posts.
import { useEffect, useState } from 'react'
import type { Place } from '../../../snapmenu-api/src/types'
import { Fold, Icon } from '../components/ui'
import { feed, nickname, plural, timeAgo, type PostView } from '../lib/community'
import { Avatar, CommunityTag, ExampleTag, NicknameSheet } from './parts'

export function PlacePosts({ place, onOpen, showEmpty = false }: { place: Place; onOpen: (p: PostView) => void; showEmpty?: boolean }) {
  const [posts, setPosts] = useState<PostView[] | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let live = true
    setError(false)
    setPosts(null)
    feed({ place: place.id, sort: 'top' }).then((p) => live && setPosts(p)).catch(() => live && setError(true))
    return () => { live = false }
  }, [place.id, retry])
  if (!showEmpty && !posts?.length) return null
  if (error) return <div className="explore-empty">Posts didn’t load.<button className="link-btn" onClick={() => setRetry((n) => n + 1)}>Try again</button></div>
  if (!posts) return <span className="skeleton" role="status" aria-label="Loading posts" style={{ height: 52, margin: '10px 0' }} />
  if (!posts.length) return <p className="small" style={{ padding: '12px 0' }}>No posts about this place yet.</p>
  return (
    <>
      <div className="section-title" style={{ margin: '20px 0 10px' }}><h3 className="h3">Posts</h3><span className="small">{posts.length}</span></div>
      <div className="place-posts">
        {posts.slice(0, 4).map((p) => (
          <button key={p.id} type="button" className="place-post" onClick={() => onOpen(p)}>
            <span className="row"><CommunityTag id={p.community} /><span className="small">· {plural(p.score, 'vote')} · {plural(p.comments, 'comment')}</span>{p.example && <ExampleTag />}</span>
            <b>{p.title}</b>
          </button>
        ))}
      </div>
    </>
  )
}

export function PostPrompt({ onPost }: { onPost: () => void }) {
  return (
    <button className="post-prompt" onClick={onPost}>
      <span className="me-ic"><Icon name="users" size={20} /></span>
      <b>Post your best order</b>
      <Icon name="chevron" size={18} />
    </button>
  )
}

function MiniList({ posts, onOpen }: { posts: PostView[]; onOpen: (p: PostView) => void }) {
  return (
    <>
      {posts.slice(0, 8).map((p) => (
        <button key={p.id} type="button" className="dish-row" onClick={() => onOpen(p)}>
          <span className="dish-row__text">
            <b>{p.title}</b>
            <span className="small">c/{p.community} · {plural(p.score, 'vote')} · {timeAgo(p.ts)}</span>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      ))}
    </>
  )
}

const ini = (n: string) => (n.replace(/[._-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2) || n.slice(0, 2)).toUpperCase()

/** The Me tab's community pieces: `card` is the nickname card, `lists` the saved and own posts (hidden while empty). */
export function useMeCommunity(onOpen: (p: PostView) => void, refreshKey: number, enabled = true) {
  const [name, setName] = useState(() => nickname.get())
  const [editing, setEditing] = useState(false)
  const [mine, setMine] = useState<PostView[] | null>(null)
  const [saved, setSaved] = useState<PostView[] | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    setName(nickname.get())
    feed({ mine: true, sort: 'new' }).then((p) => { if (live) setMine(p) }).catch(() => { if (live) setMine([]) })
    feed({ saved: true, sort: 'new' }).then((p) => { if (live) setSaved(p) }).catch(() => { if (live) setSaved([]) })
    return () => { live = false }
  }, [refreshKey, enabled])
  const karma = (mine ?? []).reduce((s, p) => s + p.score, 0)
  const card = (
    <>
      <button className="card me-card" onClick={() => setEditing(true)} aria-label={name ? `Nickname ${name}. Change` : 'Pick a nickname'}>
        <Avatar name={name ?? '?'} initials={name ? ini(name) : '?'} size={52} />
        <span className="me-card__text">
          <b className="me-card__name">{name ?? 'Pick a nickname'}</b>
          <span className="small">{name ? `${plural(mine?.length ?? 0, 'post')} · ${plural(karma, 'vote')}` : 'No account needed'}</span>
        </span>
        <Icon name="edit" size={18} />
      </button>
      {editing && <NicknameSheet onClose={() => setEditing(false)} onDone={(n) => { setName(n); setEditing(false) }} />}
    </>
  )
  const lists = (
    <>
      {saved && saved.length > 0 && <Fold title="Saved" count={saved.length}><MiniList posts={saved} onOpen={onOpen} /></Fold>}
      {mine && mine.length > 0 && <Fold title="Your posts" count={mine.length} defaultOpen><MiniList posts={mine} onOpen={onOpen} /></Fold>}
    </>
  )
  return { card, lists }
}
