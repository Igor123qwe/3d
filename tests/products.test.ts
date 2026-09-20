import { describe, expect, it } from 'vitest'
import { fetchProduct, formatPrice, parseDims, parseDimsLabelled, parseDimsTriple, parseProductPage, typeForProduct } from '../src/planner/products'

describe('разбор габаритов', () => {
  it('тройка через «х» с единицами', () => {
    expect(parseDimsTriple('Размеры: 59,5x65,5x185,5 см')).toEqual({ w: 59.5, d: 65.5, h: 185.5 })
    expect(parseDimsTriple('60×65×185 см')).toEqual({ w: 60, d: 65, h: 185 })
    expect(parseDimsTriple('600x650x1850 мм')).toEqual({ w: 60, d: 65, h: 185 })
  })

  it('порядок берётся из подписи', () => {
    expect(parseDimsTriple('Габариты (ВхШхГ): 185x60x65 см')).toEqual({ w: 60, d: 65, h: 185 })
    expect(parseDimsTriple('ШхГхВ 60x65x185 см')).toEqual({ w: 60, d: 65, h: 185 })
  })

  it('размеры, подписанные по отдельности', () => {
    expect(parseDimsLabelled('Ширина: 60 см Глубина: 65 см Высота: 185 см')).toEqual({ w: 60, d: 65, h: 185 })
    expect(parseDimsLabelled('Ширина, см 60 Глубина, см 65 Высота, см 185')).toEqual({ w: 60, d: 65, h: 185 })
    expect(parseDimsLabelled('Ширина 600 мм Глубина 650 мм Высота 1850 мм')).toEqual({ w: 60, d: 65, h: 185 })
  })

  it('подписанные размеры важнее тройки', () => {
    const text = 'Артикул 100x200x300. Ширина: 60 см Глубина: 65 см Высота: 185 см'
    expect(parseDims(text)).toEqual({ w: 60, d: 65, h: 185 })
  })

  it('мусор не принимается за размеры', () => {
    expect(parseDims('Отзывов 12 345, рейтинг 4,9')).toBeNull()
    expect(parseDimsTriple('5000x6000x7000 см')).toBeNull()
    expect(parseDims('')).toBeNull()
  })
})

const ldPage = `<html><head><title>Магазин</title>
<meta property="og:image" content="https://shop.example/img/fridge.jpg">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Холодильник Bosch KGN39",
 "image":["https://shop.example/img/fridge.jpg"],
 "offers":{"@type":"Offer","price":"89990.00","priceCurrency":"RUB"}}
</script></head>
<body><div>Ширина: 60 см</div><div>Глубина: 66 см</div><div>Высота: 203 см</div></body></html>`

const plainPage = `<html><head><title>Диван Осло — 24 900 ₽</title>
<meta property="og:title" content="Диван Осло трёхместный">
<meta property="og:image" content="https://shop.example/sofa.png">
<meta property="product:price:amount" content="24900">
</head><body><p>Габариты (ШхГхВ): 220x95x85 см</p></body></html>`

describe('разбор страницы товара', () => {
  it('берёт данные из разметки', () => {
    const p = parseProductPage(ldPage, 'https://shop.example/fridge')
    expect(p.name).toBe('Холодильник Bosch KGN39')
    expect(p.photo).toBe('https://shop.example/img/fridge.jpg')
    expect(p.price).toBe(89990)
    expect(p.currency).toBe('RUB')
    expect(p.dims).toEqual({ w: 60, d: 66, h: 203 })
    expect(p.source).toBe('разметка страницы')
  })

  it('берёт данные из обычных тегов и текста', () => {
    const p = parseProductPage(plainPage, 'https://shop.example/sofa')
    expect(p.name).toBe('Диван Осло трёхместный')
    expect(p.photo).toBe('https://shop.example/sofa.png')
    expect(p.price).toBe(24900)
    expect(p.dims).toEqual({ w: 220, d: 95, h: 85 })
  })

  it('пустая страница честно сообщает, что ничего не нашлось', () => {
    const p = parseProductPage('<html><body>Ошибка 404</body></html>', 'https://shop.example/x')
    expect(p.source).toBe('ничего не найдено')
    expect(p.dims).toBeUndefined()
  })

  it('скрипты и стили не попадают в текст', () => {
    const page = '<html><body><script>var a="Ширина: 999 см"</script><p>Ширина: 60 см Глубина: 65 см Высота: 185 см</p></body></html>'
    expect(parseProductPage(page, 'u').dims).toEqual({ w: 60, d: 65, h: 185 })
  })
})

describe('загрузка через читалку', () => {
  const reader = (body: string) => async () => body
  it('берёт первую читалку, которая ответила', async () => {
    const calls: string[] = []
    const readers = [
      (u: string) => { calls.push('первая'); return `first:${u}` },
      (u: string) => { calls.push('вторая'); return `second:${u}` },
    ]
    const orig = globalThis.fetch
    globalThis.fetch = (async (u: string) => ({
      ok: !String(u).startsWith('first:'),
      status: String(u).startsWith('first:') ? 500 : 200,
      text: async () => ldPage,
    })) as unknown as typeof fetch
    try {
      const p = await fetchProduct('https://shop.example/fridge', readers)
      expect(p.name).toBe('Холодильник Bosch KGN39')
      expect(calls).toEqual(['первая', 'вторая'])
    } finally {
      globalThis.fetch = orig
    }
  })

  it('отказ всех читалок объясняется понятно', async () => {
    const orig = globalThis.fetch
    globalThis.fetch = (async () => { throw new Error('сеть недоступна') }) as unknown as typeof fetch
    try {
      await expect(fetchProduct('https://shop.example/x', [(u) => u])).rejects.toThrow(/вручную/)
    } finally {
      globalThis.fetch = orig
    }
  })

  it('не ссылка отвергается сразу', async () => {
    await expect(fetchProduct('холодильник')).rejects.toThrow(/https/)
  })
  void reader
})

describe('подбор типа и цена', () => {
  it('тип по названию товара', () => {
    expect(typeForProduct('Холодильник Bosch')).toBe('fridge')
    expect(typeForProduct('Диван угловой Осло')).toBe('sofa-corner')
    expect(typeForProduct('Стиральная машина LG')).toBe('washer')
    expect(typeForProduct('Шкаф-купе Лофт')).toBe('wardrobe-slide')
    expect(typeForProduct('Нечто неведомое')).toBe('box')
  })

  it('цена печатается по-русски', () => {
    expect(formatPrice(89990, 'RUB')).toContain('₽')
    expect(formatPrice(1200)).toMatch(/1\s?200/)
  })
})
