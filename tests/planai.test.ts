import { describe, expect, it } from 'vitest'
import type { AiBox, AiPlan } from '../src/planner/aicontract'
import type { Underlay } from '../src/planner/types'
import {
  applyAiPlan,
  axisAlign,
  convertAiPlan,
  dedupeWalls,
  floorFor,
  marksFromReads,
  roomLabelInBox,
  robustMedian,
  roundThickness,
  scaleFromDimensions,
  scaleFromLabels,
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

describe('чертёж заново по числам', () => {
  // две комнаты рядом: 400 × 500 и 300 × 500 см, картинка 1000 × 800 при 1 см в пикселе
  const rooms: AiPlan['rooms'] = [
    { name: 'Гостиная', areaM2: 20, widthCm: 400, depthCm: 500, box: { x1: 0.1, y1: 0.15, x2: 0.5, y2: 0.775 }, x: 0.3, y: 0.46 },
    { name: '2', kind: 'жилая', areaM2: 15, widthCm: 300, depthCm: 500, box: { x1: 0.51, y1: 0.15, x2: 0.81, y2: 0.775 }, x: 0.66, y: 0.46 },
  ]

  it('без стен от модели чертёж всё равно строится, масштаб — по размерам комнат', () => {
    const ai: AiPlan = { walls: [], openings: [], rooms, dimensions: [] }
    // подложка в неверном масштабе: размеры комнат его поправят
    const r = convertAiPlan(ai, underlay(2))
    expect(r.report.method).toBe('по размерам комнат')
    expect(r.report.scale.source).toBe('размеры комнат')
    expect(r.report.scale.cmPerPx).toBeCloseTo(1, 2)
    expect(r.rooms.map((m) => m.name).sort()).toEqual(['2', 'Гостиная'])
    expect(r.rooms.find((m) => m.name === '2')?.floor).toBe('laminate')
    expect(r.report.areaFit?.accuracy ?? 0).toBeGreaterThan(0.97)
    expect(r.report.roomsSkipped).toEqual([])
    // наружный контур и одна перегородка
    expect(r.walls.filter((w) => w.thickness === 40).length).toBeGreaterThanOrEqual(4)
    expect(r.walls.filter((w) => w.thickness === 10)).toHaveLength(1)
  })

  it('проём по комнате и стороне садится на нужную стену', () => {
    const ai: AiPlan = {
      walls: [],
      dimensions: [],
      rooms,
      openings: [
        { kind: 'door', x: 0.5, y: 0.4, widthCm: 90, room: 'Гостиная', side: 'right', at: 0.5 },
        { kind: 'window', x: 0.3, y: 0.15, widthCm: 150, room: 'Гостиная', side: 'top', at: 0.5 },
        // без комнаты — по точке на картинке, как раньше
        { kind: 'window', x: 0.66, y: 0.15, widthCm: 150 },
      ],
    }
    const r = convertAiPlan(ai, underlay(1))
    expect(r.openings).toHaveLength(3)
    const wallOf = (i: number) => r.walls.find((w) => w.id === r.openings[i].wallId)!
    // дверь — в перегородке (вертикальная тонкая стена)
    expect(wallOf(0).thickness).toBe(10)
    expect(wallOf(0).a.x).toBeCloseTo(wallOf(0).b.x, 5)
    // окна — в верхней наружной стене
    expect(wallOf(1).thickness).toBe(40)
    expect(wallOf(1).a.y).toBeCloseTo(wallOf(1).b.y, 5)
    expect(wallOf(2).id).toBe(wallOf(1).id)
  })

  it('масштаб по всем числам разом: цепочки и размеры комнат в одной медиане', () => {
    const ai: AiPlan = { walls: [], openings: [], rooms, dimensions: [{ x1: 0.1, y1: 0.05, x2: 0.5, y2: 0.05, cm: 400 }] }
    const fit = scaleFromLabels(ai, px)
    expect(fit?.source).toBe('размеры на плане')
    expect(fit?.samples).toBe(5)
    expect(fit?.cmPerPx).toBeCloseTo(1, 2)
  })

  it('если по стенам замкнулось больше комнат, чем по числам, — берутся стены', () => {
    // прямоугольник стен замыкает единственную комнату; прямоугольник-комната — ниша уже полуметра, по числам ничего
    const ai = boxPlan({ rooms: [{ name: 'Ниша', x: 0.5, y: 0.5, box: { x1: 0.5, y1: 0.5, x2: 0.52, y2: 0.6 }, widthCm: 20, depthCm: 80 }] })
    const r = convertAiPlan(ai, underlay(1))
    expect(r.report.method).toBe('по линиям стен')
    expect(r.walls).toHaveLength(4)
  })

  it('пол по типу комнаты, когда название — номер', () => {
    expect(floorFor('6', 'санузел')).toBe('tile')
    expect(floorFor('5ж', 'жилая')).toBe('laminate')
    expect(floorFor('3', 'кладовая')).toBe('plain')
    expect(floorFor('Кухня')).toBe('tile')
  })
})

describe('чертёж лежит на картинке', () => {
  it('стены, построенные мимо подложки, сдвигаются на неё, и отчёт об этом говорит', () => {
    // подложка в стороне: x от 5000, а комнаты модель «положила» в долях картинки — они лягут на неё
    const far: Underlay = { src: '', px, x: 5000, y: 5000, scale: 1, opacity: 0.6, visible: true, locked: false }
    const ai: AiPlan = {
      walls: [],
      openings: [],
      dimensions: [],
      rooms: [{ name: 'К', areaM2: 20, widthCm: 400, depthCm: 500, box: { x1: 0.1, y1: 0.15, x2: 0.5, y2: 0.775 }, x: 0.3, y: 0.46 }],
    }
    const r = convertAiPlan(ai, far)
    expect(r.report.placement.shifted).toBe(false)
    const b = r.report.placement.walls!
    expect(b.minX).toBeGreaterThan(5000)
    expect(b.maxX).toBeLessThan(6000)
  })

  it('стены с картинки, попавшие мимо подложки из-за сдвинутой подложки, центрируются на ней', () => {
    // подложка стоит в 5000, а стены модель дала так, что после перевода они не на ней быть не могут только при ошибке;
    // имитируем ошибку: подложка со смещением после расчёта — стены считались от x=0
    const shifted: Underlay = { src: '', px, x: 0, y: 0, scale: 1, opacity: 0.6, visible: true, locked: false }
    const r = convertAiPlan(boxPlan(), shifted)
    expect(r.report.placement.shifted).toBe(false)
    // а теперь та же геометрия, но подложку отнесли: центр стен окажется вне неё
    const moved = { ...r.underlay, x: 3000 }
    const out = convertAiPlan(boxPlan(), moved, { keepScale: true })
    // стены строятся от подложки, поэтому лягут на неё сами — сдвига не нужно
    expect(out.report.placement.shifted).toBe(false)
    expect(out.report.placement.walls!.minX).toBeGreaterThan(3000)
  })
})

describe('рамки привязываются к стенам на картинке', () => {
  it('привязка меняет рамку, если площадь похожа, и не трогает, если заливка утекла в чужую комнату', () => {
    const rooms: AiPlan['rooms'] = [
      { name: 'Гостиная', areaM2: 20, box: { x1: 0.15, y1: 0.2, x2: 0.45, y2: 0.7 }, x: 0.3, y: 0.46 },
      { name: '2', areaM2: 15, box: { x1: 0.55, y1: 0.2, x2: 0.8, y2: 0.7 }, x: 0.66, y: 0.46 },
    ]
    const calls: AiBox[] = []
    const ground = (box: AiBox) => {
      calls.push(box)
      // для первой — настоящие стены 400 × 500 при 1 см/px; для второй — утечка на всю квартиру
      return box.x1 < 0.5 ? { x1: 0.1, y1: 0.15, x2: 0.5, y2: 0.775 } : { x1: 0.1, y1: 0.15, x2: 0.9, y2: 0.775 }
    }
    const r = convertAiPlan({ walls: [], openings: [], dimensions: [], rooms }, underlay(1), { ground })
    expect(calls).toHaveLength(2)
    expect(r.report.grounded).toBe(1)
    const living = r.rooms.find((m) => m.name === 'Гостиная')!
    expect(living.anchor.x).toBeCloseTo(300, -2)
  })
})

describe('комнаты с картинки', () => {
  const region = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2, areaPx: (x2 - x1) * (y2 - y1), points: (x2 - x1) * (y2 - y1), fill: 0.97, fillBox: 0.97, edges: 0, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 })
  // две комнаты 400 × 500 и 300 × 500 на картинке 1000 × 800, 1 px = 1 см
  const regions = [region(100, 150, 500, 650), region(510, 150, 810, 650)]

  it('без ИИ: комнаты по номерам, стены общие, масштаб текущий', () => {
    const r = convertAiPlan({ walls: [], openings: [], rooms: [], dimensions: [] }, underlay(1), { keepScale: true, regions })
    expect(r.report.method).toBe('по комнатам с картинки')
    expect(r.rooms.map((m) => m.name)).toEqual(['Помещение 1', 'Помещение 2'])
    expect(r.walls.filter((w) => w.thickness === 10)).toHaveLength(1)
    expect(r.report.scale.source).toBe('прежняя калибровка')
  })

  it('с подписями модели: имена и площади ложатся на области, масштаб — по площадям, выдумка отпадает', () => {
    const ai: AiPlan = {
      walls: [],
      openings: [],
      dimensions: [],
      rooms: [
        // точки модели промахнулись, рамки её кривые — не важно: площади всё расставят
        { name: 'Гостиная', areaM2: 20, x: 0.05, y: 0.05, box: { x1: 0, y1: 0, x2: 0.2, y2: 0.2 } },
        { name: '2', areaM2: 15, x: 0.05, y: 0.05, box: { x1: 0, y1: 0, x2: 0.2, y2: 0.2 } },
        { name: 'Санузел', areaM2: 3, x: 0.05, y: 0.05 },
      ],
    }
    // подложка в неверном масштабе: площади его поправят
    const r = convertAiPlan(ai, underlay(2), { regions })
    expect(r.report.method).toBe('по комнатам с картинки')
    expect(r.report.segmented).toEqual({ regions: 2, matched: 2, unmatched: ['Санузел'] })
    expect(r.report.scale.cmPerPx).toBeCloseTo(1, 1)
    expect(r.rooms.map((m) => m.name).sort()).toEqual(['2', 'Гостиная'])
    expect(r.report.areaFit?.accuracy ?? 0).toBeGreaterThan(0.97)
  })

  it('дверь между комнатами, названная обеими, встаёт один раз и считается одной', () => {
    const ai: AiPlan = {
      walls: [],
      dimensions: [],
      rooms: [
        { name: 'A', areaM2: 20, x: 0.3, y: 0.5 },
        { name: 'B', areaM2: 15, x: 0.66, y: 0.5 },
      ],
      openings: [
        { kind: 'door', room: 'A', side: 'right', at: 0.5, x: 0.5, y: 0.5, widthCm: 80 },
        { kind: 'door', room: 'B', side: 'left', at: 0.5, x: 0.51, y: 0.5, widthCm: 80 },
        { kind: 'window', room: 'A', side: 'left', at: 0.5, x: 0.1, y: 0.5, widthCm: 150 },
      ],
    }
    const r = convertAiPlan(ai, underlay(1), { regions })
    expect(r.openings.filter((o) => o.kind === 'door')).toHaveLength(1)
    expect(r.openings.filter((o) => o.kind === 'window')).toHaveLength(1)
    expect(r.report.quality.openings).toEqual({ expected: 2, placed: 2 })
  })

  it('подписи не легли — области не в счёт, работает прежний путь по рамкам модели', () => {
    const ai: AiPlan = {
      walls: [],
      openings: [],
      dimensions: [],
      rooms: [
        // площади 50 и 12 относятся друг к другу не так, как области (20 и 15): совпадений нет
        { name: 'A', areaM2: 50, x: 0.05, y: 0.05, box: { x1: 0.1, y1: 0.15, x2: 0.5, y2: 0.775 }, widthCm: 400, depthCm: 1250 },
        { name: 'B', areaM2: 12, x: 0.05, y: 0.05, box: { x1: 0.51, y1: 0.15, x2: 0.81, y2: 0.775 }, widthCm: 300, depthCm: 400 },
      ],
    }
    const r = convertAiPlan(ai, underlay(1), { regions })
    expect(r.report.method).toBe('по размерам комнат')
    expect(r.report.segmented).toBeNull()
  })
})

