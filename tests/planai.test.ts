import { describe, expect, it } from 'vitest'
import type { AiPlan } from '../src/planner/aicontract'
import type { Underlay } from '../src/planner/types'
import {
  applyAiPlan,
  axisAlign,
  convertAiPlan,
  dedupeWalls,
  floorFor,
  robustMedian,
  roundThickness,
  scaleFromDimensions,
  weldEnds,
} from '../src/planner/planai'

const px = { w: 1000, h: 800 }
const underlay = (scale: number): Underlay => ({ src: '', px, x: 0, y: 0, scale, opacity: 0.6, visible: true, locked: false })

/** прямоугольная квартира 8 × 6 м на картинке 1000 × 800 px: 1 px = 1 см */
function boxPlan(extra: Partial<AiPlan> = {}): AiPlan {
  const walls = [
    { x1: 0.1, y1: 0.125, x2: 0.9, y2: 0.125, thicknessCm: 25 },
    { x1: 0.9, y1: 0.125, x2: 0.9, y2: 0.875, thicknessCm: 25 },
    { x1: 0.9, y1: 0.875, x2: 0.1, y2: 0.875, thicknessCm: 25 },
    { x1: 0.1, y1: 0.875, x2: 0.1, y2: 0.125, thicknessCm: 25 },
  ]
  return { walls, openings: [], rooms: [], dimensions: [], ...extra }
}

describe('масштаб по подписям плана', () => {
  it('медиана отбрасывает выброс', () => {
    expect(robustMedian([1, 1.02, 0.98, 1.01, 40])).toBeCloseTo(1.01, 2)
  })

  it('размерная цепочка задаёт сантиметры в пикселе', () => {
    // отрезок в 800 px подписан как 800 см -> 1 см в пикселе
    const dims = [
      { x1: 0.1, y1: 0.05, x2: 0.9, y2: 0.05, cm: 800 },
      { x1: 0.1, y1: 0.95, x2: 0.9, y2: 0.95, cm: 800 },
    ]
    const fit = scaleFromDimensions(dims, px)
    expect(fit?.cmPerPx).toBeCloseTo(1, 4)
    expect(fit?.source).toBe('размерные цепочки')
    expect(fit?.samples).toBe(2)
  })

  it('одна цепочка — мало, чтобы доверять', () => {
    expect(scaleFromDimensions([{ x1: 0.1, y1: 0.05, x2: 0.9, y2: 0.05, cm: 800 }], px)).toBeNull()
  })

  it('короткие выноски не портят масштаб', () => {
    const dims = [
      { x1: 0.1, y1: 0.05, x2: 0.9, y2: 0.05, cm: 800 },
      { x1: 0.5, y1: 0.5, x2: 0.505, y2: 0.5, cm: 300 },
      { x1: 0.1, y1: 0.95, x2: 0.9, y2: 0.95, cm: 800 },
    ]
    expect(scaleFromDimensions(dims, px)?.cmPerPx).toBeCloseTo(1, 4)
  })

  it('масштаб берётся из размеров, а не из прежней калибровки', () => {
    const ai = boxPlan({
      dimensions: [
        { x1: 0.1, y1: 0.05, x2: 0.9, y2: 0.05, cm: 800 },
        { x1: 0.05, y1: 0.125, x2: 0.05, y2: 0.875, cm: 600 },
      ],
    })
    const r = convertAiPlan(ai, underlay(5))
    expect(r.report.scale.source).toBe('размерные цепочки')
    expect(r.underlay.scale).toBeCloseTo(1, 2)
    // верхняя стена стала 8 метров
    const top = r.walls.find((w) => Math.abs(w.a.y - w.b.y) < 1)
    expect(Math.abs((top as { a: { x: number } }).a.x - (top as { b: { x: number } }).b.x)).toBeCloseTo(800, 0)
  })

  it('без размеров масштаб подбирается по подписанной площади', () => {
    // комната по осям 800 × 600 см, при масштабе 1 площадь по внутренним граням ~45,6 м²
    const ai = boxPlan({ rooms: [{ name: 'Студия', areaM2: 45.6, x: 0.5, y: 0.5 }] })
    const r = convertAiPlan(ai, underlay(1))
    expect(r.report.scale.source).toBe('площади комнат')
    expect(r.underlay.scale).toBeGreaterThan(0.9)
    expect(r.underlay.scale).toBeLessThan(1.1)
  })

  it('дикая подпись площади масштаб не ломает', () => {
    const ai = boxPlan({ rooms: [{ name: 'Студия', areaM2: 400, x: 0.5, y: 0.5 }] })
    const r = convertAiPlan(ai, underlay(1))
    // поправка больше чем вдвое отвергается
    expect(r.report.scale.source).toBe('прежняя калибровка')
    expect(r.underlay.scale).toBe(1)
  })

  it('ручную калибровку не трогает, если так попросили', () => {
    const ai = boxPlan({ dimensions: [{ x1: 0.1, y1: 0.05, x2: 0.9, y2: 0.05, cm: 800 }, { x1: 0.1, y1: 0.95, x2: 0.9, y2: 0.95, cm: 800 }] })
    const r = convertAiPlan(ai, underlay(2.5), { keepScale: true })
    expect(r.underlay.scale).toBe(2.5)
    expect(r.report.scale.source).toBe('прежняя калибровка')
  })
})

