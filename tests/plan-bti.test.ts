// Настоящее фото плана БТИ (обмерный план квартиры, снятый с экрана: справа
// наложена тёмная панель). Маска чернил после очистки лежит в fixtures как
// серии (RLE); подписи — те, что читаются на фото.
// Эталон проверен руками по цифрам плана:
//   5ж 13,9 м², 3,72 × 4,08 с вырезом 0,82 × 1,50 — Г-образная;
//   6 4,6 (1,80 × 2,58);
//   1 11,4 — Г-образная прихожая: 2,34 в ширину у входа и коридор 2,77 × 1,37
//     вдоль 6 до выреза 5ж. Отдельного коридора на плане нет;
//   4ж 17,1 (4,01 × 4,26); 2 13,0 (3,30 в ширину по нижней части, справа уступы).
// Тест падает, если пропала комната, Г-образная комната стала прямоугольником
// или разрезана на две, или подтверждённый размер ушёл дальше допуска.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { AiPlan } from '../src/planner/aicontract'
import type { Underlay } from '../src/planner/types'
import { distanceToInk, segmentRoomsAuto } from '../src/planner/raster'
import { convertAiPlan } from '../src/planner/planai'
import { buildRooms } from '../src/planner/rooms'
import { checkAiPlan } from '../src/planner/aicontract'

const fx = JSON.parse(readFileSync(new URL('./fixtures/plan-bti.ink.json', import.meta.url), 'utf8')) as { w: number; h: number; scale: number; runs: number[] }

function inkMask(): Uint8Array {
  const ink = new Uint8Array(fx.w * fx.h)
  let i = 0
  let v = 0
  for (const n of fx.runs) {
    if (v) ink.fill(1, i, i + n)
    i += n
    v ^= 1
  }
  return ink
}

/** ответ модели: подписи с фото (числа с плана, рамки и точки — примерные, как их называет модель) */
const LABELS = {
  walls: [],
  openings: [
    { kind: 'door', room: '5ж', side: 'right', at: 0.85, x: 0.46, y: 0.42, width_cm: 80 },
    { kind: 'door', room: '4ж', side: 'top', at: 0.5, x: 0.28, y: 0.5, width_cm: 80 },
    { kind: 'window', room: '5ж', side: 'left', at: 0.5, x: 0.06, y: 0.3, width_cm: 150 },
    { kind: 'window', room: '4ж', side: 'left', at: 0.5, x: 0.06, y: 0.7, width_cm: 150 },
  ],
  rooms: [
    { name: '5ж', kind: 'жилая', area_m2: 13.9, width_cm: 372, depth_cm: 408, box: { x1: 0.1, y1: 0.15, x2: 0.4, y2: 0.45 }, x: 0.26, y: 0.3 },
    { name: '6', kind: 'санузел', area_m2: 4.6, width_cm: 180, depth_cm: 258, box: { x1: 0.5, y1: 0.12, x2: 0.65, y2: 0.32 }, x: 0.58, y: 0.22 },
    { name: '1', kind: 'прихожая', area_m2: 11.4, width_cm: 234, box: { x1: 0.72, y1: 0.12, x2: 0.86, y2: 0.36 }, x: 0.79, y: 0.24 },
    { name: '4ж', kind: 'жилая', area_m2: 17.1, width_cm: 401, depth_cm: 426, box: { x1: 0.1, y1: 0.55, x2: 0.45, y2: 0.88 }, x: 0.28, y: 0.71 },
    { name: '2', kind: 'жилая', area_m2: 13.0, width_cm: 330, depth_cm: 426, box: { x1: 0.55, y1: 0.55, x2: 0.82, y2: 0.88 }, x: 0.68, y: 0.71 },
  ],
  dimensions: [],
}

function recognise() {
  const ink = inkMask()
  const d2 = distanceToInk({ ink, w: fx.w, h: fx.h })
  const u: Underlay = { src: '', px: { w: fx.w, h: fx.h }, x: 0, y: 0, scale: fx.scale, opacity: 0.6, visible: true, locked: false }
  const closePx = Math.min(80, Math.max(3, Math.round(45 / u.scale)))
  const { regions } = segmentRoomsAuto(d2, fx.w, fx.h, closePx)
  const ai: AiPlan = checkAiPlan(LABELS)
  const result = convertAiPlan(ai, u, { regions, raster: { d2, w: fx.w, h: fx.h } })
  const { rooms } = buildRooms({ version: 1, name: '', walls: result.walls, openings: result.openings, furniture: [], rooms: result.rooms, dims: [], settings: { grid: 10 } })
  return { regions, result, rooms, u: result.underlay }
}

