// Размерные линии, привязанные к стенам.
//
// Конец размера помнит стену и линию на ней: ось, грань или конец стены.
// После любой правки стен (сдвиг, растяжка, склейка кусков) конец переезжает
// следом: на ту же линию той же стены — поперёк неё, вдоль остаётся где был.
// Так размер «от стены до стены» всегда показывает текущее расстояние.
import type { DimRef, DimensionLine, Plan, Pt, Wall } from './types'
import { uid } from './types'
import { add, cross, dist, dot, mul, norm, perp, sub } from './geometry'

/** линия стены: ось (side 0) или грань (±1 по perp(b − a)) — точка на ней и направление */
function lineOf(w: Wall, side: -1 | 0 | 1): { o: Pt; d: Pt } {
  const d = norm(sub(w.b, w.a))
  return { o: add(w.a, mul(perp(d), (side * w.thickness) / 2)), d }
}

const project = (p: Pt, o: Pt, d: Pt): Pt => add(o, mul(d, dot(sub(p, o), d)))

/**
 * Куда на стенах попадает точка размера: конец стены, ось или грань —
 * ближайшее в пределах tol. Концы важнее: по ним меряют длину стены
 */
export function dimSnap(walls: Wall[], p: Pt, tol: number, ends = true): { p: Pt; ref: DimRef } | null {
  let end: { p: Pt; ref: DimRef } | null = null
  let endD = tol
  for (const w of ends ? walls : []) {
    for (const e of ['a', 'b'] as const) {
      const d = dist(p, w[e])
      if (d < endD) {
        endD = d
        end = { p: { ...w[e] }, ref: { wallId: w.id, side: 0, end: e } }
      }
    }
  }
  if (end) return end
  let best: { p: Pt; ref: DimRef } | null = null
  let bestD = tol
  for (const w of walls) {
    const L = dist(w.a, w.b)
    if (L < 1) continue
    const d = norm(sub(w.b, w.a))
    const n = perp(d)
    const t = dot(sub(p, w.a), d)
    if (t < -w.thickness / 2 || t > L + w.thickness / 2) continue
    const off = dot(sub(p, w.a), n)
    for (const side of [1, -1, 0] as const) {
      const e = Math.abs(off - (side * w.thickness) / 2)
      if (e < bestD) {
        bestD = e
        const l = lineOf(w, side)
        best = { p: project(p, l.o, l.d), ref: { wallId: w.id, side } }
      }
    }
  }
  return best
}

/**
 * Размер между двумя параллельными линиями стен меряют поперёк: второй
 * конец встаёт напротив первого. Иначе щелчки чуть вкось дают диагональ
 */
export function squareDim(walls: Wall[], a: Pt, aRef: DimRef | undefined, b: Pt, bRef: DimRef | undefined): Pt {
  if (!aRef || !bRef || aRef.end || bRef.end) return b
  const wa = walls.find((w) => w.id === aRef.wallId)
  const wb = walls.find((w) => w.id === bRef.wallId)
  if (!wa || !wb || wa === wb) return b
  const la = lineOf(wa, aRef.side)
  const lb = lineOf(wb, bRef.side)
  if (Math.abs(cross(la.d, lb.d)) > 0.02) return b
  return project(a, lb.o, lb.d)
}

/** новый размер: концы на стенах — с привязкой */
export function addDimRef(plan: Plan, a: Pt, b: Pt, offset: number, aRef?: DimRef, bRef?: DimRef): Plan {
  const d: DimensionLine = { id: uid('d'), a: { ...a }, b: { ...b }, offset }
  if (aRef) d.aRef = aRef
  if (bRef) d.bRef = bRef
  return { ...plan, dims: [...plan.dims, d] }
}

/**
 * Преемник стены, которой больше нет по id: склеенная из кусков или
 * разрезанная. Параллельная, недалеко от прежней линии и покрывает точку
 */
function successor(w0: Wall, ref: DimRef, p: Pt, walls: Wall[]): Wall | undefined {
  const d0 = norm(sub(w0.b, w0.a))
  let best: Wall | undefined
  let bestD = 40
  for (const w of walls) {
    const L = dist(w.a, w.b)
    if (L < 1) continue
    const d = norm(sub(w.b, w.a))
    if (Math.abs(cross(d, d0)) > 0.02) continue
    const t = dot(sub(p, w.a), d)
    if (t < -w.thickness || t > L + w.thickness) continue
    const s = dot(d, d0) < 0 ? -ref.side : ref.side
    const l = lineOf(w, s as -1 | 0 | 1)
    const e = dist(p, project(p, l.o, l.d))
    if (e < bestD) {
      bestD = e
      best = w
    }
  }
  return best
}

