/**
 * Open Food Facts lookup — free, no key, strong on European products.
 *
 * Used only when the bundled USDA corpus has no acceptable row for a component
 * (branded drinks, European sauces, regional products). Sends a generic
 * User-Agent and the search words only — never anything about the user.
 */

export interface OffHit {
  code: string
  name: string
  brand: string | null
  per100: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number | null; sugar_g: number | null; sodium_mg: number | null }
  url: string
}

const cache = new Map<string, OffHit | null>()
const UA = 'Snapmenu/0.1 (hackathon; +https://github.com/Malek1414/nut-ai)'

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

export async function lookupOpenFoodFacts(query: string, timeoutMs = 3500, fetchImpl: typeof fetch = fetch): Promise<OffHit | null> {
  const q = query.trim().toLowerCase()
  if (!q) return null
  if (cache.has(q)) return cache.get(q) ?? null

  // search-a-licious (Elasticsearch) answers in ~200 ms; the legacy cgi search takes ~9 s.
  const url =
    'https://search.openfoodfacts.org/search?page_size=8&fields=code,product_name,brands,nutriments&q=' + encodeURIComponent(q)

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal })
    if (!res.ok) return null
    const body = (await res.json()) as { hits?: Array<Record<string, unknown>>; products?: Array<Record<string, unknown>> }
    for (const p of body.hits ?? body.products ?? []) {
      const nu = (p['nutriments'] ?? {}) as Record<string, unknown>
      const kcal = n(nu['energy-kcal_100g'])
      const protein = n(nu['proteins_100g'])
      const carbs = n(nu['carbohydrates_100g'])
      const fat = n(nu['fat_100g'])
      const name = typeof p['product_name'] === 'string' ? (p['product_name'] as string) : ''
      if (kcal == null || protein == null || carbs == null || fat == null || !name) continue
      // Reject internally inconsistent rows (Atwater check within 35%).
      const atwater = protein * 4 + carbs * 4 + fat * 9
      if (kcal > 20 && Math.abs(atwater - kcal) / kcal > 0.35) continue
      const sodiumG = n(nu['sodium_100g'])
      const hit: OffHit = {
        code: String(p['code'] ?? ''),
        name,
        brand: Array.isArray(p['brands']) ? String((p['brands'] as unknown[])[0] ?? '') || null
          : typeof p['brands'] === 'string' && p['brands'] ? (p['brands'] as string).split(',')[0]!.trim() : null,
        per100: {
          kcal, protein_g: protein, carbs_g: carbs, fat_g: fat,
          fiber_g: n(nu['fiber_100g']), sugar_g: n(nu['sugars_100g']),
          sodium_mg: sodiumG == null ? null : sodiumG * 1000,
        },
        url: `https://world.openfoodfacts.org/product/${String(p['code'] ?? '')}`,
      }
      cache.set(q, hit)
      return hit
    }
    cache.set(q, null)
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
