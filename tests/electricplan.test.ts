import { describe, expect, it } from 'vitest'
import { DEFAULT_AUTO, autoElectrics } from '../src/planner/electrics'
import { DEFAULT_ELECTRIC, designCsv, designElectrics, feedOf, inputRating, powerOf, simultaneity } from '../src/planner/electricplan'
import { buildRooms } from '../src/planner/rooms'
import { CATALOG_MAP } from '../src/planner/catalog'
import { TEMPLATES } from '../src/planner/templates'
import type { Furniture, Plan } from '../src/planner/types'
import { pointInPoly } from '../src/planner/geometry'

/** 2-комнатная из шаблона, электрика — заново по нормам, со щитом */
function designed(settings = DEFAULT_ELECTRIC, opts = { ...DEFAULT_AUTO, panel: true }) {
  const p0 = TEMPLATES[3].build()
  const base: Plan = { ...p0, furniture: p0.furniture.filter((f) => !CATALOG_MAP[f.type]?.symbol), electric: settings }
  const rooms = buildRooms(base).rooms
  const plan: Plan = { ...base, furniture: [...base.furniture, ...autoElectrics(base, rooms, opts, settings)] }
  return { plan, rooms, design: designElectrics(plan, rooms, settings) }
}

const socket = (id: string, x: number, y: number, extra: Partial<Furniture['electric']> = {}): Furniture => ({
  id,
  type: 'outlet',
  x,
  y,
  w: 8,
  d: 4,
  rot: 0,
  electric: { kind: 'outlet', why: 'тест', height: 30, ...extra },
})

describe('расстановка по нормам', () => {
  it('всё на стенах, мимо проёмов, мимо зон ванной, розеток — не меньше нормы', () => {
    const { design } = designed()
    const bad = design.issues.filter((i) => /не на стене|в проёме|зоны 0–2|по норме не меньше/.test(i.text))
    expect(bad.map((i) => i.text)).toEqual([])
  })

  it('у техники — свои линии: холодильник, стиральная, варочная панель', () => {
    const { plan } = designed()
    const feeds = plan.furniture.map(feedOf)
    expect(feeds).toContain('fridge')
    expect(feeds).toContain('washer')
    expect(feeds).toContain('cooktop')
    expect(feeds).toContain('hood')
  })

  it('газовая плита: вместо силовой линии — розетка поджига не ближе 50 см', () => {
    const { plan, design } = designed({ ...DEFAULT_ELECTRIC, stove: 'gas' })
    expect(plan.furniture.map(feedOf)).not.toContain('cooktop')
    expect(design.issues.some((i) => /газовой плите/.test(i.text))).toBe(false)
  })

  it('выключатель санузла — снаружи, у двери', () => {
    const { plan, rooms } = designed()
    const bath = rooms.find((r) => /Санузел/.test(r.meta.name))!
    const sw = plan.furniture.filter((f) => f.electric?.kind === 'switch' && /санузел/.test(f.electric.why))
    expect(sw.length).toBeGreaterThan(0)
    const inside = (f: Furniture) => pointInPoly({ x: f.x, y: f.y }, bath.inner)
    expect(sw.some(inside)).toBe(false)
  })
})

