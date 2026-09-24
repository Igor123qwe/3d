// Комната с картинки — многоугольник по пикселям.
//
// Так делают открытые проекты и советуют на форумах по OpenCV: заливка →
// контур → прямые углы. Комнату не режут на прямоугольники и не собирают
// обратно с правилами «кто кому уступил угол». Область заливки дорастает до
// граней стен, обводится по пикселям и выпрямляется до прямых углов —
// Г-образная прихожая или комната с вырезом под шахту получаются сами.
//
// Стены — из граней соседних комнат. Где правая грань одной комнаты смотрит на
// левую грань другой через полосу чернил, там перегородка ровно этой толщины и
// ровно посередине. Грань без соседа — наружная стена: её толщина меряется по
// чернилам наружу, а не вышло — берётся обычная. Подписи геометрию не двигают:
// они дают имена, масштаб и проверку площадей.
import type { Pt, Underlay, Wall } from './types'
import { uid } from './types'
import { buildRooms } from './rooms'
import { interiorPoint, pointInPoly, polyArea } from './geometry'
import type { AiSide } from './aicontract'
import type { AreaFit, PlacedRoom, ReconstructResult } from './reconstruct'

/**
 * Область заливки держится на расстоянии closePx от чернил — так закрыты
 * дверные проёмы. Дорастить её обратно до граней стен: все области растут
 * разом, по шагу за раз, через бумагу, но не через чернила. В проёме соседи
 * встречаются посередине, и чужого никто не забирает. Остальные области
 * разметки (поле листа, отброшенные обрывки) растут вместе со всеми, только
 * ничьими: иначе комната через входную дверь или дырку в стене расползлась бы
 * по полю вдоль наружной стены.
 * Возвращает карту: номер области с единицы (порядок ids), 0 — ничья.
 */
export function growRegions(labels: Int32Array, ids: number[], d2: Float32Array, w: number, h: number, steps: number): Int32Array {
  const owner = new Int32Array(w * h)
  const index = new Map(ids.map((id, k) => [id, k + 1]))
  const NOBODY = ids.length + 1
  const queue = new Int32Array(w * h)
  let head = 0
  let tail = 0
  for (let i = 0; i < labels.length; i++) {
    if (!labels[i]) continue
    owner[i] = index.get(labels[i]) ?? NOBODY
    queue[tail++] = i
  }
  // по восьми соседям: за steps шагов область доходит до угла комнаты так же, как до стены
  for (let s = 0; s < steps && head < tail; s++) {
    const end = tail
    while (head < end) {
      const i = queue[head++]
      const x = i % w
      const y = (i - x) / w
      const k = owner[i]
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const j = ny * w + nx
          if (owner[j] || d2[j] === 0) continue
          owner[j] = k
          queue[tail++] = j
        }
      }
    }
  }
  for (let i = 0; i < owner.length; i++) if (owner[i] === NOBODY) owner[i] = 0
  return owner
}

/**
 * Внешний контур области по границам пикселей. Вершины — углы пикселей
 * (пиксель x,y занимает квадрат x..x+1, y..y+1), только там, где контур
 * поворачивает. Обход — область справа по ходу; на экране (ось y вниз) это
 * по часовой стрелке и положительная площадь. Дыры внутри не обходятся.
 */
export function traceOutline(owner: Int32Array, w: number, h: number, k: number, start: number): Pt[] {
  const inR = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && owner[y * w + x] === k
  // направления: 0 вправо, 1 вниз, 2 влево, 3 вверх
  const DX = [1, 0, -1, 0]
  const DY = [0, 1, 0, -1]
  // пиксели впереди слева и справа от угла x,y при движении в направлении d
  const ahead = (x: number, y: number, d: number): [boolean, boolean] => {
    switch (d) {
      case 0:
        return [inR(x, y - 1), inR(x, y)]
      case 1:
        return [inR(x, y), inR(x - 1, y)]
      case 2:
        return [inR(x - 1, y), inR(x - 1, y - 1)]
      default:
        return [inR(x - 1, y - 1), inR(x, y - 1)]
    }
  }
  const sx = start % w
  const sy = (start - sx) / w
  let x = sx
  let y = sy
  let d = 0
  const out: Pt[] = []
  // первый пиксель по строкам — верхний левый: угол над ним принадлежит контуру один раз
  for (let guard = 0; guard < 4 * w * h + 8; guard++) {
    const [left, right] = ahead(x, y, d)
    // области по диагонали не соединяются: контур четырёхсвязный
    const nd = !right ? (d + 1) % 4 : left ? (d + 3) % 4 : d
    if (nd !== d) out.push({ x, y })
    d = nd
    x += DX[d]
    y += DY[d]
    if (x === sx && y === sy) {
      if (d !== 0) out.push({ x: sx, y: sy })
      break
    }
  }
  return out
}

