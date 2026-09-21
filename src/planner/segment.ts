// Комнаты с картинки + подписи от модели.
//
// Геометрия берётся с растра: сегментация (raster.ts) даёт прямоугольники комнат
// по внутренним граням стен — точные по построению, общая стена одна на двоих.
// Модель со зрением к ней только подписи: имя, площадь, размеры. Какая подпись
// к какой области — по точке модели внутри области, а где точка промахнулась,
// по площадям: отношение подписанной площади к площади области в пикселях у
// верных пар одинаково (это квадрат масштаба), и такие пары находятся сами.
import type { AiRoom, AiSide } from './aicontract'
import type { RoomRegion } from './raster'
import { robustMedian } from './planai'

export interface RegionRooms {
  rooms: AiRoom[]
  /** подписи модели, которым нашлась область */
  matched: number
  /** подписи, которым области не нашлось — скорее всего, выдуманные комнаты */
  unmatched: string[]
  /** сантиметров в пикселе по совпавшим площадям; null — совпадений нет */
  cmPerPx: number | null
}

const inside = (r: RoomRegion, x: number, y: number) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2

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
  // 2. по площадям: у верных пар корень из (подпись / площадь области) — один и тот же масштаб
  const ratios: number[] = []
  regions.forEach((r, j) => {
    if (owner[j] < 0) return
    const a = ai[owner[j]]
    if (a.areaM2) ratios.push(Math.sqrt((a.areaM2 * 1e4) / r.areaPx))
  })
  let scale = ratios.length ? robustMedian(ratios) : null
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
      exact: true,
    }
  })
  // имена безымянных должны совпадать с теми, что записаны в соседях
  regions.forEach((r, j) => {
    if (owner[j] < 0) rooms[j].name = `Помещение ${j + 1}`
  })
  // Г-образная комната уступает угол соседу, который в него заходит
  regions.forEach((r, j) => {
    const names = (r.yieldsTo ?? []).map((i) => rooms[i].name)
    if (names.length) rooms[j].yieldsTo = names
  })
  return { rooms, matched: taken.size, unmatched: ai.filter((_, k) => !taken.has(k)).map((a) => a.name), cmPerPx: scale }
}
