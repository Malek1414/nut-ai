import type { MenuResult, Profile } from '../../../snapmenu-api/src/types'
import { sayChat } from '../../../snapmenu-api/src/voice/chat-copy'
import { menuForChat, type ChatReply, type ChatTurn } from '../../../snapmenu-api/src/voice/chat-types'
import { ApiError } from '../lib/api'
import { phoneLocale } from '../lib/format'
import { store } from '../lib/storage'

async function failure(res: Response, lang: string, fallback: Parameters<typeof sayChat>[1]): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
  return new ApiError(body?.error?.message ?? sayChat(lang, fallback), body?.error?.code ?? 'http', res.status)
}

export interface Ask {
  message: string
  via: 'voice' | 'text'
  history: ChatTurn[]
  result: MenuResult
  profile: Profile
  voice?: { seconds: number }
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
