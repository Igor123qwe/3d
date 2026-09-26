import { describe, expect, it } from 'vitest'
import type { Furniture, Plan } from '../src/planner/types'
import { buildRooms } from '../src/planner/rooms'
import { addOpening } from '../src/planner/ops'
import { applyLayout, layoutSummary, vetLayout } from '../src/planner/autolayout'
import { counters } from '../src/planner/kitchen'
import { runChecks } from '../src/planner/checks'

const empty: Plan = { version: 1, name: 'тест', walls: [], openings: [], furniture: [], rooms: [], dims: [], settings: { grid: 10 } }
const W = (id: string, ax: number, ay: number, bx: number, by: number, t: number) => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: t })

/** кухня пользователя: 330 × 426, справа вверху шахта 26 × 215, дверь в верхней стене слева, окно в нижней */
function userKitchen() {
  let plan: Plan = {
    ...empty,
    walls: [W('top', -10, -10, 314, -10, 20), W('shaftV', 314, -10, 314, 225, 20), W('shaftH', 314, 225, 340, 225, 20), W('right', 340, 225, 340, 436, 20), W('bottom', -10, 436, 340, 436, 20), W('left', -10, -10, -10, 436, 20)],
  }
  const rooms0 = buildRooms(plan).rooms
  plan = addOpening(plan, 'door', 'top', 70 / 324, 80, rooms0).plan
  plan = addOpening(plan, 'window', 'bottom', 206 / 350, 150, rooms0).plan
  return { plan, room: buildRooms(plan).rooms[0] }
}

/** модули гарнитура по стенам: вдоль каждой — сплошь, без зазоров */
function runsOf(fs: Furniture[]): Furniture[][] {
  const byRot = new Map<number, Furniture[]>()
  for (const f of fs) if (f.type !== 'counter-corner') byRot.set(f.rot, [...(byRot.get(f.rot) ?? []), f])
  return [...byRot.values()].map((list) => {
    const along = (f: Furniture) => (f.rot % 180 === 0 ? f.x : f.y)
    return list.sort((a, b) => along(a) - along(b))
  })
}

