// Building blocks of the community: avatars, the vote pill, post cards and the small sheets.
import { useState } from 'react'
import { DeliveryBadge } from '../components/Delivery'
import { Icon, Sheet } from '../components/ui'
import { PROVIDERS } from '../lib/delivery'
import { communityOf, compactScore, nickname as nick, timeAgo, validNickname, type PostView } from '../lib/community'
import { kcalRange } from '../lib/format'

const AVATAR = ['#1e6b4e', '#3b63d6', '#c8456b', '#d98b16', '#6553cf', '#0f7a8a', '#8a5a14']

export function Avatar({ name, initials, size = 32 }: { name: string; initials: string; size?: number }) {
  let h = 0
  for (const ch of name) h = (h * 33 + ch.charCodeAt(0)) >>> 0
  const bg = AVATAR[h % AVATAR.length]!
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(145deg, color-mix(in srgb, ${bg} 82%, white), ${bg})` }} aria-hidden="true">
      {initials}
    </span>
  )
}

export function ExampleTag() {
  return <span className="example-badge" title="An example post written to show how the community works. Not counted anywhere.">Example</span>
}

/** Reddit-style vote pill. Optimistic: the parent updates the score at once and rolls back on error. */
export function VotePill({ score, myVote, onVote, compact = false, label }: { score: number; myVote: -1 | 0 | 1; onVote: (v: -1 | 0 | 1) => void; compact?: boolean; label: string }) {
  return (
    <span className={`vote ${myVote === 1 ? 'is-up' : myVote === -1 ? 'is-down' : ''} ${compact ? 'vote--compact' : ''}`} role="group" aria-label={`Votes for ${label}`}>
      <button type="button" className="vote__btn vote__btn--up" aria-pressed={myVote === 1} aria-label="Upvote" onClick={(e) => { e.stopPropagation(); onVote(myVote === 1 ? 0 : 1) }}>
        <Icon name="up" size={compact ? 16 : 18} strokeWidth={1.8} />
      </button>
      <span className="vote__score num" aria-live="polite">{compactScore(score)}</span>
      <button type="button" className="vote__btn vote__btn--down" aria-pressed={myVote === -1} aria-label="Downvote" onClick={(e) => { e.stopPropagation(); onVote(myVote === -1 ? 0 : -1) }}>
        <Icon name="down" size={compact ? 16 : 18} strokeWidth={1.8} />
      </button>
    </span>
  )
}

export function CommunityTag({ id }: { id: string }) {
  const c = communityOf(id)
  return (
    <span className="c-tag">
      <span className="c-tag__ic" style={{ background: c.tint, color: c.ink }}><Icon name={c.icon} size={12} strokeWidth={2.2} /></span>
      c/{c.id}
    </span>
  )
}

/** The dish block inside a best-order post: the Snapmenu range bar in small. */
export function OrderBlock({ post, onPlace }: { post: PostView; onPlace?: () => void }) {
  const d = post.dish!
  const max = 1500
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`
  return (
    <div className="order">
      <div className="order__top">
        <b className="order__dish">{d.name}</b>
        {d.price && <span className="order__price">{d.price}</span>}
      </div>
      {(post.place || post.via || post.delivery) && (
        <div className="order__dl">
          {post.place && (
            onPlace
              ? <button type="button" className="order__place" onClick={(e) => { e.stopPropagation(); onPlace() }}><Icon name="pin" size={14} /> {post.place.name}</button>
              : <span className="order__place"><Icon name="pin" size={14} /> {post.place.name}</span>
          )}
          {post.via && <span className="via-tag"><i className="dl-dot" style={{ background: PROVIDERS.find((p) => p.id === post.via)!.color }} aria-hidden="true" />via {PROVIDERS.find((p) => p.id === post.via)!.label}</span>}
          {post.delivery && !post.via && <DeliveryBadge level={post.delivery.level} label={post.delivery.label} size="sm" />}
        </div>
      )}
      <div className="order__nums">
        <span className="order__kcal num">{kcalRange({ low: d.kcalLow, high: d.kcalHigh })}<small>kcal</small></span>
        <span className="order__protein num">{d.protein}<small>g protein</small></span>
      </div>
      <span className="order__track" aria-hidden="true"><i style={{ left: pct(d.kcalLow), width: `calc(${pct(d.kcalHigh)} - ${pct(d.kcalLow)})` }} /></span>
    </div>
  )
}

