import { describe, expect, it } from 'vitest'
import { addDimRef, dimSnap, followDims, roomDims, squareDim } from '../src/planner/dims'
import { deleteRun, normalizeWalls, pushRun, setRunLength } from '../src/planner/walledit'
import { buildRooms } from '../src/planner/rooms'
import { emptyPlan, type Plan, type Wall } from '../src/planner/types'

const w = (id: string, ax: number, ay: number, bx: number, by: number, thickness = 10): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness })
const twoRooms = (): Plan => ({
  ...emptyPlan(),
  walls: [w('top1', 0, 0, 400, 0), w('top2', 400, 0, 800, 0), w('bottom', 0, 400, 800, 400), w('left', 0, 0, 0, 400), w('right', 800, 0, 800, 400), w('mid', 400, 0, 400, 400)],
})
const len = (p: Plan, i = 0) => Math.hypot(p.dims[i].b.x - p.dims[i].a.x, p.dims[i].b.y - p.dims[i].a.y)

/** ширина левой комнаты в чистоте: от грани левой стены до грани перегородки */
const withWidth = (): Plan => {
  const p = twoRooms()
  const a = dimSnap(p.walls, { x: 6, y: 200 }, 3)!
  const b = dimSnap(p.walls, { x: 394, y: 203 }, 3)!
  return addDimRef(p, a.p, squareDim(p.walls, a.p, a.ref, b.p, b.ref), 0, a.ref, b.ref)
}

describe('размеры, привязанные к стенам', () => {
  it('щелчок у грани — точка на грани и привязка к ней; второй конец встаёт напротив первого', () => {
    const p = withWidth()
    const d = p.dims[0]
    expect(d.a).toEqual({ x: 5, y: 200 })
    expect(d.b).toEqual({ x: 395, y: 200 })
    expect(d.aRef?.wallId).toBe('left')
    expect(d.bRef?.wallId).toBe('mid')
    expect(len(p)).toBe(390)
  })

  it('у конца стены — привязка к концу', () => {
    const s = dimSnap(twoRooms().walls, { x: 797, y: 3 }, 8)!
    expect(s.ref.end).toBeDefined()
    expect(s.p).toEqual({ x: 800, y: 0 })
  })

  it('перегородку сдвинули на 30 — размер 420, стоит на той же высоте', () => {
    const p0 = withWidth()
    const p = followDims(p0, pushRun(p0, 'mid', -30))
    expect(len(p)).toBeCloseTo(420, 5)
    expect(p.dims[0].b.y).toBeCloseTo(200, 5)
  })

  it('стену растянули — размер вдоль неё до конца стены следует за концом', () => {
    const p0 = twoRooms()
    const a = dimSnap(p0.walls, { x: 1, y: 401 }, 5)!
    const b = dimSnap(p0.walls, { x: 1, y: 1 }, 5)!
    const p1 = addDimRef(p0, a.p, b.p, -40, a.ref, b.ref)
    expect(len(p1)).toBe(400)
    const p = followDims(p1, setRunLength(p1, 'left', 450))
    expect(len(p)).toBeCloseTo(450, 5)
  })

  it('куски склеились в одну стену — привязка переходит на склеенную', () => {
    const p0: Plan = { ...emptyPlan(), walls: [w('a', 0, 0, 300, 0), w('b', 300, 0, 500, 0), w('c', 0, 200, 500, 200)] }
    const s = dimSnap(p0.walls, { x: 450, y: 4 }, 3)!
    expect(s.ref.wallId).toBe('b')
    const t = dimSnap(p0.walls, { x: 450, y: 196 }, 3)!
    const p1 = addDimRef(p0, s.p, t.p, 0, s.ref, t.ref)
    const p = followDims(p1, normalizeWalls(p1))
    expect(p.walls).toHaveLength(2)
    const ref = p.dims[0].aRef!
    expect(p.walls.some((x) => x.id === ref.wallId)).toBe(true)
    // склеенную стену потом двигают на 20 к нижней — размер короче на 20
    const q = followDims(p, pushRun(p, ref.wallId, 20))
    const moved = q.walls.find((x) => x.id === ref.wallId)!
    expect(moved.a.y).toBe(20)
    expect(len(q)).toBeCloseTo(len(p) - 20, 5)
  })

  it('стену удалили — размер остаётся где был, без привязки', () => {
    const p0 = withWidth()
    const p = followDims(p0, deleteRun(p0, 'mid'))
    expect(p.dims[0].bRef).toBeUndefined()
    expect(len(p)).toBe(390)
  })

  it('правка без стен (мебель) размеры не трогает — тот же объект', () => {
    const p0 = withWidth()
    const next = { ...p0, furniture: [] }
    expect(followDims(p0, next)).toBe(next)
  })

  it('«Размеры комнаты»: ширина и глубина в чистоте, обе привязаны', () => {
    const p0 = twoRooms()
    const room = buildRooms(p0).rooms.find((r) => r.polygon.some((q) => q.x === 0))!
    const p = roomDims(p0, room.inner)
    expect(p.dims.map((_, i) => Math.round(len(p, i)))).toEqual([390, 390])
    expect(p.dims.every((d) => d.aRef && d.bRef)).toBe(true)
    const q = followDims(p, pushRun(p, 'mid', -25))
    expect(Math.round(len(q, 0))).toBe(415)
  })
})
