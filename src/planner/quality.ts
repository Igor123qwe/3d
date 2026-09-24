// Проверка чертежа по исходной картинке и по числам с плана.
//
// Процент совпадения площадей — не мера качества: он считает только те
// комнаты, которым нашёлся замкнутый контур, и молчит о потерянных. Здесь
// каждая сторона проверяется отдельно:
//
// - полнота: все ли помещения, что назвала модель, есть на чертеже;
// - стены: лежат ли они на линиях картинки (по карте расстояний до чернил)
//   и на сколько сантиметров ушли те, что мимо;
// - формы: совпадает ли контур каждой комнаты с областью на картинке
//   (IoU) — так видно потерянный выступ или лишний угол;
// - размеры: на сколько сантиметров расходится каждая прочитанная цепочка
//   с расстоянием между стенами на чертеже;
// - проёмы: сколько назвала модель и сколько встало на стены;
// - площади — как дополнительная проверка, не как приговор.
//
// Пока полнота не подтверждена, результат не объявляется точным.
import type { AiPlan } from './aicontract'
import type { Opening, Plan, Pt, RoomMeta, Underlay, Wall } from './types'
import type { RoomRegion } from './raster'
import type { AreaFit, DimSpan } from './reconstruct'
import { regionPoly, type LabelDispute } from './segment'
import { buildRooms } from './rooms'
import { pointInPoly } from './geometry'

export interface RasterInfo {
  /** квадрат расстояния до ближайших чернил, по пикселям картинки */
  d2: Float32Array
  w: number
  h: number
}

export interface QualityReport {
  completeness: { expected: number; found: number; missing: { name: string; why: string }[] }
  /** null — картинки для проверки не было */
  walls: { onInk: number; off: { a: Pt; b: Pt; devCm: number }[] } | null
  /** null — областей с картинки не было */
  shapes: { name: string; iou: number }[] | null
  dims: { cm: number; gotCm: number | null }[]
  openings: { expected: number; placed: number }
  areas: AreaFit | null
  /** комнаты, без которых площади сошлись бы лучше, но на картинке они есть — их не трогали */
  doubtful: string[]
  /** щели: замкнутые клетки между стенами площадью меньше метра — не помещения, а разошедшиеся оси */
  slivers: { name: string; areaM2: number }[]
  /** подписи, не сходящиеся с картинкой: скорее всего, прочитаны неверно */
  disputes: LabelDispute[]
  verdict: 'ok' | 'check' | 'weak'
  /** что именно не так — короткими фразами для диалога */
  issues: string[]
}

export interface QualityInput {
  ai: AiPlan
  u: Underlay
  walls: Wall[]
  openings: Opening[]
  metas: RoomMeta[]
  regions?: RoomRegion[]
  raster?: RasterInfo | null
  dims: DimSpan[]
  areas: AreaFit | null
  /** почему комнаты модели не попали на чертёж: имя → причина */
  lost: Map<string, string>
  doubtful: string[]
  disputes?: LabelDispute[]
  /** сколько проёмов пытались поставить: найденные по картинке и от модели, без повторов; нет — сколько назвала модель */
  openingsExpected?: number
}

const emptyPlan = (walls: Wall[]): Plan => ({ version: 1, name: '', walls, openings: [], furniture: [], rooms: [], dims: [], settings: { grid: 10 } })

/** Доля длины стен на линиях картинки и стены, ушедшие с линий */
export function wallsOnInk(walls: Wall[], u: Underlay, raster: RasterInfo): { onInk: number; off: { a: Pt; b: Pt; devCm: number }[] } {
  const { d2, w, h } = raster
  const toPx = (p: Pt): Pt => ({ x: (p.x - u.x) / u.scale, y: (p.y - u.y) / u.scale })
  // допуск: половина толщины стены плюс запас на неровность линии
  const slack = Math.max(3, 0.008 * Math.min(w, h))
  let total = 0
  let on = 0
  const off: { a: Pt; b: Pt; devCm: number }[] = []
  for (const wall of walls) {
    const L = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y)
    if (L < 1) continue
    const tol = wall.thickness / 2 / u.scale + slack
    const n = Math.max(3, Math.ceil(L / u.scale / 4))
    const devs: number[] = []
    let hit = 0
    for (let k = 0; k <= n; k++) {
      const t = k / n
      const p = toPx({ x: wall.a.x + (wall.b.x - wall.a.x) * t, y: wall.a.y + (wall.b.y - wall.a.y) * t })
      const x = Math.round(p.x)
      const y = Math.round(p.y)
      if (x < 0 || y < 0 || x >= w || y >= h) {
        devs.push(Infinity)
        continue
      }
      const d = Math.sqrt(d2[y * w + x])
      devs.push(d)
      if (d <= tol) hit++
    }
    const frac = hit / (n + 1)
    total += L
    on += L * frac
    if (frac < 0.5) {
      // отклонение — по самой далёкой от чернил точке: концы стены часто упираются в чужие линии
      const finite = devs.filter((d) => Number.isFinite(d))
      const devPx = finite.length ? Math.max(...finite) : Infinity
      off.push({ a: wall.a, b: wall.b, devCm: Number.isFinite(devPx) ? Math.round(devPx * u.scale) : Infinity })
    }
  }
  return { onInk: total ? on / total : 0, off }
}

