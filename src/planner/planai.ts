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
import type { AiBox, AiDimension, AiPlan, AiRoom } from './aicontract'
import type { Opening, Plan, Pt, RoomMeta, Underlay, Wall } from './types'
import { uid } from './types'
import { MIN_WALL_LENGTH, WALL_THICKNESSES } from './ops'
import { buildRooms } from './rooms'
import { bboxOf, closestOnSeg, dist, lerp, norm, pointInPoly, sub } from './geometry'
import { canRebuildFrom, DEFAULT_RECONSTRUCT, pointOnSide, reconstructFromRooms, scaleSamplesFromRooms, type AreaFit } from './reconstruct'
import { detectOpenings, pointOnOutline, wallsFromPicture } from './picture'
import { fitToLabels, type SizeFix } from './fitlabels'
import { evenWalls } from './rectify'
import type { RoomRegion } from './raster'
import { regionPoly, roomsFromRegions, type LabelDispute } from './segment'
import { assessQuality, type QualityReport, type RasterInfo } from './quality'

export interface ConvertOptions {
  /** не трогать масштаб: пользователь уже откалибровал подложку руками */
  keepScale?: boolean
  /**
   * Привязка рамки комнаты к стенам на картинке (заливка по очищенному растру):
   * возвращает уточнённую рамку в долях картинки или null, если стен вокруг не нашлось.
   * closeCm — на сколько сантиметров закрывать дверные проёмы
   */
  ground?: (box: AiBox, closeCm: number) => AiBox | null
  /**
   * Комнаты, найденные сегментацией картинки (пиксели). Если их две и больше,
   * геометрия берётся с них, а от модели — только подписи и проёмы
   */
  regions?: RoomRegion[]
  /** карта расстояний до чернил очищенной картинки: по ней чертёж проверяется на совпадение со стенами */
  raster?: RasterInfo | null
  /** допуск сведения концов стен, см */
  weldCm?: number
  /** до скольких градусов отклонения стена считается осевой */
  axisTolDeg?: number
}

/** настройки со значениями по умолчанию; привязка к картинке — необязательная */
type ConvertSettings = Required<Omit<ConvertOptions, 'ground' | 'regions' | 'raster'>> & Pick<ConvertOptions, 'ground' | 'regions' | 'raster'>

export const DEFAULT_CONVERT: ConvertSettings = { keepScale: false, weldCm: 12, axisTolDeg: 6 }

export type ScaleSource = 'размерные цепочки' | 'размеры комнат' | 'размеры на плане' | 'площади комнат' | 'прежняя калибровка'

export interface ScaleFit {
  /** сантиметров в пикселе картинки */
  cmPerPx: number
  source: ScaleSource
  /** по скольким подписям посчитано */
  samples: number
  /** сами подписи, по которым посчитано: чтобы было видно, чему верить и что проверить */
  labels?: string[]
}

export type ConvertMethod = 'по комнатам с картинки' | 'по размерам комнат' | 'по линиям стен'

