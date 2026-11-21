import { describe, expect, it } from 'vitest'
import type { MenuResult } from '../types.js'
import { foodOnly, isAlcoholic, isDrink, visibleDrinks, type DrinkLike } from './drinks.js'

const drink = (name: string, more: Partial<DrinkLike> = {}): DrinkLike => ({ name, course: 'drink', ...more })

describe('isAlcoholic: the nine languages', () => {
  it.each([
    ['English', 'Draught beer'], ['German', 'Weißbier vom Fass'], ['Spanish', 'Cerveza'], ['French', 'Bière pression'], ['Italian', 'Birra alla spina'],
    ['Portuguese', 'Cerveja'], ['Turkish', 'Efes Bira'], ['Polish', 'Piwo jasne'], ['Dutch', 'Biertje'],
  ])('beer in %s: %s', (_lang, name) => expect(isAlcoholic(drink(name))).toBe(true))

  it.each([
    ['English', 'House red wine'], ['German', 'Weißweinschorle'], ['Spanish', 'Vino tinto'], ['French', 'Vin rouge (verre)'], ['Italian', 'Vino della casa'],
    ['Portuguese', 'Vinho verde'], ['Turkish', 'Kırmızı şarap'], ['Polish', 'Wino czerwone'], ['Dutch', 'Rode wijn'],
  ])('wine in %s: %s', (_lang, name) => expect(isAlcoholic(drink(name))).toBe(true))

  it.each([
    'Berliner Pilsner 0,5l', 'Augustiner Hell', 'Kölsch', 'Radler', 'Pale Ale', 'IPA', 'Hefeweizen', 'Bananenweizen', 'Berliner Weiße mit Schuss',
    'Glühwein', 'Riesling trocken', 'Prosecco', 'Sekt auf Eis', 'Rosé', 'Sangría', 'Port', 'Apfelwein', 'Cidre brut',
    'Aperol Spritz', 'Hugo', 'Negroni', 'Mojito', 'Caipirinha', 'Margarita', 'Espresso Martini', 'Moscow Mule', 'Gin Tonic', 'Cuba Libre', 'Piña Colada',
    'Wódka', 'Whiskey Sour', 'Rakı', 'Ouzo', 'Grappa', 'Obstschnaps', 'Eierlikör', 'Jägermeister', 'Limoncello', 'Amaro', 'Sake', 'Soju', 'Korn', 'Tequila Shot',
    'Longdrink', 'Cocktail des Hauses', 'Heiße Schokolade mit Schuss', 'Tschunk',
  ])('%s is alcoholic', (name) => expect(isAlcoholic(drink(name))).toBe(true))
})

describe('isAlcoholic: said to be alcohol-free', () => {
  it.each([
    'Weizen alkoholfrei', 'Alkoholfreies Bier', 'Alcohol-free beer', 'Alcohol free lager', 'Non-alcoholic wine', 'Bière sans alcool', 'Cerveza sin alcohol',
    'Birra analcolica', 'Aperitivo senza alcol', 'Cerveja sem álcool', 'Alkolsüz bira', 'Piwo bezalkoholowe', 'Alcoholvrij bier',
    'Heineken 0.0', 'Pils 0,0%', 'Virgin Mojito', 'Mocktail', 'Hugo (alkoholfrei)', 'Jever Fun',
  ])('%s is not alcoholic', (name) => expect(isAlcoholic(drink(name))).toBe(false))

  it('reads the marker in the description too', () => {
    expect(isAlcoholic(drink('Erdinger Weizen', { description: 'alkoholfrei' }))).toBe(false)
  })

  it('keeps a drink alcoholic when alcohol-free is only an option', () => {
    expect(isAlcoholic(drink('Mojito', { description: 'Rum, mint and lime. Also available alcohol-free' }))).toBe(true)
    expect(isAlcoholic(drink('Hefeweizen / alkoholfrei'))).toBe(true)
    expect(isAlcoholic(drink('Pils oder alkoholfreies Pils'))).toBe(true)
  })

  it('does not read a size as 0,0', () => {
    expect(isAlcoholic(drink('Pils 0,3l'))).toBe(true)
    expect(isAlcoholic(drink('Schnaps 0,04 l'))).toBe(true)
  })
})

describe('isAlcoholic: soft drinks and false friends', () => {
  it.each([
    'Ginger Ale', 'Ginger Beer', 'Root Beer', 'Malzbier', 'Malt beer', 'Kombucha', 'Bitter Lemon', 'Apple cider vinegar tonic', 'Weintraubensaft',
    'Portion Kaffee', 'Ginger Lemonade', 'Ingwertee', 'Popcorn Shake', 'Rumpsteak', 'Tomatensaft Vinaigrette', 'Principal Blend Coffee', 'Bockshornklee Tee',
    'Twine Iced Tea', 'Sprite', 'Limonade', 'Kirschsaft', 'Apfelschorle', 'Traubensaft', 'Butterscotch Latte', 'Buchweizen Tee',
    'Ingwer Shot', 'Espresso (double shot)', 'Latte with a shot of espresso', 'Rose Lemonade', 'Fruchtcocktail', 'Club-Mate', 'Fritz-Kola', 'Ayran', 'Çay', 'Mineralwasser',
  ])('%s is not alcoholic', (name) => expect(isAlcoholic(drink(name))).toBe(false))

  it('does not take an everyday word in a description for a drink', () => {
    expect(isAlcoholic(drink('Lemoniada', { description: 'Domowa, ale bez cukru' }))).toBe(false)
    expect(isAlcoholic(drink('Caffè', { description: 'Amaro, senza zucchero' }))).toBe(false)
    expect(isAlcoholic(drink('Flat White', { description: 'With an extra shot' }))).toBe(false)
  })

  it('is never alcoholic for a dish that is not a drink', () => {
    expect(isAlcoholic({ name: 'Coq au vin', course: 'main' })).toBe(false)
    expect(isAlcoholic({ name: 'Bier', translated: 'Beer' })).toBe(false)
    expect(isDrink({ name: 'Coq au vin', course: 'main' })).toBe(false)
    expect(isDrink(drink('Cola'))).toBe(true)
  })
})