/** конец размера после правки стен; ref: undefined — стены больше нет, конец свободен */
function follow(p: Pt, ref: DimRef, before: Map<string, Wall>, after: Map<string, Wall>, walls: Wall[]): { p: Pt; ref?: DimRef } {
  const w0 = before.get(ref.wallId)
  let w1 = after.get(ref.wallId)
  if (w1 && w1 === w0) return { p, ref }
  if (ref.end) {
    if (w1) return { p: { ...w1[ref.end] }, ref }
    // конец стены пропал (куски склеились): остался на оси той же прямой
    for (const w of walls) for (const e of ['a', 'b'] as const) if (dist(w[e], p) < 1) return { p: { ...w[e] }, ref: { wallId: w.id, side: 0, end: e } }
    const heir = w0 ? successor(w0, { ...ref, side: 0 }, p, walls) : undefined
    if (!heir) return { p }
    const l = lineOf(heir, 0)
    return { p: project(p, l.o, l.d), ref: { wallId: heir.id, side: 0 } }
  }
  if (!w1) w1 = w0 ? successor(w0, ref, p, walls) : undefined
  if (!w1) return { p }
  // та же грань, даже если стену развернули: сторона — относительно прежнего направления
  const side = (w0 && dot(norm(sub(w0.b, w0.a)), norm(sub(w1.b, w1.a))) < 0 ? -ref.side : ref.side) as -1 | 0 | 1
  const l = lineOf(w1, side)
  return { p: project(p, l.o, l.d), ref: { wallId: w1.id, side } }
}

/**
 * Размеры следуют за стенами: вызывается на каждую правку плана (store).
 * Стены не менялись — план как есть
 */
export function followDims(prev: Plan, next: Plan): Plan {
  if (prev.walls === next.walls || !next.dims.some((d) => d.aRef || d.bRef)) return next
  const before = new Map(prev.walls.map((w) => [w.id, w]))
  const after = new Map(next.walls.map((w) => [w.id, w]))
  let changed = false
  const dims = next.dims.map((d) => {
    if (!d.aRef && !d.bRef) return d
    const a = d.aRef ? follow(d.a, d.aRef, before, after, next.walls) : { p: d.a }
    const b = d.bRef ? follow(d.b, d.bRef, before, after, next.walls) : { p: d.b }
    if (a.p === d.a && b.p === d.b && a.ref === d.aRef && b.ref === d.bRef) return d
    changed = true
    const out: DimensionLine = { id: d.id, a: a.p, b: b.p, offset: d.offset }
    if (a.ref) out.aRef = a.ref
    if (b.ref) out.bRef = b.ref
    return out
  })
  return changed ? { ...next, dims } : next
}

/**
 * Размеры комнаты в чистоте на план: ширина и глубина между внутренними
 * гранями, по четверти комнаты от угла — чтобы не спорить с её подписью
 */
export function roomDims(plan: Plan, inner: Pt[]): Plan {
  if (inner.length < 3) return plan
  const xs = inner.map((p) => p.x)
  const ys = inner.map((p) => p.y)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const tol = 3
  let out = plan
  // линии на пятой части комнаты от угла: подальше от имени и площади в центре
  const pairs: [Pt, Pt][] = [
    [
      { x: x0, y: y0 + (y1 - y0) * 0.2 },
      { x: x1, y: y0 + (y1 - y0) * 0.2 },
    ],
    [
      { x: x0 + (x1 - x0) * 0.2, y: y0 },
      { x: x0 + (x1 - x0) * 0.2, y: y1 },
    ],
  ]
  for (const [a, b] of pairs) {
    // здесь нужна грань, а не конец стены рядом с углом
    const ra = dimSnap(plan.walls, a, tol, false)
    const rb = dimSnap(plan.walls, b, tol, false)
    if (!ra || !rb) continue
    const pb = squareDim(plan.walls, ra.p, ra.ref, rb.p, rb.ref)
    // повторное нажатие не плодит дубли: такой размер уже есть
    const same = (u: Pt, v: Pt) => Math.abs(u.x - v.x) < 2 && Math.abs(u.y - v.y) < 2
    if (out.dims.some((d) => (same(d.a, ra.p) && same(d.b, pb)) || (same(d.a, pb) && same(d.b, ra.p)))) continue
    out = addDimRef(out, ra.p, pb, 0, ra.ref, rb.ref)
  }
  return out
}
