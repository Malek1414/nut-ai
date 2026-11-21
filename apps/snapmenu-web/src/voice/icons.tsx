import type { ReactNode } from 'react'

/** The icons voice adds, in the app's one family (components/ui.tsx): 24px grid, 1.75 stroke, round caps and joins. */
const PATHS: Record<string, ReactNode> = {
  mic: <><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5m-3 0h6" /></>,
  play: <path d="M8 5.5v13a.7.7 0 0 0 1.1.6l9.6-6.5a.7.7 0 0 0 0-1.2L9.1 4.9A.7.7 0 0 0 8 5.5Z" fill="currentColor" stroke="none" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" stroke="none" />,
  lock: <><rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
  chevLeft: <path d="m15 6-6 6 6 6" />,
  chevUp: <path d="m6 15 6-6 6 6" />,
  retry: <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4h-4" /></>,
}

export function VIcon({ name, size = 20, strokeWidth = 1.75 }: { name: keyof typeof PATHS | string; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name] ?? null}
    </svg>
  )
}
