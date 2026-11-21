import { beforeEach, describe, expect, it } from 'vitest'
import { checkNickname, checkText, hotScore, initials, kiezFor, REPORT_HIDE_AT, shouldHide, voteDelta } from '../src/community.js'
import * as c from '../src/community-api.js'
import { PLACES_SCHEMA } from '../src/places.js'
import { seedCommunitySql } from '../src/seed.js'
import { memoryD1 } from './d1-shim.js'

const H = 3_600_000

describe('hotScore (Reddit hot)', () => {
  const now = Date.UTC(2026, 10, 21, 12)
  it('ranks more votes higher at the same age', () => {
    expect(hotScore(50, 0, now)).toBeGreaterThan(hotScore(5, 0, now))
  })
  it('lets a fresh post beat an older one with the same score', () => {
    expect(hotScore(10, 0, now)).toBeGreaterThan(hotScore(10, 0, now - 6 * H))
  })
  it('weighs 12.5 hours of age like 10x the votes', () => {
    expect(hotScore(100, 0, now - 12.5 * H)).toBeCloseTo(hotScore(10, 0, now), 5)
  })
  it('pushes net-negative posts down', () => {
    expect(hotScore(1, 5, now)).toBeLessThan(hotScore(1, 1, now))
    expect(hotScore(1, 1, now)).toBeLessThan(hotScore(2, 0, now))
  })
  it('decays: a 1-vote post from now beats a 20-vote post from 2 days ago', () => {
    expect(hotScore(1, 0, now)).toBeGreaterThan(hotScore(20, 0, now - 48 * H))
  })
})

describe('voteDelta', () => {
  it('covers every transition', () => {
    expect(voteDelta(0, 1)).toEqual({ ups: 1, downs: 0 })
    expect(voteDelta(0, -1)).toEqual({ ups: 0, downs: 1 })
    expect(voteDelta(1, -1)).toEqual({ ups: -1, downs: 1 })
    expect(voteDelta(-1, 1)).toEqual({ ups: 1, downs: -1 })
    expect(voteDelta(1, 0)).toEqual({ ups: -1, downs: 0 })
    expect(voteDelta(-1, 0)).toEqual({ ups: 0, downs: -1 })
    expect(voteDelta(1, 1)).toEqual({ ups: 0, downs: 0 })
  })
})

describe('text safety', () => {
  it('blocks slurs and insults, also in disguise', () => {
    expect(checkText('you are a f*cking idiot', 'comment', 1, 500).ok).toBe(false)
    expect(checkText('Der Koch ist ein Arschl0ch', 'comment', 1, 500).ok).toBe(false)
  })
  it('lets normal food talk through', () => {
    for (const t of ['Spicy tofu with extra shiitake', 'Fagottini al tartufo were great', 'Raps oil, grapes and a big salad', 'Best lunch under 12 EUR?']) {
      expect(checkText(t, 'comment', 1, 500)).toMatchObject({ ok: true })
    }
  })
  it('keeps personal data and links out', () => {
    expect(checkText('mail me at lena@example.com', 'comment', 1, 500)).toMatchObject({ ok: false, code: 'personal_data' })
    expect(checkText('call +49 170 1234567', 'comment', 1, 500)).toMatchObject({ ok: false, code: 'personal_data' })
    expect(checkText('see www.example.com', 'comment', 1, 500)).toMatchObject({ ok: false, code: 'no_links' })
    expect(checkText('Ate 2 plates for 12,50 € at 13:30', 'comment', 1, 500).ok).toBe(true)
  })
  it('checks lengths and nicknames', () => {
    expect(checkText('  ', 'comment', 1, 500).ok).toBe(false)
    expect(checkText('x'.repeat(501), 'comment', 1, 500).ok).toBe(false)
    expect(checkNickname('lena.lifts').ok).toBe(true)
    expect(checkNickname('two words').ok).toBe(false)
    expect(checkNickname('a').ok).toBe(false)
  })
  it('makes initials for avatars', () => {
    expect(initials('lena.lifts')).toBe('LL')
    expect(initials('HungryOtter')).toBe('HO')
    expect(initials('sam')).toBe('SA')
  })
  it('suggests a Kiez from a position', () => {
    expect(kiezFor(52.4990, 13.4180)).toBe('Kreuzberg')
    expect(kiezFor(52.5236, 13.4031)).toBe('Mitte')
    expect(kiezFor(48.137, 11.575)).toBeNull()
  })
})

