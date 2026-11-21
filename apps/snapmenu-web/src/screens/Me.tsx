import type { Profile } from '../../../snapmenu-api/src/types'
import { Fold, Footer, Icon } from '../components/ui'
import { useMeCommunity } from '../community/extras'
import type { PostView } from '../lib/community'
import { allergyName, goalLabel, LANGUAGES } from '../lib/format'
import { requestPosition, resetPosition, usePosition } from '../lib/position'

/** Nickname, then settings as one quiet list, then saved and own posts. */
export function Me({ profile, onEditProfile, onLanguage, onOpenPost, refreshKey }: {
  profile: Profile | null
  onEditProfile: () => void
  onLanguage: (language: string) => void
  onOpenPost: (p: PostView) => void
  /** Changes after a new post, so the lists reload. */
  refreshKey: number
}) {
  const position = usePosition()
  const { card, lists } = useMeCommunity(onOpenPost, refreshKey)
  const located = position.status === 'granted'
  const list = profile?.allergies.map(allergyName).join(', ') ?? ''
  const allergies = list ? list[0]!.toUpperCase() + list.slice(1) : 'None'
  return (
    <main className="screen me">
      <h1 className="h1 page-title">Me</h1>

      {card}

      <div className="card-flat list-card set-list">
        <button className="set-row" onClick={onEditProfile}>
          <span className="set-row__ic" style={{ background: 'var(--fat-tint)', color: 'var(--fat)' }}><Icon name="flame" size={18} /></span>
          <span className="set-row__label">Goal</span>
          <span className="set-row__value">{profile ? goalLabel(profile) : 'Set up'}</span>
          <Icon name="chevron" size={18} />
        </button>
        {profile && (
          <button className="set-row" onClick={onEditProfile}>
            <span className="set-row__ic" style={{ background: 'var(--alert-tint)', color: 'var(--alert)' }}><Icon name="shield" size={18} /></span>
            <span className="set-row__label">Allergies</span>
            <span className="set-row__value">{allergies}</span>
            <Icon name="chevron" size={18} />
          </button>
        )}
        {profile && (
          <label className="set-row">
            <span className="set-row__ic" style={{ background: 'var(--basil-tint)', color: 'var(--basil)' }}><Icon name="globe" size={18} /></span>
            <span className="set-row__label">Translate to</span>
            <select className="set-row__select" value={profile.language} onChange={(e) => onLanguage(e.target.value)} aria-label="Language for translations">
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.native}</option>)}
            </select>
            <Icon name="chevronDown" size={18} />
          </label>
        )}
        <button className="set-row" onClick={() => (located ? resetPosition() : void requestPosition())} disabled={position.status === 'locating'}>
          <span className="set-row__ic" style={{ background: 'var(--protein-tint)', color: 'var(--protein)' }}><Icon name="locate" size={18} /></span>
          <span className="set-row__label">Location</span>
          <span className="set-row__value">{located ? 'On' : position.status === 'locating' ? 'Finding…' : position.status === 'denied' ? 'Blocked in browser' : 'Berlin Mitte'}</span>
          <span className={`switch ${located ? 'is-on' : ''}`} aria-hidden="true" />
        </button>
      </div>

      {lists}

      <Fold title="About the data">
        <ul className="plain-list">
          <li>Everything stays on this phone. No account, no email.</li>
          <li>Your location is only used to load nearby restaurants.</li>
          <li>Nutrition: USDA FoodData Central and Open Food Facts, through the open Nut AI engine.</li>
          <li>Restaurants: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors, ODbL 1.0.</li>
          <li>Map tiles: OpenFreeMap, © OpenMapTiles. Map design adapted from our team's wohin app.</li>
        </ul>
      </Fold>
      <Footer />
    </main>
  )
}
