import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { DishEstimate, MenuResult, Place, Profile } from '../../snapmenu-api/src/types'
import { errorText, interviewReply } from '../../snapmenu-api/src/voice/index'
import { TabBar, type Tab } from './components/TabBar'
import { Icon, Toast } from './components/ui'
import { Compose, type Draft } from './community/Compose'
import { PlacePosts, PostPrompt } from './community/extras'
import { Feed } from './community/Feed'
import { PostDetail } from './community/PostDetail'
import type { PostView } from './lib/community'
import { AttachCard } from './map/AttachCard'
import { ApiError, scanMenu, track } from './lib/api'
import { goalLabel } from './lib/format'
import { compressImage } from './lib/image'
import { store } from './lib/storage'
import { Capture } from './screens/Capture'
import { DishDetail } from './screens/DishDetail'
import { Interview } from './screens/Interview'
import { Landing } from './screens/Landing'
import { Numbers } from './screens/Numbers'
import { Results } from './screens/Results'
import { Me } from './screens/Me'
import { Scanning } from './screens/Scanning'
import { fromInstagram, InstagramLanding, InstallHint, SharePlace, social, SocialLayer } from './social'

// The map (maplibre) loads only when someone opens the Map tab.
const MapScreen = lazy(() => import('./map/MapScreen').then((m) => ({ default: m.MapScreen })))

type Screen = 'landing' | 'interview' | 'capture' | 'scanning' | 'results' | 'dish' | 'error' | 'map' | 'me' | 'feed' | 'post' | 'compose'

const SCAN_SCREENS: Screen[] = ['landing', 'interview', 'capture', 'scanning', 'results', 'dish', 'error']
const NO_TABS: Screen[] = ['interview', 'scanning', 'post', 'compose']
const tabOf = (s: Screen): Tab => (s === 'map' ? 'map' : s === 'me' ? 'me' : s === 'feed' || s === 'post' || s === 'compose' ? 'community' : 'scan')

/** A post's restaurant as a map place. */
const placeOfPost = (p: PostView): Place => ({ id: p.place!.id, name: p.place!.name, lat: p.place!.lat, lng: p.place!.lng, kind: 'restaurant', cuisine: null, address: null, vegan: null, vegetarian: null })

interface Failure { title: string; body: string; icon: string; retry: boolean }

