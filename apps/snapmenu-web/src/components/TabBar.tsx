import { Icon } from './ui'

export type Tab = 'scan' | 'map' | 'community' | 'me'

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'scan', label: 'Scan', icon: 'camera' },
  { id: 'map', label: 'Map', icon: 'map' },
  { id: 'community', label: 'Community', icon: 'users' },
  { id: 'me', label: 'Me', icon: 'user' },
]

/** Bottom tab bar across the app. Safe-area aware; the active tab gets a basil pill behind its icon. */
export function TabBar({ tab, onTab, tabs = TABS.map((t) => t.id), badge }: { tab: Tab; onTab: (t: Tab) => void; tabs?: Tab[]; badge?: Partial<Record<Tab, boolean>> }) {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.filter((t) => tabs.includes(t.id)).map((t) => {
        const on = t.id === tab
        return (
          <button key={t.id} type="button" className={`tab ${on ? 'is-on' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => onTab(t.id)}>
            <span className="tab__pill">
              <Icon name={t.icon} size={22} strokeWidth={on ? 2.1 : 1.8} />
              {badge?.[t.id] && <i className="tab__badge" aria-hidden="true" />}
            </span>
            <span className="tab__label">{t.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
