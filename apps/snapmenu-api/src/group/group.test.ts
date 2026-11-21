import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { PLACES_SCHEMA } from '../places.js'
import { SEED_SQL } from '../seed.js'
import { LANGUAGES } from '../voice/index.js'
import { memoryD1 } from '../../test/d1-shim.js'
import { needsRequest } from './ai.js'
import { centerOf, cleanCode, cleanMenu, GROUP_LIMITS, GROUP_SCHEMA, handleGroup, newCode, readNeeds, worthAsking, type GroupEnv } from './api.js'
import { GROUP_COPY, gsay } from './copy.js'
import { matchPlaces, pickFor, smallestConflict, type Candidate, type Member } from './match.js'
import { cleanName, cleanNeeds, EMPTY_NEEDS, mergeModelNeeds, numeralSaid, parseNeedsText } from './needs.js'
import type { GroupView, Needs } from './types.js'

const needs = (n: Partial<Needs> = {}): Needs => ({ ...EMPTY_NEEDS, ...n })
const person = (name: string, n: Partial<Needs> = {}): Member => ({ id: name.toLowerCase(), name, needs: needs(n) })
const dish = (name: string, priceEur: number | null, extra: Partial<Candidate> = {}): Candidate => ({
  name, translated: null, price: priceEur === null ? null : `${priceEur.toFixed(2).replace('.', ',')} €`, priceEur,
  kcal: { low: 480, mid: 600, high: 720 }, protein: 30, carbs: 60, fat: 22, fiber: 5, vegetarian: false, vegan: false, allergens: [], course: 'main', example: false, ...extra,
})

describe('parseNeedsText: needs from a note or a voice transcript', () => {
  it('reads a short English note', () => {
    expect(parseNeedsText('vegan, no nuts, max 10 euros').needs).toEqual({ diet: 'vegan', allergies: ['tree_nuts'], budget: 10 })
  })
  it('reads a German sentence the way it is spoken', () => {
    const out = parseNeedsText('Ich heiße Sara, ich bin Vegetarierin, allergisch gegen Nüsse und Sesam, will abnehmen und maximal 12 Euro ausgeben.')
    expect(out.needs).toEqual({ diet: 'vegetarian', allergies: ['tree_nuts', 'sesame'], goal: 'lose_fat', budget: 12 })
    expect(out.name).toBe('Sara')
  })
  it('fills in only what was said', () => {
    expect(parseNeedsText('I just want a lot of protein').needs).toEqual({ goal: 'build_muscle' })
    expect(parseNeedsText('hello there').needs).toEqual({})
    expect(parseNeedsText(null).needs).toEqual({})
  })
  it('takes a food as an allergy only when the person says they cannot have it', () => {
    expect(parseNeedsText('I love nuts and fish').needs.allergies).toBeUndefined()
    expect(parseNeedsText('no meat but fish is fine').needs).toEqual({ diet: 'vegetarian' })
    expect(parseNeedsText('lactose intolerant').needs.allergies).toEqual(['milk'])
    expect(parseNeedsText('Milch vertrage ich nicht').needs.allergies).toEqual(['milk'])
    expect(parseNeedsText('glutenfrei bitte').needs.allergies).toEqual(['gluten'])
    expect(parseNeedsText('Ich habe eine Nussallergie').needs.allergies).toEqual(['tree_nuts'])
    expect(parseNeedsText('peanut allergy, I eat everything else').needs.allergies).toEqual(['peanuts'])
    expect(parseNeedsText('sin gluten y sin mariscos').needs.allergies).toEqual(['gluten', 'shellfish'])
    expect(parseNeedsText('allergic to shrimp, eggs and soy').needs.allergies).toEqual(['eggs', 'soy', 'shellfish'])
  })
  it('does not turn "not vegan" into vegan', () => {
    expect(parseNeedsText('I am not vegan, I eat everything').needs.diet).toBe('any')
    expect(parseNeedsText('ich bin kein Vegetarier').needs.diet).toBeUndefined()
  })
  it('reads a budget from digits, number words and slang, in whole euros', () => {
    expect(parseNeedsText('budget is 15').needs.budget).toBe(15)
    expect(parseNeedsText('nicht mehr als 12,50 €').needs.budget).toBe(12)
    expect(parseNeedsText('€20 tops').needs.budget).toBe(20)
    expect(parseNeedsText('höchstens zehn Euro').needs.budget).toBe(10)
    expect(parseNeedsText('hab nur nen Zehner dabei').needs.budget).toBe(10)
    expect(parseNeedsText('between 10 and 15 euros').needs.budget).toBe(15)
    expect(parseNeedsText('table for 4 at 8').needs.budget).toBeUndefined()
  })
})

