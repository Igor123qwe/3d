import type { Pt } from './types'

export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k })
export const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y
export const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x
export const len = (a: Pt): number => Math.hypot(a.x, a.y)
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y)
export const norm = (a: Pt): Pt => {
  const l = len(a) || 1
  return { x: a.x / l, y: a.y / l }
}
/** нормаль «влево» от направления (в алгебраическом смысле) */
export const perp = (a: Pt): Pt => ({ x: -a.y, y: a.x })
export const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
export const mid = (a: Pt, b: Pt): Pt => lerp(a, b, 0.5)
export const eq = (a: Pt, b: Pt, eps = 0.01): boolean => Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
export const roundTo = (v: number, step: number): number => (step > 0 ? Math.round(v / step) * step : v)
export const snapPt = (p: Pt, step: number): Pt => ({ x: roundTo(p.x, step), y: roundTo(p.y, step) })
export const angleDeg = (a: Pt, b: Pt): number => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
export const normDeg = (d: number): number => ((d % 360) + 360) % 360
/** минимальная разница углов, 0..180 */
export const angleDiff = (a: number, b: number): number => {
  const d = Math.abs(normDeg(a) - normDeg(b))
  return d > 180 ? 360 - d : d
}
export const rotate = (p: Pt, deg: number): Pt => {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }
}

/** параметр проекции точки на прямую a-b (без ограничения 0..1) */
export function projectT(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  if (l2 === 0) return 0
  return dot(sub(p, a), ab) / l2
}

export function closestOnSeg(p: Pt, a: Pt, b: Pt): { t: number; p: Pt } {
  const t = clamp(projectT(p, a, b), 0, 1)
  return { t, p: lerp(a, b, t) }
}

export const pointSegDist = (p: Pt, a: Pt, b: Pt): number => dist(p, closestOnSeg(p, a, b).p)

/** пересечение прямых a-b и c-d в параметрах отрезков (t по a-b, u по c-d) */
export function segIntersect(a: Pt, b: Pt, c: Pt, d: Pt): { t: number; u: number; p: Pt } | null {
  const r = sub(b, a)
  const s = sub(d, c)
  const den = cross(r, s)
  if (Math.abs(den) < 1e-9) return null
  const qp = sub(c, a)
  const t = cross(qp, s) / den
  const u = cross(qp, r) / den
  return { t, u, p: add(a, mul(r, t)) }
}

/** пересечение прямых, заданных точкой и направлением */
export function lineIntersect(p1: Pt, d1: Pt, p2: Pt, d2: Pt): Pt | null {
  const den = cross(d1, d2)
  if (Math.abs(den) < 1e-9) return null
  const t = cross(sub(p2, p1), d2) / den
  return add(p1, mul(d1, t))
}

/** знаковая площадь многоугольника (см²) */
export function polyArea(poly: Pt[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    s += p.x * q.y - q.x * p.y
  }
  return s / 2
}

export function polyPerimeter(poly: Pt[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) s += dist(poly[i], poly[(i + 1) % poly.length])
  return s
}

export function polyCentroid(poly: Pt[]): Pt {
  const a = polyArea(poly)
  if (Math.abs(a) < 1e-6) {
    const n = poly.length || 1
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n }
  }
  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const f = p.x * q.y - q.x * p.y
    cx += (p.x + q.x) * f
    cy += (p.y + q.y) * f
  }
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    const intersects = a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    if (intersects) inside = !inside
  }
  return inside
}

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function bboxOf(points: Pt[]): BBox {
  const b: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const p of points) {
    if (p.x < b.minX) b.minX = p.x
    if (p.y < b.minY) b.minY = p.y
    if (p.x > b.maxX) b.maxX = p.x
    if (p.y > b.maxY) b.maxY = p.y
  }
  return b
}

/** углы повёрнутого прямоугольника: back-left, back-right, front-right, front-left */
export function obbCorners(cx: number, cy: number, w: number, d: number, rot: number): Pt[] {
  const hw = w / 2
  const hd = d / 2
  const c = { x: cx, y: cy }
  return [
    add(c, rotate({ x: -hw, y: -hd }, rot)),
    add(c, rotate({ x: hw, y: -hd }, rot)),
    add(c, rotate({ x: hw, y: hd }, rot)),
    add(c, rotate({ x: -hw, y: hd }, rot)),
  ]
}

/** прямоугольник в локальной системе объекта: смещение центра и размеры */
export function localRect(cx: number, cy: number, rot: number, ox: number, oy: number, w: number, d: number): Pt[] {
  const c = add({ x: cx, y: cy }, rotate({ x: ox, y: oy }, rot))
  return obbCorners(c.x, c.y, w, d, rot)
}

/** пересекаются ли два выпуклых многоугольника (SAT). tol > 0 — допускаем касание/зазор */
export function convexOverlap(A: Pt[], B: Pt[], tol = 0.5): boolean {
  const polys = [A, B]
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % poly.length]
      const axis = norm(perp(sub(q, p)))
      let minA = Infinity
      let maxA = -Infinity
      for (const v of A) {
        const d = dot(v, axis)
        minA = Math.min(minA, d)
        maxA = Math.max(maxA, d)
      }
      let minB = Infinity
      let maxB = -Infinity
      for (const v of B) {
        const d = dot(v, axis)
        minB = Math.min(minB, d)
        maxB = Math.max(maxB, d)
      }
      if (maxA - tol <= minB || maxB - tol <= minA) return false
    }
  }
  return true
}

