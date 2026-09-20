// Привязки: точки стен (сетка, концы, оси, Т-примыкания), мебель (к стенам и друг к другу), проёмы.
import type { Furniture, Plan, Pt, Wall } from './types'
import { CATALOG_MAP } from './catalog'
import {
  add,
  angleDiff,
  bboxOf,
  closestOnSeg,
  dist,
  dot,
  eq,
  len,
  lineIntersect,
  mul,
  norm,
  normDeg,
  obbCorners,
  perp,
  pointSegDist,
  projectT,
  roundTo,
  sub,
} from './geometry'

export interface Guide {
  a: Pt
  b: Pt
}

export interface PointSnap {
  p: Pt
  guides: Guide[]
  kind: 'endpoint' | 'wall' | 'align' | 'grid' | 'free'
}

export interface WallSnapOpts {
  grid: number
  /** допуск в мировых единицах (см) */
  tol: number
  ortho: boolean
  last?: Pt | null
  /** исключить концы стен (например, перетаскиваемый узел) */
  exclude?: (p: Pt) => boolean
}

export function wallEndpoints(walls: Wall[]): Pt[] {
  const out: Pt[] = []
  for (const w of walls) out.push(w.a, w.b)
  return out
}

export function snapWallPoint(raw: Pt, walls: Wall[], o: WallSnapOpts): PointSnap {
  const guides: Guide[] = []
  const endpoints = wallEndpoints(walls).filter((p) => !o.exclude?.(p))

  // 1. концы существующих стен
  let best: Pt | null = null
  let bestD = o.tol
  for (const e of endpoints) {
    const d = dist(raw, e)
    if (d < bestD) {
      bestD = d
      best = e
    }
  }
  if (best) return { p: { ...best }, guides, kind: 'endpoint' }

  let p: Pt = { ...raw }
  let lockX = false
  let lockY = false
  let kind: PointSnap['kind'] = 'free'

  // 2. орто-режим: 0/45/90° от предыдущей точки
  if (o.last && o.ortho) {
    const d = sub(raw, o.last)
    const L = len(d)
    if (L > 0.01) {
      const ang = Math.atan2(d.y, d.x)
      const step = Math.PI / 4
      const snapped = Math.round(ang / step) * step
      const dir = { x: Math.cos(snapped), y: Math.sin(snapped) }
      const isH = Math.abs(dir.y) < 1e-6
      const isV = Math.abs(dir.x) < 1e-6
      if (isH) {
        p = { x: raw.x, y: o.last.y }
        lockY = true
      } else if (isV) {
        p = { x: o.last.x, y: raw.y }
        lockX = true
      } else {
        // диагональ: только шаг сетки по длине
        const Ls = Math.max(o.grid, roundTo(L, o.grid))
        p = add(o.last, mul(dir, Ls))
        return { p, guides, kind: 'grid' }
      }
    }
  }

  // 3. примыкание к существующей стене (Т-стык)
  for (const w of walls) {
    if (o.exclude && (o.exclude(w.a) || o.exclude(w.b))) continue
    const wl = dist(w.a, w.b)
    if (wl < 1) continue
    const dir = norm(sub(w.b, w.a))
    if (lockX || lockY) {
      const axis = lockY ? { x: 1, y: 0 } : { x: 0, y: 1 }
      const x = lineIntersect(p, axis, w.a, dir)
      if (!x) continue
      const t = projectT(x, w.a, w.b)
      if (t < -0.02 || t > 1.02) continue
      if (dist(x, p) < o.tol) {
        p = x
        lockX = true
        lockY = true
        kind = 'wall'
        break
      }
    } else if (pointSegDist(p, w.a, w.b) < o.tol) {
      const c = closestOnSeg(p, w.a, w.b).p
      const isH = Math.abs(dir.y) < 1e-6
      const isV = Math.abs(dir.x) < 1e-6
      if (isH) {
        p = { x: p.x, y: c.y }
        lockY = true
      } else if (isV) {
        p = { x: c.x, y: p.y }
        lockX = true
      } else {
        p = c
        lockX = true
        lockY = true
      }
      kind = 'wall'
      break
    }
  }

  // 4. выравнивание по осям с концами стен
  if (!lockX) {
    let bx: Pt | null = null
    let bd = o.tol
    for (const e of endpoints) {
      const d = Math.abs(e.x - p.x)
      if (d < bd) {
        bd = d
        bx = e
      }
    }
    if (bx) {
      p = { x: bx.x, y: p.y }
      guides.push({ a: bx, b: { x: bx.x, y: p.y } })
      lockX = true
      kind = 'align'
    }
  }
  if (!lockY) {
    let by: Pt | null = null
    let bd = o.tol
    for (const e of endpoints) {
      const d = Math.abs(e.y - p.y)
      if (d < bd) {
        bd = d
        by = e
      }
    }
    if (by) {
      p = { x: p.x, y: by.y }
      guides.push({ a: by, b: { x: p.x, y: by.y } })
      lockY = true
      kind = 'align'
    }
  }

  // 5. сетка
  if (!lockX) p = { x: roundTo(p.x, o.grid), y: p.y }
  if (!lockY) p = { x: p.x, y: roundTo(p.y, o.grid) }
  if (kind === 'free') kind = 'grid'
  return { p, guides, kind }
}