describe('cleanNeeds, cleanName', () => {
  it('keeps known values and drops the rest', () => {
    expect(cleanNeeds({ diet: 'vegan', allergies: ['tree_nuts', 'rocks', 7, 'milk'], goal: 'lose_fat', budget: 12.9 })).toEqual({ diet: 'vegan', allergies: ['milk', 'tree_nuts'], goal: 'lose_fat', budget: 12 })
    expect(cleanNeeds({ diet: 'carnivore', goal: 'x', budget: -3 })).toEqual(EMPTY_NEEDS)
    expect(cleanNeeds(null)).toEqual(EMPTY_NEEDS)
  })
  it('takes a first name and nothing that looks like a link or markup', () => {
    expect(cleanName('  Sara ')).toBe('Sara')
    expect(cleanName("Jean-Luc O'Neil")).toBe("Jean-Luc O'Neil")
    expect(cleanName('<b>x</b>')).toBeNull()
    expect(cleanName('a@b.de')).toBeNull()
    expect(cleanName('')).toBeNull()
    expect(cleanName('x'.repeat(25))).toBeNull()
  })
})

describe('mergeModelNeeds: the model only adds what passes the checks', () => {
  const text = 'Hi, Tom here. I do not eat dairy and I have about twenty euros.'
  const rules = parseNeedsText(text)
  it('takes list values and unions the allergies', () => {
    const out = mergeModelNeeds(rules, { diet: 'any', allergies: ['milk', 'plutonium'], goal: 'unknown', budget_eur: null, name: 'Tom' }, text)
    expect(out.needs.diet).toBe('any')
    expect(out.needs.allergies).toEqual(['milk'])
    expect(out.needs.goal).toBeUndefined()
    expect(out.name).toBe('Tom')
    expect(out.source).toBe('ai')
  })
  it('never shows a number the person did not say', () => {
    // "twenty euros" is read by the word rules; a number the model made up is dropped.
    expect(rules.needs.budget).toBe(20)
    expect(mergeModelNeeds(parseNeedsText('not much money on me'), { budget_eur: 8 }, 'not much money on me').needs.budget).toBeUndefined()
    expect(mergeModelNeeds(parseNeedsText('I have 14 on me'), { budget_eur: 14 }, 'I have 14 on me').needs.budget).toBe(14)
    expect(mergeModelNeeds(parseNeedsText('I have 140 on me'), { budget_eur: 14 }, 'I have 140 on me').needs.budget).toBeUndefined()
    expect(numeralSaid('10,50 €', 10)).toBe(true)
  })
  it('ignores a name that is not in the text, and anything that is not an object', () => {
    expect(mergeModelNeeds(rules, { name: 'Robert' }, text).name).toBeNull()
    expect(mergeModelNeeds(rules, 'vegan', text)).toBe(rules)
  })
  it('asks the reading model for picks from fixed lists', () => {
    const req = needsRequest('claude-opus-5-5', 'vegan')
    expect(req.model).toBe('claude-opus-5-5')
    expect(req.output_config.format.type).toBe('json_schema')
    expect(JSON.stringify(req.output_config.format.schema)).toContain('tree_nuts')
  })
})