const edgeLen = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

/** убрать совпавшие точки и вершины посреди прямой */
function tidy(pts: Pt[]): Pt[] {
  let cur = pts
  for (let pass = 0; pass < 8; pass++) {
    const out: Pt[] = []
    for (const p of cur) if (!out.length || edgeLen(out[out.length - 1], p) > 1e-9) out.push({ x: p.x, y: p.y })
    while (out.length > 1 && edgeLen(out[0], out[out.length - 1]) <= 1e-9) out.pop()
    const kept: Pt[] = []
    const n = out.length
    for (let i = 0; i < n; i++) {
      const a = out[(i - 1 + n) % n]
      const b = out[i]
      const c = out[(i + 1) % n]
      const straight = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)
      if (!straight) kept.push(b)
    }
    if (kept.length === cur.length) return kept
    cur = kept
  }
  return cur
}

/**
 * Прямые углы без мелочи: ступеньки, язычки в дверных проёмах и зазубрины
 * короче minEdge убираются, начиная с самой короткой. Ступенька — две
 * параллельные стороны, идущие в одну сторону: они сводятся на линию длинной.
 * Острый выступ или узкая щель (стороны навстречу друг другу) срезаются по
 * короткой из боковых сторон.
 */
export function simplifyOrthogonal(poly: Pt[], minEdge: number): Pt[] {
  let pts = tidy(poly)
  for (let guard = 0; guard < 4 * poly.length + 8 && pts.length > 4; guard++) {
    const n = pts.length
    let i = -1
    let shortest = minEdge
    for (let k = 0; k < n; k++) {
      const L = edgeLen(pts[k], pts[(k + 1) % n])
      if (L < shortest) (shortest = L), (i = k)
    }
    if (i < 0) break
    const ip = (i - 1 + n) % n
    const ia = i
    const ib = (i + 1) % n
    const inx = (i + 2) % n
    const p0 = pts[ip]
    const a = pts[ia]
    const b = pts[ib]
    const n1 = pts[inx]
    const next = pts.map((p) => ({ ...p }))
    // короткая сторона горизонтальна — соседние вертикальны, и наоборот
    const horizontal = a.y === b.y
    const c = horizontal ? 'y' : 'x'
    const dirP = Math.sign(a[c] - p0[c])
    const dirN = Math.sign(n1[c] - b[c])
    const lenP = Math.abs(a[c] - p0[c])
    const lenN = Math.abs(n1[c] - b[c])
    const along = horizontal ? 'x' : 'y'
    if (dirP === dirN) {
      // ступенька: обе соседние стороны — на линию длинной
      const v = lenP >= lenN ? a[along] : b[along]
      next[ip][along] = v
      next[ia][along] = v
      next[ib][along] = v
      next[inx][along] = v
    } else {
      // выступ или щель шириной в короткую сторону: срезать на глубину короткой из боковых
      const depth = Math.min(lenP, lenN)
      const v = a[c] - dirP * depth
      next[ia][c] = v
      next[ib][c] = v
    }
    const tidied = tidy(next)
    // на всякий случай: упрощение не должно выворачивать контур
    if (tidied.length < 4 || polyArea(tidied) <= 0) break
    pts = tidied
  }
  return pts
}

/**
 * Мелкие выступы наружу — не комната. Область дорастает до стен на closePx,
 * и в дверном проёме, в нише окна или под батареей она заходит в толщу стены
 * язычком. Выступ наружу не глубже maxDepth срезается по линии грани; вырезы
 * внутрь (колонна, короб шахты) остаются — это стены, заходящие в комнату.
 */
