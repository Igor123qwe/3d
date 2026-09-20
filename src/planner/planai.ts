// Превращение распознанного моделью плана в настоящий чертёж.
//
// Модель возвращает доли картинки и подписи. Здесь они становятся стенами в
// сантиметрах. Две вещи, ради которых всё и затевалось:
//
// 1. Масштаб находится сам. На плане БТИ есть размерные цепочки («3400») и
//    подписанные площади («17,3»). По ним считается, сколько сантиметров в
//    пикселе, и ручная калибровка больше не нужна. Цепочки точнее площадей,
//    поэтому они в приоритете; площади идут вторым эшелоном.
// 2. Геометрия причёсывается: почти горизонтальные и почти вертикальные стены
//    выравниваются по осям, близкие концы сводятся в один узел, толщина
//    округляется до стандартной. Без этого стены не смыкаются и комнаты не
//    находятся.
// 3. Если модель прочитала комнаты с размерами, чертёж строится заново по
//    числам (reconstruct.ts), а стены с картинки остаются запасным путём:
//    берётся тот вариант, где замкнулось больше комнат.
import type { AiDimension, AiPlan } from './aicontract'
import type { Opening, Plan, Pt, RoomMeta, Underlay, Wall } from './types'
import { uid } from './types'
import { MIN_WALL_LENGTH, WALL_THICKNESSES } from './ops'
import { buildRooms } from './rooms'
import { closestOnSeg, dist, pointInPoly } from './geometry'
import { canRebuildFrom, pointOnSide, reconstructFromRooms, scaleSamplesFromRooms, type AreaFit } from './reconstruct'

export interface ConvertOptions {
  /** не трогать масштаб: пользователь уже откалибровал подложку руками */
  keepScale?: boolean
  /** допуск сведения концов стен, см */
  weldCm?: number
  /** до скольких градусов отклонения стена считается осевой */
  axisTolDeg?: number
}

export const DEFAULT_CONVERT: Required<ConvertOptions> = { keepScale: false, weldCm: 12, axisTolDeg: 6 }

export type ScaleSource = 'размерные цепочки' | 'размеры комнат' | 'размеры на плане' | 'площади комнат' | 'прежняя калибровка'

export interface ScaleFit {
  /** сантиметров в пикселе картинки */
  cmPerPx: number
  source: ScaleSource
  /** по скольким подписям посчитано */
  samples: number
}

export type ConvertMethod = 'по размерам комнат' | 'по линиям стен'

export interface ConvertReport {
  scale: ScaleFit
  /** как построен чертёж: заново по числам или по стенам с картинки */
  method: ConvertMethod
  walls: number
  openings: number
  /** проёмы, которым не нашлось стены */
  openingsDropped: number
  rooms: number
  /** сверка площадей с подписанными, когда чертёж построен по числам */
  areaFit: AreaFit | null
  /** комнаты, которые не удалось поставить по числам */
  roomsSkipped: string[]
  note?: string
}

export interface ApplyResult {
  plan: Plan
  /** сколько предметов убрано: после замены чертежа они оказались вне комнат */
  furnitureDropped: number
}

// ---------- масштаб ----------
const pxLen = (d: AiDimension, px: { w: number; h: number }): number =>
  Math.hypot((d.x2 - d.x1) * px.w, (d.y2 - d.y1) * px.h)

/** медиана без выбросов: одна неверно прочитанная цифра не должна портить масштаб */
export function robustMedian(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const m = s[Math.floor(s.length / 2)]
  if (s.length < 4) return m
  const near = s.filter((v) => v > m / 2 && v < m * 2)
  if (!near.length) return m
  return near[Math.floor(near.length / 2)]
}

function dimensionSamples(dims: AiDimension[], px: { w: number; h: number }): number[] {
  const values: number[] = []
  for (const d of dims) {
    const len = pxLen(d, px)
    // слишком короткая выноска даёт дикий масштаб
    if (len < 12) continue
    values.push(d.cm / len)
  }
  return values
}

/** Сколько сантиметров в пикселе по размерным цепочкам */
export function scaleFromDimensions(dims: AiDimension[], px: { w: number; h: number }): ScaleFit | null {
  const values = dimensionSamples(dims, px)
  if (values.length < 2) return null
  return { cmPerPx: robustMedian(values), source: 'размерные цепочки', samples: values.length }
}

