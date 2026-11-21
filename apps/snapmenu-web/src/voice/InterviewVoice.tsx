import { useState } from 'react'
import { sayChat } from '../../../snapmenu-api/src/voice/chat-copy'
import { understandInterview, type InterviewChoice } from '../../../snapmenu-api/src/voice/speech'
import { track } from '../lib/api'
import { VoiceRecorder } from './VoiceRecorder'
import './voice.css'

/**
 * The interview, answered by voice: "I want to lose weight and I can't have
 * nuts". The words are matched on the phone (speech.ts `understandInterview`,
 * ten languages); the goal and allergies it finds are handed to the interview,
 * which shows them selected so a wrong guess is one tap to fix.
 */
export function InterviewVoice({ language, onHeard }: { language: string; onHeard: (heard: { choice: InterviewChoice | null; allergies: string[] }) => void }) {
  const [said, setSaid] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const heard = (text: string) => {
    const got = understandInterview(text)
    setSaid(text)
    setNote(got.choice || got.allergies.length > 0 ? null : sayChat(language, 'interview.unheard'))
    track('voice_message', { context: 'interview', understood: got.choice ? 1 : 0, allergies: got.allergies.length })
    onHeard(got)
  }

  return (
    <div className="iv">
      <div className="iv__row">
        <span className="iv__text">{said ? `“${said}”` : sayChat(language, 'interview.say')}</span>
        <VoiceRecorder language={language} onTranscript={heard} onClip={() => { setSaid(null); setNote(null) }} onFail={(_why, message) => { setSaid(null); setNote(message) }} />
      </div>
      {note && <p className="iv__note" role="status">{note}</p>}
    </div>
  )
}
