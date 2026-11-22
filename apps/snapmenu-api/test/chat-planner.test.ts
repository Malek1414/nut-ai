import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatGroupLanguage, generateChatPlan, generateChatReply } from '../src/chats/planner.js'
import { PLACES_SCHEMA } from '../src/places.js'
import { parseOverpass } from '../src/overpass.js'
import { memoryD1 } from './d1-shim.js'

const member = (username: string, profile: object) => ({ username, snapshot: JSON.stringify({ goals: { profile } }) })
const sina = member('sina', { goal: 'plant_based', plantStyle: 'vegan', allergies: ['peanuts'], language: 'German' })
const theo = member('theo', { goal: 'build_muscle', diet: 'any', allergies: [], language: 'English' })

function fixture() {
  const db = memoryD1()
  PLACES_SCHEMA.forEach((sql) => db.raw.exec(sql))
  const insert = db.raw.prepare(`INSERT INTO place_dishes
    (place_id, place_name, lat, lng, kind, scan_id, seed, osm_verified, ts, name, kcal_low, kcal_mid, kcal_high, protein, carbs, fat, fiber, vegetarian, vegan)
    VALUES (?, ?, 52.523, ?, 'restaurant', ?, ?, ?, 1, ?, 420, 490, 540, ?, 52, 13, 6, ?, ?)`)
  function dish(id: number, restaurant: string, name: string, vegan: boolean, protein: number, options: { seed?: number; verified?: number; lng?: number } = {}) {
    insert.run(`n${id}`, restaurant, options.lng ?? 13.404, `scan-${id}`, options.seed ?? 0, options.verified ?? 1, name, protein, Number(vegan), Number(vegan))
  }
  return { db, dish }
}

describe('meal suggestions in a chat', () => {
  it('matches each saved profile against verified menus, including legacy diets and recorded allergen hints', async () => {
    const { db, dish } = fixture()
    for (const [id, restaurant] of ['Juniper Kitchen', 'Little Ginger', 'Saffron Table', 'Other Kitchen'].entries()) {
      dish(id, restaurant, 'Lentil bowl', true, 23)
      dish(id, restaurant, 'Chicken with rice', false, 40)
    }
    dish(12, 'Chicken shop', 'Chicken with rice', false, 40)
    dish(13, 'Noodle house', 'House noodles', true, 42)
    db.raw.prepare('INSERT INTO place_dish_hints VALUES (?, ?, ?, ?)').run('scan-13', 'House noodles', 'main', '["peanuts"]')
    const plan = await generateChatPlan(db, [sina, theo], {})
    expect(plan).toMatchObject({ area: 'berlin', missingProfiles: [], hasAllergies: true })
    expect(plan.options).toHaveLength(3)
    for (const option of plan.options) {
      expect(['Noodle house', 'Chicken shop']).not.toContain(option.name)
      expect(option.picks).toMatchObject([{ username: 'sina', dish: 'Lentil bowl' }, { username: 'theo', dish: 'Chicken with rice' }])
      expect(option.picks.every(pick => pick.why.length > 2)).toBe(true)
      expect(option.delivery).toHaveLength(3)
      expect(new URL(option.delivery[0]!.url).searchParams.get('q')).toBe(option.name)
    }
  })

  it('never fills a suggestion with illustrative or unverified menus, even if no real alternatives exist', async () => {
    const { db, dish } = fixture()
    dish(10, 'Example', 'Lentil bowl', true, 23, { seed: 1 })
    dish(11, 'Unverified', 'Lentil bowl', true, 23, { verified: 0 })
    const unknown = { username: 'newperson', snapshot: '{}' }
    expect(await generateChatPlan(db, [sina, unknown], {})).toMatchObject({ options: [], missingProfiles: ['newperson'] })
    dish(12, 'Scanned across town', 'Lentil bowl', true, 21, { lng: 13.46 })
    const result = await generateChatPlan(db, [sina, unknown], { lat: 52.523, lng: 13.404 })
    expect(result.area).toBe('local')
    expect(result.options.map(p => p.name)).toEqual(['Scanned across town'])
    expect(result.options[0]?.picks.map(p => p.username)).toEqual(['sina'])
    expect((await generateChatPlan(db, [unknown], {})).options).toEqual([])
  })

  it('uses the shared profile language as a fallback when the conversation language is unclear', () => {
    expect(chatGroupLanguage([theo, sina, member('jana', { goal: 'balanced', allergies: [], language: 'de-AT' })])).toBe('German')
    expect(chatGroupLanguage([], 'fr-FR')).toBe('French')
  })

  it('uses nearby cached restaurant identities and diet tags when scanned menus are scarce', async () => {
    const { db, dish } = fixture()
    const writeCell = db.raw.prepare('INSERT OR REPLACE INTO overpass_cache VALUES (?, ?, ?, ?, ?)')
    const node = (id: number, name: string, lon: number, tags: Record<string, string>) =>
      ({ type: 'node', id, lat: 52.523, lon, tags: { amenity: 'restaurant', name, ...tags } })
    const listed = [
      node(1, 'Chicken only', 13.404, { 'diet:vegan': 'yes' }),
      node(2, 'Vegetarian cafe', 13.405, { 'diet:vegetarian': 'yes' }),
      node(3, 'Around the corner', 13.405, { 'diet:vegan': 'yes' }),
      node(4, 'Farther away', 13.425, { 'diet:vegan': 'only' }),
      node(5, 'Much too far', 13.6, { 'diet:vegan': 'yes' }),
      node(6, 'Untagged kitchen', 13.404, {}),
    ]
    writeCell.run('cell1', Date.now(), 52.523, 13.404, JSON.stringify(parseOverpass({ elements: listed })))
    const vegan = member('val', { goal: 'balanced', diet: 'vegan', allergies: ['gluten'], language: 'English' })
    const first = await generateChatPlan(db, [theo, vegan], {})
    expect(first.options.map(p => p.name)).toEqual(['Chicken only', 'Around the corner', 'Farther away'])
    expect(first.options[0]).toMatchObject({ picks: [], menuNote: expect.stringContaining('cross-contact') })
    expect(first.options[0]?.menuNote).toContain('Vegan options')
    expect(first.options[0]?.menuNote).toContain('No scanned menu')
    expect(first.options[0]?.delivery[0]?.url).toContain('Chicken%20only')

    dish(1, 'Chicken only', 'Roast chicken', false, 45)
    dish(7, 'Scanned restaurant', 'Bean bowl', true, 27)
    const mixed = await generateChatPlan(db, [theo, vegan], {})
    expect(mixed.options.map(p => p.name)).toEqual(['Scanned restaurant', 'Around the corner', 'Farther away'])
    expect(mixed.options[0]?.picks).toHaveLength(2)
    expect(mixed.options[0]?.menuNote).toBeUndefined()
    expect(mixed.options.slice(1).every(p => !p.picks.length)).toBe(true)

    db.raw.exec("DELETE FROM place_dishes WHERE place_id='n7'")
    writeCell.run('cell1', Date.now(), 52.523, 13.404, JSON.stringify(parseOverpass({ elements: listed.slice(0, 2) })))
    expect((await generateChatPlan(db, [vegan], {})).options).toEqual([])
    const veg = member('jules', { goal: 'balanced', diet: 'vegetarian', allergies: [], language: 'English' })
    expect((await generateChatPlan(db, [veg], {})).options.map(p => p.name)).toEqual(['Vegetarian cafe'])
  })
})