export function cutBumps(poly: Pt[], maxDepth: number, tol: number): Pt[] {
  let pts = tidy(poly)
  const area0 = polyArea(pts)
  for (let guard = 0; guard < 2 * poly.length + 8 && pts.length > 4; guard++) {
    const n = pts.length
    let cut: Pt[] | null = null
    for (let i = 0; i < n && !cut; i++) {
      const p0 = pts[(i - 1 + n) % n]
      const a = pts[i]
      const b = pts[(i + 1) % n]
      const n1 = pts[(i + 2) % n]
      const horizontal = a.y === b.y
      const c = horizontal ? 'y' : 'x'
      const dirP = Math.sign(a[c] - p0[c])
      const dirN = Math.sign(n1[c] - b[c])
      if (dirP !== -dirN) continue
      // куда смотрит наружу эта сторона: область справа по ходу
      const out = horizontal ? (b.x > a.x ? -1 : 1) : b.y > a.y ? 1 : -1
      if (dirP !== out) continue
      const lenP = Math.abs(a[c] - p0[c])
      const lenN = Math.abs(n1[c] - b[c])
      // выступ возвращается на ту же линию, с которой вышел: язычок на грани, а не угол комнаты
      if (Math.abs(lenP - lenN) > tol) continue
      const depth = Math.min(lenP, lenN)
      if (depth > maxDepth) continue
      const next = pts.map((p) => ({ ...p }))
      const v = a[c] - dirP * depth
      next[i][c] = v
      next[(i + 1) % n][c] = v
      const tidied = tidy(next)
      // срез не должен съесть комнату: это язычок, а не её половина
      if (tidied.length >= 4 && polyArea(tidied) >= area0 * 0.75) cut = tidied
    }
    if (!cut) break
    pts = cut
  }
  return pts
}

/** контур области с картинки, пиксели; площадь и рамка — по нему */
export interface Outline {
  poly: Pt[]
  areaPx: number
  box: { x1: number; y1: number; x2: number; y2: number }
}

/**
 * Контуры всех областей: дорастить до стен, обвести, выпрямить. minEdge —
 * мельче этого ступеньки считаются неровностью линий, а не выступом стены.
 */
export function outlineRegions(labels: Int32Array, ids: number[], d2: Float32Array, w: number, h: number, closePx: number): { outlines: (Outline | null)[]; owner: Int32Array } {
  const owner = growRegions(labels, ids, d2, w, h, closePx + 2)
  // Кусок, отрезанный от поля листа, может нести с собой обрывки поля с той же
  // меткой: обводим самый большой связный кусок области, остальное — ничьё
  const first = new Int32Array(ids.length + 1).fill(-1)
  const size = new Int32Array(ids.length + 1)
  const comp = new Int32Array(w * h).fill(-1)
  const queue = new Int32Array(w * h)
  const starts: number[] = []
  for (let i = 0; i < owner.length; i++) {
    const k = owner[i]
    if (!k || comp[i] >= 0) continue
    const c = starts.length
    starts.push(i)
    let head = 0
    let tail = 0
    queue[tail++] = i
    comp[i] = c
    while (head < tail) {
      const j = queue[head++]
      const x = j % w
      const y = (j - x) / w
      if (x > 0 && owner[j - 1] === k && comp[j - 1] < 0) (comp[j - 1] = c), (queue[tail++] = j - 1)
      if (x < w - 1 && owner[j + 1] === k && comp[j + 1] < 0) (comp[j + 1] = c), (queue[tail++] = j + 1)
      if (y > 0 && owner[j - w] === k && comp[j - w] < 0) (comp[j - w] = c), (queue[tail++] = j - w)
      if (y < h - 1 && owner[j + w] === k && comp[j + w] < 0) (comp[j + w] = c), (queue[tail++] = j + w)
    }
    if (tail > size[k]) (size[k] = tail), (first[k] = i)
  }
  for (let i = 0; i < owner.length; i++) if (owner[i] && starts[comp[i]] !== first[owner[i]]) owner[i] = 0
  // ступенька мельче пятой части радиуса (≈ 9 см) — неровность линии; выступ
  // наружу не глубже радиуса — язычок в проёме или нише окна
  const minEdge = Math.max(4, Math.round(0.2 * closePx))
  const outlines = ids.map((_, k) => {
    if (first[k + 1] < 0) return null
    const raw = traceOutline(owner, w, h, k + 1, first[k + 1])
    const poly = simplifyOrthogonal(cutBumps(simplifyOrthogonal(raw, minEdge), closePx, minEdge), minEdge)
    if (poly.length < 4) return null
    const xs = poly.map((p) => p.x)
    const ys = poly.map((p) => p.y)
    return { poly, areaPx: Math.abs(polyArea(poly)), box: { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) } }
  })
  return { outlines, owner }
}