describe('pickFor: a pick, or the needs in the way', () => {
  const menu = [
    dish('Pesto Pasta', 9, { vegetarian: true, allergens: ['tree_nuts', 'gluten', 'milk'] }),
    dish('Walnut Salad', 8, { vegetarian: true, vegan: true, allergens: ['tree_nuts'], course: 'starter' }),
    dish('Steak Frites', 18, { protein: 52 }),
    dish('Lentil Curry', 12, { vegetarian: true, vegan: true, protein: 24 }),
    dish('Tiramisu', 6, { vegetarian: true, course: 'dessert', allergens: ['milk', 'eggs'] }),
    dish('Cola', 3, { vegan: true, vegetarian: true, course: 'drink' }),
  ]
  it('names the two needs that cannot be met together', () => {
    const r = pickFor(person('Sara', { allergies: ['tree_nuts'], budget: 10 }), menu, 'English', 'menu')
    expect(r.pick).toBeNull()
    expect(r.blockers.map((b) => b.kind)).toEqual(['allergy', 'budget'])
    expect(r.conflict).toBe('Nothing on this menu fits Sara: no nuts, max 10 €.')
  })
  it('names one need when that one alone rules everything out', () => {
    const r = pickFor(person('Ben', { diet: 'vegan', allergies: ['tree_nuts'], budget: 5 }), menu, 'English', 'place')
    expect(r.conflict).toBe('Nothing here for Ben: max 5 €.')
  })
  it('picks the best dish for the goal among those that meet every need, and says what was checked', () => {
    const r = pickFor(person('Mia', { diet: 'vegan', allergies: ['tree_nuts'], budget: 15 }), menu, 'English', 'menu')
    expect(r.pick!.dish.name).toBe('Lentil Curry')
    expect(r.pick!.checks).toEqual(['vegan', 'no nuts named', 'within budget'])
    expect(r.pick!.fit).toBeGreaterThan(0)
    expect(r.pick!.why.length).toBeGreaterThan(5)
    expect(r.conflict).toBeNull()
  })
  it('never picks a drink or a dessert, and lists what else fits', () => {
    const r = pickFor(person('Tom', { goal: 'build_muscle' }), menu, 'English', 'menu')
    expect(r.pick!.dish.name).toBe('Steak Frites')
    expect(r.pick!.alsoFits.map((d) => d.name)).not.toContain('Tiramisu')
    expect(pickFor(person('Kid', { budget: 4 }), menu, 'English', 'menu').conflict).toBe('Nothing on this menu fits Kid: max 4 €.')
  })
  it('does not hold a budget against a menu that prints no prices', () => {
    const noPrices = menu.map((d) => ({ ...d, price: null, priceEur: null }))
    const r = pickFor(person('Sara', { allergies: ['tree_nuts'], budget: 10 }), noPrices, 'English', 'menu')
    expect(r.pick).not.toBeNull()
    expect(r.pick!.checks).toEqual(['no nuts named'])
  })
  it('a dish without a price cannot pass a budget when other dishes are priced', () => {
    const r = pickFor(person('Sara', { budget: 10 }), [dish('Market fish', null), dish('Steak', 18)], 'English', 'menu')
    expect(r.conflict).toBe('Nothing on this menu fits Sara: max 10 €.')
  })
  it('covers shrimp and mussels with "shellfish"', () => {
    const r = pickFor(person('Ada', { allergies: ['shellfish'] }), [dish('Paella', 14, { allergens: ['molluscs'] }), dish('Gambas', 12, { allergens: ['crustaceans'] })], 'English', 'menu')
    expect(r.conflict).toBe('Nothing on this menu fits Ada: no shellfish.')
  })
  it('talks in the person\'s language', () => {
    const r = pickFor(person('Sara', { allergies: ['tree_nuts'], budget: 10 }), menu, 'German', 'menu')
    expect(r.conflict).toBe('Auf dieser Karte passt nichts für Sara: ohne Nüsse, max. 10 €.')
  })
  it('has no opinion on an empty menu', () => {
    expect(pickFor(person('Sara', { diet: 'vegan' }), [], 'English', 'menu')).toEqual({ memberId: 'sara', pick: null, blockers: [], conflict: null })
  })
})

describe('smallestConflict', () => {
  const d = [dish('A', 5, { vegan: true, allergens: ['sesame'] }), dish('B', 20, { vegan: true }), dish('C', 5)]
  const tests: Record<string, (x: Candidate) => boolean> = { vegan: (x) => x.vegan, cheap: (x) => (x.priceEur ?? 99) <= 10, noSesame: (x) => !x.allergens.includes('sesame') }
  const ok = (need: string, x: Candidate) => tests[need]!(x)
  it('is empty when a dish meets everything', () => {
    expect(smallestConflict(['vegan', 'cheap'], d, ok)).toEqual([])
  })
  it('needs all three here: any two can be met', () => {
    expect(smallestConflict(['vegan', 'cheap', 'noSesame'], d, ok)).toEqual(['vegan', 'cheap', 'noSesame'])
  })
  it('finds the pair inside a longer list', () => {
    expect(smallestConflict(['vegan', 'cheap', 'noSesame'], [d[1]!, d[2]!], ok)).toEqual(['vegan', 'cheap'])
  })
})