describe('the @PlatePal reply', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends only bounded conversation and option names via the selected OpenAI adapter and gates the reply', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: 'Ich würde die Linsensuppe nehmen. Sie hat 238 Kalorien.' }, finish_reason: 'stop' }] }))
    vi.stubGlobal('fetch', fakeFetch)
    const text = await generateChatReply({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-openai-fixture', OPENAI_MODEL: 'fixture-model', ANTHROPIC_API_KEY: 'unused-fixture' }, {
      history: [...Array.from({ length: 10 }, (_, i) => ({ author: 'sina', text: `msg-${i}` })), { author: 'sina', text: '@PlatePal, was meinst du?' }],
      language: 'German', plan: { area: 'local', hasAllergies: true, missingProfiles: [], options: [
        { id: 'n12', name: 'Juniper', lat: 52.52, lng: 13.4, picks: [{ username: 'sina', dish: 'Linsensuppe', why: 'private preference' }], delivery: [] },
      ] },
    })
    expect(fakeFetch).toHaveBeenCalledTimes(1)
    const [url, request] = fakeFetch.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    const body = JSON.parse(request.body)
    expect(body).toMatchObject({ model: 'fixture-model', store: false })
    expect(body.messages[0].content).toContain('German')
    expect(body.messages[0].content).toContain('Sound like a friend')
    const payload = JSON.parse(body.messages[1].content)
    expect(payload.conversation).toHaveLength(8)
    expect(payload.mealOptions).toEqual([{ restaurant: 'Juniper', dishes: ['Linsensuppe'] }])
    expect(body.messages[1].content).not.toContain('private preference')
    expect(text).toBe('Ich würde die Linsensuppe nehmen.')
  })

  it('stays offline when the configured provider has no key', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(generateChatReply({ AI_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'unused-fixture' }, {
      history: [{ author: 'sina', text: '@PlatePal, dinner?' }],
    })).rejects.toThrow('unavailable')
    await expect(generateChatReply({ AI_PROVIDER: 'anthropic', OPENAI_API_KEY: 'unused-fixture', ANTHROPIC_API_KEY: 'unused-fixture' }, {
      history: [{ author: 'sina', text: '@PlatePal, dinner?' }],
    })).rejects.toThrow('unavailable')
    expect(fetch).not.toHaveBeenCalled()
  })
})
