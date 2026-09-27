import { describe, expect, it } from 'vitest'
import type { Furniture, Plan } from '../src/planner/types'
import { buildRooms } from '../src/planner/rooms'
import { addOpening } from '../src/planner/ops'
import { applyLayout, layoutSummary, vetLayout } from '../src/planner/autolayout'
import { counters, shaftsOf } from '../src/planner/kitchen'
import { runChecks } from '../src/planner/checks'
import { convexOverlap, obbCorners } from '../src/planner/geometry'

const empty: Plan = { version: 1, name: 'тест', walls: [], openings: [], furniture: [], rooms: [], dims: [], settings: { grid: 10 } }
const W = (id: string, ax: number, ay: number, bx: number, by: number, t: number) => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: t })
const KITCHEN = new Set(['counter-60', 'counter-80', 'counter-100', 'counter-corner', 'counter-top', 'sink', 'stove', 'fridge', 'dishwasher', 'tall-cabinet'])

/**
 * Кухня пользователя: сверху 304, справа выступ вентшахты 16 × 64 (y 216…280),
 * ниже уступ наружу; дверь в верхней стене слева, окно в нижней (x 113…258)
 */
function userKitchen() {
  let plan: Plan = {
    ...empty,
    walls: [
      W('top', -10, -10, 314, -10, 20),
      W('r1', 314, -10, 314, 216, 20),
      W('sh1', 314, 216, 298, 216, 0.1),
      W('sh2', 298, 216, 298, 280, 20),
      W('sh3', 298, 280, 314, 280, 0.1),
      W('r2', 314, 280, 314, 353, 20),
      W('j1', 314, 353, 339, 353, 20),
      W('r3', 339, 353, 339, 436, 20),
      W('bottom', -10, 436, 339, 436, 20),
      W('left', -10, -10, -10, 436, 20),
    ],
  }
  const rooms0 = buildRooms(plan).rooms
  plan = addOpening(plan, 'door', 'top', 70 / 324, 80, rooms0).plan
  plan = addOpening(plan, 'window', 'bottom', 195 / 349, 145, rooms0).plan
  const rooms = buildRooms(plan).rooms
  return { plan, rooms, room: rooms.find((r) => r.area > 10)! }
}

/** как ответила модель у пользователя: гарнитур вдоль левой стены и под окном, круглый стол посреди */
const GEMINI = [
  { type: 'counter-60', x: 30, y: 110, rot: 270, why: '' },
  { type: 'fridge', x: 32, y: 170, rot: 270, why: '' },
  { type: 'tall-cabinet', x: 32, y: 230, rot: 270, why: '' },
  { type: 'stove', x: 30, y: 300, rot: 270, why: '' },
  { type: 'counter-corner', x: 45, y: 380, rot: 270, why: '' },
  { type: 'sink', x: 190, y: 395, rot: 180, why: '' },
  { type: 'table-round', x: 200, y: 200, rot: 0, why: '' },
  { type: 'chair', x: 200, y: 140, rot: 0, why: '' },
  { type: 'chair', x: 140, y: 200, rot: 90, why: '' },
  { type: 'chair', x: 200, y: 260, rot: 180, why: '' },
]

/** модули гарнитура по стенам: вдоль каждой — сплошь, без зазоров */
function runsOf(fs: Furniture[]): Furniture[][] {
  const byRot = new Map<number, Furniture[]>()
  for (const f of fs) if (f.type !== 'counter-corner') byRot.set(f.rot, [...(byRot.get(f.rot) ?? []), f])
  return [...byRot.values()].map((list) => list.sort((a, b) => (a.rot % 180 === 0 ? a.x - b.x : a.y - b.y)))
}

function continuous(kitchen: Furniture[]) {
  for (const run of runsOf(kitchen)) {
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1]
      const b = run[i]
      const gap = (b.rot % 180 === 0 ? b.x - a.x : b.y - a.y) - (a.w + b.w) / 2
      expect(Math.abs(gap), `зазор между ${a.type} и ${b.type}`).toBeLessThan(1)
    }
  }
}

