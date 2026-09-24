import { describe, expect, it } from 'vitest'
import { rectifyWalls } from '../src/planner/rectify'
import { applyH, perspectiveQuad, rectTarget } from '../src/planner/raster'
import type { Pt, Wall } from '../src/planner/types'

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
