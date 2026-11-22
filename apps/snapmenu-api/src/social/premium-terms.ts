import { BRAND } from '../brand.js'

/**
 * What the Premium sheet offers and the sentence a person agrees to. Its own
 * file, with no import from the Worker, because the web app shows both.
 */

/** What Premium could be. `id` is stored; `label` is what the sheet shows. */
export const PREMIUM_WANTS = [
  { id: 'voice', label: 'Voice messages' },
  { id: 'unlimited', label: 'Unlimited scans' },
  { id: 'groups', label: 'Group matching' },
  { id: 'plans', label: 'Daily suggestions' },
  { id: 'delivery', label: 'Delivery picks' },
  { id: 'imports', label: 'Saving from links' },
] as const

export const PREMIUM_CONSENT_VERSION = 'premium-2026-11-21'
/** The whole agreement, in one plain sentence pair. Shown above the button, stored with the row. */
export const PREMIUM_CONSENT = `${BRAND.name} emails you once, when Premium starts. No newsletter, and you can take your email off the list here anytime.`