describe('community API on SQLite', () => {
  let db: ReturnType<typeof memoryD1>
  const A = { device: 'device-aaaa-1', team: false }
  const B = { device: 'device-bbbb-2', team: false }
  const C = { device: 'device-cccc-3', team: false }
  const D = { device: 'device-dddd-4', team: false }
  const url = (q: string) => new URL(`http://x/api/feed?${q}`)

  beforeEach(async () => {
    db = memoryD1()
    for (const sql of [...PLACES_SCHEMA, ...c.COMMUNITY_SCHEMA, ...seedCommunitySql(Date.now())]) await db.prepare(sql).run()
  })

  const post = async (v = A, extra: Record<string, unknown> = {}) => {
    const out = await c.createPost(db, { nickname: 'lena.lifts', community: 'HighProtein', kind: 'text', title: 'Best protein lunch near Kotti?', body: 'Under 12 EUR please', ...extra }, v)
    if (!out.ok) throw new Error(out.message)
    return out.data
  }

  it('creates a post with the author upvote, shows it under New, keeps examples labelled', async () => {
    const p = await post()
    expect(p).toMatchObject({ score: 1, myVote: 1, mine: true, example: false, initials: 'LL' })
    const fresh = await c.listPosts(db, url('sort=new'), B)
    expect(fresh[0]!.id).toBe(p.id)
    expect(fresh[0]!.mine).toBe(false)
    expect(fresh.filter((x) => x.example).length).toBe(9)
  })

  it('orders Top by score and Hot by score with time decay', async () => {
    const top = await c.listPosts(db, url('sort=top'), A)
    expect(top.map((x) => x.score)).toEqual([...top.map((x) => x.score)].sort((a, b) => b - a))
    const hot = await c.listPosts(db, url('sort=hot'), A)
    expect(hot[0]!.id).toBe('ex-post-1')
  })

  it('counts votes once per device and lets them change', async () => {
    const p = await post()
    expect(await c.vote(db, { kind: 'post', id: p.id, value: 1 }, B)).toMatchObject({ ok: true, data: { score: 2, myVote: 1 } })
    expect(await c.vote(db, { kind: 'post', id: p.id, value: 1 }, B)).toMatchObject({ ok: true, data: { score: 2 } })
    expect(await c.vote(db, { kind: 'post', id: p.id, value: -1 }, B)).toMatchObject({ ok: true, data: { score: 0, myVote: -1 } })
    expect(await c.vote(db, { kind: 'post', id: p.id, value: 0 }, B)).toMatchObject({ ok: true, data: { score: 1, myVote: 0 } })
    expect(await c.vote(db, { kind: 'post', id: p.id, value: 2 }, B)).toMatchObject({ ok: false })
  })

  it('moves a post up the Hot feed when it gets votes', async () => {
    const before = (await c.listPosts(db, url('sort=hot'), A)).findIndex((x) => x.id === 'ex-post-6')
    for (let i = 0; i < 200; i++) await c.vote(db, { kind: 'post', id: 'ex-post-6', value: 1 }, { device: `voter-device-${i}`, team: false })
    const after = (await c.listPosts(db, url('sort=hot'), A)).findIndex((x) => x.id === 'ex-post-6')
    expect(after).toBeLessThan(before)
  })

  it('hides a post after 3 different devices report it, not before', async () => {
    const p = await post()
    expect(await c.report(db, { kind: 'post', id: p.id }, A)).toMatchObject({ ok: false, code: 'own' })
    expect(await c.report(db, { kind: 'post', id: p.id }, B)).toMatchObject({ ok: true, data: { hidden: false, reports: 1 } })
    expect(await c.report(db, { kind: 'post', id: p.id }, B)).toMatchObject({ ok: true, data: { hidden: false, reports: 1 } })
    // The reporter stops seeing it at once; everyone else still does.
    expect((await c.listPosts(db, url('sort=new'), B)).some((x) => x.id === p.id)).toBe(false)
    expect((await c.listPosts(db, url('sort=new'), D)).some((x) => x.id === p.id)).toBe(true)
    await c.report(db, { kind: 'post', id: p.id }, C)
    expect(await c.report(db, { kind: 'post', id: p.id }, D)).toMatchObject({ ok: true, data: { hidden: true, reports: REPORT_HIDE_AT } })
    expect((await c.listPosts(db, url('sort=new'), { device: 'device-other-9', team: false })).some((x) => x.id === p.id)).toBe(false)
    expect((await c.getPost(db, p.id, A)).ok).toBe(false)
    expect(shouldHide(2)).toBe(false)
  })

  it('threads comments one level deep and hides reported comments', async () => {
    const p = await post()
    const top = await c.createComment(db, { postId: p.id, body: 'Try the shawarma plate', nickname: 'ana.eats' }, B)
    if (!top.ok) throw new Error(top.message)
    const reply = await c.createComment(db, { postId: p.id, parentId: top.data.id, body: 'Agreed', nickname: 'lena.lifts' }, A)
    if (!reply.ok) throw new Error(reply.message)
    const deep = await c.createComment(db, { postId: p.id, parentId: reply.data.id, body: 'Me too', nickname: 'tom' }, C)
    if (!deep.ok) throw new Error(deep.message)
    expect(deep.data.parentId).toBe(top.data.id)
    let full = await c.getPost(db, p.id, D)
    if (!full.ok) throw new Error()
    expect(full.data.post.comments).toBe(3)
    expect(full.data.comments).toHaveLength(1)
    expect(full.data.comments[0]!.replies.map((r) => r.body)).toEqual(['Agreed', 'Me too'])
    for (const v of [A, C, D]) await c.report(db, { kind: 'comment', id: top.data.id }, v)
    full = await c.getPost(db, p.id, { device: 'device-other-9', team: false })
    if (!full.ok) throw new Error()
    expect(full.data.comments).toHaveLength(0)
  })

  it('saves posts per device', async () => {
    await c.save(db, { postId: 'ex-post-3' }, A)
    expect((await c.listPosts(db, url('saved=1'), A)).map((x) => x.id)).toEqual(['ex-post-3'])
    expect(await c.listPosts(db, url('saved=1'), B)).toEqual([])
    await c.save(db, { postId: 'ex-post-3', on: false }, A)
    expect(await c.listPosts(db, url('saved=1'), A)).toEqual([])
  })

  it('rejects bad words, links and spam bursts', async () => {
    expect(await c.createPost(db, { nickname: 'lena', community: 'Mitte', kind: 'text', title: 'This place is shit honestly' }, A)).toMatchObject({ ok: false, code: 'blocked_word' })
    expect(await c.createPost(db, { nickname: 'lena', community: 'Nope', kind: 'text', title: 'Valid title here' }, A)).toMatchObject({ ok: false, code: 'bad_community' })
    for (let i = 0; i < 5; i++) await post(B, { title: `Lunch question number ${i}` })
    expect(await c.createPost(db, { nickname: 'lena', community: 'Mitte', kind: 'text', title: 'One more lunch question' }, B)).toMatchObject({ ok: false, code: 'rate_limited' })
  })

  it('needs the dish numbers for a best-order post and files it under the restaurant', async () => {
    expect(await c.createPost(db, { nickname: 'lena', community: 'HighProtein', kind: 'order', title: 'Great plate at the corner' }, A)).toMatchObject({ ok: false, code: 'bad_dish' })
    const p = await post(A, { kind: 'order', place: { id: 'n975312181', name: 'Mustafa', lat: 52.52, lng: 13.4 }, dish: { name: 'Döner Teller', kcalLow: 520, kcalHigh: 720, protein: 44, price: '11,00 €' } })
    expect(p.dish).toMatchObject({ name: 'Döner Teller', protein: 44 })
    expect((await c.listPosts(db, url('place=n975312181'), A)).map((x) => x.id)).toContain(p.id)
  })

  it('leaves examples, team devices and self-votes out of the numbers', async () => {
    const p = await post(A)
    await post({ device: 'team-device-01', team: true }, { title: 'Team test post here' })
    await c.vote(db, { kind: 'post', id: p.id, value: 1 }, B)
    await c.vote(db, { kind: 'post', id: 'ex-post-1', value: 1 }, B)
    await c.createComment(db, { postId: p.id, body: 'Nice', nickname: 'ana' }, C)
    expect(await c.communityNumbers(db)).toMatchObject({ posts: 1, comments: 1, votes: 2, activePosters: 2 })
  })
})
