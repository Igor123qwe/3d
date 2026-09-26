import { describe, expect, it } from 'vitest'
import { DEFAULT_AUTO, ELECTRIC_NAMES, autoElectrics, catalogTypeOf } from '../src/planner/electrics'
import { buildRooms } from '../src/planner/rooms'
import { CATALOG_MAP } from '../src/planner/catalog'
import { TEMPLATES } from '../src/planner/templates'
import { pointInPoly } from '../src/planner/geometry'
import { runChecks } from '../src/planner/checks'
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

describe('проверки электрики', () => {
  const withAuto = (opts = DEFAULT_AUTO) => {
    const { plan, rooms, items } = run(twoRoom(), opts)
    const full: Plan = { ...plan, furniture: [...plan.furniture, ...items] }
    return { plan: full, rooms, issues: runChecks(full, rooms).issues }
  }

  it('после автоматической расстановки нет замечаний по свету и розеткам у кровати', () => {
    const { issues } = withAuto()
    expect(issues.some((i) => i.text.includes('нет светильника'))).toBe(false)
    expect(issues.some((i) => i.text.includes('нет розетки в пределах'))).toBe(false)
  })

  it('розетка у ванны помечается как опасная', () => {
    const { plan, rooms } = run(twoRoom())
    const bath = plan.furniture.find((f) => f.type === 'bathtub-150')!
    const risky: Plan = {
      ...plan,
      furniture: [...plan.furniture, { id: 'risky', type: 'outlet', x: bath.x + 20, y: bath.y, w: 8, d: 4, rot: 0, electric: { kind: 'outlet' as const, why: 'вручную', height: 30 } }],
    }
    const issues = runChecks(risky, rooms).issues
    expect(issues.some((i) => i.text.includes('зоне брызг'))).toBe(true)
  })

  it('план без электрики не заваливает список замечаниями', () => {
    const { plan, rooms } = run(twoRoom())
    const issues = runChecks(plan, rooms).issues
    expect(issues.some((i) => i.text.includes('нет светильника'))).toBe(false)
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

describe('связь выключатель ↔ светильник', () => {
  it('после расстановки выключатели управляют светом своей комнаты, мастер — всем', () => {
    const base = twoRoom()
    const plan: Plan = { ...base, openings: [{ id: 'd', kind: 'door', wallId: base.walls[0].id, t: 0.5, width: 80, hinge: 'a', side: 1 }] }
    const { items } = run(plan, { ...DEFAULT_AUTO, smart: true })
    const lights = items.filter((i) => ['light', 'spot', 'wall-lamp'].includes(i.electric!.kind))
    const switches = items.filter((i) => ['switch', 'smart-switch', 'dimmer'].includes(i.electric!.kind))
    expect(lights.length).toBeGreaterThan(0)
    expect(switches.length).toBeGreaterThan(0)
    expect(switches.some((sw) => (sw.electric!.controls?.length ?? 0) > 0)).toBe(true)
    const master = items.find((i) => i.electric!.kind === 'switch-master')
    if (master) expect(master.electric!.controls?.length).toBe(lights.length)
  })
})
