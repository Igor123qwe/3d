import { describe, expect, it } from 'vitest'
import { snapWallPoint } from '../src/planner/snapping'
import { addRect, scalePlan } from '../src/planner/ops'
import { buildRooms } from '../src/planner/rooms'
import { emptyPlan } from '../src/planner/types'

describe('магнит к линиям картинки', () => {
  const lines = [
    { a: { x: 100, y: 100 }, b: { x: 500, y: 100 } },
    { a: { x: 500, y: 100 }, b: { x: 500, y: 400 } },
  ]

  it('курсор липнет к концу линии на картинке, если рядом нет настоящих стен', () => {
    const s = snapWallPoint({ x: 104, y: 97 }, [], { grid: 10, tol: 12, ortho: false, lines })
    expect(s.p).toEqual({ x: 100, y: 100 })
    expect(s.kind).toBe('endpoint')
  })

  it('и к самой линии — точка проецируется на неё', () => {
    const s = snapWallPoint({ x: 300, y: 106 }, [], { grid: 10, tol: 12, ortho: false, lines })
    expect(s.p.y).toBe(100)
    expect(s.kind).toBe('wall')
  })

  it('настоящая стена важнее линии на картинке', () => {
    const walls = [{ id: 'w', a: { x: 100, y: 108 }, b: { x: 500, y: 108 }, thickness: 10 }]
    const s = snapWallPoint({ x: 300, y: 105 }, walls, { grid: 10, tol: 12, ortho: false, lines })
    expect(s.p.y).toBe(108)
  })

  it('без линий поведение прежнее: сетка', () => {
    const s = snapWallPoint({ x: 303, y: 106 }, [], { grid: 10, tol: 12, ortho: false })
    expect(s.p).toEqual({ x: 300, y: 110 })
    expect(s.kind).toBe('grid')
  })
})

describe('масштабирование чертежа', () => {
  it('стены, мебель, размеры и подложка масштабируются вокруг точки; размеры мебели — нет', () => {
    const plan = {
      ...emptyPlan(),
      walls: [{ id: 'w', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, thickness: 10 }],
      furniture: [{ id: 'f', type: 'sofa-3', x: 50, y: 50, w: 200, d: 90, rot: 0 }],
      dims: [{ id: 'd', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, offset: 30 }],
      rooms: [{ id: 'r', anchor: { x: 50, y: 50 }, name: 'К', floor: 'tile' as const }],
      underlay: { src: '', px: { w: 100, h: 100 }, x: -10, y: -10, scale: 2, opacity: 0.5, visible: true, locked: false },
    }
    const out = scalePlan(plan, 2, { x: 0, y: 0 })
    expect(out.walls[0].b).toEqual({ x: 200, y: 0 })
    expect(out.walls[0].thickness).toBe(10)
    expect(out.furniture[0]).toMatchObject({ x: 100, y: 100, w: 200, d: 90 })
    expect(out.dims[0].b).toEqual({ x: 200, y: 0 })
    expect(out.rooms[0].anchor).toEqual({ x: 100, y: 100 })
    expect(out.underlay).toMatchObject({ x: -20, y: -20, scale: 4 })
  })

  it('коэффициент 1 или мусор ничего не меняет', () => {
    const plan = emptyPlan()
    expect(scalePlan(plan, 1, { x: 0, y: 0 })).toBe(plan)
    expect(scalePlan(plan, NaN, { x: 0, y: 0 })).toBe(plan)
  })
})

describe('прямоугольник комнаты рядом с готовыми стенами', () => {
  const rect = (plan: ReturnType<typeof emptyPlan>, a: { x: number; y: number }, b: { x: number; y: number }) => addRect(plan, a, b, 10)

  it('две комнаты с общей стеной: общая стена одна', () => {
    const p = rect(rect(emptyPlan(), { x: 0, y: 0 }, { x: 400, y: 300 }), { x: 400, y: 0 }, { x: 700, y: 300 })
    expect(p.walls).toHaveLength(7)
  })

  it('частичное наложение (Т-стык): добавляется только непокрытый остаток', () => {
    const p = rect(rect(emptyPlan(), { x: 0, y: 0 }, { x: 372, y: 408 }), { x: 0, y: 408 }, { x: 401, y: 834 })
    // нижняя стена первой комнаты покрывает верх второй до 372; остаток 372..401 — отдельная стена
    const top = p.walls.filter((w) => w.a.y === 408 && w.b.y === 408)
    expect(top.map((w) => [Math.min(w.a.x, w.b.x), Math.max(w.a.x, w.b.x)]).sort((u, v) => u[0] - v[0])).toEqual([
      [0, 372],
      [372, 401],
    ])
    // левая стена не задвоилась
    const left = p.walls.filter((w) => w.a.x === 0 && w.b.x === 0)
    expect(left).toHaveLength(2)
    const { rooms } = buildRooms(p)
    expect(rooms).toHaveLength(2)
  })

  it('комната внутри уже нарисованной стены — ничего лишнего', () => {
    const p = rect(rect(emptyPlan(), { x: 0, y: 0 }, { x: 400, y: 300 }), { x: 0, y: 0 }, { x: 400, y: 300 })
    expect(p.walls).toHaveLength(4)
  })
})
