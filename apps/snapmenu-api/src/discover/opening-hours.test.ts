import { describe, expect, it } from 'vitest'
import { deviceLocalTime, localTimeIn, mentionsHolidays, openStatus, weekRows, type LocalTime } from './opening-hours.js'

const SU = 0, MO = 1, TU = 2, WE = 3, TH = 4, FR = 5, SA = 6

/** A moment: weekday, "HH:MM", and a date for the values that depend on one (15 June by default). */
const at = (weekday: number, time: string, month = 6, day = 15): LocalTime => {
  const [h, m] = time.split(':').map(Number)
  return { weekday, minutes: h! * 60 + m!, month, day }
}

const UNKNOWN = { state: 'unknown' }
const open = (closesAt: string | null, closesInMin: number | null) => ({ state: 'open', closesAt, closesInMin })
const closed = (opensAt: string | null, opensInMin: number | null, opensWeekday: number | null) => ({ state: 'closed', opensAt, opensInMin, opensWeekday })

describe('openStatus: plain weekday hours', () => {
  const hours = 'Mo-Fr 11:00-22:00'

  it('is open inside a span and says when it closes', () => {
    expect(openStatus(hours, at(WE, '12:00'))).toEqual(open('22:00', 600))
    expect(openStatus('Mo-Su 08:00-20:00', at(SU, '19:59'))).toEqual(open('20:00', 1))
  })

  it('is closed outside and names the next opening, today or on a later day', () => {
    expect(openStatus(hours, at(WE, '10:00'))).toEqual(closed('11:00', 60, WE))
    expect(openStatus(hours, at(WE, '23:00'))).toEqual(closed('11:00', 720, TH))
    expect(openStatus(hours, at(FR, '23:00'))).toEqual(closed('11:00', 3600, MO))
    // The closing minute itself is closed.
    expect(openStatus(hours, at(WE, '22:00')).state).toBe('closed')
  })

  it('reads two spans a day and a second rule for the weekend', () => {
    const lunchAndDinner = 'Mo-Fr 11:30-15:00,17:30-23:00; Sa,Su 12:00-23:00'
    expect(openStatus(lunchAndDinner, at(TU, '16:00'))).toEqual(closed('17:30', 90, TU))
    expect(openStatus(lunchAndDinner, at(TU, '12:00'))).toEqual(open('15:00', 180))
    expect(openStatus(lunchAndDinner, at(SA, '13:00'))).toEqual(open('23:00', 600))
  })

  it('reads lists, wrapping day ranges and a rule with times only', () => {
    expect(openStatus('Mo,We,Fr 10:00-12:00', at(WE, '11:00')).state).toBe('open')
    expect(openStatus('Mo,We,Fr 10:00-12:00', at(TU, '11:00'))).toEqual(closed('10:00', 1380, WE))
    expect(openStatus('Mo-Th,Sa 11:00-22:00', at(FR, '12:00'))).toEqual(closed('11:00', 1380, SA))
    expect(openStatus('Fr-Mo 10:00-18:00', at(SU, '12:00'))).toEqual(open('18:00', 360))
    expect(openStatus('Fr-Mo 10:00-18:00', at(TU, '12:00'))).toEqual(closed('10:00', 4200, FR))
    expect(openStatus('11:00-23:00', at(SU, '12:00'))).toEqual(open('23:00', 660))
    expect(openStatus('09:00-18:00; Su off', at(SU, '10:00'))).toEqual(closed('09:00', 1380, MO))
  })

  it('tolerates the usual sloppiness: case, missing zeros, dots, long dashes, comments', () => {
    expect(openStatus('mo-fr 9:00-18:00', at(MO, '09:30'))).toEqual(open('18:00', 510))
    expect(openStatus('Mo-Fr 09.00-18.00', at(MO, '09:30'))).toEqual(open('18:00', 510))
    expect(openStatus('Mo – Fr 09:00 – 18:00', at(MO, '09:30'))).toEqual(open('18:00', 510))
    expect(openStatus('Mo-Fr: 09:00-18:00;', at(MO, '09:30'))).toEqual(open('18:00', 510))
    expect(openStatus('Mo-Fr 10:00-18:00 "Küche bis 17:30"', at(MO, '11:00'))).toEqual(open('18:00', 420))
  })
})

