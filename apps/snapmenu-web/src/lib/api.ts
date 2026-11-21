import type { MenuResult, Profile } from '../../../snapmenu-api/src/types'
import { store } from './storage'

export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message)
  }
}

export async function scanMenu(image: string, profile: Profile, signal?: AbortSignal): Promise<MenuResult> {
  let res: Response
  try {
    res = await fetch('/api/menu', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image, profile, deviceId: store.deviceId(), team: store.isTeam() }),
      ...(signal ? { signal } : {}),
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new ApiError('Cancelled.', 'aborted', 0)
    throw new ApiError('No connection. Check your internet and try again.', 'offline', 0)
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const err = (body as { error?: { code: string; message: string } } | null)?.error
    throw new ApiError(err?.message ?? `The server answered ${res.status}. Try again.`, err?.code ?? 'http', res.status)
  }
  return body as MenuResult
}

/** Fire-and-forget analytics. Never blocks or breaks the UI. */
export function track(type: string, props: Record<string, unknown> = {}) {
  try {
    const body = JSON.stringify({ type, props, deviceId: store.deviceId(), team: store.isTeam() })
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/event', new Blob([body], { type: 'application/json' }))
    } else {
      void fetch('/api/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {})
    }
  } catch {
    /* ignore */
  }
}
