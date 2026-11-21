/**
 * Opening hours from OpenStreetMap, read conservatively.
 *
 * A small parser for the common part of the `opening_hours` grammar
 * (https://wiki.openstreetmap.org/wiki/Key:opening_hours/specification): weekdays,
 * time spans (also past midnight and open-ended), `off`, `24/7`, month and
 * month-day ranges, and both rule separators. `;` starts a normal rule, which
 * replaces what earlier rules said for the days it names; `,` in front of a new
 * day starts an additional rule, which adds to them.
 *
 * Why not the `opening_hours` npm package: its licence (LGPL-3.0-only) would fit,
 * but it is 4.7 MB unpacked and brings i18next and suncalc, too heavy for a phone
 * and for a Worker on the free plan.
 *
 * The rule is the app's rule everywhere: never claim more than we know. A value
 * we do not fully understand is 'unknown', not a guess. Three moments inside a
 * value we do understand are 'unknown' as well:
 *   - the hours after an open end ("17:00+": open from 17:00, closing time not given);
 *   - a stretch past midnight that the next day's own rule replaces
 *     ("Fr,Sa 12:00-02:00; Su 12:00-22:00" at 01:00 on Sunday: closed by the letter
 *     of the specification, open by what the mapper most likely meant);
 *   - a stretch past midnight of a rule that was itself replaced on the day it starts.
 * Public and school holidays (PH, SH) are not known here, so rules for them are left out.
 *
 * Pure and without imports: the Worker and the web app both use this file.
 */

export interface LocalTime {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number
  /** Minutes since local midnight. */
  minutes: number
  /** 1-12. */
  month: number
  /** 1-31. */
  day: number
}

export type OpenStatus =
  /** `closesAt` like "22:00"; null when open around the clock, open-ended ("17:00+") or when the closing time is disputed. */
  | { state: 'open'; closesAt: string | null; closesInMin: number | null }
  /** `opensAt` like "11:30"; null when nothing opens in the next 7 days. `opensWeekday` equals the current weekday when it opens later today. */
  | { state: 'closed'; opensAt: string | null; opensInMin: number | null; opensWeekday: number | null }
  | { state: 'unknown' }

const DAY = 1440

/** One stretch of a day, in minutes from that day's midnight. `end` may pass midnight; "maybe still open" lasts until `tail`. */
interface Span { start: number; end: number; tail: number; openEnd: boolean; bare: boolean }
/** Month * 100 + day, both ends included; `from` greater than `to` runs over New Year. */
interface DateRange { from: number; to: number }
interface Rule {
  /** null: all year. */
  dates: DateRange[] | null
  /** Index 0 = Sunday; null: every day. */
  days: boolean[] | null
  spans: Span[]
  off: boolean
  /** Introduced by a comma: adds to earlier rules instead of replacing them. */
  additional: boolean
}

const ALL_DAY: Span = { start: 0, end: DAY, tail: DAY, openEnd: false, bare: false }

// ---------- Parsing ----------

const WEEKDAYS = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa']
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?![a-z])'
const WEEKDAY = '(mo|tu|we|th|fr|sa|su)(?![a-z])'
const DAYSEL = '(mo|tu|we|th|fr|sa|su|ph|sh)(?![a-z])'
const TIME = '(\\d{1,2})[:.](\\d{2})(?!\\d)'
const DAYNUM = '(\\d{1,2})(?![\\d:./])'
const sticky = (source: string) => new RegExp(source, 'y')
const RE = {
  always: sticky('24/7'),
  month: sticky(MONTH),
  weekday: sticky(WEEKDAY),
  daysel: sticky(DAYSEL),
  time: sticky(TIME),
  dayNum: sticky(DAYNUM),
  spaceDayNum: sticky(` ?${DAYNUM}`),
  state: sticky('(off|closed|open)(?![a-z])'),
  dash: sticky('-'),
  plus: sticky('\\+'),
  colon: sticky(':'),
  space: sticky(' '),
  dashWeekday: sticky(`-(?=${WEEKDAY})`),
  commaDaysel: sticky(`,(?=${DAYSEL})`),
  commaMonth: sticky(`,(?=${MONTH})`),
  commaDayNum: sticky(`,(?=${DAYNUM})`),
  commaTime: sticky(`,(?=${TIME})`),
  selector: sticky(`(?:${MONTH}|${DAYSEL})`),
}

