import { describe, expect, it } from 'vitest'
import type { Plan } from '../src/planner/types'
import { buildRooms } from '../src/planner/rooms'
import { addOpening } from '../src/planner/ops'
import { applyLayout, layoutSummary, vetLayout } from '../src/planner/autolayout'
import { runChecks } from '../src/planner/checks'
import { PALETTES } from '../src/planner/palette'

const empty: Plan = { version: 1, name: 'тест', walls: [], openings: [], furniture: [], rooms: [], dims: [], settings: { grid: 10 } }
const W = (id: string, ax: number, ay: number, bx: number, by: number, t: number) => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: t })

/** комната 450 × 400 по чистовым граням: окно слева, дверь справа внизу */
function livingRoom() {
  let plan: Plan = { ...empty, walls: [W('top', -10, -10, 460, -10, 20), W('right', 460, -10, 460, 410, 20), W('bottom', -10, 410, 460, 410, 20), W('left', -10, -10, -10, 410, 20)] }
  const rooms0 = buildRooms(plan).rooms
  plan = addOpening(plan, 'window', 'left', 0.5, 150, rooms0).plan
  plan = addOpening(plan, 'door', 'right', 0.8, 80, rooms0).plan
  return { plan, room: buildRooms(plan).rooms[0] }
}

const LIVING = [
  { type: 'sofa-3', x: 225, y: 350, rot: 180, why: 'у нижней стены' },
  // как отвечает модель: стол и кресло где попало, телевизор сбоку
  { type: 'coffee-table', x: 100, y: 120, rot: 0, why: '' },
  { type: 'armchair', x: 380, y: 100, rot: 0, why: '' },
  { type: 'tv-stand', x: 420, y: 200, rot: 90, why: '' },
  { type: 'bookshelf', x: 225, y: 20, rot: 0, why: '' },
]

describe('приёмы дизайнера', () => {
  it('гостиная: стол перед диваном, кресло к столу, телевизор напротив, ковёр, торшер, растение, одна палитра', () => {
    const { plan, room } = livingRoom()
    const checks = vetLayout(LIVING, room, plan, { purpose: 'Гостиная', touches: true })
    const f = (type: string) => checks.find((c) => c.furniture?.type === type)!.furniture!
    const sofa = f('sofa-3')
    // журнальный стол — на оси дивана, 45 см от его фасада (диван смотрит вверх)
    const table = f('coffee-table')
    expect(table.x).toBeCloseTo(sofa.x, 0)
    expect(sofa.y - sofa.d / 2 - (table.y + table.d / 2)).toBeCloseTo(45, 0)
    // кресло сбоку от стола лицом к нему
    const chair = f('armchair')
    expect(Math.abs(chair.x - table.x)).toBeGreaterThan(table.w / 2)
    expect(Math.abs(chair.y - table.y)).toBeLessThan(40)
    // телевизор напротив дивана, у верхней стены, на его оси
    const tv = f('tv-stand')
    expect(tv.x).toBeCloseTo(sofa.x, 0)
    expect(tv.y - tv.d / 2).toBeLessThan(2)
    // штрихи: ковёр под передними ножками дивана, торшер у кресла, растение у окна (окно слева)
    const rug = f('rug')
    expect(rug.y + rug.d / 2).toBeGreaterThan(sofa.y - sofa.d / 2)
    expect(Math.hypot(f('lamp').x - chair.x, f('lamp').y - chair.y)).toBeLessThan(80)
    expect(f('plant').x).toBeLessThan(60)
    // палитра: диван — основной цвет, кресло — акцент
    expect(sofa.color).toBe(PALETTES.living.main)
    expect(chair.color).toBe(PALETTES.living.accent)
    const summary = layoutSummary(checks)
    expect(summary).toMatch(/тв-тумба — напротив дивана/)
    expect(summary).toMatch(/штрихи дизайнера: ковёр у дивана, торшер у кресла, растение у окна/)
    expect(summary).toMatch(/палитра «морская волна и горчица»/)
    const next = applyLayout(plan, checks)
    expect(runChecks(next, buildRooms(next).rooms).issues.filter((i) => i.level !== 'info').map((i) => i.text)).toEqual([])
  })

  it('спальня: ковёр под нижние две трети кровати, покрывало в палитре', () => {
    const { plan, room } = livingRoom()
    const checks = vetLayout([{ type: 'bed-160', x: 225, y: 105, rot: 0, why: '' }], room, plan, { purpose: 'Спальня', touches: true })
    const bed = checks.find((c) => c.furniture?.type === 'bed-160')!.furniture!
    const rug = checks.find((c) => c.furniture?.type === 'rug')!.furniture!
    expect(bed.color).toBe(PALETTES.bedroom.main)
    expect(rug.w).toBeGreaterThan(bed.w)
    // верх ковра — ниже изголовья на треть кровати, низ — за изножьем
    expect(rug.y - rug.d / 2).toBeGreaterThan(bed.y - bed.d / 2 + bed.d * 0.3)
    expect(rug.y + rug.d / 2).toBeGreaterThan(bed.y + bed.d / 2)
    expect(layoutSummary(checks)).toMatch(/ковёр под кроватью/)
  })

  it('без штрихов — только то, что предложила модель, без палитры', () => {
    const { plan, room } = livingRoom()
    const checks = vetLayout(LIVING, room, plan, { purpose: 'Гостиная' })
    expect(checks.map((c) => c.furniture?.type).sort()).toEqual(['armchair', 'bookshelf', 'coffee-table', 'sofa-3', 'tv-stand'])
    expect(checks.every((c) => !c.furniture?.color)).toBe(true)
    // но композиция та же: стол перед диваном
    expect(checks.find((c) => c.furniture?.type === 'coffee-table')!.paired).toMatch(/перед диваном/)
  })

  it('ковёр, предложенный моделью, ложится под кровать, а не встаёт «рядом» как шкаф', () => {
    const { plan, room } = livingRoom()
    const checks = vetLayout(
      [
        { type: 'bed-160', x: 225, y: 105, rot: 0, why: '' },
        { type: 'rug', x: 380, y: 330, rot: 0, why: '' },
      ],
      room,
      plan,
      { purpose: 'Спальня' },
    )
    const bed = checks[0].furniture!
    const rug = checks[1].furniture!
    expect(Math.abs(rug.x - bed.x)).toBeLessThan(2)
    expect(rug.w).toBeGreaterThan(bed.w)
    expect(checks[1].touch).toBe('ковёр под кроватью')
  })
})
