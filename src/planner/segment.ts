// Комнаты с картинки + подписи от модели.
//
// Геометрия берётся с растра: сегментация (raster.ts) даёт контуры комнат по
// внутренним граням стен — многоугольники с прямыми углами, обведённые по
// пикселям; стены из них собирает picture.ts.
// Модель со зрением к ней только подписи: имя, площадь, размеры. Какая подпись
// к какой области — по точке модели внутри области, а где точка промахнулась,
// по площадям: отношение подписанной площади к площади области в пикселях у
// верных пар одинаково (это квадрат масштаба), и такие пары находятся сами.
import type { AiRoom, AiSide } from './aicontract'
import type { RoomRegion } from './raster'
import type { Pt } from './types'
import { pointInPoly } from './geometry'

/** подпись, которая не сходится с картинкой: скорее всего, модель прочитала её неверно */
export interface LabelDispute {
  room: string
  field: 'area' | 'width' | 'depth'
  /** что прочитала модель: м² для площади, см для размеров */
  label: number
  /** что выходит по картинке при общем масштабе, в тех же единицах */
  picture: number
}

export interface RegionRooms {
  rooms: AiRoom[]
  /** подписи модели, которым нашлась область */
  matched: number
  /** подписи, которым области не нашлось — скорее всего, выдуманные комнаты */
  unmatched: string[]
  /** сантиметров в пикселе по согласию подписей; null — согласия нет */
  cmPerPx: number | null
  /** подписи, по которым посчитан масштаб: «5ж 13.9 м²», «4ж ширина 401» */
  scaleLabels: string[]
  /** подписи, расходящиеся с картинкой больше чем на десятую часть */
  disputes: LabelDispute[]
}

/** одна оценка масштаба по одной подписи */
interface ScaleSample {
  s: number
  room: string
  field: LabelDispute['field']
  label: number
  /** величина на картинке: пиксели для размера, квадратные пиксели для площади */
  px: number
}

/**
 * Масштаб по согласию подписей. Каждая подпись — площадь, ширина, глубина —
 * даёт свою оценку сантиметров в пикселе. Верные подписи дают одно и то же
 * число, неверно прочитанная — случайное. Берём оценку, с которой согласны
 * больше всего других (в пределах 7 %), и медиану этих согласных. Так одна
 * «3.84» вместо «0.82» не уводит масштаб, а сама оказывается спорной.
 */
export function consensusScale(samples: ScaleSample[]): { s: number; inliers: ScaleSample[] } | null {
  if (!samples.length) return null
  let best: { inliers: ScaleSample[]; spread: number } | null = null
  for (const c of samples) {
    const inliers = samples.filter((x) => Math.abs(x.s / c.s - 1) <= 0.07)
    const spread = inliers.reduce((a, x) => a + Math.abs(x.s / c.s - 1), 0)
    if (!best || inliers.length > best.inliers.length || (inliers.length === best.inliers.length && spread < best.spread)) best = { inliers, spread }
  }
  // одно случайное совпадение — не согласие: при двух подписях и больше нужно хотя бы две согласных
  if (!best || (samples.length >= 2 && best.inliers.length < 2)) return null
  const vals = best.inliers.map((x) => x.s).sort((a, b) => a - b)
  return { s: vals[Math.floor(vals.length / 2)], inliers: best.inliers }
}

/** точка внутри области: по контуру, если он есть, иначе по рамке */
const inside = (r: RoomRegion, x: number, y: number) => (r.poly ? pointInPoly({ x, y }, r.poly) : x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2)

/** контур области, пиксели: обведённый по картинке или её рамка */
export const regionPoly = (r: RoomRegion): Pt[] =>
  r.poly ?? [
    { x: r.x1, y: r.y1 },
    { x: r.x2, y: r.y1 },
    { x: r.x2, y: r.y2 },
    { x: r.x1, y: r.y2 },
  ]

/**
 * Соседство областей: две комнаты соседи по стороне, если их рамки, растянутые
 * на толщину стены, пересекаются, и одна лежит с нужной стороны от другой
 */