/**
 * Контур комнаты на чертеже против области на картинке: IoU на сетке пикселей.
 * Область — её контур по пикселям (у Г-образной — шесть углов); контур
 * комнаты — многоугольник чертежа, переведённый в пиксели картинки
 */
export function shapeIou(polygon: Pt[], region: RoomRegion, u: Underlay): number {
  const shape = regionPoly(region)
  const poly = polygon.map((p) => ({ x: (p.x - u.x) / u.scale, y: (p.y - u.y) / u.scale }))
  const xs = [...poly, ...shape].map((p) => p.x)
  const ys = [...poly, ...shape].map((p) => p.y)
  const x1 = Math.floor(Math.min(...xs))
  const y1 = Math.floor(Math.min(...ys))
  const x2 = Math.ceil(Math.max(...xs))
  const y2 = Math.ceil(Math.max(...ys))
  const cell = Math.max(1, Math.round(Math.max(x2 - x1, y2 - y1) / 120))
  let inter = 0
  let union = 0
  for (let y = y1 + cell / 2; y <= y2; y += cell) {
    for (let x = x1 + cell / 2; x <= x2; x += cell) {
      const inRegion = pointInPoly({ x, y }, shape)
      const inPoly = pointInPoly({ x, y }, poly)
      if (inRegion && inPoly) inter++
      if (inRegion || inPoly) union++
    }
  }
  return union ? inter / union : 0
}

/** Расстояние между стенами чертежа на месте размерной цепочки; null — стен на её концах нет */
export function measureDim(d: DimSpan, walls: Wall[]): number | null {
  const dx = Math.abs(d.b.x - d.a.x)
  const dy = Math.abs(d.b.y - d.a.y)
  const tol = Math.max(50, d.cm * 0.2)
  const nearest = (values: number[], v: number): number | null => {
    let best: number | null = null
    for (const p of values) if (Math.abs(p - v) < tol && (best === null || Math.abs(p - v) < Math.abs(best - v))) best = p
    return best
  }
  if (dx >= dy * 4) {
    const xs = walls.filter((w) => Math.abs(w.a.x - w.b.x) < 1).map((w) => w.a.x)
    const a = nearest(xs, Math.min(d.a.x, d.b.x))
    const b = nearest(xs, Math.max(d.a.x, d.b.x))
    return a !== null && b !== null && a !== b ? Math.abs(b - a) : null
  }
  if (dy >= dx * 4) {
    const ys = walls.filter((w) => Math.abs(w.a.y - w.b.y) < 1).map((w) => w.a.y)
    const a = nearest(ys, Math.min(d.a.y, d.b.y))
    const b = nearest(ys, Math.max(d.a.y, d.b.y))
    return a !== null && b !== null && a !== b ? Math.abs(b - a) : null
  }
  return null
}

