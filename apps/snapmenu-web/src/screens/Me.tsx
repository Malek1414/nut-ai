import type { Profile } from '../../../snapmenu-api/src/types'
import { Footer, Icon, Wordmark } from '../components/ui'
import { GOAL_LABEL } from '../lib/format'
import { formatDistance, requestPosition, resetPosition, usePosition, distance, BERLIN_MITTE } from '../lib/position'
import type { ReactNode } from 'react'

export function Me({ profile, onEditProfile, onHome, children }: { profile: Profile | null; onEditProfile: () => void; onHome: () => void; children?: ReactNode }) {
  const position = usePosition()
  const goal = profile ? (profile.goal === 'plant_based' ? (profile.plantStyle === 'vegetarian' ? 'Vegetarian' : 'Vegan') : GOAL_LABEL[profile.goal]) : null
  const located = position.status === 'granted'
  return (
    <main className="screen">
      <div className="topbar"><Wordmark onClick={onHome} /></div>
      <header className="results-head">
        <p className="eyebrow">Me</p>
        <h1 className="h1">Your Snapmenu</h1>
        <p className="body">Everything stays on this phone. No account, no email.</p>
      </header>

      {children}

      <div className="section-title" style={{ marginTop: 8 }}><h2 className="h3">Your goal</h2></div>
      <div className="card-flat me-row">
        <span className="me-ic"><Icon name="spark" size={20} /></span>
        <span style={{ flex: 1, minWidth: 0, display: 'grid' }}>
          <b>{goal ?? 'Not set yet'}</b>
          <span className="small">{profile ? `${profile.allergies.length ? `Avoiding ${profile.allergies.join(', ').replace(/_/g, ' ')}` : 'No allergies'} · ${profile.language}` : 'Answer 3 quick questions before your first scan.'}</span>
        </span>
        <button className="btn btn-secondary btn-sm" onClick={onEditProfile}>{profile ? 'Edit' : 'Set up'}</button>
      </div>

      <div className="section-title"><h2 className="h3">Location</h2></div>
      <div className="card-flat me-row">
        <span className="me-ic" style={{ background: 'var(--protein-tint)', color: 'var(--protein)' }}><Icon name="locate" size={20} /></span>
        <span style={{ flex: 1, minWidth: 0, display: 'grid' }}>
          <b>{located ? 'Using your location' : position.status === 'denied' ? 'Location blocked' : 'Berlin Mitte'}</b>
          <span className="small">{located ? `${formatDistance(distance(position.position, BERLIN_MITTE))} from Berlin Mitte. Only used to load nearby restaurants.` : position.status === 'denied' ? 'Allow location for this site in your browser settings to see what is near you.' : 'The map starts in Mitte until you share your location.'}</span>
        </span>
        {located
          ? <button className="btn btn-secondary btn-sm" onClick={resetPosition}>Forget</button>
          : <button className="btn btn-secondary btn-sm" onClick={() => void requestPosition()} disabled={position.status === 'locating'}>{position.status === 'locating' ? '…' : 'Use'}</button>}
      </div>

      <div className="section-title"><h2 className="h3">Where the data comes from</h2></div>
      <div className="card-flat" style={{ padding: 16 }}>
        <ul className="me-sources">
          <li><b>Nutrition:</b> USDA FoodData Central and Open Food Facts, through the open Nut AI engine.</li>
          <li><b>Restaurants:</b> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors, ODbL 1.0.</li>
          <li><b>Map tiles:</b> OpenFreeMap, © OpenMapTiles.</li>
          <li><b>Map design:</b> adapted from our team's wohin app.</li>
        </ul>
      </div>
      <Footer />
    </main>
  )
}
