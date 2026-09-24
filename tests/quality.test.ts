import { describe, expect, it } from 'vitest'
import type { AiPlan } from '../src/planner/aicontract'
import type { Underlay, Wall } from '../src/planner/types'
import { uid } from '../src/planner/types'
import { binarize, distanceToInk, type RoomRegion } from '../src/planner/raster'
import { assessQuality, measureDim, shapeIou, wallsOnInk } from '../src/planner/quality'

// картинка 400 × 300 px, 1 px = 1 см, подложка в начале координат
const px = { w: 400, h: 300 }
const u: Underlay = { src: '', px, x: 0, y: 0, scale: 1, opacity: 0.6, visible: true, locked: false }
const wall = (x1: number, y1: number, x2: number, y2: number, thickness = 10): Wall => ({ id: uid('w'), a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, thickness })

/** лист с одной комнатой 100..300 × 60..240, стены 6 px */
function sheet() {
  const g = new Uint8Array(px.w * px.h).fill(255)
  const ink = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y * px.w + x] = 0
  }
  ink(97, 57, 303, 63)
  ink(97, 237, 303, 243)
  ink(97, 57, 103, 243)
  ink(297, 57, 303, 243)
  const d2 = distanceToInk(binarize(g, px.w, px.h))
  return { d2, w: px.w, h: px.h }
}

describe('стены на линиях картинки', () => {
  it('стены по линиям — на месте; стена в стороне — мимо, с отклонением в сантиметрах', () => {
    const raster = sheet()
    const good = [wall(100, 60, 300, 60), wall(100, 240, 300, 240), wall(100, 60, 100, 240), wall(300, 60, 300, 240)]
    const q = wallsOnInk(good, u, raster)
    expect(q.onInk).toBeGreaterThan(0.95)
    expect(q.off).toHaveLength(0)
    const bad = wallsOnInk([...good, wall(100, 150, 300, 150)], u, raster)
    expect(bad.off).toHaveLength(1)
    expect(bad.off[0].devCm).toBeGreaterThan(60)
    expect(bad.onInk).toBeLessThan(0.85)
  })

  it('стена за краем картинки — мимо', () => {
    const q = wallsOnInk([wall(500, 60, 700, 60)], u, sheet())
    expect(q.onInk).toBe(0)
    expect(q.off).toHaveLength(1)
  })
})

describe('форма комнаты против области', () => {
  const region = (x1: number, y1: number, x2: number, y2: number, extra: Partial<RoomRegion> = {}): RoomRegion => ({ x1, y1, x2, y2, areaPx: (x2 - x1) * (y2 - y1), points: (x2 - x1) * (y2 - y1), fill: 1, fillBox: 1, edges: 0, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, ...extra })

  it('прямоугольник по области — почти единица; прямоугольник вместо Г-образной комнаты — меньше', () => {
    const r = region(100, 60, 300, 240)
    const rect = [{ x: 100, y: 60 }, { x: 300, y: 60 }, { x: 300, y: 240 }, { x: 100, y: 240 }]
    expect(shapeIou(rect, r, u)).toBeGreaterThan(0.95)
    // контур с картинки Г-образный: угол 200..300 × 150..240 — соседа
    const lShape = [{ x: 100, y: 60 }, { x: 300, y: 60 }, { x: 300, y: 150 }, { x: 200, y: 150 }, { x: 200, y: 240 }, { x: 100, y: 240 }]
    const L = region(100, 60, 300, 240, { poly: lShape })
    expect(shapeIou(lShape, L, u)).toBeGreaterThan(0.95)
    expect(shapeIou(rect, L, u)).toBeLessThan(0.8)
  })
})

describe('размерные цепочки против стен', () => {
  const walls = [wall(100, 60, 300, 60), wall(100, 240, 300, 240), wall(100, 60, 100, 240), wall(300, 60, 300, 240)]
  it('горизонтальная цепочка меряется между вертикальными стенами у её концов', () => {
    expect(measureDim({ a: { x: 105, y: 30 }, b: { x: 295, y: 30 }, cm: 200 }, walls)).toBe(200)
    expect(measureDim({ a: { x: 100, y: 70 }, b: { x: 100, y: 230 }, cm: 180 }, walls)).toBe(180)
  })
  it('цепочка без стен на концах — не меряется', () => {
    expect(measureDim({ a: { x: 500, y: 30 }, b: { x: 700, y: 30 }, cm: 200 }, walls)).toBeNull()
  })
})

