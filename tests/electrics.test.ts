import { describe, expect, it } from 'vitest'
import { DEFAULT_AUTO, ELECTRIC_NAMES, autoElectrics, cableEstimate, catalogTypeOf, electricSpec } from '../src/planner/electrics'
import { buildRooms } from '../src/planner/rooms'
import { CATALOG_MAP } from '../src/planner/catalog'
import { TEMPLATES } from '../src/planner/templates'
import { pointInPoly } from '../src/planner/geometry'
import type { ElectricKind, Plan } from '../src/planner/types'

const studio = () => TEMPLATES[1].build()
const twoRoom = () => TEMPLATES[3].build()

/** план без исходной электрики — её ставим заново */
const clean = (p: Plan): Plan => ({ ...p, furniture: p.furniture.filter((f) => !CATALOG_MAP[f.type]?.symbol) })

const run = (p: Plan, opts = DEFAULT_AUTO) => {
  const plan = clean(p)
  const rooms = buildRooms(plan).rooms
  return { plan, rooms, items: autoElectrics(plan, rooms, opts) }
}
const kinds = (items: { electric?: { kind: ElectricKind } }[]) => items.map((i) => i.electric!.kind)

describe('автоматическая расстановка', () => {
  it('в каждой комнате есть светильник', () => {
    const { rooms, items } = run(twoRoom())
    const lights = items.filter((i) => i.electric?.kind === 'light')
    for (const r of rooms) {
      const has = lights.some((l) => pointInPoly({ x: l.x, y: l.y }, r.polygon))
      expect(has, `нет света в «${r.meta.name}»`).toBe(true)
    }
  })

  it('у изголовья кровати четыре розетки', () => {
    const { plan, rooms, items } = run(twoRoom())
    const bed = plan.furniture.find((f) => f.type === 'bed-160')!
    const head = items.filter((i) => i.electric?.kind === 'outlet' && i.electric.why.includes('изголов'))
    expect(head.length).toBeGreaterThanOrEqual(4)
    // и все они действительно рядом с кроватью
    expect(head.every((i) => Math.hypot(i.x - bed.x, i.y - bed.y) < 250)).toBe(true)
    void rooms
  })

  it('каждая точка описывает причину и высоту установки', () => {
    const { items } = run(studio())
    for (const i of items) {
      expect(i.electric!.why.length, i.label).toBeGreaterThan(3)
      expect(i.electric!.height).toBeGreaterThan(0)
    }
  })

  it('в санузле нет розеток общего назначения', () => {
    const { rooms, items } = run(twoRoom())
    const bath = rooms.find((r) => r.meta.name.includes('Санузел'))!
    const inside = items.filter((i) => pointInPoly({ x: i.x, y: i.y }, bath.polygon))
    const outlets = inside.filter((i) => i.electric?.kind === 'outlet')
    expect(outlets.every((o) => /стиральн|раковин|подключение/i.test(o.electric!.why))).toBe(true)
  })

  it('выключатели ставятся у дверей', () => {
    const { items } = run(twoRoom())
    const switches = items.filter((i) => i.electric?.kind === 'switch')
    expect(switches.length).toBeGreaterThan(2)
    expect(switches.every((s) => s.electric!.why.includes('двер') || s.electric!.why.includes('санузел'))).toBe(true)
  })

  it('выключенные правила ничего не ставят', () => {
    const { items } = run(twoRoom(), { ...DEFAULT_AUTO, outlets: false, switches: false, lights: false })
    expect(items).toEqual([])
  })

  it('только свет — только светильники', () => {
    const { items } = run(twoRoom(), { ...DEFAULT_AUTO, outlets: false, switches: false, lights: true })
    expect(new Set(kinds(items))).toEqual(new Set(['light']))
  })
})

describe('умный дом', () => {
  const smart = { ...DEFAULT_AUTO, smart: true, curtains: true, leak: true, motion: true, panel: true }

  it('мастер-выключатель у входа и у кровати', () => {
    const { items } = run(twoRoom(), smart)
    const master = items.filter((i) => i.electric?.kind === 'switch-master')
    expect(master.length).toBeGreaterThanOrEqual(2)
    expect(master.some((m) => m.electric!.why.includes('ухожу'))).toBe(true)
    expect(master.some((m) => m.electric!.why.includes('ночь'))).toBe(true)
  })

  it('электрокарниз на каждое окно', () => {
    const { plan, items } = run(twoRoom(), smart)
    const windows = plan.openings.filter((o) => o.kind === 'window').length
    expect(items.filter((i) => i.electric?.kind === 'curtain-motor').length).toBe(windows)
  })

  it('датчики протечки в мокрых зонах, движения — в проходных', () => {
    const { items } = run(twoRoom(), smart)
    expect(items.some((i) => i.electric?.kind === 'leak-sensor')).toBe(true)
    expect(items.some((i) => i.electric?.kind === 'motion-sensor')).toBe(true)
  })

  it('умные выключатели вместо обычных', () => {
    const { items } = run(twoRoom(), smart)
    expect(items.some((i) => i.electric?.kind === 'smart-switch')).toBe(true)
    expect(items.some((i) => i.electric?.kind === 'switch')).toBe(false)
  })

  it('щит ставится один', () => {
    const { items } = run(twoRoom(), smart)
    expect(items.filter((i) => i.electric?.kind === 'panel').length).toBe(1)
  })
})

describe('ведомость и кабель', () => {
  it('ведомость считает приборы по видам', () => {
    const { plan, rooms, items } = run(twoRoom())
    const withElectrics: Plan = { ...plan, furniture: [...plan.furniture, ...items] }
    const spec = electricSpec(withElectrics, rooms)
    expect(spec.length).toBeGreaterThan(2)
    expect(spec.reduce((s, r) => s + r.count, 0)).toBe(items.length)
    for (const row of spec) {
      expect(row.name).toBe(ELECTRIC_NAMES[row.kind])
      expect(row.where.length).toBeGreaterThan(0)
      expect(row.height).toBeGreaterThan(0)
    }
    // ведомость отсортирована по убыванию количества
    expect(spec.map((r) => r.count)).toEqual([...spec.map((r) => r.count)].sort((a, b) => b - a))
  })

  it('оценка кабеля растёт с числом точек', () => {
    const { plan, rooms, items } = run(twoRoom())
    const few: Plan = { ...plan, furniture: [...plan.furniture, ...items.slice(0, 3)] }
    const many: Plan = { ...plan, furniture: [...plan.furniture, ...items] }
    expect(cableEstimate(many, rooms).meters).toBeGreaterThan(cableEstimate(few, rooms).meters)
    expect(cableEstimate(many, rooms).groups).toBeGreaterThan(0)
  })

  it('пустой план даёт пустую ведомость', () => {
    const { plan, rooms } = run(twoRoom())
    expect(electricSpec(plan, rooms)).toEqual([])
  })
})

describe('отображение', () => {
  it('каждому виду соответствует элемент каталога', () => {
    for (const kind of Object.keys(ELECTRIC_NAMES) as ElectricKind[]) {
      expect(CATALOG_MAP[catalogTypeOf(kind)], kind).toBeTruthy()
      expect(CATALOG_MAP[catalogTypeOf(kind)].symbol, kind).toBe(true)
    }
  })
})
