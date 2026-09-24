import { describe, expect, it } from 'vitest'
import { evenWalls, rectifyWalls } from '../src/planner/rectify'
import { buildRooms } from '../src/planner/rooms'
import { applyH, perspectiveQuad, rectTarget } from '../src/planner/raster'
import type { Plan, Pt, Wall } from '../src/planner/types'

const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 10 })

describe('выпрямление готового чертежа', () => {
  it('верхняя стена, что каждая комната видела на своей высоте, становится одной прямой', () => {
    // три комнаты: верх на 0, 3 и 6 см — ступеньками, как на снимке под углом
    const walls = [
      wall('t1', 0, 0, 300, 0),
      wall('t2', 300, 3, 500, 3),
      wall('t3', 500, 6, 800, 6),
      wall('v1', 0, 0, 0, 400),
      wall('v2', 300, 0, 300, 400),
      wall('v3', 500, 3, 500, 400),
      wall('v4', 800, 6, 800, 400),
      wall('b', 0, 400, 800, 400),
    ]
    const out = rectifyWalls(walls, (p) => p)
    const ys = out.filter((w) => w.id.startsWith('t')).flatMap((w) => [w.a.y, w.b.y])
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.01)
    // вертикальные стены по-прежнему упираются в верхнюю
    for (const id of ['v1', 'v2', 'v3', 'v4']) expect(out.find((w) => w.id === id)!.a.y).toBeCloseTo(ys[0], 5)
  })

  it('прямые дальше допуска не сливаются: ступенька стены в 13 см остаётся', () => {
    const walls = [wall('a', 0, 0, 300, 0), wall('b', 300, 13, 600, 13), wall('j', 300, 0, 300, 13)]
    const out = rectifyWalls(walls, (p) => p)
    expect(out.find((w) => w.id === 'b')!.a.y - out.find((w) => w.id === 'a')!.a.y).toBeCloseTo(13, 5)
  })

  // рамка со стенами, снятая с перспективой: правый край ближе к камере
  function photo(k: number) {
    const W = 400
    const H = 400
    // из картинки в план: x' = x / (1 − kx), y' = (y − 200) / (1 − kx) + 200
    const toPlan = (p: Pt): Pt => {
      const z = 1 - k * p.x
      return { x: p.x / z, y: (p.y - 200) / z + 200 }
    }
    const lines = [50, 200, 350]
    const ink = new Uint8Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const q = toPlan({ x, y })
        const inside = q.x > 45 && q.x < 355 && q.y > 45 && q.y < 355
        if (inside && lines.some((v) => Math.abs(q.x - v) < 2 || Math.abs(q.y - v) < 2)) ink[y * W + x] = 1
      }
    return { ink, w: W, h: H }
  }

  it('снимок под углом: точки схода стен находятся, после выпрямления стены идут по осям', () => {
    const bin = photo(0.0006)
    const quad = perspectiveQuad(bin, 10)
    expect(quad).not.toBeNull()
    const { forward } = rectTarget(quad!)
    // средняя вертикальная стена на снимке наклонена; после выпрямления — отвесна
    const top = applyH(forward, { x: 200 * (1 - 0.0006 * 200), y: 200 + (60 - 200) * (1 - 0.0006 * 200) })
    const bottom = applyH(forward, { x: 200 * (1 - 0.0006 * 200), y: 200 + (340 - 200) * (1 - 0.0006 * 200) })
    expect(Math.abs(top.x - bottom.x)).toBeLessThan(1.5)
  })

  it('ровный снимок не трогается', () => {
    expect(perspectiveQuad(photo(0), 10)).toBeNull()
  })
})

describe('наружная стена — одна прямая', () => {
  const w = (id: string, ax: number, ay: number, bx: number, by: number, thickness = 40): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness })
  const asPlan = (walls: Wall[]): Plan => ({ version: 1, name: '', walls, openings: [], furniture: [], rooms: [], dims: [], settings: { grid: 10 } })
  // две комнаты рядом; верхняя наружная стена над правой съехала на 10 см
  const slid = [
    w('tl', 0, 0, 400, 0),
    w('tr', 400, 10, 800, 10),
    w('l', 0, 0, 0, 400),
    w('r', 800, 10, 800, 400),
    w('m', 400, 0, 400, 400, 12),
    w('b', 0, 400, 800, 400),
  ]

  it('кусок той же толщины, съехавший на 10 см, встаёт в линию; концы соседних стен — за ним', () => {
    const out = evenWalls(slid)
    const at = (id: string) => out.find((x) => x.id === id)!
    expect(at('tr').a.y).toBeCloseTo(at('tl').a.y, 6)
    expect(at('tr').b.y).toBeCloseTo(at('tl').a.y, 6)
    expect(at('tr').thickness).toBeCloseTo(40, 6)
    // правая стена по-прежнему упирается в верхнюю
    expect(Math.min(at('r').a.y, at('r').b.y)).toBeCloseTo(at('tr').a.y, 6)
    expect(buildRooms(asPlan(out)).rooms).toHaveLength(2)
  })

  it('настоящий выступ меняет толщину, а не сдвигает стену, — он остаётся', () => {
    // над правой комнатой стена толще на 13 см внутрь (выступ 0,13): наружная грань та же
    const bump = slid.map((x) => (x.id === 'tr' ? { ...x, a: { x: 400, y: 6.5 }, b: { x: 800, y: 6.5 }, thickness: 53 } : x.id === 'r' ? { ...x, a: { x: 800, y: 6.5 } } : x))
    const out = evenWalls(bump)
    expect(out.find((x) => x.id === 'tr')).toEqual(bump.find((x) => x.id === 'tr'))
  })

  it('одиночная перегородка не трогается', () => {
    const out = evenWalls(slid)
    expect(out.find((x) => x.id === 'm')!.thickness).toBe(12)
    expect(out.find((x) => x.id === 'm')!.a.x).toBe(400)
  })

  it('перегородка из кусков 11 и 13 см — одна стена: грань коридора под ней одна, а не 67 + 205', () => {
    // сверху две комнаты, снизу коридор во всю ширину; стена между ними — два куска
    const walls = [
      w('T', 0, 0, 800, 0),
      w('B', 0, 600, 800, 600),
      w('L', 0, 0, 0, 600),
      w('R', 800, 0, 800, 600),
      w('m', 400, 0, 400, 300, 12),
      w('p1', 0, 300, 400, 300, 11),
      w('p2', 400, 300, 800, 300, 13),
    ]
    const out = evenWalls(walls)
    const p1 = out.find((x) => x.id === 'p1')!
    const p2 = out.find((x) => x.id === 'p2')!
    expect(p1.a.y).toBeCloseTo(p2.a.y, 6)
    expect(p1.thickness).toBeCloseTo(p2.thickness, 6)
    const rooms = buildRooms(asPlan(out)).rooms
    expect(rooms).toHaveLength(3)
    const corridor = rooms.find((r) => r.inner.every((q) => q.y > 290))!
    expect(corridor.inner).toHaveLength(4)
    // а куски, что расходятся гранями сильнее 3 см, — разные стены
    const apart = evenWalls(walls.map((x) => (x.id === 'p2' ? { ...x, thickness: 21 } : x)))
    expect(apart.find((x) => x.id === 'p2')!.thickness).toBe(21)
  })
})