export function PostCard({ post, onOpen, onVote, onSave, onMore, onPlace }: {
  post: PostView
  onOpen: () => void
  onVote: (v: -1 | 0 | 1) => void
  onSave: () => void
  onMore: () => void
  onPlace?: () => void
}) {
  return (
    <article className="post-card" onClick={onOpen}>
      <header className="post-card__head">
        <Avatar name={post.nickname} initials={post.initials} size={24} />
        <span className="post-card__who">
          <b>{post.nickname}</b>
          <span className="small">c/{post.community} · {timeAgo(post.ts)}</span>
        </span>
        {post.example && <ExampleTag />}
      </header>
      <h3 className="post-card__title">
        <a href={`#post-${post.id}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpen() }}>{post.title}</a>
      </h3>
      {post.kind === 'order' && post.dish && <OrderBlock post={post} {...(onPlace ? { onPlace } : {})} />}
      {post.kind !== 'order' && post.place && post.delivery && (
        <div className="post-card__dl"><span className="small"><Icon name="pin" size={13} /> {post.place.name}</span><DeliveryBadge level={post.delivery.level} label={post.delivery.label} size="sm" /></div>
      )}
      {post.hasPhoto && <img className="post-card__photo" src={`/api/photo?id=${post.id}`} alt={`Photo of ${post.dish?.name ?? 'the plate'}`} loading="lazy" />}
      {post.body && <p className="post-card__body">{post.body}</p>}
      <footer className="post-card__foot">
        <VotePill score={post.score} myVote={post.myVote} onVote={onVote} label={post.title} />
        <button type="button" className="pill-btn" onClick={(e) => { e.stopPropagation(); onOpen() }} aria-label={`${post.comments} comments`}>
          <Icon name="comment" size={17} /> <span className="num">{post.comments}</span>
        </button>
        <span className="spacer" />
        <button type="button" className={`pill-btn pill-btn--icon ${post.saved ? 'is-on' : ''}`} aria-pressed={post.saved} aria-label={post.saved ? 'Saved' : 'Save'} onClick={(e) => { e.stopPropagation(); onSave() }}>
          <Icon name="bookmark" size={17} />
        </button>
        <button type="button" className="pill-btn pill-btn--icon" aria-label="More" onClick={(e) => { e.stopPropagation(); onMore() }}>
          <Icon name="more" size={18} />
        </button>
      </footer>
    </article>
  )
}

export function PostSkeleton() {
  return (
    <div className="post-card" aria-hidden="true">
      <div className="row" style={{ gap: 10 }}><span className="skeleton" style={{ width: 28, height: 28, borderRadius: 999 }} /><span className="skeleton" style={{ width: 140, height: 12 }} /></div>
      <span className="skeleton" style={{ height: 18, width: '85%', marginTop: 14 }} />
      <span className="skeleton" style={{ height: 18, width: '55%', marginTop: 8 }} />
      <span className="skeleton" style={{ height: 34, width: 160, marginTop: 16, borderRadius: 999 }} />
    </div>
  )
}

const REASONS = ['Spam', 'Rude or hateful', 'Personal information', 'Misleading numbers', 'Something else']

/** "More" menu for a post or comment: report someone else's, delete your own. */
export function MoreSheet({ kind, mine, onClose, onReport, onDelete }: { kind: 'post' | 'comment'; mine: boolean; onClose: () => void; onReport: (reason: string) => void; onDelete: () => void }) {
  const [reason, setReason] = useState<string | null>(null)
  if (mine) {
    return (
      <Sheet label={`Your ${kind}`} onClose={onClose}>
        <h2 className="h2">Delete this {kind}?</h2>
        <p className="body" style={{ margin: '4px 0 16px' }}>This cannot be undone.</p>
        <div className="stack-8">
          <button className="btn btn-secondary" style={{ color: 'var(--alert)' }} onClick={onDelete}><Icon name="trash" size={18} /> Delete</button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </Sheet>
    )
  }
  return (
    <Sheet label={`Report this ${kind}`} onClose={onClose}>
      <h2 className="h2">Report this {kind}</h2>
      <div className="stack-8" role="radiogroup" aria-label="Reason" style={{ marginTop: 16 }}>
        {REASONS.map((r) => (
          <button key={r} className="option option--sm" role="radio" aria-checked={reason === r} onClick={() => setReason(r)}>
            <span className="o-title">{r}</span>
            <span className="o-check"><Icon name="check" size={14} strokeWidth={2.5} /></span>
          </button>
        ))}
      </div>
      <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={!reason} onClick={() => reason && onReport(reason)}>Report</button>
    </Sheet>
  )
}

/** First post or comment: pick a nickname. No account, no email. */
export function NicknameSheet({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const [value, setValue] = useState(() => nick.get() ?? nick.suggest())
  const ok = validNickname(value)
  return (
    <Sheet label="Pick a nickname" onClose={onClose}>
      <h2 className="h2">Pick a nickname</h2>
      <p className="body" style={{ margin: '4px 0 16px' }}>No account, no email.</p>
      <div className="nick-field">
        <Avatar name={value || '?'} initials={(value.replace(/[._-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2) || '?').toUpperCase()} size={44} />
        <input
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\s/g, ''))}
          maxLength={24}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Nickname"
          aria-invalid={!ok}
        />
        <button className="icon-btn" type="button" aria-label="Suggest another" onClick={() => setValue(nick.suggest())}><Icon name="refresh" size={18} /></button>
      </div>
      {!ok && <p className="small" role="alert" style={{ marginTop: 8, color: 'var(--alert)' }}>2 to 24 letters or numbers, no spaces.</p>}
      <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={!ok} onClick={() => { nick.set(value); onDone(value) }}>Continue</button>
    </Sheet>
  )
}