/** The rules of a value, or null when any part of it is outside the grammar we support. */
function parse(value: string | null | undefined): Rule[] | null {
  if (typeof value !== 'string' || value.length > 400) return null
  const bare = value.replace(/"[^"]*"/g, ' ')
  if (bare.includes('"') || bare.includes('||')) return null
  const s = bare.replace(/[‐-―−]/g, '-').toLowerCase().replace(/\s+/g, ' ').replace(/ ?([-,;:+]) ?/g, '$1').trim()
  if (!s) return null

  let i = 0
  const at = (re: RegExp): RegExpExecArray | null => { re.lastIndex = i; return re.exec(s) }
  const take = (re: RegExp): RegExpExecArray | null => { const m = at(re); if (m) i = re.lastIndex; return m }

  const readTime = (): number | null => {
    const m = take(RE.time)
    if (!m) return null
    const minutes = Number(m[1]) * 60 + Number(m[2])
    return Number(m[2]) < 60 && minutes <= 2 * DAY ? minutes : null
  }

  const readSpans = (): Span[] | null => {
    const spans: Span[] = []
    for (;;) {
      const start = readTime()
      if (start === null || start >= DAY) return null
      if (take(RE.plus)) {
        // "17:00+": open from then on, closing time not given. After midnight it is anyone's guess for a few hours.
        spans.push({ start, end: DAY, tail: Math.max(DAY, Math.min(start + 600, DAY + 360)), openEnd: true, bare: true })
      } else {
        if (!take(RE.dash)) return null
        const to = readTime()
        if (to === null) return null
        // "18:00-02:00" ends on the next day; "10:00-10:00" is a full day, as in the reference parser.
        const end = to <= start ? to + DAY : to
        if (end - start > DAY) return null
        const openEnd = take(RE.plus) !== null
        spans.push({ start, end, tail: openEnd ? Math.max(end, Math.min(end + 240, DAY + 360)) : end, openEnd, bare: false })
      }
      if (!at(RE.commaTime)) return spans
      i += 1
    }
  }

  const readDays = (): { days: boolean[] | null; holidays: boolean } | null => {
    const days = [false, false, false, false, false, false, false]
    let named = false
    let holidays = false
    for (;;) {
      const a = take(RE.daysel)
      if (!a) return null
      if (a[1] === 'ph' || a[1] === 'sh') holidays = true
      else {
        const from = WEEKDAYS.indexOf(a[1]!)
        let to = from
        if (at(RE.dashWeekday)) {
          i += 1
          to = WEEKDAYS.indexOf(take(RE.weekday)![1]!)
        }
        // "Fr-Mo" wraps over the weekend.
        for (let d = from; ; d = (d + 1) % 7) { days[d] = true; if (d === to) break }
        named = true
      }
      if (!at(RE.commaDaysel)) break
      i += 1
    }
    return { days: named ? days : null, holidays }
  }

  const readDates = (): DateRange[] | null => {
    const out: DateRange[] = []
    for (;;) {
      const m1 = take(RE.month)
      if (!m1) return null
      const month = MONTHS.indexOf(m1[1]!) + 1
      const d1 = take(RE.spaceDayNum)
      const from = month * 100 + (d1 ? Number(d1[1]) : 1)
      let to = month * 100 + (d1 ? Number(d1[1]) : 31)
      if (take(RE.dash)) {
        const m2 = take(RE.month)
        if (m2) {
          // "Apr-Oct" or "Dec 24-Jan 02"; one end with a day and the other without is not understood.
          const d2 = take(RE.spaceDayNum)
          if ((d1 === null) !== (d2 === null)) return null
          to = (MONTHS.indexOf(m2[1]!) + 1) * 100 + (d2 ? Number(d2[1]) : 31)
        } else {
          // "Dec 24-26"
          const d2 = take(RE.dayNum)
          if (!d1 || !d2) return null
          to = month * 100 + Number(d2[1])
          if (to < from) return null
        }
      }
      if (from % 100 < 1 || from % 100 > 31 || to % 100 < 1 || to % 100 > 31) return null
      out.push({ from, to })
      // "Dec 25,26" and "Dec 24-26,31": more days of the same month.
      while (d1 && Math.floor(to / 100) === month && at(RE.commaDayNum)) {
        i += 1
        const first = Number(take(RE.dayNum)![1])
        let last = first
        if (take(RE.dash)) {
          const end = take(RE.dayNum)
          if (!end) return null
          last = Number(end[1])
        }
        if (first < 1 || last > 31 || last < first) return null
        out.push({ from: month * 100 + first, to: month * 100 + last })
      }
      if (!at(RE.commaMonth)) return out
      i += 1
    }
  }

  /** One rule: [months] [days] [times] [off|closed|open]. `skip` marks a rule that only names holidays. */
  const readRule = (additional: boolean): (Rule & { skip: boolean }) | null => {
    const begin = i
    let dates: DateRange[] | null = null
    let days: boolean[] | null = null
    let holidays = false
    let spans: Span[] = []
    if (take(RE.always)) spans = [ALL_DAY]
    else {
      if (at(RE.month)) {
        dates = readDates()
        if (!dates) return null
        take(RE.colon)
        take(RE.space)
      }
      if (at(RE.daysel)) {
        const d = readDays()
        if (!d) return null
        days = d.days
        holidays = d.holidays
        take(RE.colon)
        take(RE.space)
      }
      if (at(RE.time)) {
        const t = readSpans()
        if (!t) return null
        spans = t
      }
    }
    take(RE.space)
    const state = take(RE.state)
    if (i === begin) return null
    const off = state !== null && state[1] !== 'open'
    // "12:00-14:00 off" cuts a hole into earlier rules: not supported.
    if (off && spans.length > 0) return null
    // "Mo-Fr" without a time means open all day.
    if (!off && spans.length === 0) spans = [ALL_DAY]
    return { dates, days, spans, off, additional, skip: holidays && days === null }
  }

  const rules: Rule[] = []
  let additional = false
  for (;;) {
    take(RE.space)
    if (i >= s.length) break
    if (s[i] === ';') { i += 1; additional = false; continue }
    const rule = readRule(additional)
    if (!rule) return null
    if (!rule.skip) {
      // A rule without a day or a month, after one that has them, would not replace it but blend with it: not supported.
      const undated = rule.dates === null && rule.days === null
      if (undated && rules.some((r) => r.dates !== null || r.days !== null)) return null
      rules.push({ dates: rule.dates, days: rule.days, spans: rule.spans, off: rule.off, additional: rule.additional })
    }
    take(RE.space)
    if (i >= s.length) break
    if (s[i] === ';') { i += 1; additional = false; continue }
    // A comma here only makes sense in front of a new day or month: an additional rule.
    if (s[i] !== ',') return null
    i += 1
    if (!at(RE.selector)) return null
    additional = true
  }
  // Only holiday rules: we know nothing about a normal day.
  return rules.length > 0 ? rules : null
}

