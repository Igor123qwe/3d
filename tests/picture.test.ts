import { describe, expect, it } from 'vitest'
import type { Plan, Pt, Underlay, Wall } from '../src/planner/types'
import { cutBumps, detectOpenings, fillDents, growRegions, pointOnOutline, simplifyOrthogonal, traceOutline, wallsFromPicture } from '../src/planner/picture'
import { buildRooms } from '../src/planner/rooms'
import { polyArea } from '../src/planner/geometry'

/** маска из прямоугольников: 1 — область */
function mask(w: number, h: number, rects: [number, number, number, number][]): Int32Array {
  const m = new Int32Array(w * h)
  for (const [x1, y1, x2, y2] of rects) for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) m[y * w + x] = 1
  return m
}

const firstOf = (m: Int32Array, k = 1) => m.findIndex((v) => v === k)

describe('обводка области по пикселям', () => {
  it('Г-образная область — шесть углов, площадь ровно по пикселям', () => {
    const w = 40
    const h = 30
    const m = mask(w, h, [
      [5, 5, 30, 15],
      [5, 15, 15, 25],
    ])
    const poly = traceOutline(m, w, h, 1, firstOf(m))
    expect(poly).toHaveLength(6)
    expect(polyArea(poly)).toBe(25 * 10 + 10 * 10)
  })

  it('обрывок, соединённый только по диагонали, в контур не входит', () => {
    const w = 20
    const h = 20
    const m = mask(w, h, [
      [2, 2, 8, 8],
      [8, 8, 10, 10],
    ])
    const poly = traceOutline(m, w, h, 1, firstOf(m))
    expect(polyArea(poly)).toBe(36)
  })
})

describe('дорастание до стен', () => {
  it('две области растут разом и встречаются в проёме посередине', () => {
    const w = 60
    const h = 20
    // стена по x = 29..30 с проёмом по y 6..13; области — ядра комнат слева и справа
    const d2 = new Float32Array(w * h).fill(100)
    for (let y = 0; y < h; y++) if (y < 6 || y > 13) for (const x of [29, 30]) d2[y * w + x] = 0
    const labels = new Int32Array(w * h)
    for (let y = 2; y < 18; y++) {
      for (let x = 2; x < 20; x++) labels[y * w + x] = 7
      for (let x = 40; x < 58; x++) labels[y * w + x] = 9
    }
    const owner = growRegions(labels, [7, 9], d2, w, h, 12)
    // стену никто не забрал, в проёме — граница посередине
    expect(owner[3 * w + 29]).toBe(0)
    expect(owner[10 * w + 29]).toBe(1)
    expect(owner[10 * w + 30]).toBe(2)
  })
})

describe('прямые углы без мелочи', () => {
  const rect = (x1: number, y1: number, x2: number, y2: number): Pt[] => [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ]

  it('дрожание линии в пиксель сглаживается, уступ крупнее порога остаётся', () => {
    // верх с зубцами в 1 px, справа уступ в 10 px
    const noisy: Pt[] = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 1 },
      { x: 60, y: 1 },
      { x: 60, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 90, y: 50 },
      { x: 90, y: 80 },
      { x: 0, y: 80 },
    ]
    const s = simplifyOrthogonal(noisy, 5)
    expect(s).toHaveLength(6)
    expect(s.every((p) => p.y !== 1)).toBe(true)
  })

  it('язычок в проёме срезается, вырез внутрь и уступ на углу остаются', () => {
    // язычок наружу глубиной 6 на правой грани
    const tongue: Pt[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 30 },
      { x: 106, y: 30 },
      { x: 106, y: 50 },
      { x: 100, y: 50 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ]
    expect(cutBumps(tongue, 10, 3)).toEqual(rect(0, 0, 100, 80))
    // тот же выступ внутрь — колонна у стены: остаётся
    const column: Pt[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 30 },
      { x: 94, y: 30 },
      { x: 94, y: 50 },
      { x: 100, y: 50 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ]
    expect(cutBumps(column, 10, 3)).toHaveLength(8)
    // уступ у угла комнаты (нижняя часть шире) — не язычок: на ту же линию он не возвращается
    const step: Pt[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 108, y: 50 },
      { x: 108, y: 80 },
      { x: 0, y: 80 },
    ]
    expect(cutBumps(step, 10, 3)).toHaveLength(6)
  })

  it('вырез без стены (цифра у стены) закрывается, колонна и чужая комната остаются', () => {
    const dent: Pt[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 30 },
      { x: 88, y: 30 },
      { x: 88, y: 40 },
      { x: 100, y: 40 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ]
    // в вырезе одна цифра, а стена — только за устьем, x ≥ 100
    expect(fillDents(dent, 20, (x) => x >= 100)).toEqual(rect(0, 0, 100, 80))
    // короб колонны нарисован линией: вырез остаётся
    expect(fillDents(dent, 20, (x) => x >= 100 || x === 88)).toHaveLength(8)
    // глубже радиуса — не зазубрина
    expect(fillDents(dent, 10, (x) => x >= 100)).toHaveLength(8)
  })

  it('ступенька в углу от цифр на стене («0,68» в нише) выравнивается, уступ со стеной остаётся', () => {
    // правый нижний угол: цифры не пустили область, низ справа на 7 выше
    const step: Pt[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 73 },
      { x: 70, y: 73 },
      { x: 70, y: 80 },
      { x: 0, y: 80 },
    ]
    expect(fillDents(step, 20, (x, y) => y >= 80 || x >= 100)).toEqual(rect(0, 0, 100, 80))
    // подступенок нарисован стеной — уступ настоящий
    expect(fillDents(step, 20, (x, y) => y >= 80 || x >= 100 || (y >= 73 && x <= 70))).toHaveLength(6)
  })
})

