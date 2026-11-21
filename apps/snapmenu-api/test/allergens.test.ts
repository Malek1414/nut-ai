import { describe, expect, it } from 'vitest'
import { detectAllergens, detectDiet, expandUserAllergies, normalizeAllergen } from '../src/allergens.js'

const flags = (dishName: string, description: string | null, components: string[] = [], modelHints: Array<{ allergen: string; reason: string }> = []) =>
  detectAllergens({ dishName, description, components: components.map((name) => ({ name })), modelHints }).map((f) => f.allergen)

describe('allergen flags', () => {
  it('flags gluten and milk on a Döner from bread and yogurt sauce', () => {
    const f = flags('Döner Kebab im Brot', 'Kalbfleisch, Salat, Knoblauchsoße', ['Flatbread (Fladenbrot)', 'Yogurt-garlic sauce'])
    expect(f).toContain('gluten')
    expect(f).toContain('milk')
    expect(f).not.toContain('peanuts')
  })

  it('flags sesame on falafel and hummus', () => {
    expect(flags('Falafel Teller', '6 Falafel, Hummus, Tahinsoße')).toContain('sesame')
  })

  it('does not flag milk for tahini ("sesame butter") or coconut milk', () => {
    expect(flags('Curry', null, ['Seeds, sesame butter, tahini'])).not.toContain('milk')
    expect(flags('Thai Curry', 'mit Kokosmilch')).not.toContain('milk')
  })

  it('rice noodles are not gluten, wheat noodles are', () => {
    expect(flags('Phở bò', null, ['Rice noodles, cooked'])).not.toContain('gluten')
    expect(flags('Ramen', null, ['Wheat noodles, cooked'])).toContain('gluten')
  })

  it('carbonara: egg, milk, gluten', () => {
    expect(flags('Spaghetti alla Carbonara', 'guanciale, tuorlo, pecorino')).toEqual(expect.arrayContaining(['gluten', 'eggs', 'milk']))
  })

  it('keeps the reason and merges the model hint from menu allergen codes', () => {
    const out = detectAllergens({
      dishName: 'Currywurst mit Pommes',
      description: null,
      components: [{ name: 'Curry ketchup' }],
      modelHints: [{ allergen: 'mustard', reason: 'Menu code J (mustard)' }],
    })
    const mustard = out.find((f) => f.allergen === 'mustard')
    expect(mustard?.reason).toContain('Menu code J')
    expect(mustard?.source).toBe('model')
  })

  it('normalizes user spellings and expands shellfish', () => {
    expect(normalizeAllergen('Lactose')).toBe('milk')
    expect(normalizeAllergen('Tree nuts')).toBe('tree_nuts')
    expect([...expandUserAllergies(['shellfish'])].sort()).toEqual(['crustaceans', 'molluscs'])
  })
})

describe('diet check', () => {
  it('döner is not vegetarian', () => {
    expect(detectDiet('Döner Kebab', null, [{ name: 'Döner meat' }]).vegetarian).toBe(false)
  })
  it('halloumi wrap is vegetarian, not vegan', () => {
    const d = detectDiet('Halloumi im Brot', 'gegrillter Hellim, Joghurtsoße', [{ name: 'Grilled halloumi' }])
    expect(d.vegetarian).toBe(true)
    expect(d.vegan).toBe(false)
  })
  it('falafel with tahini is vegan', () => {
    expect(detectDiet('Falafel Teller', 'Falafel, Hummus, Salat', [{ name: 'Tahini sauce' }]).vegan).toBe(true)
  })
  it('the model saying "has meat" wins over an innocent name', () => {
    expect(detectDiet('Saltimbocca', null, [], { meat: true }).vegetarian).toBe(false)
  })
})
