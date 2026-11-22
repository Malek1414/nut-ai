/**
 * The brand, in ONE place. Change the name or the tagline here and it changes
 * everywhere a person can read it: the page title, the wordmark, the home
 * screen manifest, share cards, link previews (OpenGraph), and the sentences
 * that name the app.
 *
 * Folders, packages, storage keys and type names keep their old "snapmenu"
 * spelling on purpose: they are not shown to anyone, and renaming a storage
 * key would lose what a phone already saved.
 *
 * No imports: the Worker, the web app and the Vite config all read this file.
 * After a change, run `npm run brand:assets -w @snapmenu/web` once to redraw
 * the two pictures that carry the name (public/og.png and the app icons).
 */
export const BRAND = {
  /** The name as written in a sentence and in the browser tab. */
  name: 'PlatePal',
  /** The wordmark in two tones: the first part in ink, the second in basil. */
  wordmark: ['plate', 'pal'],
  tagline: 'Scan the menu in front of you. Find what fits you.',
  /** One line for stores, link previews and the manifest. */
  description: 'Scan the menu in front of you. Find what fits you. Calories and protein as honest ranges, in your language.',
  /** Browser chrome and splash colours (the design tokens --bg and --basil). */
  background: '#F3F5EF',
  theme: '#F3F5EF',
  accent: '#1E6B4E',
} as const

/** The tagline as its sentences: ["Scan the menu in front of you.", "Find what fits you."]. */
export const taglineParts = (tagline: string = BRAND.tagline): string[] =>
  (tagline.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [tagline]).map((s) => s.trim()).filter(Boolean)

/** The name in lower case, as it is set in the wordmark and on share cards. */
export const brandWordmark = (): string => BRAND.wordmark.join('')

/** A file name for something the app lets a person save: "platepal-best-order.png". */
export const brandFile = (suffix: string): string => `${brandWordmark()}-${suffix}`