describe('matchPlaces: nobody is averaged away', () => {
  const at = (id: string, name: string, distanceM: number, dishes: Candidate[]) => ({ place: { id, name, lat: 52.52, lng: 13.4, kind: 'restaurant', cuisine: null, address: null }, distanceM, dishes })
  const places = [
    at('n1', 'Steakhaus', 100, [dish('Rumpsteak', 24, { protein: 55 })]),
    at('n2', 'Green Bowl', 400, [dish('Tofu Bowl', 11, { vegan: true, vegetarian: true, allergens: ['soy'] }), dish('Chicken Bowl', 12, { protein: 40 })]),
    at('n3', 'Falafel Haus', 250, [dish('Falafel Teller', 8, { vegan: true, vegetarian: true, allergens: ['sesame'] })]),
  ]
  it('puts the place with a dish for everyone first, however far or however good the others are', () => {
    const out = matchPlaces([person('Tom', { goal: 'build_muscle' }), person('Lena', { diet: 'vegan' })], places, 'English')
    expect(out.matches.map((m) => [m.place.name, m.fits])).toEqual([['Green Bowl', 2], ['Falafel Haus', 2], ['Steakhaus', 1]])
    expect(out.noPlaceForAll).toBe(false)
    expect(out.conflicts).toEqual([])
    const steak = out.matches[2]!.results.find((r) => r.memberId === 'lena')!
    expect(steak.conflict).toBe('Nothing here for Lena: vegan.')
  })
  it('says who no place fits, and with which needs', () => {
    const out = matchPlaces([person('Tom'), person('Sara', { diet: 'vegan', allergies: ['sesame', 'soy'] })], places, 'English')
    expect(out.conflicts).toEqual([{ memberId: 'sara', text: 'No place nearby fits Sara: vegan, no sesame, no soy.' }])
    expect(out.noPlaceForAll).toBe(true)
    expect(out.matches.every((m) => m.fits === 1)).toBe(true)
  })
  it('says when no single place fits everyone although each person has one', () => {
    const out = matchPlaces([person('Tom', { budget: 9 }), person('Lena', { allergies: ['sesame'], diet: 'vegan' })], places, 'English')
    expect(out.conflicts).toEqual([])
    expect(out.noPlaceForAll).toBe(true)
  })
  it('ranks real scans before example data', () => {
    const ex = at('n4', 'Example Bowl', 50, [dish('Bowl', 9, { example: true })])
    const out = matchPlaces([person('Tom')], [ex, places[0]!], 'English')
    expect(out.matches.map((m) => m.place.name)).toEqual(['Steakhaus', 'Example Bowl'])
    expect(out.matches[1]!.example).toBe(true)
  })
})

describe('copy', () => {
  it('has every sentence in every language, with the same placeholders and no number typed in', () => {
    const keys = Object.keys(GROUP_COPY.English) as Array<keyof typeof GROUP_COPY.English>
    for (const l of LANGUAGES) {
      for (const k of keys) {
        const line = GROUP_COPY[l.id][k]
        expect(line, `${l.id} ${k}`).toBeTruthy()
        expect(line.match(/\{\w+\}/g)?.sort(), `${l.id} ${k}`).toEqual(GROUP_COPY.English[k].match(/\{\w+\}/g)?.sort())
        expect(/\p{N}/u.test(line), `${l.id} ${k}`).toBe(false)
      }
    }
    expect(gsay('fr-FR', 'need.budget', { budget: 12 })).toBe('max. 12 €')
    expect(gsay('Klingon', 'need.vegan')).toBe('vegan')
  })
})

// ---------- The routes, against real SQL ----------

const MITTE = { lat: 52.5235, lng: 13.404 }
const EVENTS_SQL = readFileSync(new URL('../../migrations/0001_events.sql', import.meta.url), 'utf8')

