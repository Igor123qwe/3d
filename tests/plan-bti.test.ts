// Настоящее фото плана БТИ (обмерный план квартиры, снятый с экрана: справа
// наложена тёмная панель, обрезающая комнату «1»). Маска чернил после очистки
// лежит в fixtures как серии (RLE); подписи — те, что читаются на фото.
// Эталон проверен руками по цифрам плана:
//   5ж 13,9 м², 3,72 × 4,08 с вырезом 0,82 × 1,50 под коридор — Г-образная;
//   6 4,6 (1,80 × 2,58); 1 11,4 (2,34 в ширину, обрезана панелью);
//   4ж 17,1 (4,01 × 4,26); 2 13,0 (3,30 в ширину); коридор без подписи.
// Тест падает, если пропала комната, потерялась Г-образная зона 5ж или
// подтверждённый размер ушёл дальше допуска — даже когда площади сошлись.
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
    { name: '5ж', kind: 'жилая', area_m2: 13.9, width_cm: 372, depth_cm: 408, box: { x1: 0.1, y1: 0.15, x2: 0.4, y2: 0.45 }, x: 0.26, y: 0.3, neighbors: { right: ['6', 'коридор'], bottom: ['4ж'] }, outer: ['left', 'top'] },
    { name: '6', kind: 'санузел', area_m2: 4.6, width_cm: 180, depth_cm: 258, box: { x1: 0.5, y1: 0.12, x2: 0.65, y2: 0.32 }, x: 0.58, y: 0.22, neighbors: { left: ['5ж'], right: ['1'], bottom: ['коридор'] }, outer: ['top'] },
    { name: '1', kind: 'кухня', area_m2: 11.4, width_cm: 234, box: { x1: 0.72, y1: 0.12, x2: 0.86, y2: 0.36 }, x: 0.79, y: 0.24, neighbors: { left: ['6', 'коридор'], bottom: ['2'] }, outer: ['top', 'right'] },
    { name: 'коридор', kind: 'коридор', box: { x1: 0.42, y1: 0.4, x2: 0.84, y2: 0.48 }, x: 0.63, y: 0.44, neighbors: { left: ['5ж'], top: ['6', '1'], bottom: ['4ж', '2'] }, outer: [] },
    { name: '4ж', kind: 'жилая', area_m2: 17.1, width_cm: 401, depth_cm: 426, box: { x1: 0.1, y1: 0.55, x2: 0.45, y2: 0.88 }, x: 0.28, y: 0.71, neighbors: { top: ['5ж', 'коридор'], right: ['2'] }, outer: ['left', 'bottom'] },
    { name: '2', kind: 'жилая', area_m2: 13.0, width_cm: 330, depth_cm: 426, box: { x1: 0.55, y1: 0.55, x2: 0.82, y2: 0.88 }, x: 0.68, y: 0.71, neighbors: { top: ['коридор', '1'], left: ['4ж'] }, outer: ['right', 'bottom'] },
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

  it('сегментация находит ровно шесть комнат', () => {
    expect(regions).toHaveLength(6)
  })

  it('все шесть помещений с подписями на чертеже — полнота подтверждена', () => {
    expect(result.report.method).toBe('по комнатам с картинки')
    expect(q.completeness).toEqual({ expected: 6, found: 6, missing: [] })
    expect(rooms.map((r) => r.meta.name).sort()).toEqual(['1', '2', '4ж', '5ж', '6', 'коридор'])
  })

  it('масштаб — по площадям, и он называет подписи', () => {
    expect(result.report.scale.source).toBe('площади комнат')
    expect(result.report.scale.cmPerPx).toBeGreaterThan(1.25)
    expect(result.report.scale.cmPerPx).toBeLessThan(1.45)
    expect(result.report.scale.labels).toContain('5ж 13.9 м²')
  })

  it('5ж Г-образная: коридор заходит в её угол, лишней клетки нет', () => {
    const r = byName('5ж')!
    expect(r.polygon).toHaveLength(6)
    expect(Math.abs(r.area - 13.9)).toBeLessThan(1.6)
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
    expect(Math.abs(width('2') - 330)).toBeLessThan(20)
    expect(Math.abs(width('6') - 180)).toBeLessThan(15)
    expect(Math.abs(depth('6') - 258)).toBeLessThan(15)
  })

  it('стены лежат на линиях фото, формы целых комнат совпадают с областями', () => {
    console.log('QUALITY', JSON.stringify({ ...q, walls: q.walls && { onInk: q.walls.onInk, off: q.walls.off.map((o) => [Math.round(o.a.x), Math.round(o.a.y), Math.round(o.b.x), Math.round(o.b.y), o.devCm]) } }, null, 0))
    console.log('ROOMS', JSON.stringify(rooms.map((r) => [r.meta.name, r.area.toFixed(1), r.inner.map((p) => [Math.round(p.x), Math.round(p.y)])])))
    console.log('REGIONS', JSON.stringify(regions.map((g) => [Math.round(g.x1), Math.round(g.y1), Math.round(g.x2), Math.round(g.y2), g.yieldsTo])))
    expect(q.walls!.onInk).toBeGreaterThan(0.8)
    // комната «1» обрезана панелью на фото — её форма по подписи и не должна совпасть
    for (const s of q.shapes!.filter((x) => x.name !== '1')) expect(s.iou, s.name).toBeGreaterThan(0.8)
  })
})
