import type { MenuResult, Profile } from '../../../snapmenu-api/src/types'
import { sayChat } from '../../../snapmenu-api/src/voice/chat-copy'
import { menuForChat, type ChatReply, type ChatTurn, type Transcript, type VoiceConfig } from '../../../snapmenu-api/src/voice/chat-types'
import { ApiError } from '../lib/api'
import { phoneLocale } from '../lib/format'
import { store } from '../lib/storage'

/** Whether the Worker transcribes recordings: asked once, and switched to "no" for the session when it says so. */
let server: 'yes' | 'no' | 'unknown' = 'unknown'
let asked: Promise<VoiceConfig | null> | null = null
let maxSeconds = 60
let failedInARow = 0

export const serverStt = (): 'yes' | 'no' | 'unknown' => server
export const maxClipSeconds = (): number => maxSeconds

/** Ask the Worker what voice can do. Safe to call often: one request per page. */
export function loadVoiceConfig(): Promise<VoiceConfig | null> {
  asked ??= fetch('/api/voice/config')
    .then((r) => (r.ok ? (r.json() as Promise<VoiceConfig>) : null))
    .then((c) => {
      if (c) {
        server = c.stt ? 'yes' : 'no'
        if (typeof c.maxSeconds === 'number' && c.maxSeconds > 0) maxSeconds = Math.min(120, c.maxSeconds)
      }
      return c
    })
    .catch(() => { asked = null; return null })
  return asked
}

async function failure(res: Response, lang: string, fallback: Parameters<typeof sayChat>[1]): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
  return new ApiError(body?.error?.message ?? sayChat(lang, fallback), body?.error?.code ?? 'http', res.status)
}

/** A recording as words, written by the Worker. Throws an ApiError whose message is in the user's language. */
export async function transcribeClip(audio: Blob, seconds: number, language: string): Promise<string> {
  let res: Response
  try {
    res = await fetch(`/api/voice/transcribe?lang=${encodeURIComponent(language)}&s=${seconds.toFixed(1)}`, {
      method: 'POST',
      headers: { 'content-type': audio.type || 'audio/webm', 'x-device': store.deviceId(), 'x-lang': phoneLocale(), ...(store.isTeam() ? { 'x-team': '1' } : {}) },
      body: audio,
    })
  } catch {
    throw new ApiError(sayChat(language, 'chat.offline'), 'offline', 0)
  }
  if (!res.ok) {
    const err = await failure(res, language, 'voice.unheard')
    if (err.code === 'stt_off' || (err.code === 'stt_failed' && ++failedInARow >= 2)) server = 'no'
    throw err
  }
  server = 'yes'
  failedInARow = 0
  const out = (await res.json()) as Transcript
  if (!out.text) throw new ApiError(sayChat(language, 'voice.unheard'), 'unheard', 422)
  return out.text
}

export interface Ask {
  message: string
  via: 'voice' | 'text'
  history: ChatTurn[]
  result: MenuResult
  profile: Profile
  voice?: { seconds: number; stt: 'browser' | 'server' }
}

/** One question about the scanned menu. Throws an ApiError whose message is in the user's language. */
export async function askMenu(ask: Ask, signal?: AbortSignal): Promise<ChatReply> {
  const lang = ask.profile.language
  let res: Response
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: ask.message, via: ask.via, history: ask.history, menu: menuForChat(ask.result), profile: ask.profile,
        locale: phoneLocale(), deviceId: store.deviceId(), team: store.isTeam(), ...(ask.voice ? { voice: ask.voice } : {}),
      }),
      ...(signal ? { signal } : {}),
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new ApiError('Cancelled.', 'aborted', 0)
    throw new ApiError(sayChat(lang, 'chat.offline'), 'offline', 0)
  }
  if (!res.ok) throw await failure(res, lang, 'chat.failed')
  return (await res.json()) as ChatReply
}