/**
 * Масштаб по всем числам с плана разом: размерные цепочки и размеры комнат —
 * одни и те же подписи, прочитанные двумя способами. Вместе оценок больше,
 * и одна ошибка чтения тонет в медиане.
 */
export function scaleFromLabels(ai: AiPlan, px: { w: number; h: number }): ScaleFit | null {
  const dims = dimensionSamples(ai.dimensions, px)
  const rooms = scaleSamplesFromRooms(ai.rooms, px)
  const all = [...dims, ...rooms]
  if (all.length < 2) return null
  const source: ScaleSource = dims.length && rooms.length ? 'размеры на плане' : dims.length ? 'размерные цепочки' : 'размеры комнат'
  return { cmPerPx: robustMedian(all), source, samples: all.length }
}

/**
 * Поправка масштаба по подписанным площадям.
 * Комнаты строятся при текущем масштабе, их площадь сравнивается с подписанной,
 * и весь чертёж множится на квадратный корень отношения.
 */
export function scaleFromAreas(walls: Wall[], ai: AiPlan, u: Underlay, cmPerPx: number): ScaleFit | null {
  const labelled = ai.rooms.filter((r) => r.areaM2 && r.areaM2 > 0)
  if (!labelled.length) return null
  const probe: Plan = emptyPlan(walls)
  const { rooms } = buildRooms(probe)
  if (!rooms.length) return null
  let want = 0
  let have = 0
  let used = 0
  for (const r of labelled) {
    const p = toPlanPt(u, { x: r.x * u.px.w, y: r.y * u.px.h })
    const found = rooms.find((room) => pointInPoly(p, room.polygon))
    if (!found) continue
    // площадь комнаты уже считается по внутренним граням стен — так же, как её подписывают в БТИ
    const area = found.area
    if (area < 0.5) continue
    want += r.areaM2 as number
    have += area
    used++
  }
  if (!used || have <= 0) return null
  const k = Math.sqrt(want / have)
  // поправка больше чем вдвое означает, что распознано не то — не трогаем масштаб
  if (!Number.isFinite(k) || k < 0.5 || k > 2) return null
  return { cmPerPx: cmPerPx * k, source: 'площади комнат', samples: used }
}

const emptyPlan = (walls: Wall[]): Plan => ({
  version: 1,
  name: '',
  walls,
  openings: [],
  furniture: [],
  rooms: [],
  dims: [],
  settings: { grid: 10 },
})

// ---------- геометрия ----------
const toPlanPt = (u: Underlay, pxPt: Pt): Pt => ({ x: u.x + pxPt.x * u.scale, y: u.y + pxPt.y * u.scale })

/** Выровнять почти осевые отрезки строго по осям */
export function axisAlign(a: Pt, b: Pt, tolDeg: number): [Pt, Pt] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const tan = Math.tan((tolDeg * Math.PI) / 180)
  if (Math.abs(dy) <= Math.abs(dx) * tan) {
    const y = (a.y + b.y) / 2
    return [{ x: a.x, y }, { x: b.x, y }]
  }
  if (Math.abs(dx) <= Math.abs(dy) * tan) {
    const x = (a.x + b.x) / 2
    return [{ x, y: a.y }, { x, y: b.y }]
  }
  return [a, b]
}

/** Свести близкие концы стен в общие узлы, иначе комнаты не замкнутся */
export function weldEnds(walls: Wall[], tol: number): Wall[] {
  const nodes: Pt[] = []
  const snap = (p: Pt): Pt => {
    for (const n of nodes) if (dist(n, p) <= tol) return n
    const node = { ...p }
    nodes.push(node)
    return node
  }
  return walls.map((w) => ({ ...w, a: { ...snap(w.a) }, b: { ...snap(w.b) } }))
}

export const roundThickness = (cm: number): number =>
  WALL_THICKNESSES.reduce((best, t) => (Math.abs(t - cm) < Math.abs(best - cm) ? t : best), WALL_THICKNESSES[0])