export function regionNeighbors(regions: RoomRegion[], wallPx: number): { neighbors: Partial<Record<AiSide, number[]>>; outer: AiSide[] }[] {
  const overlap = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1))
  return regions.map((r, i) => {
    const nb: Partial<Record<AiSide, number[]>> = {}
    regions.forEach((s, j) => {
      if (i === j) return
      const spanY = overlap(r.y1, r.y2, s.y1, s.y2)
      const spanX = overlap(r.x1, r.x2, s.x1, s.x2)
      const minH = Math.min(r.y2 - r.y1, s.y2 - s.y1)
      const minW = Math.min(r.x2 - r.x1, s.x2 - s.x1)
      if (spanY > minH * 0.3) {
        if (Math.abs(s.x1 - r.x2) <= wallPx) (nb.right ??= []).push(j)
        if (Math.abs(r.x1 - s.x2) <= wallPx) (nb.left ??= []).push(j)
      }
      if (spanX > minW * 0.3) {
        if (Math.abs(s.y1 - r.y2) <= wallPx) (nb.bottom ??= []).push(j)
        if (Math.abs(r.y1 - s.y2) <= wallPx) (nb.top ??= []).push(j)
      }
    })
    const outer = (['top', 'right', 'bottom', 'left'] as AiSide[]).filter((side) => !nb[side]?.length)
    return { neighbors: nb, outer }
  })
}

/**
 * Собрать комнаты из областей и подписей модели.
 * wallPx — типичная толщина стены в пикселях (для поиска соседей).
 */
