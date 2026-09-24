// Размеры по подписям. Чертёж БТИ нарисован не точно в масштабе, да и снимок
// добавляет своё: если поделить подпись на размер комнаты в точках, у каждой
// комнаты свой масштаб (на плане пользователя — от 1,75 до 1,83 см в точке).
// Один масштаб на весь лист даёт одним комнатам +12 см, другим −7. Подпись —
// обмер, картинка — эскиз: грани стен сдвигаются так, чтобы ширина, глубина
// и размеры вдоль стен сошлись с числами, а форма осталась с картинки.
import type { Pt, Wall } from './types'
import { polyArea } from './geometry'

/** требование к оси: расстояние между двумя осями стен должно стать want */
export interface AxisSpan {
  lo: number
  hi: number
  want: number
  /** вес требования: подпись — 1, удержание размера с картинки — меньше */
  weight?: number
}

/**
 * Растянуть ось как резинку. Узлы — координаты граней и осей стен вдоль оси;
 * отрезок между соседними узлами меняет длину тем охотнее, чем он длиннее:
 * цена изменения на d сантиметров — d²/длина. Так поправка ложится на
 * комнату, а не на толщину стены между комнатами. Требования мягкие: если
 * подписи противоречат друг другу (чертёж неточен), выходит лучший компромисс.
 *
 * Пределы: отрезок не выворачивается (короче нуля не бывает — ступенька в
 * 12 см между верхом двух комнат, которой нет на плане, может сойтись в
 * ноль), а стена (walls — её грани) не становится тоньше половины
 * нарисованной. Возвращает отображение координаты; средняя точка узлов
 * остаётся на месте.
 */
export function fitAxis(knotsIn: number[], spans: AxisSpan[], walls: { lo: number; hi: number }[] = []): (x: number) => number {
  const knots = clusterKnots(knotsIn)
  const n = knots.length - 1
  const same = (x: number) => x
  if (n < 1 || !spans.length) return same
  const len = knots.slice(1).map((k, i) => k - knots[i])
  // конец требования — ближайший узел: грани соседних стен разной толщины
  // слиты в один узел, и допуск «±1 см» мог бы отрезать от требования полстены
  const nearest = (x: number) => knots.reduce((best, k, i) => (Math.abs(k - x) < Math.abs(knots[best] - x) ? i : best), 0)
  const cover = (lo: number, hi: number) => {
    const idx: number[] = []
    for (let k = nearest(lo); k < nearest(hi); k++) idx.push(k)
    return idx
  }
  const rows = spans.map((s) => ({ idx: cover(s.lo, s.hi), r: s.want - (s.hi - s.lo), g: s.weight ?? 1 })).filter((row) => row.idx.length)
  if (!rows.length) return same
  const bands = walls
    .map((w) => {
      const idx = cover(w.lo, w.hi)
      const now = idx.reduce((s, i) => s + len[i], 0)
      return { idx, now, min: Math.min(now, Math.max(4, 0.5 * (w.hi - w.lo))) }
    })
    .filter((b) => b.idx.length)
  // (W + γAᵀA) d = γAᵀr, W = diag(1/длина). Нарушенный предел становится
  // жёстким требованием (отрезок — ровно ноль, стена — ровно половина), и
  // решаем заново
  const gamma = 10
  const hard = 1e6
  const flat = new Set<number>()
  const thin = new Set<number>()
  let d: number[] | null = null
  for (let round = 0; round < 12; round++) {
    const M = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 / Math.max(1, len[i]) : 0)))
    const rhs = new Array<number>(n).fill(0)
    const add = (idx: number[], r: number, g: number) => {
      for (const i of idx) {
        rhs[i] += g * r
        for (const j of idx) M[i][j] += g
      }
    }
    for (const { idx, r, g } of rows) add(idx, r, gamma * g)
    for (const i of flat) add([i], -len[i], hard)
    for (const b of thin) add(bands[b].idx, bands[b].min - bands[b].now, hard)
    d = solve(M, rhs)
    if (!d) return same
    const x = d
    const newFlat = x.map((v, i) => (len[i] + v < -0.01 && !flat.has(i) ? i : -1)).filter((i) => i >= 0)
    const newThin = bands.map((b, k) => (!thin.has(k) && b.idx.reduce((s, i) => s + len[i] + x[i], 0) < b.min - 0.01 ? k : -1)).filter((k) => k >= 0)
    if (!newFlat.length && !newThin.length) break
    for (const i of newFlat) flat.add(i)
    for (const k of newThin) thin.add(k)
  }
  if (!d || d.some((v, i) => len[i] + v < -0.05)) return same
  const moved = [knots[0]]
  for (let k = 0; k < n; k++) moved.push(moved[k] + Math.max(0, len[k] + d[k]))
  const shift = knots.reduce((s, x) => s + x, 0) / knots.length - moved.reduce((s, x) => s + x, 0) / moved.length
  for (let k = 0; k <= n; k++) moved[k] += shift
  return (x: number) => {
    if (x <= knots[0]) return x + (moved[0] - knots[0])
    if (x >= knots[n]) return x + (moved[n] - knots[n])
    let k = 0
    while (k < n - 1 && x > knots[k + 1]) k++
    const t = len[k] > 0 ? (x - knots[k]) / len[k] : 0
    return moved[k] + t * (moved[k + 1] - moved[k])
  }
}

