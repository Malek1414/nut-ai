// Spring tokens from the team's wohin motion system (motion.json), used by the ported map pieces.
import type { Transition } from 'framer-motion'

const SPRINGS = { appear: { duration: 1, bounce: 0.2 }, state: { duration: 0.4, bounce: 0.2 } } as const
export type SpringName = keyof typeof SPRINGS

export const springTransition = (name: SpringName, delayMs = 0): Transition => ({ type: 'spring', ...SPRINGS[name], delay: delayMs / 1000 })
export const springTo = (name: SpringName, delayMs = 0) => ({ type: 'spring' as const, ...SPRINGS[name], delay: delayMs / 1000 })