export interface ConvertReport {
  scale: ScaleFit
  /** как построен чертёж: заново по числам или по стенам с картинки */
  method: ConvertMethod
  walls: number
  openings: number
  /** проёмы, которым не нашлось стены */
  openingsDropped: number
  /** проёмы, найденные по самой картинке (остальные — от модели) */
  openingsFromPicture: number
  rooms: number
  /** сверка площадей с подписанными, когда чертёж построен по числам */
  areaFit: AreaFit | null
  /** комнаты, которые не удалось поставить по числам */
  roomsSkipped: string[]
  /** комнаты, выброшенные как выдуманные: без них площади остальных сошлись */
  roomsDropped: string[]
  /** сколько рамок комнат привязано к стенам на картинке */
  grounded: number
  /** комнаты, без которых площади сошлись бы лучше, но картинка их подтверждает — оставлены и помечены */
  roomsDoubtful: string[]
  /** сегментация: сколько комнат найдено на картинке и скольким подписям модели нашлось место */
  segmented: { regions: number; matched: number; unmatched: string[] } | null
  /** проверка по картинке и числам: полнота, стены, формы, размеры, проёмы */
  quality: QualityReport
  /** ширина и глубина комнат, подогнанные под подписи: чертёж на бумаге не точно в масштабе */
  sizesFitted: SizeFix[]
  /** где лёг чертёж относительно картинки: для разбора, если он лёг мимо */
  placement: { walls: { minX: number; minY: number; maxX: number; maxY: number } | null; underlay: { minX: number; minY: number; maxX: number; maxY: number }; shifted: boolean }
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
export function scaleFromLabels(ai: AiPlan, px: { w: number; h: number }, minSamples = 2): ScaleFit | null {
  const dims = dimensionSamples(ai.dimensions, px)
  const rooms = scaleSamplesFromRooms(ai.rooms, px)
  const all = [...dims, ...rooms]
  if (all.length < minSamples) return null
  const source: ScaleSource = dims.length && rooms.length ? 'размеры на плане' : dims.length ? 'размерные цепочки' : 'размеры комнат'
  const labels = [
    ...ai.dimensions.filter((d) => pxLen(d, px) >= 12).map((d) => `${d.cm} см`),
    ...ai.rooms.filter((r) => r.box && (r.widthCm || r.depthCm || r.areaM2)).map((r) => (r.widthCm || r.depthCm ? `${r.name} ${r.widthCm ?? '?'}×${r.depthCm ?? '?'}` : `${r.name} ${r.areaM2} м²`)),
  ]
  return { cmPerPx: robustMedian(all), source, samples: all.length, labels }
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

/**
 * Толщины стен для чертежа по числам: если модель назвала толщины стен с
 * картинки, наружные и перегородки берутся по медианам, иначе — типовые 40 и 10.
 * От этого зависит, сойдётся ли сумма комнат с размерной цепочкой по осям.
 */
export function wallThicknesses(ai: AiPlan): { exteriorCm?: number; interiorCm?: number } {
  const thick = ai.walls.filter((w) => w.thicknessCm >= 20).map((w) => w.thicknessCm)
  const thin = ai.walls.filter((w) => w.thicknessCm < 20).map((w) => w.thicknessCm)
  const out: { exteriorCm?: number; interiorCm?: number } = {}
  if (thick.length >= 2) out.exteriorCm = roundThickness(robustMedian(thick))
  if (thin.length >= 2) out.interiorCm = roundThickness(robustMedian(thin))
  return out
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

  // 1. масштаб — по числам с плана
  let fit: ScaleFit = { cmPerPx: underlay.scale, source: 'прежняя калибровка', samples: 0 }
  if (!o.keepScale) {
    const byLabels = scaleFromLabels(ai, px)
    if (byLabels) fit = byLabels
  }
  let u: Underlay = { ...underlay, scale: fit.cmPerPx }

  // 1а. комнаты с картинки: сегментация нашла области — геометрия берётся с них,
  //     от модели остаются подписи (по точке или по площади) и проёмы
  let grounded = 0
  let segmented: ConvertReport['segmented'] = null
  let rooms = ai.rooms
  let bySegments = false
  let disputes: LabelDispute[] = []
  const regions = o.regions ?? []
  if (regions.length >= 2) {
    // толщина стены между соседними областями — в пикселях картинки; масштаб здесь
    // ещё ненадёжен, поэтому допуск задаётся долей картинки, а не сантиметрами
    const wallPx = Math.max(8, 0.05 * Math.min(px.w, px.h))
    const seg = roomsFromRegions(regions, px, ai.rooms, wallPx)
    const labelled = ai.rooms.filter((r) => r.areaM2).length
    // областям верим, если подписи легли хотя бы наполовину (или подписей нет вовсе)
    if (!labelled || seg.matched >= Math.ceil(labelled / 2)) {
      rooms = seg.rooms
      bySegments = true
      segmented = { regions: regions.length, matched: seg.matched, unmatched: seg.unmatched }
      disputes = seg.disputes
      if (!o.keepScale && seg.cmPerPx) {
        fit = { cmPerPx: seg.cmPerPx, source: 'площади комнат', samples: seg.scaleLabels.length, labels: seg.scaleLabels }
        u = { ...underlay, scale: fit.cmPerPx }
      }
    }
  }

  // 1б. иначе — рамки комнат от модели привязываются к настоящим стенам на картинке,
  //     где заливка нашла комнату похожего размера. Радиус закрытия дверных проёмов
  //     берётся по предварительному масштабу
  const groundedNames = new Set<string>()
  if (!bySegments) {
    rooms = ai.rooms.map((r) => {
      if (!r.box || !o.ground) return r
      const g = o.ground(r.box, 45)
      if (!g) return r
      const areaM2 = (g.x2 - g.x1) * px.w * (g.y2 - g.y1) * px.h * u.scale * u.scale * 1e-4
      // подписанная площадь есть — заливка не должна расходиться с ней больше чем вдвое
      if (r.areaM2 && (areaM2 < r.areaM2 * 0.55 || areaM2 > r.areaM2 * 1.8)) return r
      grounded++
      groundedNames.add(r.name)
      return { ...r, box: g }
    })
    // привязанные рамки — настоящая геометрия: масштаб по ним точнее, чем по рамкам модели
    if (!o.keepScale && grounded) {
      // рамка со стен картинки надёжна и в одиночку: одной оценки достаточно
      const byGrounded = scaleFromLabels({ ...ai, rooms: rooms.filter((r) => groundedNames.has(r.name)) }, px, 1)
      if (byGrounded) {
        fit = byGrounded
        u = { ...underlay, scale: fit.cmPerPx }
      }
    }
  }

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
  const dimSpans = ai.dimensions.map((d) => ({ a: toPlanPt(u, { x: d.x1 * px.w, y: d.y1 * px.h }), b: toPlanPt(u, { x: d.x2 * px.w, y: d.y2 * px.h }), cm: d.cm }))
  // Выбросить комнату ради сходимости площадей можно только с подтверждением
  // картинки: области с картинки — все настоящие; рамка модели, под которой
  // заливка не нашла замкнутой области, — под подозрением. Без картинки не
  // выбрасывается ничего: спорное остаётся и помечается
  const canDrop = (r: AiRoom): boolean => !bySegments && !!o.ground && !groundedNames.has(r.name)
  // Комнаты сняты с картинки — стены встают по их контурам, подписи их не
  // двигают. Иначе чертёж собирается по числам из рамок модели
  const thick = { ...DEFAULT_RECONSTRUCT, ...wallThicknesses(ai) }
  const raster = o.raster && o.raster.w === px.w && o.raster.h === px.h ? o.raster.d2 : null
  const rebuilt = bySegments
    ? wallsFromPicture(
        regions.map((r, j) => ({ name: rooms[j].name, kind: rooms[j].kind, poly: regionPoly(r), wantM2: rooms[j].areaM2 })),
        u,
        raster,
        { interiorCm: thick.interiorCm, exteriorCm: thick.exteriorCm },
      )
    : rooms.some(canRebuildFrom)
      ? reconstructFromRooms(rooms, u, wallThicknesses(ai), dimSpans, canDrop)
      : null
  const closedByNumbers = rebuilt ? rebuilt.rooms.filter((r) => r.haveM2 !== undefined).length : 0
  const byNumbers = !!rebuilt && closedByNumbers > 0 && closedByNumbers >= closedRooms(walls, ai, u)
  const method: ConvertMethod = byNumbers ? (bySegments ? 'по комнатам с картинки' : 'по размерам комнат') : 'по линиям стен'
  if (byNumbers && rebuilt) walls = rebuilt.walls

  // 6. чертёж должен лежать на картинке: центр стен внутри подложки. Если он лёг
  //    мимо — это ошибка координат, и лучше сдвинуть чертёж на картинку и сказать
  //    об этом, чем оставить его в стороне
  const uRect = { minX: u.x, minY: u.y, maxX: u.x + px.w * u.scale, maxY: u.y + px.h * u.scale }
  const pts = walls.flatMap((w) => [w.a, w.b])
  const wBox = pts.length ? bboxOf(pts) : null
  let shifted = false
  if (wBox) {
    const cx = (wBox.minX + wBox.maxX) / 2
    const cy = (wBox.minY + wBox.maxY) / 2
    if (cx < uRect.minX || cx > uRect.maxX || cy < uRect.minY || cy > uRect.maxY) {
      const dx = (uRect.minX + uRect.maxX) / 2 - cx
      const dy = (uRect.minY + uRect.maxY) / 2 - cy
      walls = walls.map((w) => ({ ...w, a: { x: w.a.x + dx, y: w.a.y + dy }, b: { x: w.b.x + dx, y: w.b.y + dy } }))
      if (byNumbers && rebuilt) {
        for (const r of rebuilt.rooms) {
          r.anchor = { x: r.anchor.x + dx, y: r.anchor.y + dy }
          r.rect = { x1: r.rect.x1 + dx, y1: r.rect.y1 + dy, x2: r.rect.x2 + dx, y2: r.rect.y2 + dy }
        }
      }
      shifted = true
    }
  }

  // 5. проёмы. Сначала — найденные по самой картинке (дверь — разрыв или
  //    участок между поперечными чертами в стене между комнатами, окно —
  //    линии стекла в наружной стене): они точнее модели и по месту, и по
  //    ширине. От модели — только то, чего картинка не показала
  const openings: Opening[] = []
  let dropped = 0
  const place = (kind: Opening['kind'], hit: { wall: Wall; t: number; d: number } | null, widthCm: number): 'placed' | 'twin' | 'dropped' => {
    // проём дальше полуметра от любой стены — это ошибка распознавания
    if (!hit || hit.d > 50) return 'dropped'
    const L = dist(hit.wall.a, hit.wall.b)
    const width = Math.min(widthCm, Math.max(30, L - 2))
    const half = width / 2 / L
    const t = Math.min(1 - half, Math.max(half, hit.t))
    if (L < width + 2) return 'dropped'
    // тот же проём, названный соседней комнатой или уже найденный по картинке
    const here = lerp(hit.wall.a, hit.wall.b, t)
    const along = norm(sub(hit.wall.b, hit.wall.a))
    const twin = openings.some((o) => {
      const w2 = walls.find((x) => x.id === o.wallId)
      if (!w2 || (o.kind === 'window') !== (kind === 'window')) return false
      const d2 = norm(sub(w2.b, w2.a))
      if (Math.abs(along.x * d2.y - along.y * d2.x) > 0.1) return false
      return dist(here, lerp(w2.a, w2.b, o.t)) < (o.width + width) / 2
    })
    if (twin) return 'twin'
    openings.push({ id: uid('o'), kind, wallId: hit.wall.id, t, width, hinge: 'a', side: 1 })
    return 'placed'
  }
  const pictureOpenings = bySegments && raster ? detectOpenings(regions.map(regionPoly), raster, px.w, px.h, u.scale) : []
  const pictureDoors = new Set<string>()
  const pictureWindows = new Set<string>()
  let fromPicture = 0
  for (const d of pictureOpenings) {
    const mid = d.vertical ? { x: d.axis, y: (d.from + d.to) / 2 } : { x: (d.from + d.to) / 2, y: d.axis }
    // только стены того же направления: у угла ближайшей может оказаться поперечная
    const parallel = walls.filter((w) => (d.vertical ? Math.abs(w.a.x - w.b.x) < 1 : Math.abs(w.a.y - w.b.y) < 1))
    if (place(d.kind, nearestWall(parallel, toPlanPt(u, mid)), (d.to - d.from) * u.scale) !== 'placed') continue
    fromPicture++
    for (const k of d.rooms) {
      if (d.kind === 'window') pictureWindows.add(`${rooms[k].name}|${d.side}`)
      else pictureDoors.add(rooms[k].name)
    }
  }
  // прихожая и коридор — единственные, где дверь в наружной стене (входная)
  // обычна; у жилой комнаты «дверь» в наружной стене модель чаще выдумывает
  const hallway = (name: string) => /прих|корид|холл|тамбур/i.test(`${name} ${rooms.find((r) => r.name === name)?.kind ?? ''}`)
  let fromModel = 0
  for (const op of ai.openings) {
    // Картинка уже показала двери этой комнаты или окна в этой её стене —
    // модели верим только во входной двери прихожей: её картинка не ищет
    if (op.room && (op.kind === 'window' ? pictureWindows.has(`${op.room}|${op.side}`) : pictureDoors.has(op.room) && !hallway(op.room))) continue
    // Два кандидата: точка на стороне комнаты (точнее, когда чертёж собран по
    // числам) и точка с картинки. У Г-образной комнаты сторона может проходить
    // через вырез, где стены нет, — тогда выручает точка модели. Берём того
    // кандидата, у кого стена ближе
    const options: Pt[] = []
    if (byNumbers && rebuilt && op.room && op.side && op.at !== undefined) {
      const room = rebuilt.rooms.find((r) => r.name === op.room)
      if (room) options.push(room.outline ? pointOnOutline(room.outline, op.side, op.at) : pointOnSide(room.rect, op.side, op.at))
    }
    options.push(toPlanPt(u, { x: op.x * px.w, y: op.y * px.h }))
    let hit: { wall: Wall; t: number; d: number } | null = null
    for (const p of options) {
      const h = nearestWall(walls, p)
      if (h && (!hit || h.d < hit.d)) hit = h
    }
    // Точка ушла в вырез Г-образной комнаты: там стены нет вовсе. Ищем стену на
    // той же стороне этой комнаты — она и есть та, в которой проём
    if ((!hit || hit.d > 50) && byNumbers && rebuilt && op.room && op.side) {
      const room = rebuilt.rooms.find((r) => r.name === op.room)
      if (room) {
        const side = op.side
        const vertical = side === 'left' || side === 'right'
        const at = side === 'left' ? room.rect.x1 : side === 'right' ? room.rect.x2 : side === 'top' ? room.rect.y1 : room.rect.y2
        let best: { wall: Wall; t: number; d: number } | null = null
        for (const w of walls) {
          const onAxis = vertical ? Math.abs(w.a.x - w.b.x) < 1 && Math.abs(w.a.x - at) < 30 : Math.abs(w.a.y - w.b.y) < 1 && Math.abs(w.a.y - at) < 30
          if (!onAxis) continue
          // стена должна идти вдоль стороны комнаты, а не мимо неё
          const lo = vertical ? Math.max(room.rect.y1, Math.min(w.a.y, w.b.y)) : Math.max(room.rect.x1, Math.min(w.a.x, w.b.x))
          const hi = vertical ? Math.min(room.rect.y2, Math.max(w.a.y, w.b.y)) : Math.min(room.rect.x2, Math.max(w.a.x, w.b.x))
          if (hi - lo < op.widthCm) continue
          const mid = vertical ? { x: w.a.x, y: (lo + hi) / 2 } : { x: (lo + hi) / 2, y: w.a.y }
          const c = closestOnSeg(mid, w.a, w.b)
          const d = dist(mid, c.p)
          if (!best || hi - lo > 0) best = { wall: w, t: c.t, d }
        }
        if (best) hit = best
      }
    }
    const res = place(op.kind, hit, op.widthCm)
    if (res === 'dropped') dropped++
    else if (res === 'placed') fromModel++
  }

  // 6а. названия комнат
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

  // 7. проверка по картинке и числам: полнота, стены, формы, размеры, проёмы
  const lost = new Map<string, string>()
  if (segmented) for (const n of segmented.unmatched) lost.set(n, 'на картинке не нашлось такой области')
  if (byNumbers && rebuilt) {
    for (const n of rebuilt.skipped) lost.set(n, 'не удалось поставить: без рамки или уже полуметра')
    for (const n of rebuilt.dropped) lost.set(n, 'на картинке под рамкой нет комнаты, а без неё площади соседей сошлись')
    for (const r of rebuilt.rooms) if (r.haveM2 === undefined) lost.set(r.name, 'контур не замкнулся')
  }
  const quality = assessQuality({
    ai,
    u,
    walls,
    openings,
    metas,
    regions: bySegments ? regions : undefined,
    raster: o.raster,
    dims: dimSpans,
    areas: byNumbers && rebuilt ? rebuilt.areaFit : null,
    lost,
    doubtful: byNumbers && rebuilt ? rebuilt.doubtful : [],
    disputes,
    openingsExpected: fromPicture + fromModel + dropped,
  })

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
      openingsFromPicture: fromPicture,
      rooms: metas.length,
      areaFit: byNumbers && rebuilt ? rebuilt.areaFit : null,
      roomsSkipped: byNumbers && rebuilt ? [...rebuilt.skipped, ...rebuilt.rooms.filter((r) => r.haveM2 === undefined).map((r) => r.name)] : [],
      roomsDropped: byNumbers && rebuilt ? rebuilt.dropped : [],
      roomsDoubtful: byNumbers && rebuilt ? rebuilt.doubtful : [],
      grounded,
      segmented,
      quality,
      sizesFitted: [],
      placement: { walls: wBox ? bboxOf(walls.flatMap((w) => [w.a, w.b])) : null, underlay: uRect, shifted },
      note: shifted ? `${ai.note ? `${ai.note} ` : ''}Чертёж лёг мимо картинки и был сдвинут на неё — координаты в ответе модели подозрительны, пришлите отчёт разработчику.` : ai.note,
    },
  }
}

