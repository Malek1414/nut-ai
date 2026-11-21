import { describe, expect, it } from 'vitest'
import { findSeedOilMention, htmlToText } from './seed-oil-text.js'

const claim = (text: string) => findSeedOilMention(text)?.claim ?? null

describe('htmlToText', () => {
  it('keeps the visible text and drops head, scripts, styles, comments and tags', () => {
    const html = `<!doctype html><html><head><title>Seed oil free</title><style>p{color:red}</style></head>
      <body><script>var a = "we fry in sunflower oil"</script>
      <h1>Caf&eacute; &amp; Bar</h1>
      <p>Wir kochen ohne   Saaten&ouml;le &#8211; versprochen.&nbsp;</p>
      <!-- fried in canola oil --><noscript>no script</noscript><svg><text>logo</text></svg></body></html>`
    expect(htmlToText(html)).toBe('Café & Bar\nWir kochen ohne Saatenöle – versprochen.')
  })

  it('decodes the basic entities once, named and numeric', () => {
    expect(htmlToText('<p>&lt;b&gt; &quot;x&quot; &#39;y&#39; &#x41;&#66; &amp;amp; &unknown;</p>')).toBe('<b> "x" \'y\' AB &amp; &unknown;')
    expect(htmlToText('<span>Saaten&shy;&ouml;l&shy;frei</span>')).toBe('Saatenölfrei')
  })

  it('separates blocks with one newline and collapses all other whitespace', () => {
    expect(htmlToText('<ul><li>Burger</li>\n\n<li>Fries   in\ttallow</li></ul><div>Open <b>daily</b></div>')).toBe('Burger\nFries in tallow\nOpen daily')
  })

  it('cuts at max and survives broken or empty input', () => {
    expect(htmlToText(`<p>${'a'.repeat(50)}</p>`, 10)).toBe('aaaaaaaaaa')
    expect(htmlToText('<p>Hi</p><script>var x = 1')).toBe('Hi')
    expect(htmlToText('')).toBe('')
  })
})

describe('findSeedOilMention: the kitchen says it cooks without seed oils', () => {
  it.each([
    'Everything on our menu is seed oil free.',
    'A 100% seed-oil-free kitchen in Kreuzberg',
    'We cook with no seed oils, only beef tallow and butter.',
    'We never use industrial seed oils.',
    "We don't use any seed oils in our kitchen.",
    'Our fryers are free from seed oils.',
    'Burgers without seed oils',
    'Zero seed oils. Ever.',
    'No canola or seed oils in our fryer.',
  ])('English: %s', (text) => {
    expect(claim(text)).toBe('free')
  })

  it.each([
    'Wir kochen ohne Saatenöle.',
    'Bei uns gibt es keine Samenöle.',
    'Unsere Küche ist frei von Saatenölen.',
    'Unsere Küche ist komplett saatenölfrei',
    'Samenöl-frei seit 2022',
    'Wir verzichten komplett auf industrielle Saatenöle.',
    'Wir kochen ohne Saatenoele.',
  ])('German: %s', (text) => {
    expect(claim(text)).toBe('free')
  })

  it('Spanish, French and Italian', () => {
    expect(claim('Cocinamos sin aceites de semillas.')).toBe('free')
    expect(claim('Una cocina libre de aceites de semillas')).toBe('free')
    expect(claim('Une cuisine sans huiles de graines.')).toBe('free')
    expect(claim("Nous n'avons aucune huile de graines en cuisine.")).toBe('free')
    expect(claim('Cuciniamo senza oli di semi.')).toBe('free')
    expect(claim('Non usiamo olio di semi.')).toBe('free')
  })

  it('returns the sentence as the quote', () => {
    expect(findSeedOilMention('Open daily from noon. Everything on our menu is seed oil free. Book a table.')).toEqual({
      claim: 'free',
      quote: 'Everything on our menu is seed oil free.',
    })
  })
})