// ---------- One day ----------

interface DayKey { weekday: number; key: number }

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** The calendar day `n` days from `now`. The year is not known: February has 29 days only when today is the 29th. */
function shift(now: LocalTime, n: number): DayKey {
  const length = (m: number) => (m === 2 && now.month === 2 && now.day === 29 ? 29 : MONTH_DAYS[m - 1]!)
  let month = now.month
  let day = now.day + n
  while (day < 1) { month = month === 1 ? 12 : month - 1; day += length(month) }
  while (day > length(month)) { day -= length(month); month = month === 12 ? 1 : month + 1 }
  return { weekday: (((now.weekday + n) % 7) + 7) % 7, key: month * 100 + day }
}

const matches = (r: Rule, d: DayKey): boolean =>
  (r.days === null || r.days[d.weekday] === true) &&
  (r.dates === null || r.dates.some((x) => (x.from <= x.to ? d.key >= x.from && d.key <= x.to : d.key >= x.from || d.key <= x.to)))

/** The rules whose hours hold on a day, after the replacing is done. */
function liveRules(rules: Rule[], day: DayKey): Set<number> {
  let live = new Set<number>()
  rules.forEach((r, n) => {
    if (!matches(r, day)) return
    if (!r.additional || r.off) live = new Set<number>()
    if (!r.off) live.add(n)
  })
  return live
}

interface DayPlan {
  /** This day's own spans, as written (they may run past midnight). */
  own: Span[]
  /** What yesterday brings into this day, in this day's minutes: open until `end`, maybe open until `tail`. */
  carry: Array<{ end: number; tail: number; openEnd: boolean }>
  /** Minutes after midnight that are open by intent and closed by the letter (see the header): 'unknown'. */
  disputed: number
}