/**
 * Точка на стороне комнаты-многоугольника: side — какая сторона, at — доля
 * вдоль всей комнаты. У Г-образной комнаты правая сторона — это несколько
 * граней на разной глубине: берётся та, что лежит напротив этой доли, и из
 * таких — крайняя. Так дверь «справа внизу» встаёт в стену выреза, а не в
 * пустоту рамки.
 */
export function pointOnOutline(poly: Pt[], side: AiSide, at: number): Pt {
  const t = Math.min(1, Math.max(0, at))
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  const x1 = Math.min(...xs)
  const x2 = Math.max(...xs)
  const y1 = Math.min(...ys)
  const y2 = Math.max(...ys)
  const vertical = side === 'left' || side === 'right'
  const along = vertical ? y1 + (y2 - y1) * t : x1 + (x2 - x1) * t
  // обход с областью справа (положительная площадь на экране) или наоборот
  const cw = polyArea(poly) > 0 ? 1 : -1
  let best: { at: number; d: number } | null = null
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (vertical ? a.x !== b.x : a.y !== b.y) continue
    // куда смотрит грань наружу
    const out = (vertical ? (b.y > a.y ? 1 : -1) : b.x > a.x ? -1 : 1) * cw
    const want = side === 'right' || side === 'bottom' ? 1 : -1
    if (out !== want) continue
    const lo = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x)
    const hi = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x)
    const d = along < lo ? lo - along : along > hi ? along - hi : 0
    const coord = vertical ? a.x : a.y
    // ближе к доле; при равенстве — крайняя грань этой стороны
    if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && (coord - best.at) * want > 0)) best = { at: coord, d }
  }
  const c = best ? best.at : side === 'left' ? x1 : side === 'right' ? x2 : side === 'top' ? y1 : y2
  return vertical ? { x: c, y: along } : { x: along, y: c }
}

// ---------- стены из граней комнат ----------

export interface PictureRoom {
  name: string
  kind?: string
  /** контур по внутренним граням стен, пиксели картинки */
  poly: Pt[]
  wantM2?: number
}

export interface PictureOptions {
  /** толщина перегородки, если между гранями нет чернил, см */
  interiorCm: number
  /** толщина наружной стены, если по картинке она не измерилась, см */
  exteriorCm: number
  /** шире — между гранями не стена, а что-то ещё (шахта, неопознанное помещение), см */
  maxGapCm?: number
}

/** грань комнаты: сторона контура */
interface Face {
  room: number
  vertical: boolean
  /** координата грани: x у вертикальной, y у горизонтальной */
  at: number
  lo: number
  hi: number
  /** куда смотрит наружу: +1 — в сторону больших координат */
  out: 1 | -1
  /** обход идёт в сторону больших координат */
  forward: boolean
}

/** кусок грани с одним соседом (или без соседа): своя ось стены и толщина */
interface Piece {
  s: number
  e: number
  partner: number
  axis: number
  t: number
}

function facesOf(poly: Pt[], room: number): Face[] {
  const out: Face[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (a.x === b.x) {
      // вниз — область слева по экрану, грань правая
      const down = b.y > a.y
      out.push({ room, vertical: true, at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), out: down ? 1 : -1, forward: down })
    } else {
      const right = b.x > a.x
      out.push({ room, vertical: false, at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), out: right ? -1 : 1, forward: right })
    }
  }
  return out
}

