import { useCallback, useEffect, useRef, useState } from 'react'
import type { DishEstimate, MenuResult, Profile } from '../../snapmenu-api/src/types'
import { Icon, Toast } from './components/ui'
import { ApiError, scanMenu, track } from './lib/api'
import { GOAL_LABEL } from './lib/format'
import { compressImage } from './lib/image'
import { renderShareCard, shareCard } from './lib/share'
import { store } from './lib/storage'
import { Capture } from './screens/Capture'
import { DishDetail } from './screens/DishDetail'
import { Interview } from './screens/Interview'
import { Landing } from './screens/Landing'
import { Numbers } from './screens/Numbers'
import { Results } from './screens/Results'
import { Scanning } from './screens/Scanning'

type Screen = 'landing' | 'interview' | 'capture' | 'scanning' | 'results' | 'dish' | 'error'

interface Failure { title: string; body: string; icon: string; retry: boolean }

function describe(e: unknown): Failure {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'offline': return { title: 'You are offline', body: 'Snapmenu needs a connection to read the menu. Check your Wi-Fi or mobile data, then try again.', icon: 'wifiOff', retry: true }
      case 'not_menu': return { title: 'We could not find a menu', body: e.message, icon: 'focus', retry: false }
      case 'no_key':
      case 'auth': return { title: 'The menu reader is not set up', body: `${e.message} No results were made up.`, icon: 'key', retry: false }
      case 'rate_limited': return { title: 'Busy right now', body: e.message, icon: 'info', retry: true }
      case 'too_big': return { title: 'Photo too large', body: e.message, icon: 'image', retry: false }
      default: return { title: 'Reading the menu failed', body: e.message, icon: 'alert', retry: true }
    }
  }
  return { title: 'Something went wrong', body: 'Try again, or choose a different photo.', icon: 'alert', retry: true }
}

export function App() {
  const isNumbers = typeof window !== 'undefined' && window.location.pathname.replace(/\/$/, '') === '/numbers'
  const [profile, setProfile] = useState<Profile | null>(() => store.profile())
  const [screen, setScreenState] = useState<Screen>('landing')
  const [photo, setPhoto] = useState<string | null>(null)
  const [result, setResult] = useState<MenuResult | null>(() => store.lastResult() as MenuResult | null)
  const [dishId, setDishId] = useState<string | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  // Phone back button walks back through screens.
  const go = useCallback((s: Screen, replace = false) => {
    setScreenState(s)
    try {
      if (replace) history.replaceState({ s }, '')
      else history.pushState({ s }, '')
    } catch { /* ignore */ }
    window.scrollTo({ top: 0 })
  }, [])
  useEffect(() => {
    store.isTeam()
    try { history.replaceState({ s: 'landing' }, '') } catch { /* ignore */ }
    const onPop = (e: PopStateEvent) => {
      const s = (e.state as { s?: Screen } | null)?.s ?? 'landing'
      if (s === 'scanning') { setScreenState('capture'); return }
      setScreenState(s)
    }
    window.addEventListener('popstate', onPop)
    track('visit', { path: window.location.pathname })
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const showToast = useCallback((t: string) => {
    setToast(t)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }, [])

  const start = () => go(profile ? 'capture' : 'interview')

  const runScan = async (dataUrl: string) => {
    if (!profile) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    go('scanning', true)
    track('scan_start', {})
    try {
      const r = await scanMenu(dataUrl, profile, ctrl.signal)
      setResult(r)
      store.saveLastResult(r)
      go('results', true)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'aborted') return
      setFailure(describe(e))
      go('error', true)
    }
  }

  const onPhoto = async (f: File) => {
    try {
      const img = await compressImage(f)
      setPhoto(img.dataUrl)
      void runScan(img.dataUrl)
    } catch {
      setFailure({ title: 'We could not open that photo', body: 'Try another photo, or take a new one with the camera. HEIC photos from some phones need "Most compatible" in camera settings.', icon: 'image', retry: false })
      go('error', true)
    }
  }

  const onShare = async (d: DishEstimate) => {
    if (!result || !profile) return
    track('share', { scanId: result.scanId })
    try {
      const goal = profile.goal === 'plant_based' ? (profile.plantStyle === 'vegetarian' ? 'Vegetarian' : 'Vegan') : GOAL_LABEL[profile.goal]!
      const blob = await renderShareCard(d, result.restaurant, goal)
      const how = await shareCard(blob, `My best order${result.restaurant ? ` at ${result.restaurant}` : ''}: ${d.kcal.low}-${d.kcal.high} kcal, ${Math.round(d.protein.mid)} g protein. Found with Snapmenu.`)
      if (how === 'downloaded') { showToast('Saved the image. Post it to your story.'); track('share_download', { scanId: result.scanId }) }
    } catch {
      showToast('Could not create the image.')
    }
  }

  if (isNumbers) return <div className="app"><Numbers /></div>

  const dish = result?.dishes.find((d) => d.id === dishId) ?? null

  return (
    <div className="app">
      {screen === 'landing' && <Landing onStart={start} hasProfile={Boolean(profile)} />}
      {screen === 'interview' && (
        <Interview
          initial={profile}
          onExit={() => go(profile ? 'capture' : 'landing')}
          onDone={(p) => { setProfile(p); store.saveProfile(p); track('profile', { goal: p.goal, allergies: p.allergies.length, language: p.language }); go('capture', true) }}
        />
      )}
      {screen === 'capture' && profile && (
        <Capture profile={profile} onPhoto={onPhoto} onEditProfile={() => go('interview')} onHome={() => go('landing')} error={null} />
      )}
      {screen === 'scanning' && photo && <Scanning photo={photo} onCancel={() => { abortRef.current?.abort(); go('capture', true) }} />}
      {screen === 'results' && result && (
        <Results result={result} onOpenDish={(id) => { setDishId(id); go('dish'); track('dish_open', { scanId: result.scanId }) }} onRescan={() => go('capture')} onHome={() => go('landing')} onShare={onShare} onToast={showToast} />
      )}
      {screen === 'dish' && result && dish && <DishDetail dish={dish} result={result} onBack={() => history.back()} onToast={showToast} />}
      {screen === 'error' && failure && (
        <main className="screen with-cta">
          <div className="state" role="alert">
            <span className="s-ic"><Icon name={failure.icon} size={32} /></span>
            <h1 className="h2">{failure.title}</h1>
            <p className="body" style={{ maxWidth: 320 }}>{failure.body}</p>
          </div>
          <div className="cta-bar">
            {failure.retry && photo && <button className="btn btn-primary" onClick={() => void runScan(photo)}>Try again</button>}
            <button className={`btn ${failure.retry && photo ? 'btn-secondary' : 'btn-primary'}`} onClick={() => go('capture', true)}>
              <Icon name="camera" size={20} /> Take another photo
            </button>
          </div>
        </main>
      )}
      <Toast text={toast} />
    </div>
  )
}
