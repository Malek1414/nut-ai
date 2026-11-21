import { useEffect, useState } from 'react'
import { Footer, Wordmark } from '../components/ui'
import { n0 } from '../lib/format'

interface NumbersData {
  scans: number; people: number; visitors: number; dishesRead: number; dishesRecommended: number; shareTaps: number; corrections: number
  menuLanguages: Array<{ v: string | null; c: number }>; userLanguages: Array<{ v: string | null; c: number }>; cuisines: Array<{ v: string | null; c: number }>
  excludedTeamScans: number; generatedAt: string
  community?: { posts: number; comments: number; votes: number; activePosters: number; scansOnMap: number }
  delivery?: { clicks: number; byProvider: Array<{ v: string | null; c: number }>; votes: number }
  voice?: { chatMessages: number; voiceMessages: number; people: number }
}

export function Numbers() {
  const [data, setData] = useState<NumbersData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    const load = () => fetch('/api/numbers').then((r) => r.json()).then((d) => live && setData(d as NumbersData)).catch(() => live && setErr('Could not load the numbers.'))
    load()
    const id = setInterval(load, 15000)
    return () => { live = false; clearInterval(id) }
  }, [])

  const stat = (label: string, v: number | undefined) => (
    <div className="card-flat stat"><b>{v == null ? '–' : n0(v)}</b><span className="small">{label}</span></div>
  )
  const list = (title: string, rows: NumbersData['menuLanguages'] | undefined) => (
    <div className="card-flat" style={{ padding: 16 }}>
      <p className="eyebrow" style={{ marginBottom: 8 }}>{title}</p>
      {(rows ?? []).filter((r) => r.v).length === 0 ? <p className="small">None yet</p> :
        (rows ?? []).filter((r) => r.v).map((r) => (
          <div key={r.v} className="row" style={{ justifyContent: 'space-between', padding: '4px 0' }}><span className="body">{r.v}</span><b className="num">{r.c}</b></div>
        ))}
    </div>
  )

  return (
    <main className="screen">
      <div className="topbar"><Wordmark onClick={() => { window.location.href = '/' }} /></div>
      <header className="results-head">
        <h1 className="h1">Live numbers</h1>
        <p className="body">Updates every 15 s · team devices excluded{data ? ` (${data.excludedTeamScans} scans)` : ''}</p>
      </header>
      {err && <p className="body" role="alert">{err}</p>}
      <div className="stat-grid">
        {stat('menus scanned', data?.scans)}
        {stat('people who scanned', data?.people)}
        {stat('dishes read', data?.dishesRead)}
        {stat('dishes recommended', data?.dishesRecommended)}
        {stat('share taps', data?.shareTaps)}
        {stat('corrections sent', data?.corrections)}
      </div>
      <div className="section-title"><h2 className="h3">Community</h2><span className="small">examples excluded</span></div>
      <div className="stat-grid">
        {stat('posts', data?.community?.posts)}
        {stat('comments', data?.community?.comments)}
        {stat('votes', data?.community?.votes)}
        {stat('active posters', data?.community?.activePosters)}
        {stat('scans on the map', data?.community?.scansOnMap)}
      </div>
      <div className="section-title"><h2 className="h3">Menu chat</h2></div>
      <div className="stat-grid">
        {stat('chat messages', data?.voice?.chatMessages)}
        {stat('voice messages', data?.voice?.voiceMessages)}
        {stat('people who asked', data?.voice?.people)}
      </div>
      <div className="section-title"><h2 className="h3">Delivery</h2></div>
      <div className="stat-grid">
        {stat('order taps', data?.delivery?.clicks)}
        {stat('“Delivers?” answers', data?.delivery?.votes)}
      </div>
      <div className="stack-12" style={{ marginTop: 16 }}>
        {list('Order taps by app', data?.delivery?.byProvider.map((r) => ({ v: r.v === 'wolt' ? 'Wolt' : r.v === 'lieferando' ? 'Lieferando' : r.v === 'ubereats' ? 'Uber Eats' : r.v, c: r.c })))}
      </div>
      <div className="stack-12" style={{ marginTop: 16 }}>
        {list('Menu languages', data?.menuLanguages)}
        {list('User languages', data?.userLanguages)}
        {list('Cuisines', data?.cuisines)}
      </div>
      <Footer />
    </main>
  )
}