describe('стены из граней комнат', () => {
  const u: Underlay = { src: '', px: { w: 400, h: 300 }, x: 0, y: 0, scale: 2, opacity: 0.6, visible: true, locked: false }
  const box = (x1: number, y1: number, x2: number, y2: number): Pt[] => [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ]
  const plan = (walls: Wall[]): Plan => ({ version: 1, name: '', walls, openings: [], furniture: [], rooms: [], dims: [], settings: { grid: 10 } })

  it('две комнаты через полосу чернил: одна перегородка ровно этой толщины посередине, комнаты по граням', () => {
    // грани 100 и 108 px: перегородка 8 px = 16 см, ось на 104 px = 208 см
    const res = wallsFromPicture(
      [
        { name: 'A', poly: box(20, 20, 100, 120), wantM2: 3.2 },
        { name: 'B', poly: box(108, 20, 200, 120) },
      ],
      u,
      null,
      { interiorCm: 10, exteriorCm: 40 },
    )
    const shared = res.walls.filter((w) => w.a.x === w.b.x && Math.abs(w.a.x - 208) < 0.01)
    expect(shared).toHaveLength(1)
    expect(shared[0].thickness).toBe(16)
    const { rooms } = buildRooms(plan(res.walls))
    expect(rooms).toHaveLength(2)
    const a = rooms.find((r) => r.inner.every((p) => p.x <= 201))!
    // внутренняя площадь — ровно контур с картинки: 80 × 100 px по 2 см
    expect(a.area).toBeCloseTo(3.2, 2)
    expect(res.areaFit!.accuracy).toBeGreaterThan(0.99)
  })

  it('Г-образная комната и сосед в её вырезе: обе замкнуты, лишней клетки нет', () => {
    const L: Pt[] = [
      { x: 20, y: 20 },
      { x: 200, y: 20 },
      { x: 200, y: 80 },
      { x: 120, y: 80 },
      { x: 120, y: 160 },
      { x: 20, y: 160 },
    ]
    const res = wallsFromPicture(
      [
        { name: 'Г', poly: L },
        { name: 'угол', poly: box(128, 88, 200, 160) },
      ],
      u,
      null,
      { interiorCm: 10, exteriorCm: 40 },
    )
    const { rooms } = buildRooms(plan(res.walls))
    expect(rooms).toHaveLength(2)
    const areas = rooms.map((r) => +r.area.toFixed(2)).sort((a, b) => a - b)
    // угол 72 × 72 px, Г: 180 × 60 + 100 × 80 px — по 4 см² в пикселе
    expect(areas).toEqual([((72 * 72) * 4) / 1e4, ((180 * 60 + 100 * 80) * 4) / 1e4].map((v) => +v.toFixed(2)))
    expect(res.rooms.every((r) => r.haveM2 !== undefined)).toBe(true)
  })

  it('короткий кусок грани мимо торца поперечной стены — продолжение перегородки, а не наружная стена с уступом', () => {
    // A выше B и C; грань A снизу длиннее, чем B и C вместе, на толщину стены между ними
    const res = wallsFromPicture(
      [
        { name: 'A', poly: box(20, 20, 200, 80) },
        { name: 'B', poly: box(20, 88, 104, 160) },
        { name: 'C', poly: box(110, 88, 200, 160) },
      ],
      u,
      null,
      { interiorCm: 10, exteriorCm: 40 },
    )
    // горизонтальная перегородка A|B,C — на одной оси по всей длине
    const ys = new Set(res.walls.filter((w) => w.a.y === w.b.y && w.a.y > 100 && w.a.y < 200).map((w) => w.a.y))
    expect([...ys]).toEqual([168])
    expect(buildRooms(plan(res.walls)).rooms).toHaveLength(3)
  })
})