let db: ReturnType<typeof memoryD1>
let env: GroupEnv
beforeEach(async () => {
  db = memoryD1()
  await db.exec(EVENTS_SQL)
  for (const sql of [...PLACES_SCHEMA, ...GROUP_SCHEMA, ...SEED_SQL]) await db.prepare(sql).run()
  env = { DB: db }
})

const A = 'device-aaaa-1111', B = 'device-bbbb-2222', C = 'device-cccc-3333'

async function call<T = Record<string, unknown>>(method: 'GET' | 'POST', path: string, body: unknown = null, device: string | null = A, lang = 'en'): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-lang': lang }
  if (device) headers['x-device'] = device
  const url = new URL(`http://x${path}`)
  const res = await handleGroup(new Request(url, body === null ? { method, headers } : { method, headers, body: JSON.stringify(body) }), env, url)
  if (!res) throw new Error(`no route for ${path}`)
  return { status: res.status, body: (await res.json()) as T }
}

const openGroup = async (device = A) => (await call<{ id: string; group: GroupView }>('POST', '/api/group', { kind: 'group', ...MITTE }, device)).body
const joinAs = async (id: string, name: string, n: Partial<Needs>, device: string, extra: Record<string, unknown> = {}) =>
  (await call<{ memberId: string; group: GroupView }>('POST', '/api/group/join', { id, name, needs: needs(n), ...extra }, device)).body