describe('кухонный гарнитур собирает программа', () => {
  it('кухня пользователя: модель поставила всё врозь — собрана буквой Г, без зазоров, по правилам', () => {
    const { plan, room } = userKitchen()
    // как ответила модель: плита одна у противоположной стены, тумбы с зазорами
    const proposal = [
      { type: 'counter-60', x: 30, y: 110, rot: 270, why: '' },
      { type: 'fridge', x: 32, y: 170, rot: 270, why: '' },
      { type: 'sink', x: 30, y: 250, rot: 270, why: '' },
      { type: 'counter-corner', x: 45, y: 380, rot: 270, why: '' },
      { type: 'dishwasher', x: 120, y: 395, rot: 180, why: '' },
      { type: 'stove', x: 274, y: 60, rot: 90, why: '' },
      { type: 'kitchen-table', x: 290, y: 300, rot: 90, why: '' },
      { type: 'bar-stool', x: 290, y: 240, rot: 0, why: '' },
      { type: 'bar-stool', x: 220, y: 300, rot: 90, why: '' },
    ]
    const checks = vetLayout(proposal, room, plan, { purpose: 'Кухня' })
    expect(checks.every((c) => c.ok), checks.filter((c) => !c.ok).map((c) => c.reason).join('; ')).toBe(true)
    const kitchen = checks.filter((c) => c.kitchen).map((c) => c.furniture!)
    const type = (t: string) => kitchen.find((f) => f.type === t)!
    expect(kitchen.filter((f) => f.type === 'counter-corner')).toHaveLength(1)
    // вдоль каждой стены — сплошь: край к краю
    for (const run of runsOf(kitchen)) {
      for (let i = 1; i < run.length; i++) {
        const a = run[i - 1]
        const b = run[i]
        const gap = (b.rot % 180 === 0 ? b.x - a.x : b.y - a.y) - (a.w + b.w) / 2
        expect(Math.abs(gap), `зазор между ${a.type} и ${b.type}`).toBeLessThan(1)
      }
    }
    // у плиты с обеих сторон что-то есть: столешница или угол, не холодильник
    const stove = type('stove')
    const beside = kitchen.filter((f) => f !== stove && Math.hypot(f.x - stove.x, f.y - stove.y) < (f.w + stove.w) / 2 + 20)
    expect(beside.length).toBeGreaterThanOrEqual(2)
    expect(beside.map((f) => f.type)).not.toContain('fridge')
    // посудомойка — вплотную к мойке
    const sink = type('sink')
    const dw = type('dishwasher')
    expect(Math.hypot(sink.x - dw.x, sink.y - dw.y)).toBeCloseTo((sink.w + dw.w) / 2, 0)
    // мойка под окном (окно в нижней стене, x 131…281), плита и холодильник — нет
    expect(sink.y).toBeGreaterThan(380)
    expect(sink.x + sink.w / 2).toBeGreaterThan(131)
    for (const f of [stove, type('fridge')]) expect(f.y < 380 || f.x + f.w / 2 < 131 || f.x - f.w / 2 > 281).toBe(true)
    expect(layoutSummary(checks)).toMatch(/кухня собрана гарнитуром буквой Г: холодильник — .*плита/)
    expect(layoutSummary(checks)).not.toMatch(/место поправлено у [2-9]/)
    // «Проверка»: ни красного, ни жёлтого; рабочий треугольник в норме — угол служит столешницей между плитой и мойкой
    const next = applyLayout(plan, checks)
    const issues = runChecks(next, buildRooms(next).rooms).issues
    expect(issues.filter((i) => i.level !== 'info').map((i) => i.text)).toEqual([])
    expect(issues.some((i) => i.id === 'triangle-ok')).toBe(true)
  })

  it('прямоугольная кухня: треугольник в норме, «Проверка» чистая', () => {
    // 300 × 400 по чистовым граням: дверь в верхней стене слева, окно в нижней посередине
    let plan: Plan = { ...empty, walls: [W('top', -10, -10, 310, -10, 20), W('right', 310, -10, 310, 410, 20), W('bottom', -10, 410, 310, 410, 20), W('left', -10, -10, -10, 410, 20)] }
    const rooms0 = buildRooms(plan).rooms
    plan = addOpening(plan, 'door', 'top', 60 / 320, 80, rooms0).plan
    plan = addOpening(plan, 'window', 'bottom', 0.5, 140, rooms0).plan
    const room = buildRooms(plan).rooms[0]
    const checks = vetLayout(
      [
        { type: 'fridge', x: 50, y: 60, rot: 0, why: '' },
        { type: 'sink', x: 150, y: 40, rot: 0, why: '' },
        { type: 'stove', x: 250, y: 40, rot: 0, why: '' },
        { type: 'dishwasher', x: 200, y: 40, rot: 0, why: '' },
        { type: 'dining-table', x: 160, y: 300, rot: 0, why: '' },
      ],
      room,
      plan,
      { purpose: 'Кухня' },
    )
    const next = applyLayout(plan, checks)
    const issues = runChecks(next, buildRooms(next).rooms).issues
    expect(checks.filter((c) => c.kitchen).length).toBeGreaterThanOrEqual(5)
    expect(issues.filter((i) => i.level !== 'info').map((i) => i.text)).toEqual([])
    expect(issues.some((i) => i.id === 'triangle-ok')).toBe(true)
  })

  it('гарнитур уже стоит — не пересобирается, новое ставится по одному', () => {
    const { plan: p0, room } = userKitchen()
    const plan = { ...p0, furniture: [{ id: 'old', type: 'sink', x: 130, y: 396, w: 80, d: 60, rot: 180 }] }
    const checks = vetLayout([{ type: 'stove', x: 31, y: 246, rot: 270, why: '' }, { type: 'fridge', x: 33, y: 126, rot: 270, why: '' }], room, plan, { purpose: 'Кухня' })
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