/** Убрать дубли: две стены с теми же концами — это одна стена */
export function dedupeWalls(walls: Wall[], tol: number): Wall[] {
  const out: Wall[] = []
  for (const w of walls) {
    const same = out.some(
      (o) => (dist(o.a, w.a) <= tol && dist(o.b, w.b) <= tol) || (dist(o.a, w.b) <= tol && dist(o.b, w.a) <= tol),
    )
    if (!same) out.push(w)
  }
  return out
}

// ---------- сборка ----------
export interface ConvertResult {
  walls: Wall[]
  openings: Opening[]
  rooms: RoomMeta[]
  underlay: Underlay
  report: ConvertReport
}

/** сколько подписанных комнат попало внутрь замкнутых контуров */
function closedRooms(walls: Wall[], ai: AiPlan, u: Underlay): number {
  if (!walls.length || !ai.rooms.length) return 0
  const { rooms } = buildRooms(emptyPlan(walls))
  return ai.rooms.filter((r) => {
    const p = toPlanPt(u, { x: r.x * u.px.w, y: r.y * u.px.h })
    return rooms.some((room) => pointInPoly(p, room.polygon))
  }).length
}

/** Собрать чертёж из ответа модели */
export function convertAiPlan(ai: AiPlan, underlay: Underlay, options: ConvertOptions = {}): ConvertResult {
  const o = { ...DEFAULT_CONVERT, ...options }
  const px = underlay.px

  // 1. масштаб
  let fit: ScaleFit = { cmPerPx: underlay.scale, source: 'прежняя калибровка', samples: 0 }
  if (!o.keepScale) {
    const byLabels = scaleFromLabels(ai, px)
    if (byLabels) fit = byLabels
  }
  let u: Underlay = { ...underlay, scale: fit.cmPerPx }

  // 2. стены по линиям с картинки при выбранном масштабе
  let walls = buildWalls(ai, u, o)

  // 3. если чисел на плане не было, площади комнат уточняют масштаб
  if (!o.keepScale && fit.source === 'прежняя калибровка') {
    const byAreas = scaleFromAreas(walls, ai, u, u.scale)
    if (byAreas) {
      fit = byAreas
      u = { ...u, scale: fit.cmPerPx }
      walls = buildWalls(ai, u, o)
    }
  }

  // 4. чертёж заново по числам, если модель дала комнаты прямоугольниками;
  //    побеждает вариант, где замкнулось больше комнат, при равенстве — числа
  const rebuilt = ai.rooms.some(canRebuildFrom) ? reconstructFromRooms(ai.rooms, u) : null
  const closedByNumbers = rebuilt ? rebuilt.rooms.filter((r) => r.haveM2 !== undefined).length : 0
  const byNumbers = !!rebuilt && closedByNumbers > 0 && closedByNumbers >= closedRooms(walls, ai, u)
  const method: ConvertMethod = byNumbers ? 'по размерам комнат' : 'по линиям стен'
  if (byNumbers && rebuilt) walls = rebuilt.walls

  // 5. проёмы садятся на ближайшую стену; по числам — на нужную стену нужной комнаты
  const openings: Opening[] = []
  let dropped = 0
  for (const op of ai.openings) {
    let p: Pt | null = null
    if (byNumbers && rebuilt && op.room && op.side && op.at !== undefined) {
      const room = rebuilt.rooms.find((r) => r.name === op.room)
      if (room) p = pointOnSide(room.rect, op.side, op.at)
    }
    if (!p) p = toPlanPt(u, { x: op.x * px.w, y: op.y * px.h })
    const hit = nearestWall(walls, p)
    // проём дальше полуметра от любой стены — это ошибка распознавания
    if (!hit || hit.d > 50) {
      dropped++
      continue
    }
    const L = dist(hit.wall.a, hit.wall.b)
    const width = Math.min(op.widthCm, Math.max(30, L - 2))
    const half = width / 2 / L
    const t = Math.min(1 - half, Math.max(half, hit.t))
    if (L < width + 2) {
      dropped++
      continue
    }
    openings.push({ id: uid('o'), kind: op.kind, wallId: hit.wall.id, t, width, hinge: 'a', side: 1 })
  }

  // 6. названия комнат
  const metas: RoomMeta[] = []
  if (byNumbers && rebuilt) {
    for (const r of rebuilt.rooms) {
      if (r.haveM2 === undefined) continue
      metas.push({ id: uid('rm'), anchor: r.anchor, name: r.name, floor: floorFor(r.name, r.kind) })
    }
  } else {
    const probe = emptyPlan(walls)
    const { rooms: built } = buildRooms(probe)
    for (const r of ai.rooms) {
      const p = toPlanPt(u, { x: r.x * px.w, y: r.y * px.h })
      const room = built.find((b) => pointInPoly(p, b.polygon))
      if (!room) continue
      // на одну комнату одна подпись
      if (metas.some((m) => pointInPoly(m.anchor, room.polygon))) continue
      metas.push({ id: uid('rm'), anchor: p, name: r.name, floor: floorFor(r.name, r.kind) })
    }
  }

  return {
    walls,
    openings,
    rooms: metas,
    underlay: u,
    report: {
      scale: fit,
      method,
      walls: walls.length,
      openings: openings.length,
      openingsDropped: dropped,
      rooms: metas.length,
      areaFit: byNumbers && rebuilt ? rebuilt.areaFit : null,
      roomsSkipped: byNumbers && rebuilt ? [...rebuilt.skipped, ...rebuilt.rooms.filter((r) => r.haveM2 === undefined).map((r) => r.name)] : [],
      note: ai.note,
    },
  }
}

