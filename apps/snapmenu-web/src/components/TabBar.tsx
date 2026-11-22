import { Map, MessageCircle, ScanLine, UserRound, UsersRound, type LucideIcon } from 'lucide-react'

export type Tab = 'scan' | 'map' | 'community' | 'chats' | 'me'

const TABS: Array<{ id: Tab; label: string; Icon: LucideIcon }> = [
  { id: 'scan', label: 'Scan', Icon: ScanLine },
  { id: 'map', label: 'Map', Icon: Map },
  { id: 'community', label: 'Community', Icon: UsersRound },
  { id: 'chats', label: 'Chats', Icon: MessageCircle },
  { id: 'me', label: 'Me', Icon: UserRound },
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
              <t.Icon aria-hidden="true" size={20} strokeWidth={on ? 2.1 : 1.8} />
              {badge?.[t.id] && <i className="tab__badge" aria-hidden="true" />}
            </span>
            <span className="tab__label">{t.label}</span>
              {badge?.[t.id] && <span className="sr-only">Unread messages</span>}
          </button>
        )
      })}
    </nav>
  )
}