describe('щит и группы', () => {
  it('каждая точка — ровно в одной группе; щит и датчики протечки — без группы', () => {
    const { plan, design } = designed()
    const ids = design.circuits.flatMap((c) => c.points.map((f) => f.id))
    expect(new Set(ids).size).toBe(ids.length)
    const powered = plan.furniture.filter((f) => f.electric && f.electric.kind !== 'panel' && f.electric.kind !== 'leak-sensor')
    expect(ids.sort()).toEqual(powered.map((f) => f.id).sort())
  })

  it('свет — автомат B10 и кабель 3×1,5; варочная — C32 и 3×6; санузел и стиральная — УЗО 10 мА', () => {
    const { design } = designed()
    const light = design.circuits.filter((c) => c.kind === 'light')
    expect(light.length).toBeGreaterThan(0)
    expect(light.every((c) => c.breaker === 'B10' && c.cable === '3×1,5' && c.device === 'автомат')).toBe(true)
    const cook = design.circuits.find((c) => c.feeds === 'cooktop')!
    expect([cook.breaker, cook.cable, cook.rcdMa]).toEqual(['C32', '3×6', 30])
    const washer = design.circuits.find((c) => c.feeds === 'washer')!
    expect(washer.rcdMa).toBe(10)
    expect(design.circuits.filter((c) => c.kind === 'sockets').every((c) => c.device === 'дифавтомат' && c.rcdMa === 30 && c.points.length <= 8)).toBe(true)
  })

  it('номера групп по порядку, у каждой трасса от щита и длина', () => {
    const { design } = designed()
    expect(design.circuits.map((c) => c.n)).toEqual(design.circuits.map((_, i) => i + 1))
    for (const c of design.circuits) {
      expect(c.route[0]).toEqual(design.panel.p)
      expect(c.lengthM).toBeGreaterThan(1.5)
    }
    expect(design.panel.placed).toBe(true)
  })

  it('перегрузка группы — ошибка с советом разделить', () => {
    const { plan, rooms } = designed()
    const washer = plan.furniture.find((f) => feedOf(f) === 'washer')!
    const heavy: Plan = { ...plan, furniture: plan.furniture.map((f) => (f.id === washer.id ? { ...f, electric: { ...f.electric!, power: 5000 } } : f)) }
    const d = designElectrics(heavy, rooms)
    expect(d.issues.some((i) => i.level === 'error' && /разделите группу/.test(i.text))).toBe(true)
  })

  it('ввод по выделенной мощности; нагрузка больше выделенной — замечание', () => {
    expect([5, 7, 9, 10, 15].map(inputRating)).toEqual([25, 32, 40, 50, 63])
    const { design } = designed({ ...DEFAULT_ELECTRIC, allottedKw: 3 })
    expect(design.input.ratingA).toBe(25)
    expect(design.issues.some((i) => /больше выделенной/.test(i.text))).toBe(true)
  })

  it('щит на DIN-рейке с запасом; кабель и автоматы — в ведомости', () => {
    const { design } = designed()
    expect(design.modules.box).toBeGreaterThanOrEqual(design.modules.used * 1.2)
    const names = design.bom.map((b) => b.name)
    expect(names.some((n) => /ВВГнг\(А\)-LS 3×1,5/.test(n))).toBe(true)
    expect(names.some((n) => /ВВГнг\(А\)-LS 3×2,5/.test(n))).toBe(true)
    expect(names.some((n) => /Дифавтомат 1P\+N C16 30 мА/.test(n))).toBe(true)
    expect(names).toContain('Подрозетник')
    const csv = designCsv(design)
    expect(csv).toContain('QF1')
    expect(csv).toContain('Подрозетник')
  })

  it('шаблон со всей техникой и умным домом укладывается в выделенные 10 кВт: спрос с коэффициентами, а не сумма', () => {
    const { design } = designed(DEFAULT_ELECTRIC, { ...DEFAULT_AUTO, panel: true, smart: true, curtains: true, leak: true, motion: true, ac: true, boiler: true })
    expect(design.demandKw).toBeLessThanOrEqual(10)
    expect(design.installedKw).toBeGreaterThan(design.demandKw)
    expect(design.issues.some((i) => /больше выделенной/.test(i.text))).toBe(false)
    // электрокарнизы — своя группа автоматики, не свет
    const auto = design.circuits.find((c) => c.kind === 'auto')!
    expect(auto.points.every((f) => f.electric?.kind === 'curtain-motor')).toBe(true)
    expect(design.circuits.filter((c) => c.kind === 'light').every((c) => c.points.every((f) => f.electric?.kind !== 'curtain-motor'))).toBe(true)
    expect([2, 5, 9, 14, 20].map(simultaneity)).toEqual([1, 0.8, 0.65, 0.55, 0.5])
  })

  it('без щита на плане — место предложено в прихожей', () => {
    const { design } = designed(DEFAULT_ELECTRIC, { ...DEFAULT_AUTO, panel: false })
    expect(design.panel.placed).toBe(false)
    expect(design.panel.room).toMatch(/Прихожая|Коридор/)
  })
})

describe('проверки норм', () => {
  const base = () => designed()

  it('розетка у ванны, выключатель низко, точка посреди комнаты — замечания', () => {
    const { plan, rooms } = base()
    const bath = plan.furniture.find((f) => f.type === 'bathtub-150')!
    const room = rooms.find((r) => /Гостиная/.test(r.meta.name)) ?? rooms[0]
    const extra: Furniture[] = [
      socket('wet', bath.x + 10, bath.y),
      { ...socket('low', 0, 0), type: 'switch', x: plan.furniture.find((f) => f.electric?.kind === 'switch')!.x, y: plan.furniture.find((f) => f.electric?.kind === 'switch')!.y, electric: { kind: 'switch', why: 'тест', height: 60 } },
      socket('float', room.meta.anchor.x, room.meta.anchor.y),
    ]
    const d = designElectrics({ ...plan, furniture: [...plan.furniture, ...extra] }, rooms)
    expect(d.issues.some((i) => i.pointId === 'wet' && i.level === 'error')).toBe(true)
    expect(d.issues.some((i) => i.pointId === 'low' && /80–170/.test(i.text))).toBe(true)
    expect(d.issues.some((i) => i.pointId === 'float' && /не на стене/.test(i.text))).toBe(true)
  })

  it('стиральная без своей розетки — замечание', () => {
    const { plan, rooms } = base()
    const d = designElectrics({ ...plan, furniture: plan.furniture.filter((f) => feedOf(f) !== 'washer') }, rooms)
    expect(d.issues.some((i) => /Стиральная машина: нет розетки на отдельной линии/i.test(i.text))).toBe(true)
  })

  it('мощность точки: по назначению или заданная руками', () => {
    expect(powerOf(socket('a', 0, 0))).toBe(300)
    expect(powerOf(socket('b', 0, 0, { feeds: 'cooktop' }))).toBe(7000)
    expect(powerOf(socket('c', 0, 0, { feeds: 'cooktop', power: 5500 }))).toBe(5500)
  })
})