/**
 * A day's hours. The rules are walked in order, like the reference parser does:
 * a normal rule that names the day drops everything collected so far, including
 * what an earlier rule carried over from the evening before.
 */
function planDay(rules: Rule[], today: DayKey, yesterday: DayKey): DayPlan {
  const liveYesterday = liveRules(rules, yesterday)
  let own: Span[] = []
  let carry: DayPlan['carry'] = []
  let disputed = 0
  rules.forEach((r, n) => {
    if (matches(r, today)) {
      if (!r.additional || r.off) {
        for (const c of carry) disputed = Math.max(disputed, c.tail)
        own = []
        carry = []
      }
      if (!r.off) own = [...own, ...r.spans]
    }
    if (r.off || !matches(r, yesterday)) return
    for (const sp of r.spans) {
      if (sp.tail <= DAY) continue
      if (liveYesterday.has(n)) carry.push({ end: Math.max(0, sp.end - DAY), tail: sp.tail - DAY, openEnd: sp.openEnd })
      else disputed = Math.max(disputed, sp.tail - DAY)
    }
  })
  return { own, carry, disputed }
}

// ---------- Status ----------

interface Stretch { start: number; end: number; openEnd: boolean }

/** Open and maybe-open stretches from today's midnight on, in minutes; touching open stretches are joined. */
function timeline(rules: Rule[], now: LocalTime, days: number): { open: Stretch[]; maybe: Array<[number, number]> } {
  const open: Stretch[] = []
  const maybe: Array<[number, number]> = []
  for (let d = 0; d <= days; d++) {
    const base = d * DAY
    const plan = planDay(rules, shift(now, d), shift(now, d - 1))
    if (plan.disputed > 0) maybe.push([base, base + plan.disputed])
    for (const c of plan.carry) {
      if (c.end > 0) open.push({ start: base, end: base + c.end, openEnd: c.openEnd })
      if (c.tail > c.end) maybe.push([base + c.end, base + c.tail])
    }
    for (const sp of plan.own) {
      open.push({ start: base + sp.start, end: base + Math.min(sp.end, DAY), openEnd: sp.openEnd && sp.end <= DAY })
      if (sp.end < DAY && sp.tail > sp.end) maybe.push([base + sp.end, base + Math.min(sp.tail, DAY)])
    }
  }
  open.sort((a, b) => a.start - b.start)
  const joined: Stretch[] = []
  for (const st of open) {
    const last = joined[joined.length - 1]
    if (last && st.start <= last.end) {
      if (st.end > last.end) { last.end = st.end; last.openEnd = st.openEnd }
      else if (st.end === last.end) last.openEnd = last.openEnd || st.openEnd
    } else joined.push({ ...st })
  }
  return { open: joined, maybe }
}

const validTime = (n: LocalTime): boolean =>
  Number.isInteger(n.weekday) && n.weekday >= 0 && n.weekday <= 6 && n.minutes >= 0 && n.minutes < DAY &&
  Number.isInteger(n.month) && n.month >= 1 && n.month <= 12 && Number.isInteger(n.day) && n.day >= 1 && n.day <= 31

const two = (n: number) => String(n).padStart(2, '0')
/** Minutes as a clock time; 24:00 and later wrap ("02:00"). */
const clock = (minutes: number): string => {
  const m = ((minutes % DAY) + DAY) % DAY
  return `${two(Math.floor(m / 60))}:${two(m % 60)}`
}

/** Open or closed right now, from an OSM opening_hours value. Anything we do not fully understand is 'unknown', never a guess. */
export function openStatus(hours: string | null | undefined, now: LocalTime): OpenStatus {
  const rules = parse(hours)
  if (!rules || !validTime(now)) return { state: 'unknown' }
  const t = Math.floor(now.minutes)
  const { open, maybe } = timeline(rules, now, 8)
  const inMaybe = (m: number) => maybe.some(([a, b]) => a <= m && m < b)
  const current = open.find((s) => s.start <= t && t < s.end)
  if (current) {
    const left = current.end - t
    // No closing time to name: open for a day or more, an open end, or an end that is disputed.
    if (left >= DAY || current.openEnd || inMaybe(current.end)) return { state: 'open', closesAt: null, closesInMin: null }
    return { state: 'open', closesAt: clock(current.end), closesInMin: left }
  }
  if (inMaybe(t)) return { state: 'unknown' }
  const next = open.find((s) => s.start > t && s.start - t <= 7 * DAY)
  if (!next) return { state: 'closed', opensAt: null, opensInMin: null, opensWeekday: null }
  return { state: 'closed', opensAt: clock(next.start), opensInMin: next.start - t, opensWeekday: (now.weekday + Math.floor(next.start / DAY)) % 7 }
}