function buildWalls(ai: AiPlan, u: Underlay, o: ConvertSettings): Wall[] {
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
 * Размеры по подписям — последним шагом, после выпрямления снимка. Форма
 * комнат — с картинки, а подпись — обмер: грани стен сдвигаются так, чтобы
 * ширина, глубина и размеры вдоль стен сошлись с числами плана. Подпись,
 * что расходится с картинкой больше 6 % (ошибка чтения, размер части
 * Г-образной комнаты), стены не двигает. Проёмы держатся за стены долей
 * длины и едут вместе с ними
 */
export function fitResultToLabels(res: ConvertResult, labels: AiRoom[]): ConvertResult {
  if (res.report.method !== 'по комнатам с картинки') return res
  const { rooms: built } = buildRooms(emptyPlan(res.walls))
  const labelled = res.rooms.flatMap((m) => {
    const label = labels.find((r) => r.name === m.name)
    const room = built.find((b) => pointInPoly(m.anchor, b.polygon))
    if (!label || !room) return []
    return [{ name: m.name, axes: room.polygon, inner: room.inner, widthCm: label.widthCm, depthCm: label.depthCm, walls: label.walls }]
  })
  const fitted = fitToLabels(res.walls, labelled)
  if (!fitted.fixes.length) return res
  const rooms = res.rooms.map((m) => ({ ...m, anchor: fitted.map(m.anchor) }))
  // подгонка не должна ломать чертёж: каждая комната по-прежнему замкнута
  const { rooms: after } = buildRooms(emptyPlan(fitted.walls))
  if (after.length < built.length || rooms.some((m) => !after.some((b) => pointInPoly(m.anchor, b.polygon)))) return res
  // Подгонка могла свести внутренние грани соседних кусков стены в одну —
  // тогда и вся стена одна. Размеры по подписям не трогаем: сводятся только
  // куски, чьи грани у комнат уже совпали до сантиметра
  const walls = evenWalls(fitted.walls, { faceTol: 1, innerTol: 1, shift: 0 })
  const ids = new Set(walls.map((w) => w.id))
  return { ...res, walls, openings: res.openings.filter((o) => ids.has(o.wallId)), rooms, report: { ...res.report, sizesFitted: fitted.fixes } }
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
