/**
 * Which Claude model does which job. Both are settings, so a model is swapped
 * with a Worker variable (wrangler.toml `[vars]`, or .dev.vars locally) and no
 * code change:
 *
 *   MODEL_READ   reads the menu photo: dish names, translations, likely components
 *   MODEL_VOICE  writes the words a person reads: why a dish, how to order it your way
 *
 * Neither model is ever asked for a number that reaches the screen.
 */

/** Both jobs run on Claude Opus 5.5 unless a variable says otherwise. */
export const DEFAULT_MODEL = 'claude-opus-5-5'

/**
 * The model and request shape the first releases ran on. A request the AI
 * service turns down as it is configured (a mistyped model name, a setting the
 * model does not take) is sent again this way, so the worst case of a wrong
 * setting is the old behaviour, not a failed scan.
 */
export const PROVEN_MODEL = 'claude-sonnet-5-5'

export interface Models {
  read: string
  voice: string
}

/** A model setting as it may be used: a Claude model id, never a Haiku; anything else is the default. */
export function pickModel(value: unknown, fallback: string = DEFAULT_MODEL): string {
  if (typeof value !== 'string') return fallback
  const id = value.trim()
  if (!/^claude-[a-z0-9-]{3,60}$/.test(id) || id.includes('haiku')) return fallback
  return id
}

export function modelSettings(env: { MODEL_READ?: string | undefined; MODEL_VOICE?: string | undefined }): Models {
  return { read: pickModel(env.MODEL_READ), voice: pickModel(env.MODEL_VOICE) }
}

/**
 * The least thinking a model can be asked for. Reading a menu and wording a
 * sentence are not reasoning tasks, and thinking is time a phone user waits.
 *
 *   Claude Sonnet 5.5: `between_tools` turns up-front thinking off.
 *   Claude Opus 5.5 and the others: thinking cannot be switched off (the
 *   service answers 400 to `disabled` and `between_tools`), so the field is
 *   left out and `effort: low` keeps it short.
 *
 * Source: the thinking table in the Claude API docs, checked against the Models
 * API (`capabilities.thinking.types`) on 21 Nov 2026.
 */
export function thinkingFor(model: string): { type: 'between_tools' } | undefined {
  return model === 'claude-sonnet-5-5' ? { type: 'between_tools' } : undefined
}

export interface TimedScan {
  ms: number | null
  readMs?: number | null
  readModel: string | null
  voiceModel: string | null
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
}
const oneDecimal = (ms: number) => Math.round(ms / 100) / 10

/**
 * What a model setting costs a person in waiting: the median seconds of real
 * scans, by the models that answered them. Every scan logs its time and its
 * models, so two settings can be compared from normal use, most used first.
 */
export function scanSeconds(rows: TimedScan[]): Array<{ read: string; voice: string | null; scans: number; medianSeconds: number; medianReadSeconds: number | null }> {
  const groups = new Map<string, TimedScan[]>()
  for (const r of rows) {
    if (!r.readModel || typeof r.ms !== 'number' || !(r.ms > 0)) continue
    const key = `${r.readModel}|${r.voiceModel ?? ''}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  return [...groups.values()]
    .map((g) => {
      const reads = g.map((r) => r.readMs).filter((v): v is number => typeof v === 'number' && v > 0)
      return { read: g[0]!.readModel!, voice: g[0]!.voiceModel, scans: g.length, medianSeconds: oneDecimal(median(g.map((r) => r.ms!))), medianReadSeconds: reads.length ? oneDecimal(median(reads)) : null }
    })
    .sort((a, b) => b.scans - a.scans)
}

/** `thinking` and `output_config` for a quick, schema-shaped answer from `model`. */
export function quickAnswer(model: string, schema: object): { thinking?: { type: 'between_tools' }; output_config: { effort: 'low'; format: { type: 'json_schema'; schema: object } } } {
  const thinking = thinkingFor(model)
  return { ...(thinking ? { thinking } : {}), output_config: { effort: 'low', format: { type: 'json_schema', schema } } }
}
