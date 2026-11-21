// Shared post actions for the feed, post page, Me tab and restaurant sheet: optimistic votes and saves,
// report and delete, each rolled back with a toast when the server says no.
import { useCallback, useState } from 'react'
import { track } from '../lib/api'
import { CommunityError, removeOwn, report, savePost, vote, type PostView } from '../lib/community'

export function usePostActions(setPosts: (fn: (p: PostView[]) => PostView[]) => void, toast: (t: string) => void) {
  const [more, setMore] = useState<PostView | null>(null)

  const patch = useCallback((id: string, fn: (p: PostView) => PostView) => setPosts((list) => list.map((p) => (p.id === id ? fn(p) : p))), [setPosts])

  const onVote = useCallback(async (post: PostView, value: -1 | 0 | 1) => {
    const before = { score: post.score, myVote: post.myVote }
    patch(post.id, (p) => ({ ...p, myVote: value, score: p.score - p.myVote + value }))
    try {
      const r = await vote('post', post.id, value)
      patch(post.id, (p) => ({ ...p, score: r.score, myVote: r.myVote }))
    } catch (e) {
      patch(post.id, (p) => ({ ...p, ...before }))
      toast(e instanceof CommunityError ? e.message : 'Could not vote.')
    }
  }, [patch, toast])

  const onSave = useCallback(async (post: PostView) => {
    const on = !post.saved
    patch(post.id, (p) => ({ ...p, saved: on }))
    try {
      await savePost(post.id, on)
      toast(on ? 'Saved. Find it under Me.' : 'Removed from saved.')
    } catch (e) {
      patch(post.id, (p) => ({ ...p, saved: !on }))
      toast(e instanceof CommunityError ? e.message : 'Could not save.')
    }
  }, [patch, toast])

  const onReport = useCallback(async (post: PostView, reason: string) => {
    setMore(null)
    setPosts((list) => list.filter((p) => p.id !== post.id))
    try {
      await report('post', post.id, reason)
      toast('Thanks. You will not see this post again.')
      track('report', { kind: 'post' })
    } catch (e) {
      toast(e instanceof CommunityError ? e.message : 'Could not send the report.')
    }
  }, [setPosts, toast])

  const onDelete = useCallback(async (post: PostView) => {
    setMore(null)
    try {
      await removeOwn('post', post.id)
      setPosts((list) => list.filter((p) => p.id !== post.id))
      toast('Post deleted.')
    } catch (e) {
      toast(e instanceof CommunityError ? e.message : 'Could not delete.')
    }
  }, [setPosts, toast])

  return { more, setMore, onVote, onSave, onReport, onDelete }
}
