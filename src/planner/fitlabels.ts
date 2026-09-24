// Размеры по подписям. Чертёж БТИ нарисован не точно в масштабе, да и снимок
// добавляет своё: если поделить подпись на размер комнаты в точках, у каждой
// комнаты свой масштаб (на плане пользователя — от 1,75 до 1,83 см в точке).
// Один масштаб на весь лист даёт одним комнатам +12 см, другим −7. Подпись —
// обмер, картинка — эскиз: оси стен сдвигаются так, чтобы ширина и глубина
// подписанных комнат сошлись с числами, а форма осталась с картинки.
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
 * Растянуть ось как резинку. Узлы — координаты осей стен вдоль оси; отрезок
 * между соседними узлами меняет длину тем охотнее, чем он длиннее: цена
 * изменения на d сантиметров — d²/длина. Так поправка ложится на комнату, а не
 * на толщину стены между комнатами. Требования мягкие: если подписи
 * противоречат друг другу (чертёж неточен), выходит лучший компромисс.
 * Возвращает отображение координаты; средняя точка узлов остаётся на месте.
 */
export function fitAxis(knotsIn: number[], spans: AxisSpan[]): (x: number) => number {
  const knots = clusterKnots(knotsIn)
  const n = knots.length - 1
  const same = (x: number) => x
  if (n < 1 || !spans.length) return same
  const len = knots.slice(1).map((k, i) => k - knots[i])
  const rows = spans
    .map((s) => {
      const idx: number[] = []
      for (let k = 0; k < n; k++) if (knots[k] >= s.lo - 1 && knots[k + 1] <= s.hi + 1) idx.push(k)
      return { idx, r: s.want - (s.hi - s.lo), g: s.weight ?? 1 }
    })
    .filter((row) => row.idx.length)
  if (!rows.length) return same
  // (W + γAᵀA) d = γAᵀr, W = diag(1/длина)
  const gamma = 10
  const M = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 / Math.max(1, len[i]) : 0)))
  const rhs = new Array<number>(n).fill(0)
  for (const { idx, r, g } of rows) {
    for (const i of idx) {
      rhs[i] += gamma * g * r
      for (const j of idx) M[i][j] += gamma * g
    }
  }
  const d = solve(M, rhs)
  if (!d) return same
  // отрезок не должен ни исчезнуть, ни вывернуться
  if (d.some((x, i) => len[i] + x < 0.5 * len[i])) return same
  const moved = [knots[0]]
  for (let k = 0; k < n; k++) moved.push(moved[k] + len[k] + d[k])
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

/** подписанная комната: контур по осям и по граням стен, подписи ширины и глубины */
export interface LabelledRoom {
  name: string
  axes: Pt[]
  inner: Pt[]
  widthCm?: number
  depthCm?: number
}

export interface SizeFix {
  name: string
  axis: 'width' | 'depth'
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
 * Подогнать оси стен под подписи. Подпись, что расходится с картинкой больше
 * чем на 6 % (и больше 12 см), не трогается: это ошибка чтения или размер
 * части Г-образной комнаты, а не всей её рамки. Возвращает новые стены,
 * отображение точек (для подписей комнат) и что поменялось.
 */
export function fitToLabels(walls: Wall[], rooms: LabelledRoom[]): { walls: Wall[]; map: (p: Pt) => Pt; fixes: SizeFix[] } {
  const xs: AxisSpan[] = []
  const ys: AxisSpan[] = []
  const fixes: SizeFix[] = []
  const fits = (have: number, want: number) => Math.abs(have - want) <= Math.max(12, 0.06 * want)
  for (const r of rooms) {
    if (r.axes.length < 3 || r.inner.length < 3) continue
    const a = bbox(r.axes)
    const f = bbox(r.inner)
    const haveW = f.x2 - f.x1
    const haveD = f.y2 - f.y1
    // Г-образная комната (прихожая с коридором) рамкой накрывает соседей:
    // держать её рамку — значит перекладывать поправку соседей в коридор
    const boxy = Math.abs(polyArea(r.inner)) >= 0.85 * haveW * haveD
    // и уже сошедшийся размер держим: иначе его растянут соседи. Комната без
    // годной подписи держит свой размер с картинки, но слабее подписи
    if (r.widthCm && fits(haveW, r.widthCm)) {
      xs.push({ lo: a.x1, hi: a.x2, want: r.widthCm + (a.x2 - a.x1 - haveW) })
      fixes.push({ name: r.name, axis: 'width', fromCm: Math.round(haveW), toCm: r.widthCm })
    } else if (boxy) xs.push({ lo: a.x1, hi: a.x2, want: a.x2 - a.x1, weight: 0.2 })
    if (r.depthCm && fits(haveD, r.depthCm)) {
      ys.push({ lo: a.y1, hi: a.y2, want: r.depthCm + (a.y2 - a.y1 - haveD) })
      fixes.push({ name: r.name, axis: 'depth', fromCm: Math.round(haveD), toCm: r.depthCm })
    } else if (boxy) ys.push({ lo: a.y1, hi: a.y2, want: a.y2 - a.y1, weight: 0.2 })
  }
  const same = (p: Pt) => p
  if (!fixes.some((f) => Math.abs(f.fromCm - f.toCm) >= 2)) return { walls, map: same, fixes: [] }
  const knotsX = walls.flatMap((w) => [w.a.x, w.b.x])
  const knotsY = walls.flatMap((w) => [w.a.y, w.b.y])
  const fx = fitAxis(knotsX, xs)
  const fy = fitAxis(knotsY, ys)
  const map = (p: Pt): Pt => ({ x: fx(p.x), y: fy(p.y) })
  // что вышло на деле: требования мягкие, противоречивые подписи сходятся не до сантиметра
  for (const fix of fixes) {
    const r = rooms.find((x) => x.name === fix.name)!
    const a = bbox(r.axes)
    const f = bbox(r.inner)
    fix.toCm = Math.round(fix.axis === 'width' ? fx(a.x2) - fx(a.x1) - (a.x2 - a.x1 - (f.x2 - f.x1)) : fy(a.y2) - fy(a.y1) - (a.y2 - a.y1 - (f.y2 - f.y1)))
  }
  // в отчёт — только то, что сдвинулось
  const changed = fixes.filter((f) => f.fromCm !== f.toCm)
  return { walls: walls.map((w) => ({ ...w, a: map(w.a), b: map(w.b) })), map, fixes: changed }
}