describe('group routes: three friends plan a meal out', () => {
  it('opens a group with a link code and nobody in it', async () => {
    const { id, group } = await openGroup()
    expect(cleanCode(id)).toBe(id)
    expect(group).toMatchObject({ id, kind: 'group', members: [], matches: [], table: null })
  })

  it('finds places with a dish and a price for each friend, from the scans around them', async () => {
    const { id } = await openGroup()
    await joinAs(id, 'Tom', { goal: 'build_muscle' }, A)
    await joinAs(id, 'Lena', { diet: 'vegetarian', goal: 'lose_fat', budget: 12 }, B)
    const { group } = await joinAs(id, 'Sara', { diet: 'vegan', budget: 12 }, C)

    expect(group.members.map((m) => [m.name, m.mine])).toEqual([['Tom', false], ['Lena', false], ['Sara', true]])
    expect(group.noPlaceForAll).toBe(false)
    expect(group.conflicts).toEqual([])
    const first = group.matches[0]!
    expect(first.fits).toBe(3)
    expect(first.example).toBe(true)
    for (const r of first.results) {
      expect(r.pick, r.memberId).not.toBeNull()
      expect(r.pick!.dish.price).toMatch(/€/)
      expect(r.pick!.dish.kcal.low).toBeLessThanOrEqual(r.pick!.dish.kcal.high)
    }
    const sara = first.results[2]!.pick!
    expect(sara.dish.priceEur).toBeLessThanOrEqual(12)
    expect(sara.checks).toEqual(['vegan', 'within budget'])
    // Places that fit fewer people come later and say who is left out.
    const last = group.matches.at(-1)!
    expect(last.fits).toBeLessThan(3)
    expect(last.results.some((r) => r.conflict?.startsWith('Nothing here for '))).toBe(true)
  })

  it('says it out loud when no place nearby fits someone', async () => {
    const { id } = await openGroup()
    await joinAs(id, 'Tom', {}, A)
    const { group } = await joinAs(id, 'Sara', { diet: 'vegan', allergies: ['sesame'], budget: 10 }, B)
    expect(group.conflicts).toEqual([{ memberId: group.members[1]!.id, text: 'No place nearby fits Sara: vegan, no sesame, max 10 €.' }])
    expect(group.noPlaceForAll).toBe(true)
    expect(group.matches[0]!.fits).toBe(1)
    const german = await call<{ group: GroupView }>('GET', `/api/group?id=${id}`, null, C, 'de-DE')
    expect(german.body.group.conflicts[0]!.text).toBe('In der Nähe passt nichts für Sara: vegan, ohne Sesam, max. 10 €.')
  })

  it('lets each friend vote for one place, and move the vote', async () => {
    const { id } = await openGroup()
    const tom = await joinAs(id, 'Tom', {}, A)
    const lena = await joinAs(id, 'Lena', {}, B)
    const [p1, p2] = lena.group.matches.map((m) => m.place.id) as [string, string]
    await call('POST', '/api/group/vote', { id, memberId: tom.memberId, placeId: p1 }, A)
    await call('POST', '/api/group/vote', { id, memberId: lena.memberId, placeId: p1 }, B)
    let g = (await call<{ group: GroupView }>('POST', '/api/group/vote', { id, memberId: lena.memberId, placeId: p2 }, B)).body.group
    expect(g.matches.find((m) => m.place.id === p1)!.voters).toEqual([tom.memberId])
    expect(g.matches.find((m) => m.place.id === p2)!.voters).toEqual([lena.memberId])
    g = (await call<{ group: GroupView }>('POST', '/api/group/vote', { id, memberId: lena.memberId, placeId: null }, B)).body.group
    expect(g.matches.every((m) => !m.voters.includes(lena.memberId))).toBe(true)
    // Not your person, not your vote.
    expect((await call('POST', '/api/group/vote', { id, memberId: tom.memberId, placeId: p2 }, B)).status).toBe(403)
    expect((await call('POST', '/api/group/vote', { id, memberId: tom.memberId, placeId: 'x; DROP' }, A)).status).toBe(400)
  })

  it('only the phone that added a person may change them; the opener may remove anyone', async () => {
    const { id } = await openGroup(A)
    const lena = await joinAs(id, 'Lena', {}, B)
    expect((await call('POST', '/api/group/join', { id, memberId: lena.memberId, name: 'Hacked', needs: needs() }, C)).status).toBe(403)
    const edited = await joinAs(id, 'Lena', { diet: 'vegan' }, B, { memberId: lena.memberId })
    expect(edited.group.members).toHaveLength(1)
    expect(edited.group.members[0]!.needs.diet).toBe('vegan')
    expect((await call('POST', '/api/group/leave', { id, memberId: lena.memberId }, C)).status).toBe(403)
    const left = await call<{ group: GroupView }>('POST', '/api/group/leave', { id, memberId: lena.memberId }, A)
    expect(left.body.group.members).toEqual([])
  })

  it('answers "unchanged" to a poll until something changes', async () => {
    const { id, group } = await openGroup()
    expect((await call('GET', `/api/group?id=${id}&since=${group.updated}`)).body).toEqual({ unchanged: true, updated: group.updated })
    const joined = await joinAs(id, 'Tom', {}, A)
    expect(joined.group.updated).toBeGreaterThan(group.updated)
    const polled = await call<{ group: GroupView }>('GET', `/api/group?id=${id.toLowerCase()}&since=${group.updated}`)
    expect(polled.body.group.members).toHaveLength(1)
  })

  it('looks further out when nothing was scanned close by, and says so', async () => {
    const far = (await call<{ id: string }>('POST', '/api/group', { kind: 'group', lat: 52.49, lng: 13.42 })).body
    const { group } = await joinAs(far.id, 'Tom', {}, A)
    expect(group.wide).toBe(true)
    expect(group.matches.length).toBeGreaterThan(0)
    const nowhere = (await call<{ id: string }>('POST', '/api/group', { kind: 'group', lat: 48.1, lng: 11.5 })).body
    expect((await joinAs(nowhere.id, 'Tom', {}, A)).group.matches).toEqual([])
  })

  it('centres on the friends who shared where they are', () => {
    expect(centerOf({ lat: 1, lng: 1 }, [{ lat: 52, lng: 13 }, { lat: 54, lng: 15 }, { lat: null, lng: null }])).toEqual({ lat: 53, lng: 14 })
    expect(centerOf({ lat: 1, lng: 2 }, [{ lat: null, lng: null }])).toEqual({ lat: 1, lng: 2 })
    expect(centerOf({ lat: null, lng: null }, [])).toBeNull()
  })

  it('refuses bad input and unknown links', async () => {
    expect((await call('GET', '/api/group?id=NOPE')).status).toBe(404)
    expect((await call('GET', `/api/group?id=${newCode()}`)).status).toBe(404)
    const { id } = await openGroup()
    expect((await call('POST', '/api/group/join', { id, name: '', needs: {} })).status).toBe(400)
    expect((await call('POST', '/api/group/join', { id, name: 'www.spam.com', needs: {} })).status).toBe(400)
    expect((await call('POST', '/api/group', { kind: 'group', ...MITTE }, null)).status).toBe(400)
    expect((await call('POST', '/api/group', { kind: 'table' })).status).toBe(400)
    expect(await handleGroup(new Request('http://x/api/places'), env, new URL('http://x/api/places'))).toBeNull()
  })

  it('stops at twelve people and thirty groups an hour from one phone', async () => {
    const { id } = await openGroup()
    for (let i = 0; i < GROUP_LIMITS.members; i++) await joinAs(id, `P${i}`, {}, A)
    expect((await call('POST', '/api/group/join', { id, name: 'Late', needs: {} })).status).toBe(409)
    for (let i = 1; i < GROUP_LIMITS.opens.max; i++) await openGroup(B)
    expect((await call('POST', '/api/group', { kind: 'group', ...MITTE }, B)).status).toBe(200)
    expect((await call('POST', '/api/group', { kind: 'group', ...MITTE }, B)).status).toBe(429)
  })
})

