import { describe, expect, it } from 'vitest'
import type { Plan, Room } from '../src/planner/types'
import { CATALOG } from '../src/planner/catalog'
import { buildRooms } from '../src/planner/rooms'
import { addOpening, addRect } from '../src/planner/ops'
import { applyLayout, catalogForRoom, layoutSummary, snapToWall, vetLayout } from '../src/planner/autolayout'

const empty: Plan = {
  version: 1,
  name: 'тест',
  walls: [],
  openings: [],
  furniture: [],
  rooms: [],
  dims: [],
  settings: { grid: 10 },
}

/** комната 5 × 4 м по осям стен */
function room(): { plan: Plan; room: Room } {
  const plan = addRect(empty, { x: 0, y: 0 }, { x: 500, y: 400 }, 20)
  const { rooms } = buildRooms(plan)
  return { plan, room: rooms[0] }
}

describe('проверка расстановки от ИИ', () => {
  it('принимает предмет в середине комнаты', () => {
    const { plan, room: r } = room()
    const checks = vetLayout([{ type: 'bed-160', x: 250, y: 200, rot: 0, why: 'по центру' }], r, plan)
    expect(checks[0].ok).toBe(true)
    expect(checks[0].furniture?.type).toBe('bed-160')
  })

  it('отказывает предмету с типом не из каталога', () => {
    const { plan, room: r } = room()
    const checks = vetLayout([{ type: 'вертолёт', x: 250, y: 200, rot: 0, why: '' }], r, plan)
    expect(checks[0].ok).toBe(false)
    expect(checks[0].reason).toMatch(/нет типа/)
  })

  it('отказывает предмету за пределами комнаты', () => {
    const { plan, room: r } = room()
    const checks = vetLayout([{ type: 'bed-160', x: 2000, y: 2000, rot: 0, why: '' }], r, plan)
    expect(checks[0].ok).toBe(false)
    expect(checks[0].reason).toMatch(/вне комнаты/)
  })

  it('отказывает предмету, торчащему сквозь стену', () => {
    const { plan, room: r } = room()
    // кровать 160 × 200 у самого края: половина окажется снаружи
    const checks = vetLayout([{ type: 'bed-160', x: 490, y: 200, rot: 0, why: '' }], r, plan)
    expect(checks[0].ok).toBe(false)
    expect(checks[0].reason).toMatch(/выходит за стены/)
  })

  it('второй предмет на том же месте отклоняется', () => {
    const { plan, room: r } = room()
    const checks = vetLayout(
      [
        { type: 'bed-160', x: 250, y: 200, rot: 0, why: 'первая' },
        { type: 'wardrobe', x: 250, y: 200, rot: 0, why: 'вторая на том же месте' },
      ],
      r,
      plan,
    )
    expect(checks[0].ok).toBe(true)
    expect(checks[1].ok).toBe(false)
    expect(checks[1].reason).toMatch(/накладывается/)
  })

  it('предмет в створе двери отклоняется', () => {
    const { plan, room: r } = room()
    const wall = plan.walls.find((w) => Math.abs(w.a.y - w.b.y) < 1 && w.a.y < 10)!
    const { rooms } = buildRooms(plan)
    const withDoor = addOpening(plan, 'door', wall.id, 0.5, 90, rooms).plan
    const checks = vetLayout([{ type: 'wardrobe', x: 250, y: 40, rot: 0, why: 'прямо в дверь' }], r, withDoor)
    expect(checks[0].ok).toBe(false)
    expect(checks[0].reason).toMatch(/двери/)
  })

  it('не наезжает на мебель, которая уже стоит', () => {
    const { plan, room: r } = room()
    const busy: Plan = {
      ...plan,
      furniture: [{ id: 'f1', type: 'sofa-3', x: 250, y: 200, w: 220, d: 95, rot: 0 }],
    }
    const checks = vetLayout([{ type: 'dining-table', x: 250, y: 200, rot: 0, why: '' }], r, busy)
    expect(checks[0].ok).toBe(false)
  })

  it('притягивает предмет к близкой стене вплотную', () => {
    const { plan } = room()
    const f = { id: 'x', type: 'wardrobe', x: 250, y: 45, w: 120, d: 60, rot: 0 }
    const snapped = snapToWall(f, plan.walls, 25)
    // верхняя стена толщиной 20 на y = 0: предмет должен встать на y = 30 + 10
    expect(snapped.y).toBeCloseTo(40, 1)
  })

  it('далёкий предмет не притягивается', () => {
    const { plan } = room()
    const f = { id: 'x', type: 'wardrobe', x: 250, y: 200, w: 120, d: 60, rot: 0 }
    expect(snapToWall(f, plan.walls, 25).y).toBe(200)
  })

  it('в план попадает только принятое', () => {
    const { plan, room: r } = room()
    const checks = vetLayout(
      [
        { type: 'bed-160', x: 250, y: 200, rot: 0, why: 'ок' },
        { type: 'вертолёт', x: 250, y: 100, rot: 0, why: 'нет' },
      ],
      r,
      plan,
    )
    const next = applyLayout(plan, checks)
    expect(next.furniture).toHaveLength(1)
    expect(layoutSummary(checks)).toMatch(/Поставлено предметов: 1\. Отклонено 1/)
  })

  it('объяснение модели попадает в пояснение, а не в подпись', () => {
    const { plan, room: r } = room()
    const checks = vetLayout([{ type: 'bed-160', x: 250, y: 200, rot: 0, why: 'изголовьем к глухой стене' }], r, plan)
    expect(checks[0].furniture?.note).toBe('изголовьем к глухой стене')
    expect(checks[0].furniture?.label, 'подпись на чертеже остаётся короткой').toBeUndefined()
  })
})

describe('каталог под комнату', () => {
  it('в санузел не предлагается кровать, а в спальню — унитаз', () => {
    const bath = catalogForRoom('Санузел', CATALOG).map((c) => c.type)
    const bed = catalogForRoom('Спальня', CATALOG).map((c) => c.type)
    expect(bath).toContain('toilet')
    expect(bath).not.toContain('bed-160')
    expect(bed).toContain('bed-160')
    expect(bed).not.toContain('toilet')
  })

  it('электрика в расстановку мебели не попадает', () => {
    for (const name of ['Кухня', 'Спальня', 'Санузел', 'Прихожая']) {
      const types = catalogForRoom(name, CATALOG)
      expect(types.every((t) => CATALOG.find((c) => c.type === t.type)?.category !== 'electric')).toBe(true)
    }
  })

  it('незнакомой комнате даётся жилой набор', () => {
    const types = catalogForRoom('Помещение №5', CATALOG).map((c) => c.type)
    expect(types).toContain('sofa-3')
  })
})