describe('openStatus: around the clock, all day, never', () => {
  it('names no closing time when it is open for a day or more', () => {
    expect(openStatus('24/7', at(TU, '03:00'))).toEqual(open(null, null))
    expect(openStatus('00:00-24:00', at(TU, '03:00'))).toEqual(open(null, null))
    expect(openStatus('Mo-Su 00:00-24:00', at(SA, '23:59'))).toEqual(open(null, null))
  })

  it('reads days without a time as open all day', () => {
    expect(openStatus('Mo-Fr', at(TU, '03:00'))).toEqual(open(null, null))
    expect(openStatus('Mo-Fr', at(FR, '12:00'))).toEqual(open('00:00', 720))
    expect(openStatus('Mo-Fr', at(SA, '12:00'))).toEqual(closed('00:00', 2160, MO))
  })

  it('reads "off" and "closed"', () => {
    expect(openStatus('Mo-Su 09:00-18:00; Su off', at(SU, '12:00'))).toEqual(closed('09:00', 1260, MO))
    expect(openStatus('Mo-Sa 09:00-18:00; Su closed', at(SU, '12:00'))).toEqual(closed('09:00', 1260, MO))
    expect(openStatus('off', at(MO, '12:00'))).toEqual(closed(null, null, null))
    expect(openStatus('24/7; Mo off', at(MO, '12:00'))).toEqual(closed('00:00', 720, TU))
  })
})

describe('openStatus: rule separators', () => {
  it('lets a later normal rule replace the day (specification behaviour)', () => {
    const hours = 'Mo-Su 10:00-22:00; We 10:00-16:00'
    expect(openStatus(hours, at(WE, '17:00'))).toEqual(closed('10:00', 1020, TH))
    expect(openStatus(hours, at(TU, '17:00'))).toEqual(open('22:00', 300))
    // The same days twice with ";": the second rule wins, lunch is gone.
    expect(openStatus('Mo-Fr 11:00-14:00; Mo-Fr 17:00-22:00', at(MO, '12:00'))).toEqual(closed('17:00', 300, MO))
  })

  it('lets a rule after a comma add to the day', () => {
    expect(openStatus('Mo-Fr 11:00-14:00, Mo-Fr 17:00-22:00', at(MO, '12:00'))).toEqual(open('14:00', 120))
    expect(openStatus('Mo-Fr 11:00-14:00, Mo-Fr 17:00-22:00', at(MO, '18:00'))).toEqual(open('22:00', 240))
    expect(openStatus('Mo-Fr 11:00-22:00, Sa-Su 12:00-20:00', at(SA, '19:00'))).toEqual(open('20:00', 60))
  })
})

describe('openStatus: past midnight', () => {
  it('counts a span that ends after midnight to the day it starts on', () => {
    expect(openStatus('Fr 18:00-02:00', at(FR, '23:30'))).toEqual(open('02:00', 150))
    expect(openStatus('Fr 18:00-02:00', at(SA, '01:00'))).toEqual(open('02:00', 60))
    expect(openStatus('Fr 18:00-02:00', at(SA, '03:00'))).toEqual(closed('18:00', 9540, FR))
    expect(openStatus('Fr 18:00-02:00', at(FR, '01:00'))).toEqual(closed('18:00', 1020, FR))
  })

  it('reads extended hours (26:00) and a daily late close', () => {
    expect(openStatus('Mo-Su 18:00-26:00', at(TU, '01:30'))).toEqual(open('02:00', 30))
    expect(openStatus('Mo-Su 10:00-02:00', at(TU, '01:30'))).toEqual(open('02:00', 30))
    expect(openStatus('Mo-Su 10:00-02:00', at(TU, '02:30'))).toEqual(closed('10:00', 450, TU))
  })

  it('does not guess when the next day has its own rule: the letter says closed, the mapper meant open', () => {
    const hours = 'Mo-Th 12:00-24:00; Fr,Sa 12:00-02:00; Su 12:00-22:00'
    expect(openStatus(hours, at(SA, '01:00'))).toEqual(open('02:00', 60))
    expect(openStatus(hours, at(SU, '01:00'))).toEqual(UNKNOWN)
    // Saturday evening is open, but when it closes is exactly that disputed stretch.
    expect(openStatus(hours, at(SA, '23:00'))).toEqual(open(null, null))
    expect(openStatus(hours, at(SU, '03:00'))).toEqual(closed('12:00', 540, SU))
    expect(openStatus('Mo-Su 18:00-02:00; Mo off', at(MO, '01:00'))).toEqual(UNKNOWN)
    expect(openStatus('Mo-Su 18:00-02:00; Mo off', at(MO, '19:00'))).toEqual(closed('18:00', 1380, TU))
  })

  it('keeps the late hours when the rules are joined with commas, as the specification advises', () => {
    const hours = 'Mo-Th 12:00-24:00, Fr,Sa 12:00-02:00, Su 12:00-22:00'
    expect(openStatus(hours, at(SU, '01:00'))).toEqual(open('02:00', 60))
    expect(openStatus(hours, at(SA, '23:00'))).toEqual(open('02:00', 180))
  })

  it('does not carry a late close over from a day whose rule was replaced', () => {
    const hours = 'Mo-Su 18:00-02:00; Sa 20:00-23:00'
    expect(openStatus(hours, at(SA, '21:00'))).toEqual(open('23:00', 120))
    expect(openStatus(hours, at(SU, '01:00'))).toEqual(UNKNOWN)
    expect(openStatus(hours, at(SU, '19:00'))).toEqual(open('02:00', 420))
  })
})