/** удаляет «шипы» (A,B,A) и повторяющиеся точки контура */
export function removeSpikes(poly: Pt[], eps = 0.5): Pt[] {
  let pts = poly.slice()
  let changed = true
  while (changed && pts.length >= 3) {
    changed = false
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length]
      const next = pts[(i + 1) % pts.length]
      if (eq(prev, next, eps)) {
        // удаляем вершину i и одну из совпадающих соседних
        const j = (i + 1) % pts.length
        pts = pts.filter((_, k) => k !== i && k !== j)
        changed = true
        break
      }
      if (eq(pts[i], next, eps)) {
        pts = pts.filter((_, k) => k !== i)
        changed = true
        break
      }
    }
  }
  return pts
}

/**
 * Убрать вершины посреди прямой, в том числе возвраты назад по той же прямой.
 * Такие появляются во внутреннем контуре, когда стена примыкает к соседней у
 * самого угла комнаты — ближе, чем полтолщины той стены
 */
export function dropCollinear(poly: Pt[], eps = 1e-6): Pt[] {
  let pts = poly.slice()
  for (let changed = true; changed && pts.length > 3; ) {
    changed = false
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length]
      const b = pts[i]
      const c = pts[(i + 1) % pts.length]
      const ux = b.x - a.x
      const uy = b.y - a.y
      const vx = c.x - b.x
      const vy = c.y - b.y
      const lu = Math.hypot(ux, uy)
      const lv = Math.hypot(vx, vy)
      if (lu < 1e-9 || lv < 1e-9 || Math.abs(ux * vy - uy * vx) <= eps * lu * lv) {
        pts = pts.filter((_, k) => k !== i)
        changed = true
        break
      }
    }
  }
  return pts
}

/** внутренний параллельный контур: insets[i] — отступ ребра poly[i]→poly[i+1] */
export function offsetPolygon(poly: Pt[], insets: number[]): Pt[] {
  const n = poly.length
  if (n < 3) return poly
  const sign = polyArea(poly) > 0 ? 1 : -1
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n]
    const d = norm(sub(q, p))
    const nrm = mul(perp(d), sign)
    return { p: add(p, mul(nrm, insets[i] ?? 0)), d, nrm, inset: insets[i] ?? 0 }
  })
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n]
    const cur = lines[i]
    const x = lineIntersect(prev.p, prev.d, cur.p, cur.d)
    if (x && dist(x, poly[i]) < Math.max(prev.inset, cur.inset) * 6 + 5) out.push(x)
    else out.push(add(poly[i], mul(cur.nrm, cur.inset)))
  }
  return out
}

/**
 * Точка внутри многоугольника, по возможности удалённая от его сторон.
 * Кандидаты: центроид, сетка по габаритам и середины горизонтальных отрезков
 * внутри контура — последние гарантируют попадание внутрь даже в узких коленах,
 * где сетка промахивается.
 */
export function interiorPoint(poly: Pt[]): Pt {
  const centroid = polyCentroid(poly)
  if (poly.length < 3) return centroid
  const bb = bboxOf(poly)
  const candidates: Pt[] = []
  if (pointInPoly(centroid, poly)) candidates.push(centroid)

  const steps = 14
  for (let i = 1; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      const p = { x: bb.minX + ((bb.maxX - bb.minX) * i) / steps, y: bb.minY + ((bb.maxY - bb.minY) * j) / steps }
      if (pointInPoly(p, poly)) candidates.push(p)
    }
  }

  // развёртка по горизонталям между уровнями вершин
  const levels = [...new Set(poly.map((p) => p.y))].sort((a, b) => a - b)
  const ys = new Set<number>()
  for (let i = 0; i + 1 < levels.length; i++) ys.add((levels[i] + levels[i + 1]) / 2)
  for (let i = 0; i < poly.length; i++) ys.add((poly[i].y + poly[(i + 1) % poly.length].y) / 2)
  for (const y of ys) {
    const xs: number[] = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      if (a.y > y !== b.y > y) xs.push(a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y))
    }
    xs.sort((p, q) => p - q)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] < 0.01) continue
      candidates.push({ x: (xs[i] + xs[i + 1]) / 2, y })
    }
  }

  let best = candidates[0] ?? centroid
  let bestD = -1
  for (const p of candidates) {
    const d = minEdgeDist(p, poly)
    if (d > bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

export function minEdgeDist(p: Pt, poly: Pt[]): number {
  let m = Infinity
  for (let i = 0; i < poly.length; i++) m = Math.min(m, pointSegDist(p, poly[i], poly[(i + 1) % poly.length]))
  return m
}

export const fmtNum = (v: number, digits = 1): string =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: digits })

export function fmtLen(cm: number, unit: 'cm' | 'mm' | 'm'): string {
  if (unit === 'mm') return `${Math.round(cm * 10)} мм`
  if (unit === 'm') return `${fmtNum(cm / 100, 2)} м`
  return `${fmtNum(cm, 0)} см`
}

export const fmtArea = (m2: number): string => `${fmtNum(m2, 1)} м²`