/** What a failed scan shows. The words come from the shared voice, in the user's language; the API's own message already is. */
function describe(e: unknown, lang: string): Failure {
  if (e instanceof ApiError) {
    const { title } = errorText(lang, e.code)
    switch (e.code) {
      case 'offline': return { title, body: e.message, icon: 'wifiOff', retry: true }
      case 'not_menu': return { title, body: e.message, icon: 'focus', retry: false }
      case 'no_key':
      case 'auth': return { title, body: e.message, icon: 'key', retry: false }
      case 'rate_limited': return { title, body: e.message, icon: 'info', retry: true }
      case 'too_big': return { title, body: e.message, icon: 'image', retry: false }
      default: return { title, body: e.message, icon: 'alert', retry: true }
    }
  }
  const { title, message } = errorText(lang, 'oops')
  return { title, body: message, icon: 'alert', retry: true }
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
  /** The reply to the interview, shown once on the next screen. */
  const [reply, setReply] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  /** The restaurant whose "Scan this menu" started the current scan. */
  const [pendingPlace, setPendingPlace] = useState<Place | null>(null)
  /** The restaurant the shown result was scanned at (moved over from pendingPlace when a scan starts). */
  const [resultPlace, setResultPlace] = useState<Place | null>(null)
  /** Open this restaurant's sheet when the map shows. */
  const [mapFocus, setMapFocus] = useState<{ place: Place; n: number } | null>(null)
  /** "Healthy delivery near me": open the map in delivery mode (bumped on every tap so the map resets). */
  const [mapDelivery, setMapDelivery] = useState(0)
  const lastScanScreen = useRef<Screen>('landing')
  /** Community: the open post, the draft being written, and a key that reloads lists after a new post. */
  const [openPostState, setOpenPost] = useState<{ id: string; initial: PostView | null } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [feedKey, setFeedKey] = useState(0)
  /** The restaurant the current result was attached to. */
  const [attachedPlace, setAttachedPlace] = useState<Place | null>(null)

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
    if (t === 'map') { setMapFocus(null); setMapDelivery(0); go('map') }
    else if (t === 'me') go('me')
    else if (t === 'community') go('feed')
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
  const openPost = (p: PostView) => { setOpenPost({ id: p.id, initial: p }); go('post') }
  const compose = (community: string | null) => { setDraft({ kind: 'text', community }); go('compose') }
  const composeOrder = () => {
    if (!result) return
    setDraft({ kind: 'order', community: null, result, place: attachedPlace ?? resultPlace })
    go('compose')
  }
  const deliveryNearMe = () => {
    track('delivery_entry', {})
    setMapFocus(null)
    setMapDelivery((n) => n + 1)
    go('map')
  }
  const viewOnMap = (place: Place) => {
    setMapDelivery(0)
    setMapFocus((f) => ({ place, n: (f?.n ?? 0) + 1 }))
    go('map')
  }

  const runScan = async (dataUrl: string) => {
    if (!profile) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    go('scanning', true)
    setReply(null)
    const at = pendingPlace
    track('scan_start', { fromMap: Boolean(at) })
    try {
      const r = await scanMenu(dataUrl, profile, ctrl.signal)
      setResult(r)
      setResultPlace(at)
      setAttachedPlace(null)
      setPendingPlace(null)
      store.saveLastResult(r)
      go('results', true)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'aborted') return
      setFailure(describe(e, profile.language))
      go('error', true)
    }
  }

  const onPhoto = async (f: File) => {
    try {
      const img = await compressImage(f)
      setPhoto(img.dataUrl)
      void runScan(img.dataUrl)
    } catch {
      const { title, message } = errorText(profile?.language ?? store.language(), 'photo')
      setFailure({ title, body: message, icon: 'image', retry: false })
      go('error', true)
    }
  }

  /** Share the pick as a link with a rich preview (src/social). */
  const onShare = (d: DishEstimate) => {
    if (!result || !profile) return
    track('share', { scanId: result.scanId })
    social.share({ kind: 'pick', dish: d, why: result.tips.find((t) => t.dishId === d.id)?.why ?? null, restaurant: result.restaurant, place: attachedPlace ?? resultPlace, goal: goalLabel(profile) })
  }

  if (isNumbers) return <div className="app"><Numbers /></div>

  const dish = result?.dishes.find((d) => d.id === dishId) ?? null
  const tabs = !NO_TABS.includes(screen)
  const noCta = screen === 'map' || screen === 'me' || screen === 'feed'

  return (
    <div className={`app ${tabs ? 'has-tabs' : ''} ${noCta ? 'no-cta' : ''}`}>
      {screen === 'landing' && (fromInstagram() ? <InstagramLanding onStart={start} /> : <Landing onStart={start} onDelivery={deliveryNearMe} />)}
      {screen === 'interview' && (
        <Interview
          initial={profile}
          onExit={() => go(profile ? 'capture' : 'landing')}
          onDone={(p) => { setProfile(p); store.saveProfile(p); setReply(interviewReply(p)); track('profile', { goal: p.goal, allergies: p.allergies.length, language: p.language }); go('capture', true) }}
        />
      )}
      {screen === 'capture' && profile && (
        <Capture profile={profile} onPhoto={onPhoto} onEditProfile={() => go('interview')} onHome={() => go('landing')} error={null} note={reply} placeName={pendingPlace?.name ?? null} onClearPlace={() => setPendingPlace(null)} />
      )}
      {screen === 'scanning' && photo && <Scanning photo={photo} onCancel={() => { abortRef.current?.abort(); go('capture', true) }} />}
      {screen === 'results' && result && (
        <Results
          result={result}
          attachSlot={<>
            <AttachCard key={result.scanId} result={result} profile={profile} pendingPlace={resultPlace} onViewMap={viewOnMap} onAttached={(p) => { setAttachedPlace(p); showToast(`Added to ${p.name}`); track('attach_done', {}) }} />
            {result.top.length > 0 && <PostPrompt onPost={composeOrder} />}
            <InstallHint />
          </>}
          onOpenDish={(id) => { setDishId(id); go('dish'); track('dish_open', { scanId: result.scanId }) }} onRescan={() => { setPendingPlace(null); go('capture') }} onHome={() => go('landing')} onShare={onShare} onToast={showToast} />
      )}
      {screen === 'dish' && result && dish && <DishDetail dish={dish} result={result} onBack={() => history.back()} onToast={showToast} />}
      {screen === 'error' && failure && (
        <main className="screen with-cta">
          <div className="state" role="alert">
            <span className="s-ic"><Icon name={failure.icon} size={32} /></span>
            <h1 className="h2">{failure.title}</h1>
            <p className="body" style={{ maxWidth: 300 }}>{failure.body}</p>
          </div>
          <div className="cta-bar">
            {failure.retry && photo && <button className="btn btn-primary" onClick={() => void runScan(photo)}>Try again</button>}
            <button className={`btn ${failure.retry && photo ? 'btn-secondary' : 'btn-primary'}`} onClick={() => go('capture', true)}>
              <Icon name="camera" size={20} /> New photo
            </button>
          </div>
        </main>
      )}
      {screen === 'map' && (
        <Suspense fallback={<div className="map-boot" aria-busy="true" />}>
          <MapScreen key={mapFocus ? `focus-${mapFocus.n}` : mapDelivery ? `delivery-${mapDelivery}` : 'map'} deliveryMode={mapDelivery > 0 && !mapFocus} profile={profile} onScanPlace={scanPlace} onScan={start} focusPlace={mapFocus?.place ?? null} renderPlaceExtras={(pl) => <><PlacePosts place={pl} onOpen={openPost} /><SharePlace place={pl} /></>} />
        </Suspense>
      )}
      {screen === 'me' && (
        <Me profile={profile} onEditProfile={() => go('interview')} onLanguage={(language) => { if (profile) { const p = { ...profile, language }; setProfile(p); store.saveProfile(p) } }} onOpenPost={openPost} refreshKey={feedKey} />
      )}
      {screen === 'feed' && <Feed onOpen={openPost} onCompose={compose} onPlace={(p) => viewOnMap(placeOfPost(p))} toast={showToast} refreshKey={feedKey} />}
      {screen === 'post' && openPostState && (
        <PostDetail
          key={openPostState.id}
          postId={openPostState.id}
          initial={openPostState.initial}
          onBack={() => history.back()}
          onPlace={(p) => viewOnMap(placeOfPost(p))}
          toast={showToast}
          onGone={() => { setFeedKey((k) => k + 1); go('feed', true) }}
        />
      )}
      {screen === 'compose' && draft && (
        <Compose
          draft={draft}
          toast={showToast}
          onCancel={() => history.back()}
          onPosted={(p) => { setFeedKey((k) => k + 1); showToast('Posted'); setOpenPost({ id: p.id, initial: p }); go('post', true) }}
        />
      )}
      {tabs && <TabBar tab={tabOf(screen)} onTab={onTab} />}
      <SocialLayer profile={profile} onScan={start} onViewPlace={viewOnMap} toast={showToast} />
      <Toast text={toast} />
    </div>
  )
}