describe('openStatus: open end', () => {
  it('is open from the start time with no closing time', () => {
    expect(openStatus('Mo-Sa 17:00+', at(MO, '20:00'))).toEqual(open(null, null))
    expect(openStatus('Mo-Sa 17:00+', at(MO, '16:00'))).toEqual(closed('17:00', 60, MO))
    expect(openStatus('We 17:00-22:00+', at(WE, '21:00'))).toEqual(open(null, null))
  })

  it('is unknown for the hours after it, then closed', () => {
    expect(openStatus('Mo-Sa 17:00+', at(TU, '01:00'))).toEqual(UNKNOWN)
    expect(openStatus('Mo-Sa 17:00+', at(TU, '04:00'))).toEqual(closed('17:00', 780, TU))
    expect(openStatus('Mo-Sa 17:00+', at(SU, '01:00'))).toEqual(UNKNOWN)
    expect(openStatus('Mo-Sa 17:00+', at(SU, '12:00'))).toEqual(closed('17:00', 1740, MO))
    expect(openStatus('We 17:00-22:00+', at(WE, '23:00'))).toEqual(UNKNOWN)
    expect(openStatus('We 17:00-22:00+', at(TH, '01:00'))).toEqual(UNKNOWN)
    expect(openStatus('We 17:00-22:00+', at(TH, '03:00'))).toEqual(closed('17:00', 9480, WE))
  })
})

describe('openStatus: holidays, months and dates', () => {
  it('leaves holiday rules out, since we do not know the holidays', () => {
    expect(openStatus('Mo-Fr 09:00-18:00; PH off', at(WE, '10:00'))).toEqual(open('18:00', 480))
    expect(openStatus('Mo-Fr,PH 10:00-20:00', at(MO, '12:00'))).toEqual(open('20:00', 480))
    expect(openStatus('Mo-Fr,PH 10:00-20:00', at(SA, '12:00'))).toEqual(closed('10:00', 2760, MO))
    expect(openStatus('Mo-Sa 11:30-23:00; Su,PH 12:00-22:00', at(SU, '13:00'))).toEqual(open('22:00', 540))
    expect(openStatus('PH off', at(WE, '10:00'))).toEqual(UNKNOWN)
    expect(mentionsHolidays('Mo-Fr 09:00-18:00; PH off')).toBe(true)
    expect(mentionsHolidays('Mo-Fr 09:00-18:00; SH off')).toBe(true)
    expect(mentionsHolidays('Mo-Fr 09:00-18:00 "PH nach Absprache"')).toBe(false)
    expect(mentionsHolidays(null)).toBe(false)
  })

  it('reads month ranges, also over the turn of the year', () => {
    const seasons = 'Apr-Oct Mo-Su 10:00-22:00; Nov-Mar Mo-Fr 12:00-20:00'
    expect(openStatus(seasons, at(SA, '11:00', 7, 18))).toEqual(open('22:00', 660))
    expect(openStatus(seasons, at(SA, '11:00', 1, 17))).toEqual(closed('12:00', 2940, MO))
    expect(openStatus('Nov-Mar: Mo-Fr 12:00-20:00', at(MO, '13:00', 11, 23))).toEqual(open('20:00', 420))
    expect(openStatus('Nov-Mar: Mo-Fr 12:00-20:00', at(MO, '13:00', 6, 15))).toEqual(closed(null, null, null))
  })

  it('reads date ranges and steps over the end of a month and a year', () => {
    expect(openStatus('Mo-Su 10:00-22:00; Dec 24-26 off', at(FR, '12:00', 12, 25))).toEqual(closed('10:00', 2760, SU))
    expect(openStatus('Mo-Su 10:00-22:00; Dec 24-26 off', at(WE, '12:00', 12, 23))).toEqual(open('22:00', 600))
    expect(openStatus('Mo-Su 10:00-22:00; Jan 01 off', at(TH, '23:00', 12, 31))).toEqual(closed('10:00', 2100, SA))
    expect(openStatus('Mo-Su 10:00-22:00; Dec 24-Jan 02 off', at(MO, '12:00', 12, 28))).toEqual(closed('10:00', 8520, SU))
  })

  it('reads a short day and a list of days in one month', () => {
    const christmas = 'Mo-Su 09:00-22:00; Dec 24 09:00-14:00; Dec 25,26 off'
    expect(openStatus(christmas, at(TH, '13:00', 12, 24))).toEqual(open('14:00', 60))
    expect(openStatus(christmas, at(TH, '15:00', 12, 24))).toEqual(closed('09:00', 3960, SU))
    expect(openStatus(christmas, at(SA, '12:00', 12, 26)).state).toBe('closed')
    expect(openStatus(christmas, at(SU, '12:00', 12, 27))).toEqual(open('22:00', 600))
    expect(openStatus('Mo-Su 09:00-22:00; Dec 24-26,31 off', at(TH, '12:00', 12, 31)).state).toBe('closed')
    expect(openStatus('Mo-Su 09:00-22:00; Dec 24-26,31 off', at(WE, '12:00', 12, 30)).state).toBe('open')
    expect(openStatus('Mo-Su 09:00-22:00; Dec 25,26- off', at(WE, '12:00', 12, 30))).toEqual(UNKNOWN)
  })
})