describe('точка на стороне Г-образной комнаты', () => {
  const L: Pt[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 60 },
    { x: 70, y: 60 },
    { x: 70, y: 100 },
    { x: 0, y: 100 },
  ]
  it('«справа, внизу» — в стене выреза, а не в пустоте рамки', () => {
    expect(pointOnOutline(L, 'right', 0.85)).toEqual({ x: 70, y: 85 })
    expect(pointOnOutline(L, 'right', 0.3)).toEqual({ x: 100, y: 30 })
    expect(pointOnOutline(L, 'bottom', 0.9)).toEqual({ x: 90, y: 60 })
    expect(pointOnOutline(L, 'left', 0.5)).toEqual({ x: 0, y: 50 })
  })
})

describe('двери и окна по картинке', () => {
  // лист 300 × 200 px, 1 px = 2 см; две комнаты слева и справа от стены x 148..160,
  // стена нарисована двумя линиями по 2 px с пустотой между ними
  const W = 300
  const H = 200
  const sheet = () => {
    const ink = new Uint8Array(W * H)
    const put = (x1: number, y1: number, x2: number, y2: number) => {
      for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) ink[y * W + x] = 1
    }
    return { ink, put }
  }
  const d2Of = (ink: Uint8Array) => Float32Array.from(ink, (v) => (v ? 0 : 100))
  const rect = (x1: number, y1: number, x2: number, y2: number): Pt[] => [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ]
  const rooms = [rect(40, 20, 148, 180), rect(160, 20, 260, 180)]

  it('дверь — участок стены между поперечными чертами; стена без черт — без двери', () => {
    const { ink, put } = sheet()
    put(148, 20, 149, 180)
    put(158, 20, 159, 180)
    // черты поперёк стены на y 80 и 125: дверь 45 px = 90 см
    put(148, 80, 159, 80)
    put(148, 125, 159, 125)
    const found = detectOpenings(rooms, d2Of(ink), W, H, 2)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ kind: 'door', rooms: [0, 1], vertical: true })
    expect(Math.abs(found[0].from - 80) + Math.abs(found[0].to - 126)).toBeLessThan(4)
  })

  it('дверь — разрыв в стене', () => {
    const { ink, put } = sheet()
    put(148, 20, 159, 90)
    put(148, 135, 159, 180)
    const found = detectOpenings(rooms, d2Of(ink), W, H, 2)
    expect(found.map((o) => [o.kind, o.from, o.to])).toEqual([['door', 91, 135]])
  })

  it('окно — линии стекла в наружной стене, закрытые чертами; штриховка квадратиками — не окно', () => {
    const { ink, put } = sheet()
    // наружная стена слева от левой комнаты: линии x 38..39 и 18..19, пустота между
    put(38, 20, 39, 180)
    put(18, 20, 19, 180)
    // окно y 60..130: две линии стекла и черты через всю толщину
    put(25, 60, 26, 130)
    put(31, 60, 32, 130)
    put(18, 60, 39, 60)
    put(18, 130, 39, 130)
    // правая наружная стена в штриховке: квадратики 4 × 4 через 8 px
    put(260, 20, 261, 180)
    put(282, 20, 283, 180)
    for (let y = 22; y < 178; y += 8) put(268, y, 272, y + 4)
    const found = detectOpenings(rooms, d2Of(ink), W, H, 2).filter((o) => o.kind === 'window')
    expect(found).toHaveLength(1)
    expect(found[0].rooms).toEqual([0])
    expect(Math.abs(found[0].from - 60) + Math.abs(found[0].to - 131)).toBeLessThan(4)
  })
})
