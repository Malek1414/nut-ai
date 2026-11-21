// One post with its comments (one level of replies), votes on both, and a comment box pinned to the bottom.
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/ui'
import { track } from '../lib/api'
import { CommunityError, createComment, getPost, nickname, removeOwn, report, timeAgo, vote, type CommentView, type PostView } from '../lib/community'
import { Avatar, CommunityTag, ExampleTag, MoreSheet, NicknameSheet, OrderBlock, VotePill } from './parts'
import { usePostActions } from './usePostActions'

function CommentItem({ c, onVote, onReply, onMore, reply = false }: { c: CommentView; onVote: (c: CommentView, v: -1 | 0 | 1) => void; onReply?: (c: CommentView) => void; onMore: (c: CommentView) => void; reply?: boolean }) {
  return (
    <div className={`cmt ${reply ? 'cmt--reply' : ''}`} id={`c-${c.id}`}>
      <Avatar name={c.nickname} initials={c.initials} size={reply ? 24 : 28} />
      <div className="cmt__main">
        <div className="cmt__head">
          <b>{c.nickname}</b>
          <span className="small">{timeAgo(c.ts)}</span>
          {c.mine && <span className="cmt__you">you</span>}
          {c.example && <ExampleTag />}
        </div>
        <p className="cmt__body">{c.body}</p>
        <div className="cmt__actions">
          <VotePill compact score={c.score} myVote={c.myVote} onVote={(v) => onVote(c, v)} label={`comment by ${c.nickname}`} />
          {onReply && <button type="button" className="pill-btn" onClick={() => onReply(c)}><Icon name="reply" size={16} /> Reply</button>}
          <button type="button" className="pill-btn pill-btn--icon" aria-label="More" onClick={() => onMore(c)}><Icon name="more" size={17} /></button>
        </div>
      </div>
    </div>
  )
}