const scanned = (name: string, price: string | null, extra: Record<string, unknown> = {}) => ({
  name, translated: `${name} (en)`, price, course: 'main', kcal: { low: 400, mid: 520, high: 640 }, protein: 28, carbs: 50, fat: 18, fiber: 6, vegetarian: false, vegan: false, allergens: [], ...extra,
})
const MENU = {
  scanId: 'scan-1', restaurant: 'Trattoria da Nonna',
  dishes: [
    scanned('Penne al pesto', '9,50 €', { vegetarian: true, allergens: ['gluten', 'milk'] }),
    scanned('Tagliata di manzo', '19,00 €', { protein: 48 }),
    scanned('Insalata di ceci', '8,00 €', { vegetarian: true, vegan: true }),
    scanned('Broken', '5 €', { kcal: { low: 900, mid: 500, high: 700 } }),
    scanned('Tiramisù', '6,00 €', { course: 'dessert', vegetarian: true }),
  ],
}

describe('table mode: one scanned menu, a pick per person', () => {
  it('opens a table from a scan without any restaurant listing', async () => {
    const { id, group } = (await call<{ id: string; group: GroupView }>('POST', '/api/group', { kind: 'table', menu: MENU })).body
    expect(group.kind).toBe('table')
    expect(group.table).toEqual({ restaurant: 'Trattoria da Nonna', dishes: 4, results: [] })
    await joinAs(id, 'Tom', { goal: 'build_muscle' }, A)
    await joinAs(id, 'Mia', { diet: 'vegan', budget: 10 }, A)
    const out = await joinAs(id, 'Sara', { allergies: ['tree_nuts'], budget: 9 }, B)
    const picks = out.group.table!.results.map((r) => r.pick?.dish.name ?? r.conflict)
    // Pesto names nuts by its own word even though the scan did not flag it.
    expect(picks).toEqual(['Tagliata di manzo', 'Insalata di ceci', 'Insalata di ceci'])
    expect(out.group.table!.results[2]!.pick!.checks).toEqual(['no nuts named', 'within budget'])
    expect(out.group.matches).toEqual([])
    // One phone can hold several people at the table.
    expect(out.group.members.map((m) => m.mine)).toEqual([false, false, true])
  })

  it('says who has nothing on this menu', async () => {
    const { id } = (await call<{ id: string }>('POST', '/api/group', { kind: 'table', menu: MENU })).body
    const out = await joinAs(id, 'Sara', { diet: 'vegan', budget: 7 }, A)
    // The dessert is cheaper, but a dessert is not a meal: the budget alone is in the way.
    expect(out.group.table!.results[0]).toMatchObject({ pick: null, conflict: 'Nothing on this menu fits Sara: max 7 €.' })
  })

  it('a group that arrives at the restaurant scans the menu and keeps its people', async () => {
    const { id } = await openGroup(A)
    await joinAs(id, 'Tom', { goal: 'build_muscle' }, A)
    await joinAs(id, 'Mia', { diet: 'vegan' }, B)
    expect((await call('POST', '/api/group/menu', { id, menu: MENU }, C)).status).toBe(403)
    const seated = (await call<{ group: GroupView }>('POST', '/api/group/menu', { id, menu: MENU }, B)).body.group
    expect(seated.kind).toBe('group')
    expect(seated.table!.results.map((r) => r.pick?.dish.name)).toEqual(['Tagliata di manzo', 'Insalata di ceci'])
    const back = (await call<{ group: GroupView }>('POST', '/api/group/menu', { id, menu: null }, A)).body.group
    expect(back.table).toBeNull()
    expect(back.matches.length).toBeGreaterThan(0)
  })

  it('checks a menu like a scan filed on the map', () => {
    expect(cleanMenu({ dishes: [] })).toBeNull()
    expect(cleanMenu({ dishes: [{ name: 'x' }] })).toBeNull()
    const m = cleanMenu({ ...MENU, dishes: [...MENU.dishes, MENU.dishes[0], scanned('Falafel', null, { allergens: ['uranium'] })] })!
    expect(m.dishes.map((d) => d.name)).toEqual(['Penne al pesto', 'Tagliata di manzo', 'Insalata di ceci', 'Tiramisù', 'Falafel'])
    expect(m.dishes[0]!.allergens).toEqual(['gluten', 'milk', 'tree_nuts'])
    expect(m.dishes[4]!).toMatchObject({ priceEur: null, allergens: ['sesame'] })
    expect(cleanMenu({ dishes: Array.from({ length: 80 }, (_x, i) => scanned(`Dish ${i}`, null)) })!.dishes).toHaveLength(GROUP_LIMITS.menuDishes)
  })
})

