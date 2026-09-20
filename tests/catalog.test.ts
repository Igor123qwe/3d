import { describe, expect, it } from 'vitest'
import { CATALOG, CATALOG_MAP, CATEGORIES, CATEGORY_COLORS, dims3d } from '../src/planner/catalog'
import { guessType, modelRefFromUrl, phDimsCm } from '../src/planner/polyhaven'

describe('каталог', () => {
  it('ключи уникальны', () => {
    expect(new Set(CATALOG.map((c) => c.type)).size).toBe(CATALOG.length)
  })

  it('у всех предметов положительные размеры и известная категория', () => {
    for (const c of CATALOG) {
      expect(c.w, c.type).toBeGreaterThan(0)
      expect(c.d, c.type).toBeGreaterThan(0)
      expect(CATEGORIES.map((x) => x.key), c.type).toContain(c.category)
      expect(CATEGORY_COLORS[c.category]).toBeTruthy()
    }
  })

  it('типы, разрешённые в зонах, существуют в каталоге', () => {
    for (const c of CATALOG) for (const t of c.allowInZone ?? []) expect(CATALOG_MAP[t], `${c.type} → ${t}`).toBeTruthy()
  })

  it('у каждого предмета есть высота для 3D', () => {
    for (const c of CATALOG) {
      const d = dims3d({ type: c.type, w: c.w, d: c.d })
      expect(d.h, c.type).toBeGreaterThan(0)
      expect(d.elev, c.type).toBeGreaterThanOrEqual(0)
    }
  })

  it('заданная высота предмета важнее каталожной', () => {
    expect(dims3d({ type: 'wardrobe', w: 100, d: 60, h: 123 }).h).toBe(123)
  })

  it('настенные символы подняты над полом', () => {
    expect(dims3d({ type: 'switch', w: 8, d: 4 }).elev).toBe(90)
    expect(dims3d({ type: 'light', w: 30, d: 30 }).elev).toBeGreaterThan(200)
  })
})

describe('фотокаталог', () => {
  it('размеры переводятся в сантиметры', () => {
    expect(phDimsCm([2200, 950, 850])).toEqual({ w: 220, d: 95, h: 85 }) // миллиметры
    expect(phDimsCm([2.2, 0.95, 0.85])).toEqual({ w: 220, d: 95, h: 85 }) // метры
    expect(phDimsCm(null)).toBeNull()
    expect(phDimsCm([0, 10, 10])).toBeNull()
    expect(phDimsCm(['a', 'b', 'c'])).toBeNull()
  })

  it('тип планировщика угадывается по названию и тегам', () => {
    const g = (name: string, tags: string[] = []) => guessType({ name, tags, categories: [] })
    expect(g('Sofa 02')).toBe('sofa-3')
    expect(g('ArmChair 01')).toBe('armchair')
    expect(g('Coffee Table')).toBe('coffee-table')
    expect(g('Dining Table 03')).toBe('dining-table')
    expect(g('Fridge', ['refrigerator'])).toBe('fridge')
    expect(g('Washing Machine')).toBe('washer')
    expect(g('Potted Plant')).toBe('plant')
    expect(g('Нечто непонятное')).toBe('box')
  })

  it('угаданный тип всегда есть в каталоге', () => {
    const names = ['Sofa', 'Chair', 'Bed', 'Wardrobe', 'Desk', 'Toilet', 'Bathtub', 'Shower', 'TV', 'Lamp', 'Rug', 'Piano', 'Mirror', 'Radiator', 'Bookshelf', 'Stove', 'Sink', 'Dishwasher', 'Bar stool', 'Nightstand']
    for (const n of names) expect(CATALOG_MAP[guessType({ name: n, tags: [], categories: [] })], n).toBeTruthy()
  })

  it('ссылка на GLB превращается в описание модели', () => {
    const ref = modelRefFromUrl('https://example.com/models/my%20sofa.glb')
    expect(ref.provider).toBe('url')
    expect(ref.name).toBe('my sofa')
  })
})
