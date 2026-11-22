import { useRef, useState } from 'react'
import { Check, Ellipsis, ExternalLink, MapPin, Pause, Play, Utensils } from 'lucide-react'
import type { Card, Message } from '../../../snapmenu-api/src/chats/types'
import { clock } from '../../../snapmenu-api/src/voice/speech'
import { MessageWave } from '../voice/MessageWave'
import { pathOf } from './client'
import { SharedCard, timeLabel } from './parts'

function VoiceMessage({ id, message }: { id: string; message: Message }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false), [position, setPosition] = useState(0), [error, setError] = useState('')
  const duration = message.voice?.durationMs ?? 0
  return <div><div className="pc-audio">
    <button type="button" aria-label={playing ? 'Pause voice message' : 'Play voice message'} onClick={() => {
      const el = audio.current
      if (!el) return
      if (playing) el.pause()
      else { setError(''); void el.play().catch(() => setError('Audio couldn’t play. Try again.')) }
    }}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
    <MessageWave progress={duration ? position / duration : 0} /><span>{clock(playing ? position : duration)}</span>
    <audio ref={audio} src={'/api/chats' + pathOf(id) + '/voice/' + message.id} preload="none"
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={e => setPosition(e.currentTarget.currentTime * 1000)}
      onEnded={() => { setPosition(0); setPlaying(false) }} />
  </div>{error && <small role="alert">{error}</small>}</div>
}

function PlanCard({ message, busy, onVote }: { message: Message; busy: boolean; onVote: (option: string) => void }) {
  const plan = message.plan!
  return <div className="pc-plan"><header><span><Utensils size={18} /></span><div><strong>Meal plan</strong><small>{plan.area === 'berlin' ? 'Around Berlin Mitte' : 'Near your shared location'}</small></div></header>
    {!plan.options.length && <p>We couldn’t find a place for these preferences nearby. Share a restaurant from the map or add a menu scan.</p>}
    {plan.missingProfiles.length > 0 && <p>Preferences unknown for {plan.missingProfiles.join(', ')}.</p>}
    {plan.options.map(option => {
      const votes = message.votes?.[option.id] ?? 0
      return <section className="pc-option" key={option.id}><strong><MapPin size={15} />{option.name}</strong>
        {option.menuNote && <p>{option.menuNote}</p>}
        {!!option.picks.length && <ul>{option.picks.map(pick => <li key={pick.username}><b>{pick.username}</b><span>{pick.dish}</span>{pick.why && <small>{pick.why}</small>}</li>)}</ul>}
        <button type="button" className="pc-vote" disabled={busy} aria-label={'Vote for ' + option.name} aria-pressed={message.myVote === option.id} onClick={() => onVote(option.id)}>
          {message.myVote === option.id && <Check size={15} />}{message.myVote === option.id ? 'Voted' : 'Vote'}<span>{votes} {votes === 1 ? 'vote' : 'votes'}</span>
        </button>
        {!!option.delivery.length && <details><summary>Check delivery</summary>{option.delivery.map(link => <a key={link.url} href={link.url} target="_blank" rel="noreferrer">Check on {link.label} <ExternalLink size={12} /></a>)}</details>}
      </section>
    })}
    {plan.hasAllergies && <p>Confirm ingredients and cross-contact with the restaurant.</p>}
  </div>
}
export function MessageBubble({ id, message, mine, group, seenBy, busy, onMenu, onVote, onOpenShare }: {
  id: string; message: Message; mine: boolean; group: boolean; seenBy?: string[]; busy: boolean; onMenu: () => void; onVote: (option: string) => void; onOpenShare?: (card: Card) => void
}) {
  const author = message.type === 'assistant' ? 'PlatePal' : message.sender?.username
  return <article className={'pc-message' + (mine ? ' is-mine' : '')} aria-label={'Message from ' + (mine ? 'you' : author || 'PlatePal')}>
    {(message.type === 'assistant' || (group && !mine)) && <strong className="pc-author">{author || 'PlatePal'}</strong>}
    {message.type === 'plan' && message.plan ? <PlanCard message={message} busy={busy} onVote={onVote} /> :
      message.type === 'card' && message.card ? <SharedCard card={message.card} onOpen={onOpenShare} /> :
      <div className="pc-bubble">{message.type === 'voice' ? <VoiceMessage id={id} message={message} /> : <p dir="auto">{message.text}</p>}</div>}
    <div className="pc-meta"><time dateTime={new Date(message.createdAt).toISOString()}>{timeLabel(message.createdAt)}</time>{mine && seenBy && <span className="pc-receipt">{seenBy.length ? (group ? 'Seen by ' + seenBy.join(', ') : 'Seen') : 'Sent'}</span>}<button type="button" aria-label="Message actions" onClick={onMenu}><Ellipsis size={16} /></button></div>
  </article>
}
