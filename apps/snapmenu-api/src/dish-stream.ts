import type { MenuRead, ModelDish } from './types.js'

/**
 * Reads the model's JSON answer while it is still arriving and hands out each
 * dish the moment its object closes, so the engine can estimate dish 1 while
 * the model is still writing dish 12.
 *
 * It only tracks strings and bracket depth; every dish is parsed with
 * JSON.parse, and `finish()` parses the complete text again as the one
 * authoritative result.
 */
export class DishStream {
  private text = ''
  private depth = 0
  private inString = false
  private escaped = false
  private stringStart = 0
  /** Last complete string seen directly inside the root object (a key or a value). */
  private lastRootString = ''
  private arrayStart = -1
  private arrayDone = false
  private dishStart = -1
  private headerCache: Partial<MenuRead> | null = null
  /** Dishes handed out so far. */
  readonly dishes: ModelDish[] = []
  get count(): number {
    return this.dishes.length
  }

  /** Feed the next piece of text; returns the dishes it completed. */
  push(delta: string): ModelDish[] {
    const base = this.text.length
    this.text += delta
    const out: ModelDish[] = []
    // Only the new piece is scanned; the full text is touched when a dish closes.
    for (let i = 0; i < delta.length; i++) {
      const ch = delta.charCodeAt(i)
      const pos = base + i
      if (this.inString) {
        if (this.escaped) this.escaped = false
        else if (ch === 92 /* \ */) this.escaped = true
        else if (ch === 34 /* " */) {
          this.inString = false
          if (this.depth === 1) this.lastRootString = this.text.slice(this.stringStart + 1, pos)
        }
        continue
      }
      if (ch === 34) {
        this.inString = true
        this.stringStart = pos
      } else if (ch === 123 /* { */ || ch === 91 /* [ */) {
        if (ch === 91 && this.depth === 1 && this.arrayStart < 0 && this.lastRootString === 'dishes') this.arrayStart = pos
        else if (ch === 123 && this.depth === 2 && this.arrayStart >= 0 && !this.arrayDone) this.dishStart = pos
        this.depth++
      } else if (ch === 125 /* } */ || ch === 93 /* ] */) {
        this.depth--
        if (ch === 125 && this.depth === 2 && this.dishStart >= 0) {
          try {
            const dish = JSON.parse(this.text.slice(this.dishStart, pos + 1)) as ModelDish
            out.push(dish)
            this.dishes.push(dish)
          } catch { /* finish() decides */ }
          this.dishStart = -1
        } else if (ch === 93 && this.depth === 1 && this.arrayStart >= 0) this.arrayDone = true
      }
    }
    return out
  }

  /** The fields written before the dish list (restaurant, language, cuisine), once the list has started. */
  header(): Partial<MenuRead> | null {
    if (this.headerCache || this.arrayStart < 0) return this.headerCache
    try {
      this.headerCache = JSON.parse(`${this.text.slice(0, this.arrayStart)}[]}`) as Partial<MenuRead>
    } catch {
      this.headerCache = {}
    }
    return this.headerCache
  }

  /** The complete answer. Throws when the text is not valid JSON. */
  finish(): MenuRead {
    return JSON.parse(this.text) as MenuRead
  }

  get length(): number {
    return this.text.length
  }
}