export function PostDetail({ postId, initial, onBack, onPlace, toast, onGone }: {
  postId: string
  initial: PostView | null
  onBack: () => void
  onPlace: (post: PostView) => void
  toast: (t: string) => void
  onGone: () => void
}) {
  const [post, setPost] = useState<PostView | null>(initial)
  const [comments, setComments] = useState<CommentView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState<CommentView | null>(null)
  const [sending, setSending] = useState(false)
  const [askNick, setAskNick] = useState(false)
  const [moreComment, setMoreComment] = useState<CommentView | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const actions = usePostActions((fn) => setPost((p) => (p ? fn([p])[0] ?? null : p)), toast)

  useEffect(() => {
    let live = true
    getPost(postId)
      .then((r) => { if (live) { setPost(r.post); setComments(r.comments) } })
      .catch((e) => live && setError(e instanceof CommunityError ? e.message : 'Could not load this post.'))
    return () => { live = false }
  }, [postId])

  // A post that vanished (deleted or reported) leaves the page.
  const hadPost = useRef(false)
  useEffect(() => {
    if (post) hadPost.current = true
    else if (hadPost.current) { hadPost.current = false; onGone() }
  }, [post, onGone])

  const patchComment = (id: string, fn: (c: CommentView) => CommentView) =>
    setComments((list) => list?.map((c) => (c.id === id ? fn(c) : { ...c, replies: c.replies.map((r) => (r.id === id ? fn(r) : r)) })) ?? null)
  const dropComment = (id: string) =>
    setComments((list) => list?.filter((c) => c.id !== id).map((c) => ({ ...c, replies: c.replies.filter((r) => r.id !== id) })) ?? null)

  const onVoteComment = async (c: CommentView, v: -1 | 0 | 1) => {
    const before = { score: c.score, myVote: c.myVote }
    patchComment(c.id, (x) => ({ ...x, myVote: v, score: x.score - x.myVote + v }))
    try {
      const r = await vote('comment', c.id, v)
      patchComment(c.id, (x) => ({ ...x, ...r }))
    } catch (e) {
      patchComment(c.id, (x) => ({ ...x, ...before }))
      toast(e instanceof CommunityError ? e.message : 'Could not vote.')
    }
  }

  const send = async () => {
    if (!text.trim() || !post) return
    if (!nickname.get()) { setAskNick(true); return }
    setSending(true)
    try {
      const c = await createComment(post.id, text.trim(), replyTo?.id ?? null)
      setComments((list) => {
        const l = list ?? []
        if (!c.parentId) return [...l, c]
        return l.map((x) => (x.id === c.parentId ? { ...x, replies: [...x.replies, c] } : x))
      })
      setPost((p) => (p ? { ...p, comments: p.comments + 1 } : p))
      setText('')
      setReplyTo(null)
      inputRef.current?.blur()
      track('comment_ui', {})
      window.setTimeout(() => document.getElementById(`c-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
    } catch (e) {
      toast(e instanceof CommunityError ? e.message : 'Could not send the comment.')
    } finally {
      setSending(false)
    }
  }

  const startReply = (c: CommentView) => {
    setReplyTo(c)
    inputRef.current?.focus()
  }

  return (
    <main className="screen post-page">
      <div className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" size={20} /></button>
        {post && <CommunityTag id={post.community} />}
        <span style={{ width: 44 }} />
      </div>

      {error && <div className="state" role="alert"><span className="s-ic"><Icon name="alert" size={28} /></span><p className="body">{error}</p><button className="btn btn-secondary btn-sm" onClick={onBack}>Back to the feed</button></div>}

      {post && (
        <article className="post-full">
          <header className="post-card__head">
            <Avatar name={post.nickname} initials={post.initials} size={32} />
            <span className="post-card__who">
              <b style={{ fontSize: 14 }}>{post.nickname}</b>
              <span className="small">{timeAgo(post.ts)}{post.mine ? ' · you' : ''}</span>
            </span>
            {post.example && <ExampleTag />}
          </header>
          <h1 className="post-full__title">{post.title}</h1>
          {post.kind === 'order' && post.dish && <OrderBlock post={post} {...(post.place ? { onPlace: () => onPlace(post) } : {})} />}
          {post.hasPhoto && <img className="post-card__photo" src={`/api/photo?id=${post.id}`} alt={`Photo of ${post.dish?.name ?? 'the plate'}`} />}
          {post.body && <p className="post-full__body">{post.body}</p>}
          <footer className="post-card__foot">
            <VotePill score={post.score} myVote={post.myVote} onVote={(v) => void actions.onVote(post, v)} label={post.title} />
            <span className="pill-btn" style={{ pointerEvents: 'none' }}><Icon name="comment" size={17} /> <span className="num">{post.comments}</span></span>
            <span className="spacer" />
            <button type="button" className={`pill-btn pill-btn--icon ${post.saved ? 'is-on' : ''}`} aria-pressed={post.saved} aria-label={post.saved ? 'Saved' : 'Save'} onClick={() => void actions.onSave(post)}><Icon name="bookmark" size={17} /></button>
            <button type="button" className="pill-btn pill-btn--icon" aria-label="More" onClick={() => actions.setMore(post)}><Icon name="more" size={18} /></button>
          </footer>
        </article>
      )}

      {post && (
        <section className="cmts" aria-label="Comments">
          <h2 className="h3" style={{ margin: '8px 0 4px' }}>{post.comments === 1 ? '1 comment' : `${post.comments} comments`}</h2>
          {comments === null && !error && <div className="stack-12" style={{ marginTop: 12 }}>{[0, 1].map((i) => <span key={i} className="skeleton" style={{ height: 56 }} />)}</div>}
          {comments && comments.length === 0 && <p className="body" style={{ padding: '12px 0' }}>No comments yet. Start the conversation.</p>}
          {comments?.map((c) => (
            <div key={c.id} className="cmt-thread">
              <CommentItem c={c} onVote={onVoteComment} onReply={startReply} onMore={setMoreComment} />
              {c.replies.map((r) => <CommentItem key={r.id} c={r} reply onVote={onVoteComment} onReply={() => startReply(c)} onMore={setMoreComment} />)}
            </div>
          ))}
        </section>
      )}

      {post && (
        <div className="composer">
          {replyTo && (
            <div className="composer__reply">
              <span>Replying to <b>{replyTo.nickname}</b></span>
              <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><Icon name="close" size={16} /></button>
            </div>
          )}
          <div className="composer__row">
            <textarea
              ref={inputRef}
              className="composer__input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={replyTo ? 'Write a reply' : 'Add a comment'}
              rows={1}
              maxLength={1000}
              aria-label={replyTo ? 'Reply' : 'Comment'}
            />
            <button type="button" className="composer__send" disabled={!text.trim() || sending} onClick={() => void send()} aria-label="Send">
              {sending ? <span className="attach__spin" /> : <Icon name="send" size={20} strokeWidth={2} />}
            </button>
          </div>
        </div>
      )}

      {askNick && <NicknameSheet onClose={() => setAskNick(false)} onDone={() => { setAskNick(false); void send() }} />}

      {actions.more && (
        <MoreSheet
          kind="post"
          mine={actions.more.mine}
          onClose={() => actions.setMore(null)}
          onReport={(r) => void actions.onReport(actions.more!, r)}
          onDelete={() => void actions.onDelete(actions.more!)}
        />
      )}
      {moreComment && (
        <MoreSheet
          kind="comment"
          mine={moreComment.mine}
          onClose={() => setMoreComment(null)}
          onReport={async (reason) => {
            const c = moreComment
            setMoreComment(null)
            dropComment(c.id)
            try { await report('comment', c.id, reason); toast('Thanks. You will not see this comment again.') } catch (e) { toast(e instanceof CommunityError ? e.message : 'Could not send the report.') }
          }}
          onDelete={async () => {
            const c = moreComment
            setMoreComment(null)
            try { await removeOwn('comment', c.id); dropComment(c.id); setPost((p) => (p ? { ...p, comments: Math.max(0, p.comments - 1) } : p)); toast('Comment deleted.') } catch { toast('Could not delete.') }
          }}
        />
      )}
    </main>
  )
}