export function roomsFromRegions(regions: RoomRegion[], px: { w: number; h: number }, ai: AiRoom[], wallPx: number): RegionRooms {
  const owner = new Array<number>(regions.length).fill(-1)
  const taken = new Set<number>()
  // 1. по точке модели внутри области
  ai.forEach((a, k) => {
    const x = a.x * px.w
    const y = a.y * px.h
    const j = regions.findIndex((r, idx) => owner[idx] < 0 && inside(r, x, y))
    if (j >= 0) {
      owner[j] = k
      taken.add(k)
    }
  })
  // 2. масштаб по согласию всех подписей легших комнат: площади, ширины, глубины
  const samplesOf = (): ScaleSample[] => {
    const out: ScaleSample[] = []
    regions.forEach((r, j) => {
      if (owner[j] < 0) return
      const a = ai[owner[j]]
      const bw = r.x2 - r.x1
      const bh = r.y2 - r.y1
      if (a.areaM2 && r.areaPx > 0) out.push({ s: Math.sqrt((a.areaM2 * 1e4) / r.areaPx), room: a.name, field: 'area', label: a.areaM2, px: r.areaPx })
      // размеры у стен сверяются только у прямоугольной комнаты: у Г-образной
      // подпись стоит у одной из ступенек, и какой — по рамке не понять
      if (r.poly && r.poly.length > 4) return
      if (a.widthCm && bw > 8) out.push({ s: a.widthCm / bw, room: a.name, field: 'width', label: a.widthCm, px: bw })
      if (a.depthCm && bh > 8) out.push({ s: a.depthCm / bh, room: a.name, field: 'depth', label: a.depthCm, px: bh })
    })
    return out
  }
  let consensus = consensusScale(samplesOf())
  let scale: number | null = consensus ? consensus.s : null
  if (scale === null) {
    // точек не хватило — ищем масштаб, при котором совпадает больше всего пар
    const cands: number[] = []
    for (const a of ai) for (const r of regions) if (a.areaM2) cands.push(Math.sqrt((a.areaM2 * 1e4) / r.areaPx))
    let best: { s: number; n: number } | null = null
    for (const s of cands) {
      let n = 0
      for (const a of ai) {
        if (!a.areaM2) continue
        if (regions.some((r) => Math.abs(r.areaPx * s * s - a.areaM2! * 1e4) / (a.areaM2! * 1e4) < 0.12)) n++
      }
      if (!best || n > best.n) best = { s, n }
    }
    // одно случайное совпадение площадей — не доказательство; нужно хотя бы два,
    // а при единственной подписи — она сама
    const labelled = ai.filter((a) => a.areaM2).length
    if (best && best.n >= (labelled >= 2 ? 2 : 1)) scale = best.s
  }
  if (scale !== null) {
    // оставшиеся подписи — к областям с ближайшей площадью, если расхождение в пределах 15 %
    const free = ai.map((a, k) => k).filter((k) => !taken.has(k) && ai[k].areaM2)
    for (const k of free) {
      const want = ai[k].areaM2! * 1e4
      let bestJ = -1
      let bestErr = 0.15
      regions.forEach((r, j) => {
        if (owner[j] >= 0) return
        const err = Math.abs(r.areaPx * scale! * scale! - want) / want
        if (err < bestErr) {
          bestErr = err
          bestJ = j
        }
      })
      if (bestJ >= 0) {
        owner[bestJ] = k
        taken.add(k)
      }
    }
  }
  // Одно имя на двух областях — на фрагменте модель прочитала чужую подпись
  // (у Г-образной комнаты в рамку попадает соседка). Имя остаётся там, где
  // сходится подписанная площадь, у остальных подпись снимается
  const byName = new Map<string, number[]>()
  regions.forEach((_, j) => {
    if (owner[j] < 0) return
    const n = ai[owner[j]].name
    byName.set(n, [...(byName.get(n) ?? []), j])
  })
  for (const js of byName.values()) {
    if (js.length < 2) continue
    const err = (j: number) => {
      const want = ai[owner[j]].areaM2
      return want && scale !== null ? Math.abs(regions[j].areaPx * scale * scale - want * 1e4) / (want * 1e4) : Infinity
    }
    const keep = js.reduce((best, j) => (err(j) < err(best) ? j : best), js[0])
    for (const j of js) {
      if (j === keep) continue
      taken.delete(owner[j])
      owner[j] = -1
    }
  }
  // после дораспределения подписей по площадям масштаб пересчитывается по всем легшим
  if (scale !== null) {
    const again = consensusScale(samplesOf())
    if (again) {
      consensus = again
      scale = again.s
    }
  }
  // подписи, расходящиеся с картинкой при общем масштабе больше чем на десятую
  // часть, — скорее всего, прочитаны неверно; геометрию они не трогают, но их
  // стоит перечитать
  const disputes: LabelDispute[] = []
  if (scale !== null) {
    for (const x of samplesOf()) {
      if (Math.abs(x.s / scale - 1) <= 0.1) continue
      const picture = x.field === 'area' ? (x.px * scale * scale) / 1e4 : x.px * scale
      disputes.push({ room: x.room, field: x.field, label: x.label, picture: Math.round(picture * (x.field === 'area' ? 10 : 1)) / (x.field === 'area' ? 10 : 1) })
    }
  }
  const scaleLabels = (consensus?.inliers ?? []).map((x) => (x.field === 'area' ? `${x.room} ${x.label} м²` : `${x.room} ${x.field === 'width' ? 'ширина' : 'глубина'} ${x.label}`))

  // 3. комнаты: геометрия с области, подписи — от модели, соседство — с областей
  const adj = regionNeighbors(regions, wallPx)
  let unnamed = 0
  const rooms: AiRoom[] = regions.map((r, j) => {
    const a = owner[j] >= 0 ? ai[owner[j]] : null
    const name = a?.name ?? `Помещение ${++unnamed}`
    const neighbors: Partial<Record<AiSide, string[]>> = {}
    for (const side of ['top', 'right', 'bottom', 'left'] as AiSide[]) {
      const ids = adj[j].neighbors[side]
      if (ids?.length) neighbors[side] = ids.map((i) => (owner[i] >= 0 ? ai[owner[i]].name : `Помещение ${i + 1}`))
    }
    return {
      name,
      kind: a?.kind,
      areaM2: a?.areaM2,
      widthCm: a?.widthCm,
      depthCm: a?.depthCm,
      x: r.cx / px.w,
      y: r.cy / px.h,
      box: { x1: r.x1 / px.w, y1: r.y1 / px.h, x2: r.x2 / px.w, y2: r.y2 / px.h },
      neighbors,
      outer: adj[j].outer,
    }
  })
  // имена безымянных должны совпадать с теми, что записаны в соседях
  regions.forEach((r, j) => {
    if (owner[j] < 0) rooms[j].name = `Помещение ${j + 1}`
  })
  return { rooms, matched: taken.size, unmatched: ai.filter((_, k) => !taken.has(k)).map((a) => a.name), cmPerPx: scale, scaleLabels, disputes }
}