describe('openStatus: anything else is unknown, never a guess', () => {
  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['sunrise and sunset', 'sunrise-sunset'],
    ['a fallback rule', 'Mo-Fr 09:00-18:00 || "by appointment"'],
    ['week numbers', 'week 1-26 Mo-Fr 10:00-18:00'],
    ['the nth weekday', 'Mo[1] 10:00-12:00'],
    ['a year', '2026 Dec 24 off'],
    ['German day names', 'Di-So 12:00-22:00'],
    ['German words', 'Montag-Freitag 9-18 Uhr'],
    ['three-letter day names', 'Mon-Fri 09:00-18:00'],
    ['a hole cut with off', 'Mo-Fr 08:00-18:00; Mo-Fr 12:00-13:00 off'],
    ['a rule without days after one with days', 'Mo-Fr 10:00-18:00; 12:00-13:00'],
    ['a start after midnight', 'Mo-Fr 25:00-26:00'],
    ['minutes over 59', 'Mo-Fr 10:75-18:00'],
    ['a span longer than a day', 'Mo 10:00-36:00'],
    ['words after the time', 'Mo-Fr 10:00-18:00 Uhr'],
    ['an unclosed comment', 'Mo-Fr 10:00-18:00 "lunch'],
    ['a dangling comma', 'Mo-Fr 10:00-18:00,'],
    ['an unknown state', 'Mo-Fr unknown'],
  ])('%s', (_name, value) => {
    expect(openStatus(value, at(WE, '12:00'))).toEqual(UNKNOWN)
    expect(weekRows(value, at(WE, '12:00'))).toBeNull()
  })

  it('missing values and a broken clock', () => {
    expect(openStatus(null, at(WE, '12:00'))).toEqual(UNKNOWN)
    expect(openStatus(undefined, at(WE, '12:00'))).toEqual(UNKNOWN)
    expect(openStatus('Mo-Fr 10:00-18:00', { weekday: 9, minutes: 0, month: 1, day: 1 })).toEqual(UNKNOWN)
    expect(openStatus('Mo-Fr 10:00-18:00', { weekday: 1, minutes: Number.NaN, month: 1, day: 1 })).toEqual(UNKNOWN)
    expect(weekRows(null, at(WE, '12:00'))).toBeNull()
  })
})