describe('настоящее фото плана БТИ', () => {
  const { regions, result, rooms } = recognise()
  const q = result.report.quality
  const byName = (n: string) => rooms.find((r) => r.meta.name === n)

  it('сегментация находит ровно пять комнат: прихожая «1» — одна область, не две', () => {
    expect(regions).toHaveLength(5)
  })

  it('все пять помещений с подписями на чертеже — полнота подтверждена', () => {
    expect(result.report.method).toBe('по комнатам с картинки')
    expect(q.completeness).toEqual({ expected: 5, found: 5, missing: [] })
    expect(rooms.map((r) => r.meta.name).sort()).toEqual(['1', '2', '4ж', '5ж', '6'])
  })

  it('масштаб — по площадям, и он называет подписи', () => {
    expect(result.report.scale.source).toBe('площади комнат')
    expect(result.report.scale.cmPerPx).toBeGreaterThan(1.25)
    expect(result.report.scale.cmPerPx).toBeLessThan(1.45)
    expect(result.report.scale.labels).toContain('5ж 13.9 м²')
  })

  const fillOf = (n: string) => {
    const r = byName(n)!
    // форма — по заполнению рамки: у Г-образной комнаты угол рамки пустой
    const xs = r.inner.map((p) => p.x)
    const ys = r.inner.map((p) => p.y)
    return (r.area * 1e4) / ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)))
  }

  it('5ж Г-образная: прихожая заходит в её угол, лишней клетки нет', () => {
    expect(fillOf('5ж')).toBeLessThan(0.95)
    expect(Math.abs(byName('5ж')!.area - 13.9)).toBeLessThan(0.6)
    expect(q.slivers).toEqual([])
  })

  it('прихожая «1» Г-образная и целая: площадь сходится с подписью 11,4', () => {
    expect(fillOf('1')).toBeLessThan(0.8)
    expect(Math.abs(byName('1')!.area - 11.4)).toBeLessThan(0.6)
  })

  it('подтверждённые размеры на месте: 5ж 3,72, 4ж 4,01, 2 3,30, 6 1,80 × 2,58', () => {
    const width = (n: string) => {
      const p = byName(n)!.inner
      return Math.max(...p.map((v) => v.x)) - Math.min(...p.map((v) => v.x))
    }
    const depth = (n: string) => {
      const p = byName(n)!.inner
      return Math.max(...p.map((v) => v.y)) - Math.min(...p.map((v) => v.y))
    }
    expect(Math.abs(width('5ж') - 372)).toBeLessThan(15)
    expect(Math.abs(width('4ж') - 401)).toBeLessThan(15)
    // у 2 в правой стене ниша: подпись 3,30 — по узкой части, рамка с картинки — по медиане
    expect(Math.abs(width('2') - 330)).toBeLessThan(25)
    expect(Math.abs(width('6') - 180)).toBeLessThan(15)
    expect(Math.abs(depth('6') - 258)).toBeLessThan(15)
  })

  it('стены лежат на линиях фото, формы целых комнат совпадают с областями', () => {
    // стены встают по картинке, а не по подписям: почти вся их длина — на линиях фото
    expect(q.walls!.onInk).toBeGreaterThan(0.9)
    for (const s of q.shapes!) expect(s.iou, s.name).toBeGreaterThan(0.8)
  })

  it('верные подписи спорными не названы, площади сходятся, стены не уходят за край картинки', () => {
    expect(q.disputes).toEqual([])
    expect(result.report.areaFit!.accuracy).toBeGreaterThan(0.95)
    for (const w of result.walls) for (const p of [w.a, w.b]) expect(p.x).toBeLessThan(fx.w * fx.scale + 30)
  })
})

describe('настоящее фото плана БТИ: модель прочитала часть цифр неверно', () => {
  // так было у пользователя: «0.82» прочитано как 3.84, площадь с лишней цифрой
  const misread = JSON.parse(JSON.stringify(LABELS))
  const room = (n: string) => misread.rooms.find((r: { name: string }) => r.name === n)
  room('6').width_cm = 384
  room('2').area_m2 = 31.0
  room('4ж').depth_cm = 150

  function run(labels: unknown) {
    const ink = inkMask()
    const d2 = distanceToInk({ ink, w: fx.w, h: fx.h })
    const u: Underlay = { src: '', px: { w: fx.w, h: fx.h }, x: 0, y: 0, scale: fx.scale, opacity: 0.6, visible: true, locked: false }
    const { regions } = segmentRoomsAuto(d2, fx.w, fx.h, Math.min(80, Math.max(3, Math.round(45 / u.scale))))
    const result = convertAiPlan(checkAiPlan(labels), u, { regions, raster: { d2, w: fx.w, h: fx.h } })
    const { rooms } = buildRooms({ version: 1, name: '', walls: result.walls, openings: result.openings, furniture: [], rooms: result.rooms, dims: [], settings: { grid: 10 } })
    return { result, rooms }
  }
  const good = run(LABELS)
  const bad = run(misread)

  it('масштаб держится на согласии остальных подписей', () => {
    expect(Math.abs(bad.result.report.scale.cmPerPx - good.result.report.scale.cmPerPx)).toBeLessThan(0.03)
  })

  it('неверные цифры не двигают стены: чертёж тот же, что при верных', () => {
    const size = (rs: typeof good.rooms, n: string) => {
      const p = rs.find((r) => r.meta.name === n)!.inner
      return [Math.max(...p.map((v) => v.x)) - Math.min(...p.map((v) => v.x)), Math.max(...p.map((v) => v.y)) - Math.min(...p.map((v) => v.y))]
    }
    for (const n of ['6', '2', '4ж', '5ж']) {
      const [gw, gh] = size(good.rooms, n)
      const [bw, bh] = size(bad.rooms, n)
      expect(Math.abs(gw - bw), `${n} ширина`).toBeLessThan(5)
      expect(Math.abs(gh - bh), `${n} глубина`).toBeLessThan(5)
    }
    expect(bad.result.report.quality.walls!.onInk).toBeGreaterThan(0.9)
    expect(bad.result.report.quality.slivers).toEqual([])
  })

  it('каждая неверная цифра названа спорной, с тем, что выходит по картинке', () => {
    const d = bad.result.report.quality.disputes
    const has = (room: string, field: string) => d.find((x) => x.room === room && x.field === field)
    expect(has('6', 'width')?.label).toBe(384)
    expect(Math.abs(has('6', 'width')!.picture - 180)).toBeLessThan(15)
    expect(has('2', 'area')?.label).toBe(31)
    expect(has('4ж', 'depth')?.label).toBe(150)
    // верные подписи спорными не названы
    expect(has('5ж', 'area')).toBeUndefined()
  })
})