export function assessQuality(inp: QualityInput): QualityReport {
  const { ai, u, walls, openings, metas, regions, raster, dims, areas, lost, doubtful } = inp
  const disputes = inp.disputes ?? []
  const issues: string[] = []

  // 1. полнота: каждое помещение модели должно быть на чертеже
  const expectedNames = [...new Set(ai.rooms.map((r) => r.name))]
  const found = new Set(metas.map((m) => m.name))
  const missing = expectedNames.filter((n) => !found.has(n)).map((name) => ({ name, why: lost.get(name) ?? 'контур не замкнулся' }))
  const completeness = { expected: expectedNames.length, found: expectedNames.length - missing.length, missing }
  if (missing.length) issues.push(`нет на чертеже: ${missing.map((m) => `${m.name} (${m.why})`).join(', ')}`)

  // 2. стены на линиях картинки
  const wallsQ = raster ? wallsOnInk(walls, u, raster) : null
  if (wallsQ) {
    if (wallsQ.onInk < 0.6) issues.push(`стены лежат на линиях картинки лишь на ${Math.round(wallsQ.onInk * 100)} %`)
    else if (wallsQ.off.length) issues.push(`мимо линий картинки: ${wallsQ.off.length} ${wallsQ.off.length === 1 ? 'стена' : 'стен'} (до ${Math.max(...wallsQ.off.map((o) => (Number.isFinite(o.devCm) ? o.devCm : 0)))} см)`)
  }

  // 3. формы комнат против областей картинки
  let shapes: QualityReport['shapes'] = null
  const { rooms: built } = buildRooms({ ...emptyPlan(walls), rooms: metas })
  // щель между разошедшимися осями замыкается в «комнату» в четверть метра:
  // помещений такого размера не бывает, и на чертеже это лишняя клетка
  const labelPts = ai.rooms.map((r) => ({ x: u.x + r.x * u.px.w * u.scale, y: u.y + r.y * u.px.h * u.scale }))
  const slivers = built
    // подпись должна лежать уверенно внутри: у щели внутренний контур в пару
    // сантиметров, и точка комнаты по соседству в него не попадёт
    .filter((b) => b.area < 1 && !labelPts.some((p) => pointInPoly(p, b.inner)))
    .map((b) => ({ name: b.meta.name, areaM2: +b.area.toFixed(2) }))
  if (slivers.length) issues.push(`щели между стенами: ${slivers.map((s) => `${s.name} ${s.areaM2} м²`).join(', ')} — оси разошлись, поправьте «Уточнить участок»`)
  if (regions && regions.length) {
    shapes = []
    for (const region of regions) {
      const c = { x: u.x + region.cx * u.scale, y: u.y + region.cy * u.scale }
      const room = built.find((b) => pointInPoly(c, b.polygon))
      if (!room) continue
      // область с картинки — по внутренним граням стен, значит и контур комнаты берётся внутренний
      shapes.push({ name: room.meta.name, iou: shapeIou(room.inner, region, u) })
    }
    const bad = shapes.filter((s) => s.iou < 0.8)
    if (bad.length) issues.push(`форма расходится с картинкой: ${bad.map((s) => `${s.name} (${Math.round(s.iou * 100)} %)`).join(', ')}`)
  }

  // 4. размеры: цепочки против стен
  const dimsQ = dims.map((d) => ({ cm: d.cm, gotCm: measureDim(d, walls) }))
  const offDims = dimsQ.filter((d) => d.gotCm !== null && Math.abs(d.gotCm - d.cm) > Math.max(15, d.cm * 0.05))
  if (offDims.length) issues.push(`размеры расходятся: ${offDims.map((d) => `${d.cm} → ${Math.round(d.gotCm!)} см`).join(', ')}`)

  // 5. проёмы
  const openingsQ = { expected: inp.openingsExpected ?? ai.openings.length, placed: openings.length }
  if (openingsQ.placed < openingsQ.expected) issues.push(`проёмов встало ${openingsQ.placed} из ${openingsQ.expected}`)

  // 6. площади — дополнительно
  if (areas && areas.accuracy < 0.85) issues.push(`площади сходятся на ${Math.round(areas.accuracy * 100)} %`)
  if (disputes.length) issues.push(`подписи не сходятся с картинкой: ${disputes.map((d) => `${d.room} ${d.field === 'area' ? 'площадь' : d.field === 'width' ? 'ширина' : 'глубина'} ${d.label} — по картинке ${d.picture}`).join(', ')}`)
  if (doubtful.length) issues.push(`сомнительно: ${doubtful.join(', ')} — без них площади соседей сошлись бы лучше, но на картинке они есть`)

  const weak = missing.length > 0 || (wallsQ !== null && wallsQ.onInk < 0.6) || (areas !== null && areas.accuracy < 0.85)
  const check = !weak && (issues.length > 0 || (shapes?.some((s) => s.iou < 0.8) ?? false))
  return { completeness, walls: wallsQ, shapes, dims: dimsQ, openings: openingsQ, areas, doubtful, slivers, disputes, verdict: weak ? 'weak' : check ? 'check' : 'ok', issues }
}
