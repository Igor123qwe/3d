import { describe, expect, it } from 'vitest'
import { closeGaps, deleteRun, deleteSection, findGaps, guardLocks, movedSection, normalizeWalls, pushRun, runSection, setAllLocked, setRoomSide, setRunLength, setRunLocked, touchesLocked, wallRun } from '../src/planner/walledit'
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

  it('выдвинутый участок находится после сдвига — на него переходит выделение; для всей прямой Т-стык в середине не мешает', () => {
    const p0 = twoRooms()
    const run = wallRun(p0.walls, 'top1')!
    const p = pushRun(p0, 'top1', -60, { lo: 0, hi: 400 })
    const w = movedSection(p.walls, run, 0, 400, -60)!
    expect(Math.abs(w.a.y - w.b.y)).toBeLessThan(0.01)
    expect(Math.abs(w.a.y)).toBeCloseTo(60, 5)
    expect(Math.abs(w.b.x - w.a.x)).toBeCloseTo(400, 5)
    // вся прямая: в её середине (x = 400) стоит перегородка, берётся кусок верха
    const q = pushRun(p0, 'top1', -30)
    const top = movedSection(q.walls, run, 0, 800, -30)!
    expect(top.a.y).toBeCloseTo(top.b.y, 5)
  })

  describe('удалить часть стены', () => {
    it('участок низа до перегородки — левая комната раскрылась, правая цела, правый кусок низа на месте', () => {
      const p0 = twoRooms()
      const run = wallRun(p0.walls, 'bottom')!
      const part = runSection(p0.walls, run, { x: 200, y: 400 })
      expect(part).toEqual({ lo: 0, hi: 400 })
      const p = deleteSection(p0, 'bottom', part.lo, part.hi)
      expect(roomsOf(p)).toEqual([[400, 400]])
      const low = p.walls.filter((x) => Math.abs(x.a.y - 400) < 0.01 && Math.abs(x.b.y - 400) < 0.01)
      expect(low).toHaveLength(1)
      expect(Math.min(low[0].a.x, low[0].b.x)).toBeCloseTo(400, 5)
      expect(Math.max(low[0].a.x, low[0].b.x)).toBeCloseTo(800, 5)
    })

    it('дверь на удалённом участке уходит, на оставшемся — стоит где стояла', () => {
      const p0: Plan = {
        ...twoRooms(),
        openings: [
          { id: 'gone', kind: 'door', wallId: 'bottom', t: 0.25, width: 80, hinge: 'a', side: 1 },
          { id: 'kept', kind: 'door', wallId: 'bottom', t: 0.75, width: 80, hinge: 'a', side: 1 },
        ],
      }
      const p = deleteSection(p0, 'bottom', 0, 400)
      expect(p.openings.map((o) => o.id)).toEqual(['kept'])
      const o = p.openings[0]
      const host = p.walls.find((x) => x.id === o.wallId)!
      expect(host.a.x + (host.b.x - host.a.x) * o.t).toBeCloseTo(600, 5)
    })

    it('зафиксированную стену по частям не удалить', () => {
      const p0 = setRunLocked(twoRooms(), 'bottom', true)
      expect(touchesLocked(p0, deleteSection(p0, 'bottom', 0, 400))).toBe(true)
    })
  })

  describe('размер комнаты цифрой', () => {
    // левая комната в чистоте: от 5 до 395 по x (стены 10 см)
    const a = { x: 5, y: 5 }
    const b = { x: 395, y: 5 }

    it('сторона 390 → 400: двигается перегородка за правым углом, соседняя комната уже', () => {
      const p = setRoomSide(twoRooms(), a, b, 400, 'b')
      expect(roomsOf(p)).toEqual([
        [390, 400],
        [410, 400],
      ])
    })

    it('или наружная стена за левым углом — соседняя комната не тронута', () => {
      const p = setRoomSide(twoRooms(), a, b, 400, 'a')
      expect(roomsOf(p)).toEqual([
        [400, 400],
        [410, 400],
      ])
      expect(p.walls.find((x) => x.id === 'left')!.a.x).toBeCloseTo(-10, 5)
    })
  })

  describe('замок', () => {
    it('зафиксированную перегородку правка не двигает: guardLocks возвращает план как был', () => {
      const p0 = setRunLocked(twoRooms(), 'mid', true)
      const moved = setRoomSide(p0, { x: 5, y: 5 }, { x: 395, y: 5 }, 400, 'b')
      expect(touchesLocked(p0, moved)).toBe(true)
      expect(guardLocks(p0, moved)).toBe(p0)
      // другая стена свободна: левая наружная едет
      const other = setRoomSide(p0, { x: 5, y: 5 }, { x: 395, y: 5 }, 400, 'a')
      expect(touchesLocked(p0, other)).toBe(false)
    })

    it('растянуть зафиксированную стену тоже нельзя: верх держит зафиксированные бока', () => {
      const p0 = setRunLocked(twoRooms(), 'left', true)
      expect(touchesLocked(p0, pushRun(p0, 'top1', -30))).toBe(true)
    })

    it('«зафиксировать все» — никакая стена не двигается, склейка зафиксированных не трогает', () => {
      const p0 = setAllLocked(twoRooms(), true)
      expect(touchesLocked(p0, pushRun(p0, 'mid', 20))).toBe(true)
      expect(touchesLocked(p0, deleteRun(p0, 'mid'))).toBe(true)
      // куски верха без стыка у зафиксированных стен не склеиваются
      const q = normalizeWalls(setAllLocked({ ...emptyPlan(), walls: [w('a', 0, 0, 300, 0), w('b', 300, 0, 500, 0)] }, true))
      expect(q.walls).toHaveLength(2)
      expect(setAllLocked(p0, false).walls.every((x) => !x.locked)).toBe(true)
    })
  })

  describe('разрывы', () => {
    it('перегородка не дошла до верха 15 см — дотягивается, комнат снова две', () => {
      const p0: Plan = { ...twoRooms(), walls: twoRooms().walls.map((x) => (x.id === 'mid' ? { ...x, a: { x: 400, y: 15 } } : x)) }
      // пока перегородка не дошла — комната одна, во всю квартиру
      expect(roomsOf(p0)).toEqual([[800, 400]])
      expect(findGaps(p0.walls).map((g) => Math.round(g.gap))).toEqual([15])
      const { plan, closed } = closeGaps(p0)
      expect(closed).toBe(1)
      expect(roomsOf(plan)).toEqual([
        [400, 400],
        [400, 400],
      ])
    })

    it('угол, где не дошли обе стены, — сводятся обе в точку угла', () => {
      const p0: Plan = { ...emptyPlan(), walls: [w('t', 12, 0, 400, 0), w('r', 400, 0, 400, 300), w('b', 400, 300, 0, 300), w('l', 0, 300, 0, 10)] }
      expect(roomsOf(p0)).toEqual([])
      const { plan } = closeGaps(p0)
      expect(roomsOf(plan)).toEqual([[400, 300]])
    })

    it('разрыв больше 30 см и зафиксированная стена — не трогаются', () => {
      const far: Plan = { ...twoRooms(), walls: twoRooms().walls.map((x) => (x.id === 'mid' ? { ...x, a: { x: 400, y: 60 } } : x)) }
      expect(closeGaps(far).closed).toBe(0)
      const near: Plan = { ...twoRooms(), walls: twoRooms().walls.map((x) => (x.id === 'mid' ? { ...x, a: { x: 400, y: 15 }, locked: true } : x)) }
      expect(closeGaps(near).closed).toBe(0)
    })
  })
})
