import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { DishEstimate, MenuResult, Place, Profile } from '../../snapmenu-api/src/types'
import { TabBar, type Tab } from './components/TabBar'
import { Icon, Toast } from './components/ui'
import { AttachCard } from './map/AttachCard'
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
import { Me } from './screens/Me'
import { Scanning } from './screens/Scanning'

// The map (maplibre) loads only when someone opens the Map tab.
const MapScreen = lazy(() => import('./map/MapScreen').then((m) => ({ default: m.MapScreen })))

type Screen = 'landing' | 'interview' | 'capture' | 'scanning' | 'results' | 'dish' | 'error' | 'map' | 'me'

const SCAN_SCREENS: Screen[] = ['landing', 'interview', 'capture', 'scanning', 'results', 'dish', 'error']
const NO_TABS: Screen[] = ['interview', 'scanning']
const tabOf = (s: Screen): Tab => (s === 'map' ? 'map' : s === 'me' ? 'me' : 'scan')

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
  /** The restaurant whose "Scan this menu" started the current scan. */
  const [pendingPlace, setPendingPlace] = useState<Place | null>(null)
  /** The restaurant the shown result was scanned at (moved over from pendingPlace when a scan starts). */
  const [resultPlace, setResultPlace] = useState<Place | null>(null)
  /** Open this restaurant's sheet when the map shows. */
  const [mapFocus, setMapFocus] = useState<{ place: Place; n: number } | null>(null)
  const lastScanScreen = useRef<Screen>('landing')

  // Phone back button walks back through screens.
  const go = useCallback((s: Screen, replace = false) => {
    if (SCAN_SCREENS.includes(s)) lastScanScreen.current = s === 'scanning' ? 'capture' : s
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

  const start = () => { setPendingPlace(null); go(profile ? 'capture' : 'interview') }

  const onTab = (t: Tab) => {
    if (t === 'map') { setMapFocus(null); go('map') }
    else if (t === 'me') go('me')
    else if (t === 'scan') {
      if (tabOf(screen) === 'scan') { setPendingPlace(null); go(profile ? 'capture' : 'landing') }
      else go(lastScanScreen.current === 'dish' && !result ? 'landing' : lastScanScreen.current)
    }
  }

  const scanPlace = (place: Place) => {
    setPendingPlace(place)
    track('scan_from_map', { place: place.id })
    go(profile ? 'capture' : 'interview')
  }
  const viewOnMap = (place: Place) => {
    setMapFocus((f) => ({ place, n: (f?.n ?? 0) + 1 }))
    go('map')
  }

  const runScan = async (dataUrl: string) => {
    if (!profile) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    go('scanning', true)
    const at = pendingPlace
    track('scan_start', { fromMap: Boolean(at) })
    try {
      const r = await scanMenu(dataUrl, profile, ctrl.signal)
      setResult(r)
      setResultPlace(at)
      setPendingPlace(null)
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
  const tabs = !NO_TABS.includes(screen)

  return (
    <div className={`app ${tabs ? 'has-tabs' : ''} ${screen === 'map' || screen === 'me' ? 'no-cta' : ''}`}>
      {screen === 'landing' && <Landing onStart={start} hasProfile={Boolean(profile)} />}
      {screen === 'interview' && (
        <Interview
          initial={profile}
          onExit={() => go(profile ? 'capture' : 'landing')}
          onDone={(p) => { setProfile(p); store.saveProfile(p); track('profile', { goal: p.goal, allergies: p.allergies.length, language: p.language }); go('capture', true) }}
        />
      )}
      {screen === 'capture' && profile && (
        <Capture profile={profile} onPhoto={onPhoto} onEditProfile={() => go('interview')} onHome={() => go('landing')} error={null} placeName={pendingPlace?.name ?? null} onClearPlace={() => setPendingPlace(null)} />
      )}
      {screen === 'scanning' && photo && <Scanning photo={photo} onCancel={() => { abortRef.current?.abort(); go('capture', true) }} />}
      {screen === 'results' && result && (
        <Results
          result={result}
          attachSlot={<AttachCard key={result.scanId} result={result} profile={profile} pendingPlace={resultPlace} onViewMap={viewOnMap} onAttached={(p) => { showToast(`Added to ${p.name} on the map.`); track('attach_done', {}) }} />}
          onOpenDish={(id) => { setDishId(id); go('dish'); track('dish_open', { scanId: result.scanId }) }} onRescan={() => { setPendingPlace(null); go('capture') }} onHome={() => go('landing')} onShare={onShare} onToast={showToast} />
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
      {screen === 'map' && (
        <Suspense fallback={<div className="map-boot" aria-busy="true" />}>
          <MapScreen key={mapFocus ? `focus-${mapFocus.n}` : 'map'} profile={profile} onScanPlace={scanPlace} onScan={start} focusPlace={mapFocus?.place ?? null} />
        </Suspense>
      )}
      {screen === 'me' && <Me profile={profile} onEditProfile={() => go('interview')} onHome={() => go('landing')} />}
      {tabs && <TabBar tab={tabOf(screen)} onTab={onTab} tabs={['scan', 'map', 'me']} />}
      <Toast text={toast} />
    </div>
  )
}