describe('findSeedOilMention: the kitchen says it cooks with a seed oil', () => {
  it.each([
    'Our fries are fried in sunflower oil.',
    'Hand-cut chips, fried fresh daily in 100% rapeseed oil',
    'We use rapeseed oil for frying.',
    'Everything is cooked with canola oil.',
    'Unsere Pommes werden in Rapsöl frittiert.',
    'Frittiert in Sonnenblumenöl',
    'Wir frittieren ausschließlich mit Rapsöl.',
    'Todo frito en aceite de girasol.',
    "Nos frites sont cuites dans de l'huile de tournesol.",
    'Fritto in olio di semi di girasole.',
  ])('%s', (text) => {
    expect(claim(text)).toBe('uses')
  })
})

describe('findSeedOilMention: nothing clear means nothing claimed', () => {
  it.each([
    ['a negated use', 'We do not fry in sunflower oil.'],
    ['a negated use, German', 'Wir verwenden kein Rapsöl.'],
    ['another fat instead', 'We use beef tallow instead of sunflower oil.'],
    ['another fat instead, German', 'Wir braten in Butterschmalz statt in Sonnenblumenöl.'],
    ['a denied claim', 'This kitchen is not seed oil free.'],
    ['a denied claim, German', 'Unsere Fritteuse ist nicht saatenölfrei.'],
    ['a claim taken back', 'Seed oil free is not something we can promise.'],
    ['a question and a "no"', 'Are you seed oil free? No, we fry in sunflower oil.'],
    ['tallow alone', 'Fried in beef tallow.'],
    ['tallow, with a seed oil ruled out in passing', 'Fried in beef tallow, never in vegetable oil'],
    ['butter and olive oil', 'Cooked in butter and olive oil.'],
    ['an oil on the shelf', 'Sunflower oil, 1 l bottle'],
    ['no mention at all', 'Open daily from noon. Book a table.'],
    ['empty', ''],
  ])('%s', (_name, text) => {
    expect(findSeedOilMention(text)).toBeNull()
  })

  it('claims nothing when a page says both', () => {
    expect(findSeedOilMention('Seed oil free. Our fries are fried in sunflower oil.')).toBeNull()
    expect(findSeedOilMention('Wir kochen ohne Saatenöle.\nUnsere Pommes werden in Rapsöl frittiert.')).toBeNull()
  })

  it('keeps a "free" claim when the same page only rules a seed oil out', () => {
    expect(claim('No seed oils here. We do not fry in sunflower oil.')).toBe('free')
    expect(claim('Wir verwenden keine Samenöle.')).toBe('free')
  })
})

describe('findSeedOilMention: the quote', () => {
  it('is cut to 180 characters around the statement, with an ellipsis where it was cut', () => {
    const long = `${'We care a great deal about every single ingredient that goes into our food and '.repeat(3)}everything here is seed oil free ${'and we will keep telling you about our farms and our suppliers for a long while '.repeat(3)}`.trim()
    const found = findSeedOilMention(long)
    expect(found?.claim).toBe('free')
    expect(found!.quote.length).toBeLessThanOrEqual(180)
    expect(found!.quote).toContain('seed oil free')
    expect(found!.quote.startsWith('…')).toBe(true)
    expect(found!.quote.endsWith('…')).toBe(true)
  })

  it('finds a statement in text without a single full stop, and still quotes whole words', () => {
    const found = findSeedOilMention(`${'menu burger fries shakes '.repeat(300)}everything here is seed oil free ${'contact imprint jobs press '.repeat(300)}`)
    expect(found?.claim).toBe('free')
    expect(found!.quote.length).toBeLessThanOrEqual(180)
    expect(found!.quote).toMatch(/^…\S.* everything here is seed oil free .*\S…$/)
  })

  it('claims nothing for a page that goes on and on about seed oils: that is a shop or an article, not a kitchen', () => {
    expect(findSeedOilMention('Seed oil free. '.repeat(30))).toEqual({ claim: 'free', quote: 'Seed oil free.' })
    expect(findSeedOilMention('Seed oil free. '.repeat(60))).toBeNull()
  })

  it('reads a page end to end', () => {
    const html = '<html><head><title>Burger Bude</title></head><body><nav><a>Menu</a><a>Kontakt</a></nav><h2>Unsere K&uuml;che</h2><p>Wir   kochen ohne Saaten&ouml;le.</p><footer>Impressum</footer></body></html>'
    expect(findSeedOilMention(htmlToText(html))).toEqual({ claim: 'free', quote: 'Wir kochen ohne Saatenöle.' })
  })
})
