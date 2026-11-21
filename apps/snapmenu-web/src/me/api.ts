import type { DishEstimate, Profile } from '../../../snapmenu-api/src/types'
import { errorText } from '../../../snapmenu-api/src/voice/index'
import { snapOfDish } from '../../../snapmenu-api/src/me/snap'
import type { DishSnap } from '../../../snapmenu-api/src/me/types'
import { ApiError, track } from '../lib/api'
import { phoneLocale } from '../lib/format'
import { store } from '../lib/storage'

/**
 * A typed dish ("2 eggs and toast") as dishes with the engine's numbers.
 * The Worker names the components; every number comes from the Nut AI engine.
 */
export async function estimateTyped(text: string, profile: Profile): Promise<DishSnap[]> {
  let res: Response
  try {
    res = await fetch('/api/me/estimate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, profile, locale: phoneLocale(), deviceId: store.deviceId(), team: store.isTeam() }),
      signal: AbortSignal.timeout(45_000),
    })
  } catch {
    throw new ApiError(errorText(profile.language, 'offline').message, 'offline', 0)
  }
  let body: unknown = null
  try { body = await res.json() } catch { /* a non-JSON error page */ }
  if (!res.ok) {
    const err = (body as { error?: { code: string; message: string } } | null)?.error
    throw new ApiError(err?.message ?? errorText(profile.language, 'http').message, err?.code ?? 'http', res.status)
  }
  const out = body as { dishes?: DishEstimate[]; source?: string }
  track('me_typed', { dishes: out.dishes?.length ?? 0, source: out.source ?? null })
  return (out.dishes ?? []).filter((d) => d.kcal.mid > 0).map((d) => snapOfDish(d, { place: null, goal: profile.goal, from: 'typed' }))
}
