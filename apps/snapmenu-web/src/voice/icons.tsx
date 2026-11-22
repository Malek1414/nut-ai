import * as Lucide from 'lucide-react'

/** The icons voice adds, in the app's one family (components/ui.tsx): 24px grid, 1.75 stroke, round caps and joins. */
const PATHS: Record<string, Lucide.LucideIcon> = { mic: Lucide.Mic, play: Lucide.Play, stop: Lucide.Square, lock: Lucide.LockKeyhole, chevLeft: Lucide.ChevronLeft, chevUp: Lucide.ChevronUp, retry: Lucide.RefreshCw }

export function VIcon({ name, size = 20, strokeWidth = 1.75 }: { name: keyof typeof PATHS | string; size?: number; strokeWidth?: number }) {
  const Glyph = PATHS[name]
  return Glyph ? <Glyph size={size} strokeWidth={strokeWidth} aria-hidden="true" /> : null
}
