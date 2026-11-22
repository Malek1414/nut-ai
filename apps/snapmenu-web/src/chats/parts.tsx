import { ArrowUpRight, BookOpen, ChevronRight, MapPin, MessagesSquare, Utensils, Users, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Card, Chat } from '../../../snapmenu-api/src/chats/types'
import { Sheet } from '../components/ui'
import { Avatar } from '../community/parts'

export function ChatAvatar({ name, group = false, size = 42 }: { name: string; group?: boolean; size?: number }) {
  if (group) return <span className="pc-group-avatar" style={{ width: size, height: size }}><Users size={size / 2} aria-hidden="true" /></span>
  return <Avatar name={name} size={size} initials={Array.from(name)[0]?.toUpperCase() ?? '?'} />
}

const dateLabel = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
export const timeLabel = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
export function dayLabel(t: number) {
  const today = new Date(), day = new Date(t).toDateString()
  if (day === today.toDateString()) return 'Today'
  today.setDate(today.getDate() - 1)
  if (day === today.toDateString()) return 'Yesterday'
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function ChatRow({ chat, onSelect, disabled }: { chat: Chat; onSelect: () => void; disabled?: boolean }) {
  return <button className="pc-row" type="button" onClick={onSelect} disabled={disabled}>
    <ChatAvatar name={chat.title} group={chat.kind === 'group'} />
    <span className="pc-row-copy"><strong>{chat.title}</strong><small>{chat.lastMessage || 'Start a conversation'}</small></span>
    <span className="pc-row-end"><time dateTime={new Date(chat.updatedAt).toISOString()}>{dayLabel(chat.updatedAt) === 'Today' ? timeLabel(chat.updatedAt) : dateLabel(chat.updatedAt)}</time>
      {chat.unread > 0 && <span className="pc-badge" aria-label={chat.unread + ' unread'}>{chat.unread > 99 ? '99+' : chat.unread}</span>}
    </span>
  </button>
}
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="pc-empty"><MessagesSquare aria-hidden="true" size={30} strokeWidth={1.6} /><h2>{title}</h2><p>{children}</p>{action}</div>
}
export function Guest({ onAccount }: { onAccount: () => void }) {
  return <Empty title="Chat with your friends" action={<button className="btn btn-primary" onClick={onAccount}>Sign in</button>}>Sign in to send messages and plan a meal together.</Empty>
}
export function ChatSheet({ label, children, close }: { label: string; children: ReactNode; close: () => void }) {
  return <Sheet label={label} onClose={close} className="pc-sheet"><header><h2>{label}</h2><button type="button" className="pc-icon" aria-label="Close" onClick={close}><X size={20} /></button></header>{children}</Sheet>
}
export function Notice({ children, retry }: { children: ReactNode; retry?: () => void }) {
  return <div role="alert" className="pc-notice">{children}{retry && <button type="button" onClick={retry}>Try again</button>}</div>
}
const cardIcons = { restaurant: MapPin, menu: BookOpen, dish: Utensils }
export function SharedCard({ card, onOpen }: { card: Card; onOpen?: (card: Card) => void }) {
  const Glyph = cardIcons[card.kind]
  const detail = <><span className="pc-share-icon"><Glyph size={21} /></span><span className="pc-card-copy"><small>Shared {card.kind}</small><strong>{card.title}</strong>{card.subtitle && <span>{card.subtitle}</span>}</span></>
  if (onOpen) return <button className="pc-shared" type="button" onClick={() => onOpen(card)}>{detail}<ArrowUpRight size={16} /></button>
  return <div className="pc-shared">{detail}</div>
}
export function FriendRow({ name, onSelect, disabled, children }: { name: string; onSelect?: () => void; disabled?: boolean; children?: ReactNode }) {
  const content = <><ChatAvatar name={name} size={36} /><strong>{name}</strong>{children ?? <ChevronRight size={18} />}</>
  return onSelect ? <button className="pc-person" type="button" onClick={onSelect} disabled={disabled}>{content}</button> : <div className="pc-person">{content}</div>
}