export interface FurnitureSnap {
  x: number
  y: number
  rot: number
  guides: Guide[]
  wallId?: string
}

export interface FurnSnapOpts {
  grid: number
  tol: number
  /** id объекта, который двигаем (исключается из выравнивания) */
  selfId?: string
}

/** Магнит мебели к граням стен и выравнивание по другим объектам */
export function snapFurniture(item: Furniture, rawCenter: Pt, plan: Plan, o: FurnSnapOpts): FurnitureSnap {
  const cat = CATALOG_MAP[item.type]
  const guides: Guide[] = []
  const halfExt = [item.d / 2, item.w / 2, item.d / 2, item.w / 2] // back, right, front, left
  let best: { gap: number; x: number; y: number; rot: number; wallId: string } | null = null

  // потолочные символы (светильники) к стенам не магнитятся
  const wallCandidates = cat?.symbol && !cat.wallSnap ? [] : plan.walls
  for (const w of wallCandidates) {
    const L = dist(w.a, w.b)
    if (L < 1) continue
    const dir = norm(sub(w.b, w.a))
    const n = perp(dir)
    for (const s of [1, -1] as const) {
      const nrm = mul(n, s)
      const facePt = add(w.a, mul(nrm, w.thickness / 2))
      const along = dot(sub(rawCenter, facePt), dir)
      if (along < -Math.max(item.w, item.d) / 2 || along > L + Math.max(item.w, item.d) / 2) continue
      const sdist = dot(sub(rawCenter, facePt), nrm)
      if (sdist <= 0) continue
      const rots = [
        Math.atan2(-nrm.x, nrm.y),
        Math.atan2(-nrm.y, -nrm.x),
        Math.atan2(nrm.x, -nrm.y),
        Math.atan2(nrm.y, nrm.x),
      ].map((r) => (r * 180) / Math.PI)
      for (let k = 0; k < 4; k++) {
        // символы (розетки, выключатели) — только спинкой к стене, под любым углом;
        // мебель с wallSnap — спинкой в широком диапазоне, остальными гранями — если почти параллельна
        let maxAng = 22
        if (k === 0 && cat?.symbol) maxAng = 181
        else if (k === 0 && cat?.wallSnap) maxAng = 100
        else if (cat?.symbol) continue
        if (angleDiff(item.rot, rots[k]) > maxAng) continue
        const gap = sdist - halfExt[k]
        if (Math.abs(gap) > o.tol) continue
        if (best && Math.abs(gap) >= Math.abs(best.gap)) continue
        const foot = add(facePt, mul(dir, along))
        const c = add(foot, mul(nrm, halfExt[k]))
        best = { gap, x: c.x, y: c.y, rot: normDeg(Math.round(rots[k] * 100) / 100), wallId: w.id }
      }
    }
  }
  if (best) {
    return { x: best.x, y: best.y, rot: best.rot, guides, wallId: best.wallId }
  }

  // выравнивание по другим объектам
  let x = rawCenter.x
  let y = rawCenter.y
  const my = bboxOf(obbCorners(x, y, item.w, item.d, item.rot))
  const myCx = x
  const myCy = y
  let snapX: { delta: number; v: number; other: ReturnType<typeof bboxOf> } | null = null
  let snapY: { delta: number; v: number; other: ReturnType<typeof bboxOf> } | null = null
  for (const f of plan.furniture) {
    if (f.id === o.selfId) continue
    const c = CATALOG_MAP[f.type]
    if (c?.symbol) continue
    const ob = bboxOf(obbCorners(f.x, f.y, f.w, f.d, f.rot))
    const candX: [number, number][] = [
      [myCx, f.x],
      [my.minX, ob.minX],
      [my.maxX, ob.maxX],
      [my.minX, ob.maxX],
      [my.maxX, ob.minX],
    ]
    for (const [a, b] of candX) {
      const d = b - a
      if (Math.abs(d) < o.tol && (!snapX || Math.abs(d) < Math.abs(snapX.delta))) snapX = { delta: d, v: b, other: ob }
    }
    const candY: [number, number][] = [
      [myCy, f.y],
      [my.minY, ob.minY],
      [my.maxY, ob.maxY],
      [my.minY, ob.maxY],
      [my.maxY, ob.minY],
    ]
    for (const [a, b] of candY) {
      const d = b - a
      if (Math.abs(d) < o.tol && (!snapY || Math.abs(d) < Math.abs(snapY.delta))) snapY = { delta: d, v: b, other: ob }
    }
  }
  if (snapX) {
    x += snapX.delta
    guides.push({
      a: { x: snapX.v, y: Math.min(my.minY, snapX.other.minY) - 10 },
      b: { x: snapX.v, y: Math.max(my.maxY, snapX.other.maxY) + 10 },
    })
  } else x = roundTo(x, o.grid)
  if (snapY) {
    y += snapY.delta
    guides.push({
      a: { x: Math.min(my.minX, snapY.other.minX) - 10, y: snapY.v },
      b: { x: Math.max(my.maxX, snapY.other.maxX) + 10, y: snapY.v },
    })
  } else y = roundTo(y, o.grid)
  return { x, y, rot: item.rot, guides }
}

export interface OpeningSnap {
  wallId: string
  t: number
  center: Pt
}

/** Ближайшая стена для проёма и его положение вдоль неё */
export function snapOpening(raw: Pt, plan: Plan, width: number, tol: number): OpeningSnap | null {
  let best: OpeningSnap | null = null
  let bestD = Infinity
  for (const w of plan.walls) {
    const L = dist(w.a, w.b)
    if (L < width + 2) continue
    const d = pointSegDist(raw, w.a, w.b)
    if (d > w.thickness / 2 + tol || d >= bestD) continue
    const hw = width / 2
    let pos = projectT(raw, w.a, w.b) * L
    pos = roundTo(pos, 5)
    if (Math.abs(pos - L / 2) < tol) pos = L / 2
    pos = Math.min(L - hw, Math.max(hw, pos))
    const t = pos / L
    const dir = norm(sub(w.b, w.a))
    bestD = d
    best = { wallId: w.id, t, center: add(w.a, mul(dir, pos)) }
  }
  return best
}

/** Все стены, у которых есть конец в точке p */
export const wallsAtNode = (walls: Wall[], p: Pt): Wall[] => walls.filter((w) => eq(w.a, p, 0.75) || eq(w.b, p, 0.75))
