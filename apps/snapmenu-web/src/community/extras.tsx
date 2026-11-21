// Community pieces that live on other tabs: posts in a restaurant sheet, the post prompt after a scan,
// and the Me tab's nickname, own posts and saved posts.
import { useEffect, useState } from 'react'
import type { Place } from '../../../snapmenu-api/src/types'
import { Icon } from '../components/ui'
import { feed, nickname, plural, timeAgo, type PostView } from '../lib/community'
import { Avatar, CommunityTag, ExampleTag, NicknameSheet } from './parts'

export function PlacePosts({ place, onOpen }: { place: Place; onOpen: (p: PostView) => void }) {
  const [posts, setPosts] = useState<PostView[] | null>(null)
  useEffect(() => {
    let live = true
    feed({ place: place.id, sort: 'top' }).then((p) => live && setPosts(p)).catch(() => live && setPosts([]))
    return () => { live = false }
  }, [place.id])
  if (!posts || posts.length === 0) return null
  return (
    <>
      <div className="section-title" style={{ margin: '20px 0 10px' }}><h3 className="h3">Posts about it</h3><span className="small">{posts.length}</span></div>
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
    <div className="post-prompt">
      <span className="me-ic"><Icon name="users" size={20} /></span>
      <span>
        <b>Tell people what to order</b>
        <span className="small">Share your best order with the community.</span>
      </span>
      <button className="btn btn-primary btn-sm" onClick={onPost}>Post</button>
    </div>
  )
}

function MiniList({ posts, empty, onOpen }: { posts: PostView[] | null; empty: string; onOpen: (p: PostView) => void }) {
  if (posts === null) return <div className="card-flat" style={{ padding: 16 }}><span className="skeleton" style={{ display: 'block', height: 16, width: '70%' }} /></div>
  if (posts.length === 0) return <p className="small" style={{ padding: '4px 4px 0' }}>{empty}</p>
  return (
    <div className="card-flat list-card">
      {posts.slice(0, 8).map((p) => (
        <button key={p.id} type="button" className="dish-row" onClick={() => onOpen(p)}>
          <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
            <b style={{ fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</b>
            <span className="small">c/{p.community} · {plural(p.score, 'vote')} · {plural(p.comments, 'comment')} · {timeAgo(p.ts)}</span>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      ))}
    </div>
  )
}

export function MeCommunity({ onOpen, refreshKey }: { onOpen: (p: PostView) => void; refreshKey: number }) {
  const [name, setName] = useState(() => nickname.get())
  const [editing, setEditing] = useState(false)
  const [mine, setMine] = useState<PostView[] | null>(null)
  const [saved, setSaved] = useState<PostView[] | null>(null)
  useEffect(() => {
    feed({ mine: true, sort: 'new' }).then(setMine).catch(() => setMine([]))
    feed({ saved: true, sort: 'new' }).then(setSaved).catch(() => setSaved([]))
  }, [refreshKey])
  const ini = (n: string) => (n.replace(/[._-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2) || n.slice(0, 2)).toUpperCase()
  const karma = (mine ?? []).reduce((s, p) => s + p.score, 0)
  return (
    <>
      <div className="card me-card">
        <Avatar name={name ?? '?'} initials={name ? ini(name) : '?'} size={56} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <b className="me-card__name">{name ?? 'No nickname yet'}</b>
          <span className="small">{name ? `${plural(mine?.length ?? 0, 'post')} · ${plural(karma, 'vote')} received` : 'Pick one when you first post or comment.'}</span>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>{name ? 'Change' : 'Pick'}</button>
      </div>
      <div className="section-title"><h2 className="h3">Saved posts</h2><span className="small">{saved?.length ?? ''}</span></div>
      <MiniList posts={saved} empty="Tap the bookmark on a post to keep it here." onOpen={onOpen} />
      <div className="section-title"><h2 className="h3">Your posts</h2><span className="small">{mine?.length ?? ''}</span></div>
      <MiniList posts={mine} empty="After a scan, share your best order. It helps the next person at that restaurant." onOpen={onOpen} />
      {editing && <NicknameSheet onClose={() => setEditing(false)} onDone={(n) => { setName(n); setEditing(false) }} />}
    </>
  )
}
