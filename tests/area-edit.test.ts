import { describe, expect, it } from 'vitest'
import type { Plan, Wall } from '../src/planner/types'
import { uid } from '../src/planner/types'
import { buildRooms } from '../src/planner/rooms'
import { addOpening, clearWallsIn, normalizeArea, openingInArea, wallInArea, wallThrough } from '../src/planner/ops'

const wall = (x1: number, y1: number, x2: number, y2: number, thickness = 10): Wall => ({ id: uid('w'), a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, thickness })

/** комната 0..400 × 0..300 из четырёх стен */
function room(): Plan {
  return {
    version: 1,
    name: '',
    walls: [wall(0, 0, 400, 0), wall(400, 0, 400, 300), wall(400, 300, 0, 300), wall(0, 300, 0, 0)],
    openings: [],
    furniture: [],
    rooms: [],
    dims: [],
    settings: { grid: 10 },
  }
}

describe('уточнение участка: стены', () => {
  it('участок посреди стены разрезает её надвое, остальные стены не трогает', () => {
    const p = room()
    const next = clearWallsIn(p, { x1: 150, y1: -20, x2: 250, y2: 20 })
    expect(next.walls).toHaveLength(5)
    const top = next.walls.filter((w) => Math.abs(w.a.y) < 1 && Math.abs(w.b.y) < 1)
    expect(top).toHaveLength(2)
    expect(Math.max(...top.map((w) => Math.min(w.a.x, w.b.x)))).toBeCloseTo(250, 0)
    expect(Math.min(...top.map((w) => Math.max(w.a.x, w.b.x)))).toBeCloseTo(150, 0)
    // боковые и нижняя стены целы
    expect(next.walls.filter((w) => Math.abs(w.a.x - w.b.x) < 1)).toHaveLength(2)
  })

  it('участок на весь конец стены её укорачивает, а совсем короткий остаток исчезает', () => {
    const p = room()
    const next = clearWallsIn(p, { x1: 380, y1: -20, x2: 420, y2: 20 })
    const top = next.walls.filter((w) => Math.abs(w.a.y) < 1 && Math.abs(w.b.y) < 1)
    expect(top).toHaveLength(1)
    expect(Math.max(top[0].a.x, top[0].b.x)).toBeCloseTo(380, 0)
  })

  it('участок вокруг всей стены удаляет её целиком', () => {
    const p = room()
    const next = clearWallsIn(p, { x1: -20, y1: -20, x2: 420, y2: 20 })
    expect(next.walls).toHaveLength(3)
  })

  it('«здесь стена» ставит стену вдоль длинной стороны участка', () => {
    const p = room()
    const next = wallInArea(p, normalizeArea({ x: 200, y: 20 }, { x: 210, y: 280 }), 10)
    const added = next.walls.find((w) => Math.abs(w.a.x - 205) < 1 && Math.abs(w.b.x - 205) < 1)
    expect(added).toBeDefined()
    // концы дотянулись до верхней и нижней стен: контур замкнулся
    expect(Math.abs(added!.a.y - added!.b.y)).toBeCloseTo(300, 0)
    // перегородка разделила комнату надвое
    expect(buildRooms(next).rooms).toHaveLength(2)
  })
})

describe('уточнение участка: двери и окна', () => {
  it('«здесь дверь» ставит дверь на стену под участком, шириной с участок', () => {
    const p = room()
    const rooms = buildRooms(p).rooms
    const { plan: next, id } = openingInArea(p, { x1: 150, y1: -20, x2: 240, y2: 20 }, 'door', rooms)
    expect(id).toBeTruthy()
    expect(next.openings).toHaveLength(1)
    const o = next.openings[0]
    expect(o.kind).toBe('door')
    expect(o.width).toBeCloseTo(90, 0)
    expect(o.t * 400).toBeCloseTo(195, 0)
    // стена цела: проём — это не дыра в геометрии
    expect(next.walls).toHaveLength(4)
  })

  it('уточнение заменяет прежний проём на том же месте, а дальний оставляет', () => {
    const p = room()
    const rooms = buildRooms(p).rooms
    const withDoor = addOpening(p, 'door', p.walls[0].id, 0.5, 80, rooms).plan
    const far = addOpening(withDoor, 'window', withDoor.walls[0].id, 0.1, 60, rooms).plan
    const { plan: next } = openingInArea(far, { x1: 150, y1: -20, x2: 240, y2: 20 }, 'window', rooms)
    expect(next.openings).toHaveLength(2)
    expect(next.openings.map((o) => o.kind).sort()).toEqual(['window', 'window'])
  })

  it('стена не дотягивается до далёкой стены: участок посреди комнаты остаётся куском', () => {
    const p = room()
    const next = wallInArea(p, normalizeArea({ x: 200, y: 120 }, { x: 210, y: 180 }), 10)
    const added = next.walls.find((w) => Math.abs(w.a.x - 205) < 1 && Math.abs(w.b.x - 205) < 1)
    expect(added).toBeDefined()
    expect(Math.abs(added!.a.y - added!.b.y)).toBeCloseTo(60, 0)
    expect(buildRooms(next).rooms).toHaveLength(1)
  })
})

describe('уточнение участка: проёмы', () => {
  it('на пустом месте проём не ставится', () => {
    const p = room()
    expect(wallThrough(p, { x1: 100, y1: 100, x2: 200, y2: 200 })).toBeNull()
    expect(openingInArea(p, { x1: 100, y1: 100, x2: 200, y2: 200 }, 'door', []).id).toBe('')
  })

  it('проём на вырезанном куске стены исчезает вместе с ним, на уцелевшем — остаётся', () => {
    const p = room()
    const rooms = buildRooms(p).rooms
    const withDoor = addOpening(p, 'door', p.walls[0].id, 0.5, 80, rooms).plan
    const gone = clearWallsIn(withDoor, { x1: 150, y1: -20, x2: 250, y2: 20 })
    expect(gone.openings).toHaveLength(0)
    const kept = clearWallsIn(withDoor, { x1: 10, y1: -20, x2: 60, y2: 20 })
    expect(kept.openings).toHaveLength(1)
    const w = kept.walls.find((x) => x.id === kept.openings[0].wallId)!
    expect(Math.min(w.a.x, w.b.x)).toBeCloseTo(60, 0)
  })
})
