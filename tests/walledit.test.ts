import { describe, expect, it } from 'vitest'
import { deleteRun, normalizeWalls, pushRun, runSection, setRunLength, wallRun } from '../src/planner/walledit'
import { buildRooms } from '../src/planner/rooms'
import { emptyPlan, type Plan, type Wall } from '../src/planner/types'

const w = (id: string, ax: number, ay: number, bx: number, by: number, thickness = 10): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness })

/**
 * Две комнаты рядом, 400 × 400 каждая по осям. Верхняя стена — из двух
 * кусков (как после распознавания), перегородка упирается в верх и низ
 * Т-стыками
 */
const twoRooms = (): Plan => ({
  ...emptyPlan(),
  walls: [w('top1', 0, 0, 400, 0), w('top2', 400, 0, 800, 0), w('bottom', 0, 400, 800, 400), w('left', 0, 0, 0, 400), w('right', 800, 0, 800, 400), w('mid', 400, 0, 400, 400)],
})

const roomsOf = (p: Plan) =>
  buildRooms(p)
    .rooms.map((r) => {
      const xs = r.polygon.map((q) => q.x)
      const ys = r.polygon.map((q) => q.y)
      return [Math.round(Math.max(...xs) - Math.min(...xs)), Math.round(Math.max(...ys) - Math.min(...ys))]
    })
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])

describe('правка стен как в The Sims', () => {
  it('прямая стена — все соосные куски подряд', () => {
    const run = wallRun(twoRooms().walls, 'top2')!
    expect(run.ids.sort()).toEqual(['top1', 'top2'])
    expect(run.a).toEqual({ x: 0, y: 0 })
    expect(run.b).toEqual({ x: 800, y: 0 })
  })

  it('перегородка двигается поперёк себя, её концы в Т-стыках остаются на стенах, комнаты замкнуты', () => {
    const p = pushRun(twoRooms(), 'mid', 50)
    const mid = p.walls.find((x) => x.id === 'mid')!
    // перегородка идёт вниз: поперёк неё — влево, и +50 сдвигает её влево
    expect(Math.abs(mid.a.x - mid.b.x)).toBeLessThan(0.01)
    expect(roomsOf(p)).toEqual([
      [350, 400],
      [450, 400],
    ])
  })

  it('прямая из кусков двигается целиком, примыкающие стены тянутся — верх уходит на 30, обе комнаты глубже', () => {
    const p = pushRun(twoRooms(), 'top1', -30)
    expect(roomsOf(p)).toEqual([
      [400, 430],
      [400, 430],
    ])
    // куски верха без стыка между ними — Т-стык с перегородкой держит их порознь
    expect(p.walls.filter((x) => Math.abs(x.a.y + 30) < 0.01 && Math.abs(x.b.y + 30) < 0.01)).toHaveLength(2)
  })

  it('участок между стыками выдвигается с перемычками по краям: выступ одной комнаты, соседняя не тронута', () => {
    const p0 = twoRooms()
    const run = wallRun(p0.walls, 'top1')!
    const part = runSection(p0.walls, run, { x: 200, y: 0 })
    expect(part).toEqual({ lo: 0, hi: 400 })
    const p = pushRun(p0, 'top1', -60, part)
    expect(roomsOf(p)).toEqual([
      [400, 400],
      [400, 460],
    ])
    // левая стена и перемычка у её конца склеились в одну
    expect(p.walls.filter((x) => Math.abs(x.a.x) < 0.01 && Math.abs(x.b.x) < 0.01)).toHaveLength(1)
  })

  it('склейка: соосные куски встык одной толщины — одна стена; в Т-стыке и разной толщины — нет', () => {
    const p = normalizeWalls({ ...emptyPlan(), walls: [w('a', 0, 0, 300, 0), w('b', 300, 0, 500, 0), w('c', 500, 0, 700, 0, 20), w('t', 300, 0, 300, 200)] })
    // a и b встречаются в Т-стыке с t — не склеиваются; b и c — разной толщины
    expect(p.walls).toHaveLength(4)
    const q = normalizeWalls({ ...emptyPlan(), walls: [w('a', 0, 0, 300, 0), w('b', 300, 0, 500, 0)], openings: [{ id: 'd', kind: 'door', wallId: 'b', t: 0.5, width: 80, hinge: 'a', side: 1 }] })
    expect(q.walls).toHaveLength(1)
    // дверь осталась на месте: середина прежнего куска, x = 400
    const door = q.openings[0]
    const wall = q.walls[0]
    expect(wall.a.x + (wall.b.x - wall.a.x) * door.t).toBeCloseTo(400, 5)
  })

  it('длина прямой: поперечная стена за её концом едет целиком, угол остаётся прямым', () => {
    const p = setRunLength(twoRooms(), 'top1', 900)
    expect(roomsOf(p)).toEqual([
      [400, 400],
      [500, 400],
    ])
    const right = p.walls.find((x) => x.id === 'right')!
    expect(right.a.x).toBeCloseTo(900, 5)
    expect(right.b.x).toBeCloseTo(900, 5)
  })

  it('удаление прямой: комнаты сливаются в одну, куски верха без стыка склеиваются', () => {
    const p = deleteRun(twoRooms(), 'mid')
    expect(roomsOf(p)).toEqual([[800, 400]])
    expect(p.walls).toHaveLength(4)
  })
})