// ---------- The week, for display ----------

export interface WeekLabels {
  /** Seven day names, Monday first. */
  days: readonly string[]
  closed: string
  allDay: string
  everyDay: string
  /** The word in front of an open-ended time: "from 17:00". */
  from: string
}

const LABELS: WeekLabels = { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], closed: 'Closed', allDay: 'Open 24 hours', everyDay: 'Every day', from: 'from' }

function describe(own: Span[], labels: WeekLabels): string {
  if (own.length === 0) return labels.closed
  const joined: Span[] = []
  for (const sp of [...own].sort((a, b) => a.start - b.start)) {
    const last = joined[joined.length - 1]
    if (last && sp.start <= last.end) {
      if (sp.end > last.end) joined[joined.length - 1] = { ...sp, start: last.start, bare: false }
      else if (sp.end === last.end && sp.openEnd) joined[joined.length - 1] = { ...last, openEnd: true }
    } else joined.push(sp)
  }
  const only = joined[0]!
  if (joined.length === 1 && only.start === 0 && only.end >= DAY && !only.openEnd) return labels.allDay
  return joined
    .map((sp) => (sp.bare ? `${labels.from} ${clock(sp.start)}` : `${clock(sp.start)}–${clock(sp.end)}${sp.openEnd ? '+' : ''}`))
    .join(', ')
}

/**
 * The week for display, Monday first, consecutive days with the same hours grouped:
 * [{ days: 'Mon–Fri', hours: '11:00–22:00' }, { days: 'Sat, Sun', hours: 'Closed' }].
 * Each weekday is its next date from `now` on (today included), so month and date
 * rules ("Dec 24-26 off") show for the coming seven days. Hours stand under the day
 * they start on ("18:00–02:00" under Friday). All seven days alike are one row,
 * 'Every day'. null when the value is not understood.
 */
export function weekRows(hours: string | null | undefined, now: LocalTime, labels: Partial<WeekLabels> = {}): Array<{ days: string; hours: string }> | null {
  const rules = parse(hours)
  if (!rules || !validTime(now)) return null
  const l: WeekLabels = { ...LABELS, ...labels }
  const texts = [1, 2, 3, 4, 5, 6, 0].map((weekday) => {
    const ahead = (weekday - now.weekday + 7) % 7
    return describe(planDay(rules, shift(now, ahead), shift(now, ahead - 1)).own, l)
  })
  const rows: Array<{ days: string; hours: string }> = []
  for (let a = 0; a < 7; ) {
    let b = a
    while (b < 6 && texts[b + 1] === texts[a]) b += 1
    const first = l.days[a] ?? ''
    const last = l.days[b] ?? ''
    rows.push({ days: a === 0 && b === 6 ? l.everyDay : b === a ? first : b === a + 1 ? `${first}, ${last}` : `${first}–${last}`, hours: texts[a]! })
    a = b + 1
  }
  return rows
}

/** Whether the value has rules for public or school holidays. We cannot apply them, so the hours may differ on such a day. */
export function mentionsHolidays(hours: string | null | undefined): boolean {
  return typeof hours === 'string' && /(?:^|[^a-z])(?:ph|sh)(?![a-z])/i.test(hours.replace(/"[^"]*"/g, ' '))
}

// ---------- The time at the restaurant ----------

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The wall-clock time in a time zone ("Europe/Berlin"): opening hours are in the restaurant's local time, not the phone's. */
export function localTimeIn(timeZone: string, at: Date = new Date()): LocalTime {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    weekday: Math.max(0, SHORT_DAYS.indexOf(part('weekday'))),
    minutes: (Number(part('hour')) % 24) * 60 + Number(part('minute')),
    month: Number(part('month')),
    day: Number(part('day')),
  }
}

/** The phone's own wall-clock time: right when the phone is where the restaurant is. */
export function deviceLocalTime(at: Date = new Date()): LocalTime {
  return { weekday: at.getDay(), minutes: at.getHours() * 60 + at.getMinutes(), month: at.getMonth() + 1, day: at.getDate() }
}