describe('weekRows', () => {
  const now = at(WE, '12:00')

  it('groups consecutive days with the same hours, Monday first', () => {
    expect(weekRows('Mo-Fr 11:00-22:00; Sa,Su off', now)).toEqual([
      { days: 'Mon–Fri', hours: '11:00–22:00' },
      { days: 'Sat, Sun', hours: 'Closed' },
    ])
    expect(weekRows('Mo,We 10:00-12:00', now)).toEqual([
      { days: 'Mon', hours: '10:00–12:00' },
      { days: 'Tue', hours: 'Closed' },
      { days: 'Wed', hours: '10:00–12:00' },
      { days: 'Thu–Sun', hours: 'Closed' },
    ])
  })

  it('joins several spans, keeps late hours under the day they start on, and names a full day', () => {
    expect(weekRows('Mo-Fr 11:30-15:00,17:30-23:00; Sa 12:00-02:00; Su off', now)).toEqual([
      { days: 'Mon–Fri', hours: '11:30–15:00, 17:30–23:00' },
      { days: 'Sat', hours: '12:00–02:00' },
      { days: 'Sun', hours: 'Closed' },
    ])
    expect(weekRows('24/7', now)).toEqual([{ days: 'Every day', hours: 'Open 24 hours' }])
    expect(weekRows('Mo-Su 10:00-24:00', now)).toEqual([{ days: 'Every day', hours: '10:00–00:00' }])
    expect(weekRows('Mo-Fr 11:00-14:00, Mo-Fr 17:00-22:00', now)?.[0]).toEqual({ days: 'Mon–Fri', hours: '11:00–14:00, 17:00–22:00' })
  })

  it('shows an open end as such', () => {
    expect(weekRows('Mo-Sa 17:00+', now)).toEqual([
      { days: 'Mon–Sat', hours: 'from 17:00' },
      { days: 'Sun', hours: 'Closed' },
    ])
    expect(weekRows('We 17:00-22:00+', now)).toEqual([
      { days: 'Mon, Tue', hours: 'Closed' },
      { days: 'Wed', hours: '17:00–22:00+' },
      { days: 'Thu–Sun', hours: 'Closed' },
    ])
  })

  it('evaluates months and dates for the coming seven days', () => {
    const seasons = 'Apr-Oct Mo-Su 10:00-22:00; Nov-Mar Mo-Fr 12:00-20:00'
    expect(weekRows(seasons, at(SA, '11:00', 1, 17))).toEqual([
      { days: 'Mon–Fri', hours: '12:00–20:00' },
      { days: 'Sat, Sun', hours: 'Closed' },
    ])
    expect(weekRows(seasons, at(SA, '11:00', 7, 18))).toEqual([{ days: 'Every day', hours: '10:00–22:00' }])
    // Wednesday 23 December: Thursday to Saturday are the 24th to the 26th.
    expect(weekRows('Mo-Su 10:00-22:00; Dec 24-26 off', at(WE, '12:00', 12, 23))).toEqual([
      { days: 'Mon–Wed', hours: '10:00–22:00' },
      { days: 'Thu–Sat', hours: 'Closed' },
      { days: 'Sun', hours: '10:00–22:00' },
    ])
  })

  it('takes other words for the labels', () => {
    expect(weekRows('Mo-Fr 09:00-17:00; Sa,Su off', now, { days: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'], closed: 'Geschlossen' })).toEqual([
      { days: 'Mo–Fr', hours: '09:00–17:00' },
      { days: 'Sa, So', hours: 'Geschlossen' },
    ])
  })
})

describe('the time at the restaurant', () => {
  it('reads the wall clock of a time zone, winter and summer', () => {
    expect(localTimeIn('Europe/Berlin', new Date('2026-11-22T10:30:00Z'))).toEqual({ weekday: SU, minutes: 690, month: 11, day: 22 })
    // 22:30 UTC on Wednesday 1 July is already Thursday 00:30 in Berlin.
    expect(localTimeIn('Europe/Berlin', new Date('2026-07-01T22:30:00Z'))).toEqual({ weekday: TH, minutes: 30, month: 7, day: 2 })
    expect(localTimeIn('Europe/Lisbon', new Date('2026-11-22T10:30:00Z'))).toEqual({ weekday: SU, minutes: 630, month: 11, day: 22 })
  })

  it('reads the phone clock', () => {
    expect(deviceLocalTime(new Date(2026, 10, 22, 11, 30))).toEqual({ weekday: SU, minutes: 690, month: 11, day: 22 })
  })

  it('feeds openStatus', () => {
    expect(openStatus('Mo-Sa 12:00-23:00; Su 12:00-22:00', localTimeIn('Europe/Berlin', new Date('2026-11-22T10:30:00Z')))).toEqual(closed('12:00', 30, SU))
  })
})