/** узлы ближе сантиметра — один узел */
function clusterKnots(xs: number[]): number[] {
  const s = [...xs].sort((a, b) => a - b)
  const out: number[] = []
  for (const x of s) if (!out.length || x - out[out.length - 1] > 1) out.push(x)
  return out
}

/**
 * То же отображение, но оси стен идут точно в середину своих подогнанных
 * граней. Соосные стены (ближе полусантиметра) — одна ось.
 */
function withAxes(f: (x: number) => number, knotsIn: number[], axes: { at: number; t: number }[]): (x: number) => number {
  const sorted = [...axes].sort((p, q) => p.at - q.at)
  const groups: { at: number; to: number; n: number }[] = []
  for (const { at, t } of sorted) {
    const to = (f(at - t / 2) + f(at + t / 2)) / 2
    const g = groups[groups.length - 1]
    if (g && at - g.at / g.n <= 0.5) {
      g.at += at
      g.to += to
      g.n++
    } else groups.push({ at, to, n: 1 })
  }
  const fixed = groups.map((g) => ({ x: g.at / g.n, y: g.to / g.n }))
  const pts = [...fixed, ...clusterKnots(knotsIn).filter((k) => !fixed.some((a) => Math.abs(a.x - k) <= 0.5)).map((x) => ({ x, y: f(x) }))].sort((p, q) => p.x - q.x)
  if (pts.length < 2) return f
  const last = pts.length - 1
  return (x: number) => {
    if (x <= pts[0].x) return x + (pts[0].y - pts[0].x)
    if (x >= pts[last].x) return x + (pts[last].y - pts[last].x)
    let k = 0
    while (k < last - 1 && x > pts[k + 1].x) k++
    const dx = pts[k + 1].x - pts[k].x
    const t = dx > 0 ? (x - pts[k].x) / dx : 0
    return pts[k].y + t * (pts[k + 1].y - pts[k].y)
  }
}

/** Гаусс с выбором главного элемента; null — система вырождена */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

/** размер, подписанный вдоль стены комнаты: у какой стены, где вдоль неё (0..1), сколько */
export interface WallLabel {
  side: 'top' | 'right' | 'bottom' | 'left'
  at: number
  cm: number
}

/** подписанная комната: контур по осям и по граням стен, подписи ширины, глубины и вдоль стен */
export interface LabelledRoom {
  name: string
  axes: Pt[]
  inner: Pt[]
  widthCm?: number
  depthCm?: number
  walls?: WallLabel[]
}

export interface SizeFix {
  name: string
  axis: 'width' | 'depth' | 'wall'
  fromCm: number
  toCm: number
}

const bbox = (pts: Pt[]) => ({
  x1: Math.min(...pts.map((p) => p.x)),
  y1: Math.min(...pts.map((p) => p.y)),
  x2: Math.max(...pts.map((p) => p.x)),
  y2: Math.max(...pts.map((p) => p.y)),
})

/**
 * Грани контура, которые могут нести подпись: на нужной стороне (наружу
 * смотрит вверх для top и т. д.) и похожие по длине на подписанное число.
 * Счёт — насколько далеко от места подписи и насколько другая длина: меньше —
 * лучше
 */