function buildWalls(ai: AiPlan, u: Underlay, o: Required<ConvertOptions>): Wall[] {
  const raw: Wall[] = []
  for (const w of ai.walls) {
    const a0 = toPlanPt(u, { x: w.x1 * u.px.w, y: w.y1 * u.px.h })
    const b0 = toPlanPt(u, { x: w.x2 * u.px.w, y: w.y2 * u.px.h })
    const [a, b] = axisAlign(a0, b0, o.axisTolDeg)
    if (dist(a, b) < MIN_WALL_LENGTH) continue
    raw.push({ id: uid('w'), a, b, thickness: roundThickness(w.thicknessCm) })
  }
  return dedupeWalls(weldEnds(raw, o.weldCm), o.weldCm)
}

function nearestWall(walls: Wall[], p: Pt): { wall: Wall; t: number; d: number } | null {
  let best: { wall: Wall; t: number; d: number } | null = null
  for (const w of walls) {
    const c = closestOnSeg(p, w.a, w.b)
    const d = dist(p, c.p)
    if (!best || d < best.d) best = { wall: w, t: c.t, d }
  }
  return best
}

/** Пол по названию комнаты (или её типу, если название — номер «5ж»): плитка в мокрых зонах, ламинат в жилых */
export function floorFor(name: string, kind?: string): RoomMeta['floor'] {
  const n = `${kind ?? ''} ${name}`.toLowerCase()
  if (/ванн|санузел|туалет|душ|уборн/.test(n)) return 'tile'
  if (/кухн/.test(n)) return 'tile'
  if (/лодж|балкон|тамбур/.test(n)) return 'concrete'
  if (/коридор|прихож|холл/.test(n)) return 'tile'
  if (/кладов|гардероб/.test(n)) return 'plain'
  if (/гостин|зал|комнат|спальн|кабинет|детск|жил/.test(n)) return 'laminate'
  return 'laminate'
}

/**
 * Положить распознанное в план, заменив прежний чертёж.
 *
 * Мебель не трогаем — кроме той, что после замены стен оказалась в пустоте:
 * предмет без комнаты висит посреди листа и только мешает. Всё, что попало
 * внутрь новых комнат, остаётся на месте.
 */
export function applyAiPlan(plan: Plan, result: ConvertResult): ApplyResult {
  const next: Plan = {
    ...plan,
    walls: result.walls,
    openings: result.openings,
    rooms: result.rooms,
    dims: [],
    underlay: result.underlay,
  }
  const { rooms } = buildRooms(next)
  if (!rooms.length) return { plan: next, furnitureDropped: 0 }
  const kept = plan.furniture.filter((f) => rooms.some((r) => pointInPoly({ x: f.x, y: f.y }, r.polygon)))
  return { plan: { ...next, furniture: kept }, furnitureDropped: plan.furniture.length - kept.length }
}