/** толщина наружной стены по чернилам за гранью, пиксели; null — не измерилась */
function inkRun(d2: Float32Array, w: number, h: number, f: Face, s: number, e: number): number | null {
  const limit = Math.max(20, Math.round(Math.min(w, h) * 0.08))
  const runs: number[] = []
  const n = Math.min(9, Math.max(1, Math.floor((e - s) / 3)))
  for (let k = 1; k <= n; k++) {
    const t = Math.floor(s + ((e - s) * k) / (n + 1))
    // первый пиксель снаружи грани
    let x = f.vertical ? (f.out > 0 ? f.at : f.at - 1) : t
    let y = f.vertical ? t : f.out > 0 ? f.at : f.at - 1
    const dx = f.vertical ? f.out : 0
    const dy = f.vertical ? 0 : f.out
    const inside = () => x >= 0 && y >= 0 && x < w && y < h
    const ink = () => d2[y * w + x] === 0
    let skip = 0
    while (skip < 3 && inside() && !ink()) (x += dx), (y += dy), skip++
    if (!inside() || !ink()) continue
    let run = 0
    while (inside() && ink() && run <= limit) (x += dx), (y += dy), run++
    if (!inside() || run > limit) continue
    runs.push(run)
  }
  if (runs.length < Math.min(3, n)) return null
  runs.sort((a, b) => a - b)
  return runs[Math.floor(runs.length / 2)]
}

/**
 * Стены по граням комнат. Координаты граней — в пикселях картинки, на выходе
 * чертёж в сантиметрах поверх подложки u.
 */