function edgeCandidates(inner: Pt[], label: WallLabel, relaxed = false): { lo: number; hi: number; score: number; index: number }[] {
  const b = bbox(inner)
  const horizontal = label.side === 'top' || label.side === 'bottom'
  // обход контура по часовой (y вниз): верхняя грань идёт вправо, нижняя — влево
  let area = 0
  for (let i = 0; i < inner.length; i++) {
    const p = inner[i]
    const q = inner[(i + 1) % inner.length]
    area += p.x * q.y - q.x * p.y
  }
  const cw = area > 0
  const out: { lo: number; hi: number; score: number; index: number }[] = []
  for (let i = 0; i < inner.length; i++) {
    const p = inner[i]
    const q = inner[(i + 1) % inner.length]
    const isH = Math.abs(p.y - q.y) < 0.5 && Math.abs(p.x - q.x) >= 1
    const isV = Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) >= 1
    if (horizontal ? !isH : !isV) continue
    const dir = horizontal ? Math.sign(q.x - p.x) : Math.sign(q.y - p.y)
    // по часовой: вправо — верх, влево — низ, вниз — правая, вверх — левая
    const side = horizontal ? (dir > 0 === cw ? 'top' : 'bottom') : dir > 0 === cw ? 'right' : 'left'
    if (side !== label.side) continue
    const lo = horizontal ? Math.min(p.x, q.x) : Math.min(p.y, q.y)
    const hi = horizontal ? Math.max(p.x, q.x) : Math.max(p.y, q.y)
    const len = hi - lo
    const mid = ((lo + hi) / 2 - (horizontal ? b.x1 : b.y1)) / Math.max(1, horizontal ? b.x2 - b.x1 : b.y2 - b.y1)
    // Грань неверной длины — чужая подпись или ошибка распознавания: не
    // тянуть. Но если подпись стоит точно у этой грани, а длина разошлась до
    // 20 %, — это ступенька, распознанная не на месте (низ ниши 1,29 вышел
    // на 20 см выше: ниша 109, стена под ней 269 вместо 242)
    const tol = relaxed && Math.abs(mid - label.at) <= 0.08 ? Math.max(20, 0.2 * label.cm) : Math.max(8, 0.1 * label.cm)
    if (Math.abs(len - label.cm) > tol) continue
    out.push({ lo, hi, index: i, score: Math.abs(mid - label.at) + Math.abs(len - label.cm) / Math.max(30, label.cm) })
  }
  return out
}

/**
 * Подогнать стены под подписи. Узлы резинки — грани стен, а не оси: толщина
 * стены — тоже отрезок, и если подписи требуют («4,08 = 2,58 + стена + 1,37»),
 * стена становится тоньше, чем её нарисовали на снимке. Подпись, что
 * расходится с картинкой больше чем на 6 % (подпись вдоль стены — на 15 %),
 * не трогается: это ошибка чтения или размер части Г-образной комнаты.
 * Возвращает новые стены, отображение точек (для подписей комнат) и что
 * поменялось.
 */