describe('проём в стене Г-образной комнаты', () => {
  it('точка стороны попала в вырез — проём садится на стену той же стороны, а не пропадает', () => {
    // комната 5ж с вырезом под коридор в правом нижнем углу; дверь — в правой стене, внизу
    const ai: AiPlan = {
      walls: [],
      dimensions: [],
      rooms: [
        { name: '5ж', areaM2: 14.4, x: 0.15, y: 0.15, box: { x1: 0.04, y1: 0.05, x2: 0.44, y2: 0.55 }, yieldsTo: ['коридор'], exact: true },
        { name: 'коридор', x: 0.5, y: 0.47, box: { x1: 0.3, y1: 0.4, x2: 0.7, y2: 0.55 }, exact: true },
        { name: 'Кухня', areaM2: 6.4, x: 0.6, y: 0.15, box: { x1: 0.45, y1: 0.05, x2: 0.7, y2: 0.36 }, exact: true },
      ],
      // дверь в правой стене 5ж на 0.85 её высоты — это как раз вырез под коридор
      openings: [{ kind: 'door', room: '5ж', side: 'right', at: 0.85, x: 0.44, y: 0.47, widthCm: 80 }],
    }
    const r = convertAiPlan(ai, underlay(1), { keepScale: true })
    expect(r.report.method).toBe('по размерам комнат')
    expect(r.openings).toHaveLength(1)
    expect(r.report.openingsDropped).toBe(0)
    // проём сел на вертикальную стену по правой стороне 5ж
    const wall = r.walls.find((w) => w.id === r.openings[0].wallId)!
    expect(Math.abs(wall.a.x - wall.b.x)).toBeLessThan(1)
    expect(r.report.quality.openings).toEqual({ expected: 1, placed: 1 })
  })
})