describe('POST /api/group/needs: text to needs', () => {
  const viewer = { device: A, team: false, lang: 'English' as const }
  const sentence = 'Hey I am Tom and I really cannot have any dairy at all'

  it('answers from the word rules alone when there is no AI key', async () => {
    const res = await call<{ needs: Partial<Needs>; source: string }>('POST', '/api/group/needs', { text: 'vegan, no nuts, max 10 euros' })
    expect(res.body).toEqual({ needs: { diet: 'vegan', allergies: ['tree_nuts'], budget: 10 }, name: null, source: 'rules' })
    expect((await call('POST', '/api/group/needs', { text: ' ' })).status).toBe(400)
  })

  it('asks the model only for a sentence that leaves something open', () => {
    expect(worthAsking('vegan no nuts', parseNeedsText('vegan no nuts'))).toBe(false)
    expect(worthAsking(sentence, parseNeedsText(sentence))).toBe(true)
    const full = 'I am vegan, allergic to nuts, want to lose weight and have 10 euros'
    expect(worthAsking(full, parseNeedsText(full))).toBe(false)
  })

  it('adds the model\'s reading, checked, and counts the call', async () => {
    const asked: string[] = []
    const out = await readNeeds({ ...env, ANTHROPIC_API_KEY: 'test-not-a-real-key' }, viewer, sentence, async (_ai, text) => { asked.push(text); return { diet: 'unknown', allergies: ['milk'], goal: 'unknown', budget_eur: 25, name: 'Tom' } })
    expect(asked).toEqual([sentence])
    expect(out).toEqual({ needs: { allergies: ['milk'] }, name: 'Tom', source: 'ai' })
    const n = await db.prepare("SELECT COUNT(*) c FROM events WHERE type = 'group_needs_ai'").first<{ c: number }>()
    expect(n!.c).toBe(1)
  })

  it('keeps the word rules when the model fails, and stops asking past the hourly limit', async () => {
    const withKey = { ...env, ANTHROPIC_API_KEY: 'test-not-a-real-key' }
    const failed = await readNeeds(withKey, viewer, sentence, async () => { throw new Error('down') })
    expect(failed.source).toBe('rules')
    let calls = 0
    for (let i = 0; i < GROUP_LIMITS.ai.perDevice + 3; i++) await readNeeds(withKey, viewer, sentence, async () => { calls++; return {} })
    // One call was already counted for this phone above.
    expect(calls).toBe(GROUP_LIMITS.ai.perDevice - 1)
    // No phone id, no model call.
    await readNeeds(withKey, { ...viewer, device: null }, sentence, async () => { calls += 100; return {} })
    expect(calls).toBe(GROUP_LIMITS.ai.perDevice - 1)
  })
})
