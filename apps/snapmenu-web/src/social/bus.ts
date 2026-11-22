// The one way the rest of the app talks to this folder: a button anywhere calls `social.share(...)`,
// `social.openImport()` or `social.openPremium()`, and the SocialLayer mounted in App shows it.
import type { ShareItem } from './client'

export type Command = { type: 'share'; item: ShareItem } | { type: 'import'; url?: string | null } | { type: 'premium' }

const listeners = new Set<(c: Command) => void>()
const emit = (c: Command) => listeners.forEach((l) => l(c))

export const social = {
  /** Open the share sheet for a dish, a pick or a restaurant. */
  share: (item: ShareItem) => emit({ type: 'share', item }),
  /** Open "Save a meal from a link", optionally with a link already in hand. */
  openImport: (url?: string | null) => emit({ type: 'import', url: url ?? null }),
  /** Open the quiet "Get Premium early" sheet. */
  openPremium: () => emit({ type: 'premium' }),
  on(fn: (c: Command) => void): () => void {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  },
}