describe('общая оценка', () => {
  const walls = [wall(100, 60, 300, 60), wall(100, 240, 300, 240), wall(100, 60, 100, 240), wall(300, 60, 300, 240)]
  const ai: AiPlan = { walls: [], openings: [], dimensions: [{ x1: 0.25, y1: 0.1, x2: 0.75, y2: 0.1, cm: 200 }], rooms: [{ name: 'Кухня', areaM2: 3.6, x: 0.5, y: 0.5 }] }
  const metas = [{ id: 'rm1', anchor: { x: 200, y: 150 }, name: 'Кухня', floor: 'tile' as const }]

  it('всё на месте — ok, и видно, что проверено', () => {
    const q = assessQuality({ ai, u, walls, openings: [], metas, raster: sheet(), dims: [{ a: { x: 100, y: 30 }, b: { x: 300, y: 30 }, cm: 200 }], areas: { accuracy: 0.99, off: [], samples: 1 }, lost: new Map(), doubtful: [] })
    expect(q.verdict).toBe('ok')
    expect(q.completeness).toEqual({ expected: 1, found: 1, missing: [] })
    expect(q.walls?.onInk).toBeGreaterThan(0.95)
    expect(q.dims).toEqual([{ cm: 200, gotCm: 200 }])
    expect(q.issues).toEqual([])
  })

  it('потерянная комната — weak, даже если площади остальных сошлись на 100 %', () => {
    const two: AiPlan = { ...ai, rooms: [...ai.rooms, { name: 'Санузел', areaM2: 3, x: 0.9, y: 0.9 }] }
    const lost = new Map([['Санузел', 'на картинке не нашлось такой области']])
    const q = assessQuality({ ai: two, u, walls, openings: [], metas, raster: sheet(), dims: [], areas: { accuracy: 1, off: [], samples: 1 }, lost, doubtful: [] })
    expect(q.verdict).toBe('weak')
    expect(q.completeness.missing).toEqual([{ name: 'Санузел', why: 'на картинке не нашлось такой области' }])
    expect(q.issues[0]).toContain('Санузел')
  })

  it('размер разошёлся или проём не встал — check, не ok', () => {
    const q = assessQuality({ ai: { ...ai, openings: [{ kind: 'door', x: 0.5, y: 0.2, widthCm: 80 }] }, u, walls, openings: [], metas, raster: sheet(), dims: [{ a: { x: 100, y: 30 }, b: { x: 300, y: 30 }, cm: 230 }], areas: null, lost: new Map(), doubtful: [] })
    expect(q.verdict).toBe('check')
    expect(q.issues.some((i) => i.startsWith('размеры расходятся'))).toBe(true)
    expect(q.issues.some((i) => i.startsWith('проёмов встало 0 из 1'))).toBe(true)
  })

  it('щель между разошедшимися осями видна как замечание, а не как комната', () => {
    // между стенами на y=150 и y=170 замкнулась полоска 200 × 20 см: это не помещение
    const gap = [
      wall(100, 60, 300, 60),
      wall(100, 150, 300, 150),
      wall(100, 170, 300, 170),
      wall(100, 240, 300, 240),
      wall(100, 60, 100, 240),
      wall(300, 60, 300, 240),
    ]
    const q = assessQuality({ ai, u, walls: gap, openings: [], metas, raster: null, dims: [], areas: null, lost: new Map(), doubtful: [] })
    expect(q.slivers.length).toBeGreaterThan(0)
    expect(q.slivers[0].areaM2).toBeLessThan(1)
    expect(q.verdict).toBe('check')
    expect(q.issues.some((i) => i.startsWith('щели между стенами'))).toBe(true)
  })

  it('сомнительная комната попадает в замечания', () => {
    const q = assessQuality({ ai, u, walls, openings: [], metas, raster: null, dims: [], areas: { accuracy: 0.9, off: [], samples: 2 }, lost: new Map(), doubtful: ['Санузел'] })
    expect(q.verdict).toBe('check')
    expect(q.issues.some((i) => i.startsWith('сомнительно: Санузел'))).toBe(true)
  })
})