export function fitToLabels(walls: Wall[], rooms: LabelledRoom[]): { walls: Wall[]; map: (p: Pt) => Pt; fixes: SizeFix[] } {
  const xs: AxisSpan[] = []
  const ys: AxisSpan[] = []
  const fixes: SizeFix[] = []
  // где мерить подпись вдоль стены после подгонки
  const edges = new Map<SizeFix, { lo: number; hi: number; alongX: boolean }>()
  const fits = (have: number, want: number) => Math.abs(have - want) <= Math.max(12, 0.06 * want)
  for (const r of rooms) {
    if (r.inner.length < 3) continue
    const f = bbox(r.inner)
    const haveW = f.x2 - f.x1
    const haveD = f.y2 - f.y1
    // Г-образная комната (прихожая с коридором) рамкой накрывает соседей:
    // держать её рамку — значит перекладывать поправку соседей в коридор
    const boxy = Math.abs(polyArea(r.inner)) >= 0.85 * haveW * haveD
    // и уже сошедшийся размер держим: иначе его растянут соседи. Комната без
    // годной подписи держит свой размер с картинки, но слабее подписи
    if (r.widthCm && fits(haveW, r.widthCm)) {
      xs.push({ lo: f.x1, hi: f.x2, want: r.widthCm })
      fixes.push({ name: r.name, axis: 'width', fromCm: Math.round(haveW), toCm: r.widthCm })
    } else if (boxy) xs.push({ lo: f.x1, hi: f.x2, want: haveW, weight: 0.2 })
    if (r.depthCm && fits(haveD, r.depthCm)) {
      ys.push({ lo: f.y1, hi: f.y2, want: r.depthCm })
      fixes.push({ name: r.name, axis: 'depth', fromCm: Math.round(haveD), toCm: r.depthCm })
    } else if (boxy) ys.push({ lo: f.y1, hi: f.y2, want: haveD, weight: 0.2 })
    // Одна грань — одна подпись, и сначала самые уверенные пары: подпись 0,64
    // выступа не должна забрать грань закутка, которой ближе подпись 0,73
    const pairs = (r.walls ?? []).flatMap((label, k) => edgeCandidates(r.inner, label).map((e) => ({ ...e, k, label })))
    pairs.sort((p, q) => p.score - q.score)
    const usedEdge = new Set<number>()
    const usedLabel = new Set<number>()
    // вторым заходом — подписи, что стоят точно у своей грани, но разошлись с ней по длине
    const loose = (r.walls ?? []).flatMap((label, k) => edgeCandidates(r.inner, label, true).map((e) => ({ ...e, k, label, score: e.score + 1 })))
    loose.sort((p, q) => p.score - q.score)
    for (const e of [...pairs, ...loose]) {
      if (usedEdge.has(e.index) || usedLabel.has(e.k)) continue
      usedEdge.add(e.index)
      usedLabel.add(e.k)
      const label = e.label
      const alongX = label.side === 'top' || label.side === 'bottom'
      ;(alongX ? xs : ys).push({ lo: e.lo, hi: e.hi, want: label.cm })
      const fix: SizeFix = { name: r.name, axis: 'wall', fromCm: Math.round(e.hi - e.lo), toCm: label.cm }
      fixes.push(fix)
      edges.set(fix, { lo: e.lo, hi: e.hi, alongX })
    }
  }
  const same = (p: Pt) => p
  if (!fixes.some((f) => Math.abs(f.fromCm - f.toCm) >= 2)) return { walls, map: same, fixes: [] }
  // узлы — грани стен и концы стен: у вертикальной стены грани по x, у горизонтальной — по y
  const vertical = (w: Wall) => Math.abs(w.a.x - w.b.x) < 0.5
  const horizontal = (w: Wall) => Math.abs(w.a.y - w.b.y) < 0.5
  const knotsX = walls.flatMap((w) => (vertical(w) ? [w.a.x - w.thickness / 2, w.a.x + w.thickness / 2] : [w.a.x, w.b.x]))
  const knotsY = walls.flatMap((w) => (horizontal(w) ? [w.a.y - w.thickness / 2, w.a.y + w.thickness / 2] : [w.a.y, w.b.y]))
  const bandsX = walls.filter(vertical).map((w) => ({ lo: w.a.x - w.thickness / 2, hi: w.a.x + w.thickness / 2 }))
  const bandsY = walls.filter(horizontal).map((w) => ({ lo: w.a.y - w.thickness / 2, hi: w.a.y + w.thickness / 2 }))
  const fx = fitAxis(knotsX, xs, bandsX)
  const fy = fitAxis(knotsY, ys, bandsY)
  // ось стены — посередине её граней после подгонки. Концы соседних стен,
  // что стояли на этой оси, должны встать туда же, иначе стыки разойдутся на
  // доли сантиметра и комната перестанет быть замкнутой
  const gx = withAxes(fx, knotsX, walls.filter(vertical).map((w) => ({ at: w.a.x, t: w.thickness })))
  const gy = withAxes(fy, knotsY, walls.filter(horizontal).map((w) => ({ at: w.a.y, t: w.thickness })))
  const map = (p: Pt): Pt => ({ x: gx(p.x), y: gy(p.y) })
  const moved = walls.map((w) => {
    const a = map(w.a)
    const b = map(w.b)
    // толщина — между подогнанными гранями
    if (vertical(w)) return { ...w, a, b, thickness: Math.max(4, fx(w.a.x + w.thickness / 2) - fx(w.a.x - w.thickness / 2)) }
    if (horizontal(w)) return { ...w, a, b, thickness: Math.max(4, fy(w.a.y + w.thickness / 2) - fy(w.a.y - w.thickness / 2)) }
    return { ...w, a, b }
  })
  // что вышло на деле: требования мягкие, противоречивые подписи сходятся не до сантиметра
  const spanOf = (fix: SizeFix, r: LabelledRoom): number => {
    const f = bbox(r.inner)
    if (fix.axis === 'width') return fx(f.x2) - fx(f.x1)
    if (fix.axis === 'depth') return fy(f.y2) - fy(f.y1)
    const e = edges.get(fix)!
    return e.alongX ? fx(e.hi) - fx(e.lo) : fy(e.hi) - fy(e.lo)
  }
  for (const fix of fixes) {
    fix.toCm = Math.round(spanOf(fix, rooms.find((x) => x.name === fix.name)!))
  }
  // в отчёт — только то, что сдвинулось
  const changed = fixes.filter((f) => f.fromCm !== f.toCm)
  return { walls: moved, map, fixes: changed }
}