describe('размеры по одному', () => {
  it('прочитанное с листа — к середине своей рамки; не размеры отброшены', () => {
    const boxes = [
      { x1: 90, y1: 10, x2: 109, y2: 19, vertical: false },
      { x1: 10, y1: 40, x2: 19, y2: 79, vertical: true },
      { x1: 50, y1: 50, x2: 69, y2: 59, vertical: false },
    ]
    expect(marksFromReads(boxes, ['3,72', '4,08', '13,9'], { w: 200, h: 100 })).toEqual([
      { x: 0.5, y: 0.15, vertical: false, cm: 372 },
      { x: 0.075, y: 0.6, vertical: true, cm: 408 },
    ])
  })

  it('числа проходят через сборку чертежа в координаты плана', () => {
    const res = convertAiPlan(boxPlan({ marks: [{ x: 0.5, y: 0.2, vertical: false, cm: 780 }] }), underlay(1), { keepScale: true })
    expect(res.marks).toEqual([{ at: { x: 500, y: 160 }, alongX: true, cm: 780 }])
  })
})

describe('место вдоль стены — из вырезки в рамку комнаты', () => {
  it('поля вырезки учитываются: ниша у правого края — у правого края рамки, а не в коридоре', () => {
    // комната 100..611 по x, 50..458 по y; вырезка с полями 60 (справа обрезана краем картинки 650)
    const box = { x1: 100, y1: 50, x2: 611, y2: 458 }
    const crop = { x1: 40, y1: 0, x2: 650, y2: 518 }
    const got = roomLabelInBox(
      {
        walls: [
          // «0,68» — середина ниши 577 по x: в вырезке (577 − 40) / 610 = 0,88
          { side: 'bottom', at: 0.88, cm: 68 },
          // «1,29» — середина правой стены ниши, 103 по y: в вырезке 103 / 518 = 0,2
          { side: 'right', at: 0.2, cm: 129 },
        ],
        openings: [{ kind: 'door', side: 'left', at: 0, widthCm: 80 }],
      },
      crop,
      box,
    )
    expect(got.walls![0].at).toBeCloseTo((0.88 * 610 + 40 - 100) / 511, 3)
    expect(got.walls![0].at).toBeGreaterThan(0.92)
    expect(got.walls![1].at).toBeCloseTo((0.2 * 518 - 50) / 408, 3)
    // место в полях вырезки прижимается к краю рамки
    expect(got.openings![0].at).toBe(0)
  })
})