export function wallsFromPicture(rooms: PictureRoom[], u: Underlay, d2: Float32Array | null, o: PictureOptions): ReconstructResult {
  const s = u.scale
  const W = u.px.w
  const H = u.px.h
  const maxGap = (o.maxGapCm ?? 110) / s
  const joinPx = Math.max(4, 60 / s)
  const faces = rooms.map((r, k) => facesOf(r.poly, k))
  const all = faces.flat()
  const defaultExt = o.exteriorCm / s
  const defaultInt = o.interiorCm / s
  // шахта или неопознанное помещение между гранями: тогда это не одна стена
  const between = (f: Face, g: Face, lo: number, hi: number): boolean => {
    const mid = (f.at + g.at) / 2
    if (Math.abs(g.at - f.at) < 4) return false
    for (let k = 1; k <= 3; k++) {
      const t = lo + ((hi - lo) * k) / 4
      const p = f.vertical ? { x: mid, y: t } : { x: t, y: mid }
      if (rooms.some((r, i) => i !== f.room && i !== g.room && pointInPoly(p, r.poly))) return true
    }
    return false
  }

  // 1. каждая грань — на куски по соседям
  const pieces: Piece[][] = all.map((f) => {
    const cands = all.filter((g) => g.room !== f.room && g.vertical === f.vertical && g.out === -f.out && (g.at - f.at) * f.out >= -0.5 && (g.at - f.at) * f.out <= maxGap && Math.min(f.hi, g.hi) - Math.max(f.lo, g.lo) > 0)
    const cuts = new Set<number>([f.lo, f.hi])
    for (const g of cands) {
      if (g.lo > f.lo && g.lo < f.hi) cuts.add(g.lo)
      if (g.hi > f.lo && g.hi < f.hi) cuts.add(g.hi)
    }
    const xs = [...cuts].sort((a, b) => a - b)
    const out: Piece[] = []
    for (let m = 0; m + 1 < xs.length; m++) {
      const a = xs[m]
      const b = xs[m + 1]
      let best = -1
      let gap = Infinity
      for (const g of cands) {
        if (g.lo > a + 1e-9 || g.hi < b - 1e-9) continue
        const d = Math.abs(g.at - f.at)
        if (d < gap && !between(f, g, a, b)) (gap = d), (best = all.indexOf(g))
      }
      // соседство на пару пикселей — это касание углами, а не общая стена
      out.push({ s: a, e: b, partner: b - a < 3 ? -1 : best, axis: 0, t: 0 })
    }
    // Короткий кусок без соседа между стенами — торец поперечной стены: грань
    // комнаты проходит мимо него на её толщину. Это продолжение соседней
    // стены, а не наружная стена с уступом
    for (let m = 0; m < out.length; m++) {
      const p = out[m]
      if (p.partner >= 0 || p.e - p.s > joinPx) continue
      const nb = [out[m - 1], out[m + 1]].filter((q) => q && q.partner >= 0).sort((x, y) => y.e - y.s - (x.e - x.s))[0]
      if (nb) p.partner = nb.partner
    }
    const merged: Piece[] = []
    for (const p of out) {
      const last = merged[merged.length - 1]
      if (last && last.partner === p.partner) last.e = p.e
      else merged.push(p)
    }
    return merged
  })

  // 2. ось и толщина каждого куска
  all.forEach((f, fi) => {
    for (const p of pieces[fi]) {
      if (p.partner >= 0) {
        const g = all[p.partner]
        const gapPx = Math.abs(g.at - f.at)
        p.t = gapPx >= 1 ? gapPx : defaultInt
        p.axis = (f.at + g.at) / 2
      } else {
        const run = d2 ? inkRun(d2, W, H, f, p.s, p.e) : null
        // двойная линия БТИ даёт тонкий штрих у грани: такой замер — не толщина стены
        p.t = run !== null && run >= 6 ? run : defaultExt
        p.axis = f.at + (f.out * p.t) / 2
      }
    }
  })

  // 3. оси, разошедшиеся на пару пикселей, — одна ось: так стены соседних
  //    комнат на одной линии не дают ступенек в сантиметр
  const snap = Math.max(1.5, 4 / s)
  for (const vertical of [true, false]) {
    const list: Piece[] = []
    all.forEach((f, fi) => {
      if (f.vertical === vertical) list.push(...pieces[fi])
    })
    list.sort((a, b) => a.axis - b.axis)
    let from = 0
    for (let k = 1; k <= list.length; k++) {
      if (k < list.length && list[k].axis - list[k - 1].axis <= snap && list[k].axis - list[from].axis <= 2 * snap) continue
      const group = list.slice(from, k)
      const len = group.reduce((a, p) => a + (p.e - p.s), 0)
      const axis = len ? group.reduce((a, p) => a + p.axis * (p.e - p.s), 0) / len : group[0].axis
      for (const p of group) p.axis = axis
      from = k
    }
  }

  // 4. контур комнаты по осям: угол — пересечение осей соседних граней,
  //    смена оси посреди грани — перемычка поперёк стены
  interface Seg {
    vertical: boolean
    axis: number
    lo: number
    hi: number
    t: number
  }
  const segs: Seg[] = []
  const push = (a: Pt, b: Pt, t: number) => {
    if (Math.abs(a.x - b.x) < 1e-6) {
      if (Math.abs(a.y - b.y) > 1e-6) segs.push({ vertical: true, axis: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), t })
    } else if (Math.abs(a.y - b.y) < 1e-6) segs.push({ vertical: false, axis: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), t })
  }
  const outlines: Pt[][] = []
  let base = 0
  rooms.forEach((r, k) => {
    const fs = faces[k]
    const n = fs.length
    const ordered = fs.map((f, i) => {
      const ps = pieces[base + i]
      return f.forward ? ps : [...ps].reverse()
    })
    const point = (f: Face, axis: number, along: number): Pt => (f.vertical ? { x: axis, y: along } : { x: along, y: axis })
    const corner = (i: number): Pt => {
      const a = fs[i]
      const b = fs[(i + 1) % n]
      const pa = ordered[i][ordered[i].length - 1]
      const pb = ordered[(i + 1) % n][0]
      return a.vertical ? { x: pa.axis, y: pb.axis } : { x: pb.axis, y: pa.axis }
    }
    const verts: Pt[] = []
    for (let i = 0; i < n; i++) {
      const f = fs[i]
      let cur = corner((i - 1 + n) % n)
      verts.push(cur)
      const ps = ordered[i]
      for (let j = 0; j < ps.length; j++) {
        const p = ps[j]
        const nextP = ps[j + 1]
        if (!nextP) {
          push(cur, corner(i), p.t)
          continue
        }
        const split = f.forward ? p.e : p.s
        const end = point(f, p.axis, split)
        push(cur, end, p.t)
        cur = end
        if (nextP.axis !== p.axis) {
          const jog = point(f, nextP.axis, split)
          push(cur, jog, Math.min(p.t, nextP.t))
          verts.push(cur, jog)
          cur = jog
        }
      }
    }
    outlines.push(verts)
    base += n
  })

  // 5. одинаковые куски стен от двух комнат — одна стена; толщина — большая из заявленных
  const groups = new Map<string, Seg[]>()
  for (const g of segs) {
    const key = `${g.vertical ? 'v' : 'h'}${g.axis.toFixed(4)}`
    ;(groups.get(key) ?? groups.set(key, []).get(key)!).push(g)
  }
  const toCm = (p: Pt): Pt => ({ x: u.x + p.x * s, y: u.y + p.y * s })
  const walls: Wall[] = []
  for (const list of groups.values()) {
    const cuts = [...new Set(list.flatMap((g) => [g.lo, g.hi]))].sort((a, b) => a - b)
    let run: { lo: number; hi: number; t: number } | null = null
    const flush = () => {
      if (!run) return
      const g = list[0]
      const a = g.vertical ? { x: g.axis, y: run.lo } : { x: run.lo, y: g.axis }
      const b = g.vertical ? { x: g.axis, y: run.hi } : { x: run.hi, y: g.axis }
      walls.push({ id: uid('w'), a: toCm(a), b: toCm(b), thickness: Math.max(4, Math.round(run.t * s)) })
      run = null
    }
    for (let m = 0; m + 1 < cuts.length; m++) {
      const a = cuts[m]
      const b = cuts[m + 1]
      const mid = (a + b) / 2
      const cover = list.filter((g) => g.lo <= mid && g.hi >= mid)
      if (!cover.length) {
        flush()
        continue
      }
      const t = Math.max(...cover.map((g) => g.t))
      if (run && Math.abs(run.t - t) < 1e-6 && Math.abs(run.hi - a) < 1e-6) run.hi = b
      else {
        flush()
        run = { lo: a, hi: b, t }
      }
    }
    flush()
  }

  // 6. комнаты по контуру и сверка площадей с подписями
  const { rooms: built } = buildRooms({ version: 1, name: '', walls, openings: [], furniture: [], rooms: [], dims: [], settings: { grid: 10 } })
  const taken = new Set<number>()
  const placed: PlacedRoom[] = rooms.map((r, k) => {
    const anchor = toCm(interiorPoint(r.poly))
    const xs = outlines[k].map((p) => p.x)
    const ys = outlines[k].map((p) => p.y)
    const rect = { x1: u.x + Math.min(...xs) * s, y1: u.y + Math.min(...ys) * s, x2: u.x + Math.max(...xs) * s, y2: u.y + Math.max(...ys) * s }
    const idx = built.findIndex((b, i) => !taken.has(i) && pointInPoly(anchor, b.polygon))
    if (idx >= 0) taken.add(idx)
    return { name: r.name, kind: r.kind, anchor, rect, outline: outlines[k].map(toCm), wantM2: r.wantM2, haveM2: idx >= 0 ? built[idx].area : undefined }
  })
  const checked = placed.filter((r) => r.wantM2 && r.haveM2 !== undefined) as (PlacedRoom & { wantM2: number; haveM2: number })[]
  let areaFit: AreaFit | null = null
  if (checked.length) {
    const errs = checked.map((r) => Math.abs(r.haveM2 - r.wantM2) / r.wantM2)
    const off = checked
      .map((r, i) => ({ name: r.name, wantM2: r.wantM2, haveM2: r.haveM2, err: errs[i] }))
      .filter((r) => r.err > 0.08)
      .sort((a, b) => b.err - a.err)
      .map(({ name, wantM2, haveM2 }) => ({ name, wantM2, haveM2 }))
    areaFit = { accuracy: Math.max(0, 1 - errs.reduce((a, b) => a + b, 0) / errs.length), off, samples: checked.length }
  }
  return { walls, rooms: placed, skipped: [], dropped: [], doubtful: [], areaFit }
}