describe('причёсывание геометрии', () => {
  it('почти горизонтальная стена становится строго горизонтальной', () => {
    const [a, b] = axisAlign({ x: 0, y: 0 }, { x: 400, y: 9 }, 6)
    expect(a.y).toBe(b.y)
    expect(a.y).toBeCloseTo(4.5, 3)
  })

  it('почти вертикальная — строго вертикальной', () => {
    const [a, b] = axisAlign({ x: 0, y: 0 }, { x: 9, y: 400 }, 6)
    expect(a.x).toBe(b.x)
  })

  it('косую стену оставляет косой', () => {
    const [a, b] = axisAlign({ x: 0, y: 0 }, { x: 300, y: 300 }, 6)
    expect(a).toEqual({ x: 0, y: 0 })
    expect(b).toEqual({ x: 300, y: 300 })
  })

  it('близкие концы сводятся в один узел', () => {
    const welded = weldEnds(
      [
        { id: 'a', a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, thickness: 10 },
        { id: 'b', a: { x: 304, y: 3 }, b: { x: 304, y: 300 }, thickness: 10 },
      ],
      12,
    )
    expect(welded[0].b).toEqual(welded[1].a)
  })

  it('дубликаты стен убираются, в том числе перевёрнутые', () => {
    const w = { id: 'a', a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, thickness: 10 }
    const back = { id: 'b', a: { x: 300, y: 1 }, b: { x: 0, y: 1 }, thickness: 10 }
    expect(dedupeWalls([w, back], 12)).toHaveLength(1)
  })

  it('толщина округляется до стандартной', () => {
    expect(roundThickness(27)).toBe(25)
    expect(roundThickness(9)).toBe(8)
    expect(roundThickness(100)).toBe(51)
  })

  it('пол подбирается по названию комнаты', () => {
    expect(floorFor('Ванная')).toBe('tile')
    expect(floorFor('Жилая комната')).toBe('laminate')
    expect(floorFor('Лоджия')).toBe('concrete')
  })
})

describe('сборка чертежа', () => {
  const ai = boxPlan({
    dimensions: [
      { x1: 0.1, y1: 0.05, x2: 0.9, y2: 0.05, cm: 800 },
      { x1: 0.05, y1: 0.125, x2: 0.05, y2: 0.875, cm: 600 },
    ],
    openings: [
      { kind: 'door', x: 0.5, y: 0.875, widthCm: 90 },
      { kind: 'window', x: 0.5, y: 0.125, widthCm: 150 },
    ],
    rooms: [{ name: 'Кухня-гостиная', areaM2: 45, x: 0.5, y: 0.5 }],
  })

  it('стены замыкаются в комнату, проёмы садятся на стены', () => {
    const r = convertAiPlan(ai, underlay(1))
    expect(r.walls).toHaveLength(4)
    expect(r.openings).toHaveLength(2)
    expect(r.report.openingsDropped).toBe(0)
    expect(r.rooms[0].name).toBe('Кухня-гостиная')
    expect(r.rooms[0].floor).toBe('tile')
    for (const op of r.openings) {
      expect(r.walls.some((w) => w.id === op.wallId)).toBe(true)
      expect(op.t).toBeGreaterThan(0)
      expect(op.t).toBeLessThan(1)
    }
  })

  it('проём в стороне от стен отбрасывается, а не привязывается наугад', () => {
    const lost = boxPlan({ openings: [{ kind: 'door', x: 0.5, y: 0.5, widthCm: 90 }] })
    const r = convertAiPlan(lost, underlay(1))
    expect(r.openings).toHaveLength(0)
    expect(r.report.openingsDropped).toBe(1)
  })

  it('проём шире стены не ставится', () => {
    const wide = boxPlan({ openings: [{ kind: 'window', x: 0.1, y: 0.5, widthCm: 400 }] })
    const r = convertAiPlan(wide, underlay(1))
    expect(r.report.openingsDropped + r.openings.length).toBe(1)
    for (const op of r.openings) {
      const w = r.walls.find((x) => x.id === op.wallId)!
      const L = Math.hypot(w.a.x - w.b.x, w.a.y - w.b.y)
      expect(op.width).toBeLessThan(L)
    }
  })

  it('комнате без подписи имя не выдумывается', () => {
    const r = convertAiPlan(boxPlan(), underlay(1))
    expect(r.rooms).toHaveLength(0)
  })
})

describe('замена чертежа распознанным', () => {
  const ai = boxPlan({
    dimensions: [
      { x1: 0.1, y1: 0.05, x2: 0.9, y2: 0.05, cm: 800 },
      { x1: 0.1, y1: 0.95, x2: 0.9, y2: 0.95, cm: 800 },
    ],
    rooms: [{ name: 'Студия', areaM2: 45, x: 0.5, y: 0.5 }],
  })

  const withFurniture = {
    version: 1 as const,
    name: '',
    walls: [],
    openings: [],
    furniture: [
      { id: 'in', type: 'bed-160', x: 400, y: 300, w: 160, d: 200, rot: 0 },
      { id: 'out', type: 'sofa-3', x: 5000, y: 5000, w: 220, d: 95, rot: 0 },
    ],
    rooms: [],
    dims: [{ id: 'd1', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, offset: 30 }],
    settings: { grid: 10 },
  }

  it('мебель внутри новых комнат остаётся, повисшая в пустоте убирается', () => {
    const result = convertAiPlan(ai, underlay(1))
    const done = applyAiPlan(withFurniture, result)
    expect(done.furnitureDropped).toBe(1)
    expect(done.plan.furniture.map((f) => f.id)).toEqual(['in'])
  })

  it('стены, проёмы и комнаты заменяются целиком', () => {
    const result = convertAiPlan(ai, underlay(1))
    const done = applyAiPlan(withFurniture, result)
    expect(done.plan.walls).toHaveLength(4)
    expect(done.plan.rooms[0].name).toBe('Студия')
    // старые размерные линии относились к прежнему чертежу
    expect(done.plan.dims).toHaveLength(0)
    expect(done.plan.underlay?.scale).toBeCloseTo(1, 2)
  })
})
