import { describe, expect, it } from 'vitest'
import { CATALOG, catalogMatches } from '../src/planner/catalog'
import { parseDimsTriple } from '../src/planner/products'

describe('поиск по каталогу', () => {
  const find = (q: string) => CATALOG.filter((c) => catalogMatches(c, q)).map((c) => c.name)
  it('понимает синонимы: софа — диван, стиралка — стиральная машина', () => {
    expect(find('софа').some((n) => /диван/i.test(n))).toBe(true)
    expect(find('стиралка').some((n) => /стиральн/i.test(n))).toBe(true)
    expect(find('телек').some((n) => /телевизор/i.test(n))).toBe(true)
  })
  it('пустой запрос — весь каталог, чужое слово — ничего', () => {
    expect(find('').length).toBe(CATALOG.length)
    expect(find('вертолёт')).toEqual([])
  })
})

describe('размеры товара без подписи', () => {
  it('высокий первый — это В×Ш×Г, как пишут магазины про холодильники', () => {
    expect(parseDimsTriple('Размеры 185x60x65 см')).toEqual({ w: 60, d: 65, h: 185 })
  })
  it('обычная тумба — Ш×Г×В', () => {
    expect(parseDimsTriple('80x45x50 см')).toEqual({ w: 80, d: 45, h: 50 })
  })
  it('подпись важнее догадки', () => {
    expect(parseDimsTriple('ШхГхВ: 185x60x65 см')).toEqual({ w: 185, d: 60, h: 65 })
  })
})