describe('кухонный гарнитур — у коммуникаций, обеденная зона — у окна', () => {
  it('выступ шахты в стене кухни найден; уступ стены — не шахта', () => {
    const { room } = userKitchen()
    const s = shaftsOf(room.inner)
    expect(s).toHaveLength(1)
    expect(s[0].x).toBeCloseTo(288, 0)
    expect(s[0].y).toBeCloseTo(248, 0)
    // срезанный угол 40 × 40 — шахта в углу
    const cut = shaftsOf([
      { x: 0, y: 0 },
      { x: 360, y: 0 },
      { x: 360, y: 40 },
      { x: 400, y: 40 },
      { x: 400, y: 300 },
      { x: 0, y: 300 },
    ])
    expect(cut).toEqual([{ x: 380, y: 20 }])
  })

  it('кухня пользователя: гарнитур к шахте на противоположной стене, под окном пусто, стол у окна вне прохода', () => {
    const { plan, rooms, room } = userKitchen()
    const checks = vetLayout(GEMINI, room, plan, { purpose: 'Кухня', rooms })
    const kitchen = checks.filter((c) => c.ok && c.kitchen).map((c) => c.furniture!)
    const one = (t: string) => checks.find((c) => c.furniture?.type === t)?.furniture
    // мойка и плита — у шахты
    const shaft = { x: 288, y: 248 }
    expect(Math.hypot(one('sink')!.x - shaft.x, one('sink')!.y - shaft.y)).toBeLessThan(150)
    expect(Math.hypot(one('stove')!.x - shaft.x, one('stove')!.y - shaft.y)).toBeLessThan(150)
    // над выступом шахты — столешница на мелких тумбах, фасад в линию
    const cover = kitchen.find((f) => f.type === 'counter-top' && f.d < 58)!
    expect(cover.d).toBeCloseTo(44, 0)
    expect(Math.abs(cover.x + cover.d / 2 - 288)).toBeLessThan(1)
    // под окном ничего: окно x 113…258 в нижней стене
    const underWindow = obbCorners(185, 400, 165, 60, 0)
    for (const f of kitchen) expect(convexOverlap(obbCorners(f.x, f.y, f.w, f.d, f.rot), underWindow, 0.5), `${f.type} под окном`).toBe(false)
    continuous(kitchen)
    // стол — у левой стены в углу у окна; стулья — с открытых сторон
    const table = one('kitchen-table')!
    expect(table.x - table.d / 2).toBeLessThan(2)
    // торцом в угол у окна: нижняя стена — y 426
    expect(Math.abs(table.y + table.w / 2 - 426)).toBeLessThan(2)
    expect(checks.filter((c) => c.ok && c.furniture?.type === 'chair').length).toBeGreaterThanOrEqual(2)
    const summary = layoutSummary(checks)
    expect(summary).toMatch(/от мойки до шахты со стояками 0,\d м/)
    expect(summary).toMatch(/под окном свободно/)
    // «Проверка»: ни красного, ни жёлтого — стулья не в проходе у гарнитура
    const next = applyLayout(plan, checks)
    expect(runChecks(next, buildRooms(next).rooms).issues.filter((i) => i.level !== 'info').map((i) => i.text)).toEqual([])
  })

  it('без шахты и меток — под окном всё равно пусто, посудомойка вплотную к мойке', () => {
    let plan: Plan = { ...empty, walls: [W('top', -10, -10, 310, -10, 20), W('right', 310, -10, 310, 410, 20), W('bottom', -10, 410, 310, 410, 20), W('left', -10, -10, -10, 410, 20)] }
    const rooms0 = buildRooms(plan).rooms
    plan = addOpening(plan, 'door', 'top', 60 / 320, 80, rooms0).plan
    plan = addOpening(plan, 'window', 'bottom', 0.5, 140, rooms0).plan
    const room = buildRooms(plan).rooms[0]
    const checks = vetLayout(
      [
        { type: 'fridge', x: 50, y: 60, rot: 0, why: '' },
        { type: 'sink', x: 150, y: 370, rot: 180, why: 'у окна' },
        { type: 'stove', x: 250, y: 40, rot: 0, why: '' },
        { type: 'dishwasher', x: 200, y: 370, rot: 180, why: '' },
        { type: 'dining-table', x: 160, y: 250, rot: 0, why: '' },
      ],
      room,
      plan,
      { purpose: 'Кухня' },
    )
    const kitchen = checks.filter((c) => c.ok && c.kitchen).map((c) => c.furniture!)
    // окно x 80…220 в нижней стене: перед ним — ни одной тумбы
    const underWindow = obbCorners(150, 370, 160, 60, 0)
    for (const f of kitchen) expect(convexOverlap(obbCorners(f.x, f.y, f.w, f.d, f.rot), underWindow, 0.5), `${f.type} под окном`).toBe(false)
    const sink = kitchen.find((f) => f.type === 'sink')!
    const dw = kitchen.find((f) => f.type === 'dishwasher')!
    expect(Math.hypot(sink.x - dw.x, sink.y - dw.y)).toBeCloseTo((sink.w + dw.w) / 2, 0)
    continuous(kitchen)
    const next = applyLayout(plan, checks)
    const issues = runChecks(next, buildRooms(next).rooms).issues
    expect(issues.filter((i) => i.level !== 'info').map((i) => i.text)).toEqual([])
    expect(issues.some((i) => i.id === 'triangle-ok')).toBe(true)
  })

  it('отмеченные стояк и вентканал: мойка — у стояка, плита — у вентканала', () => {
    let plan: Plan = { ...empty, walls: [W('top', -10, -10, 310, -10, 20), W('right', 310, -10, 310, 410, 20), W('bottom', -10, 410, 310, 410, 20), W('left', -10, -10, -10, 410, 20)] }
    const rooms0 = buildRooms(plan).rooms
    plan = addOpening(plan, 'door', 'top', 260 / 320, 80, rooms0).plan
    plan = addOpening(plan, 'window', 'bottom', 0.5, 140, rooms0).plan
    plan = {
      ...plan,
      furniture: [
        { id: 'r', type: 'riser', x: 12.5, y: 300, w: 25, d: 20, rot: 270 },
        { id: 'v', type: 'vent-duct', x: 12.5, y: 120, w: 40, d: 25, rot: 270 },
      ],
    }
    const room = buildRooms(plan).rooms[0]
    const checks = vetLayout(
      [
        { type: 'fridge', x: 270, y: 200, rot: 90, why: '' },
        { type: 'sink', x: 270, y: 300, rot: 90, why: '' },
        { type: 'stove', x: 270, y: 120, rot: 90, why: '' },
      ],
      room,
      plan,
      { purpose: 'Кухня' },
    )
    const one = (t: string) => checks.find((c) => c.furniture?.type === t)!.furniture!
    expect(Math.hypot(one('sink').x - 12.5, one('sink').y - 300)).toBeLessThan(150)
    expect(Math.hypot(one('stove').x - 12.5, one('stove').y - 120)).toBeLessThan(150)
    expect(layoutSummary(checks)).toMatch(/от мойки до стояка/)
    const next = applyLayout(plan, checks)
    expect(runChecks(next, buildRooms(next).rooms).issues.filter((i) => /стояка|вентканала/.test(i.text))).toEqual([])
  })

  it('мойку у окна попросили — ставится у окна', () => {
    let plan: Plan = { ...empty, walls: [W('top', -10, -10, 310, -10, 20), W('right', 310, -10, 310, 410, 20), W('bottom', -10, 410, 310, 410, 20), W('left', -10, -10, -10, 410, 20)] }
    const rooms0 = buildRooms(plan).rooms
    plan = addOpening(plan, 'door', 'top', 60 / 320, 80, rooms0).plan
    plan = addOpening(plan, 'window', 'bottom', 0.5, 140, rooms0).plan
    const room = buildRooms(plan).rooms[0]
    const checks = vetLayout(
      [
        { type: 'fridge', x: 30, y: 150, rot: 270, why: '' },
        { type: 'sink', x: 150, y: 370, rot: 180, why: '' },
        { type: 'stove', x: 30, y: 280, rot: 270, why: '' },
      ],
      room,
      plan,
      { purpose: 'Кухня', wishes: 'хочу мойку у окна' },
    )
    const sink = checks.find((c) => c.furniture?.type === 'sink')!.furniture!
    expect(sink.y).toBeGreaterThan(350)
    expect(Math.abs(sink.x - 150)).toBeLessThan(70)
  })

  it('гарнитур уже стоит — не пересобирается, новое ставится по одному', () => {
    const { plan: p0, room } = userKitchen()
    const plan = { ...p0, furniture: [{ id: 'old', type: 'sink', x: 274, y: 160, w: 80, d: 60, rot: 90 }] }
    const checks = vetLayout([{ type: 'stove', x: 274, y: 310, rot: 90, why: '' }, { type: 'fridge', x: 271, y: 30, rot: 90, why: '' }], room, plan, { purpose: 'Кухня' })
    expect(checks.some((c) => c.kitchen)).toBe(false)
  })

  it('столешница нужной длины — из тумб каталога', () => {
    expect(counters(60)).toEqual([60])
    expect(counters(120)).toEqual([60, 60])
    expect(counters(140)).toEqual([80, 60])
    expect(counters(160)).toEqual([100, 60])
    expect(counters(200)).toEqual([100, 100])
    expect(counters(220)).toEqual([100, 60, 60])
  })
})

void KITCHEN