describe('isAlcoholic: description and components', () => {
  it('finds a cocktail through its components alone', () => {
    expect(isAlcoholic(drink('Sommerliebe', { rows: [{ name: 'Prosecco' }, { name: 'Elderflower syrup' }] }))).toBe(true)
    expect(isAlcoholic(drink('Hugo', { rows: [{ name: 'Prosecco' }, { name: 'Elderflower syrup' }] }))).toBe(true)
    expect(isAlcoholic(drink('Hausgetränk', { rows: [{ name: 'Dark rum' }, { name: 'Cola' }] }))).toBe(true)
  })

  it('finds it through the translation or the description', () => {
    expect(isAlcoholic(drink('Sommertraum', { description: 'Sparkling wine with peach' }))).toBe(true)
    expect(isAlcoholic(drink('Tyskie', { translated: 'Tyskie (Polish lager beer)' }))).toBe(true)
  })

  it('a mixer does not hide the spirit, and a soft component is not a spirit', () => {
    expect(isAlcoholic(drink('Munich Special', { rows: [{ name: 'Vodka' }, { name: 'Ginger beer' }, { name: 'Lime juice' }] }))).toBe(true)
    expect(isAlcoholic(drink('Ginger Beer', { rows: [{ name: 'Ginger beer' }] }))).toBe(false)
    expect(isAlcoholic(drink('Clausthaler', { rows: [{ name: 'Non-alcoholic beer' }] }))).toBe(false)
  })
})

describe('visibleDrinks', () => {
  const dishes: DrinkLike[] = [
    { name: 'Schnitzel', course: 'main' },
    drink('Pils'),
    drink('Cola'),
    drink('Rotwein'),
    drink('Wasser'),
  ]

  it('hides alcohol until the viewer is an adult, and counts what it hid', () => {
    const v = visibleDrinks(dishes, false)
    expect(v.drinks.map((d) => d.name)).toEqual(['Cola', 'Wasser'])
    expect(v.hiddenAlcohol).toBe(2)
    expect(v.alcoholic.size).toBe(0)
  })

  it('lists alcohol last for an adult', () => {
    const v = visibleDrinks(dishes, true)
    expect(v.drinks.map((d) => d.name)).toEqual(['Cola', 'Wasser', 'Pils', 'Rotwein'])
    expect(v.hiddenAlcohol).toBe(0)
    expect([...v.alcoholic].map((d) => d.name)).toEqual(['Pils', 'Rotwein'])
  })

  it('has nothing to show on a menu without drinks', () => {
    expect(visibleDrinks([{ name: 'Schnitzel', course: 'main' }], true)).toEqual({ drinks: [], alcoholic: new Set(), hiddenAlcohol: 0 })
  })
})

describe('foodOnly', () => {
  const dish = (id: string, course: string, name: string) => ({ id, course, name })
  const result = (dishes: Array<ReturnType<typeof dish>>, top: string[], avoid: string[]) =>
    ({ scanId: 's', dishes, top, avoid: avoid.map((dishId) => ({ dishId, reasons: ['x'] })), tips: [{ dishId: 'd0', local: 'a', translated: 'b' }, { dishId: 'd1', local: 'a', translated: 'b' }] }) as unknown as MenuResult

  it('drops drinks from the dishes, the picks, the skip list and the tips', () => {
    const r = result([dish('d0', 'main', 'Schnitzel'), dish('d1', 'drink', 'Pils'), dish('d2', 'drink', 'Cola'), dish('d3', 'side', 'Salat')], ['d0', 'd3', 'd2'], ['d1', 'd0'])
    const food = foodOnly(r)
    expect(food.dishes.map((d) => d.id)).toEqual(['d0', 'd3'])
    expect(food.top).toEqual(['d0', 'd3'])
    expect(food.avoid.map((a) => a.dishId)).toEqual(['d0'])
    expect(food.tips.map((t) => t.dishId)).toEqual(['d0'])
    // The scan itself is untouched: the drinks list still reads from it.
    expect(r.dishes).toHaveLength(4)
    expect(food.scanId).toBe('s')
  })

  it('returns the same object when the menu has no drinks, and the same answer every time', () => {
    const plain = result([dish('d0', 'main', 'Schnitzel')], ['d0'], [])
    expect(foodOnly(plain)).toBe(plain)
    const mixed = result([dish('d0', 'main', 'Schnitzel'), dish('d1', 'drink', 'Cola')], ['d0'], [])
    expect(foodOnly(mixed)).toBe(foodOnly(mixed))
    expect(foodOnly(mixed)).not.toBe(mixed)
  })
})
