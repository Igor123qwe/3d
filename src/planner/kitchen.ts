// Кухонный гарнитур собирает программа, а не модель.
//
// Гарнитур — это не набор предметов, а одна линия столешницы с порядком
// модулей, и его правила строгие: холодильник с краю, рядом с мойкой —
// посудомойка, у плиты столешница с обеих сторон, плита не у окна и не
// вплотную к холодильнику.
//
// Первым делом — коммуникации. Стояки и вентканал в квартире не переносят:
// мойка ставится у стояка (слив идёт с уклоном, длинная труба засоряется),
// плита с вытяжкой — у вентканала. Под окном по умолчанию ничего: там батарея,
// створке мешает смеситель, а у окна лучше всего обеденному столу. Стояк и
// вентканал человек отмечает на плане; нет меток — их выдаёт выступ шахты в
// стене кухни.
//
// Шахта не рвёт гарнитур: столешница идёт над её выступом, тумбы там мельче.
// Поэтому стены с выступами сливаются в одну линию, а место над выступом
// занимает столешница нужной длины.
import type { Furniture, Pt } from './types'
import { uid } from './types'
import { CATALOG_MAP } from './catalog'
import { workTriangle } from './checks'
import { add, convexOverlap, dist, mul, norm, normDeg, obbCorners, perp, pointInPoly, sub } from './geometry'

/** модули гарнитура: их расставляет сборщик, а не проверка по одному */
export const KITCHEN_MODULES = new Set(['counter-60', 'counter-80', 'counter-100', 'counter-corner', 'counter-top', 'sink', 'stove', 'fridge', 'dishwasher', 'tall-cabinet'])

export interface KitchenInput {
  /** чистовой контур комнаты */
  inner: Pt[]
  /** стены, колонны и то, что уже стоит: гарнитур мимо них */
  blockers: Pt[][]
  /** дуги дверей и проходы перед ними */
  doorZones: Pt[][]
  doors: Pt[]
  /** окна — отрезки по стене */
  windows: [Pt, Pt][]
  /** пол перед окнами: там батарея и подоконник — тумбам туда нельзя, с какой стены ни иди */
  windowZones?: Pt[][]
  /** что предложила модель: состав и где она хотела кухню */
  proposed: { type: string; x: number; y: number }[]
  /** стояки воды и канализации: мойка к ним */
  risers?: Pt[]
  /** вентканалы: плита с вытяжкой к ним */
  vents?: Pt[]
  /** можно ставить под окном: попросили мойку у окна */
  allowWindow?: boolean
}

export interface KitchenRun {
  furniture: Furniture[]
  /** прямая или угловая */
  shape: 'line' | 'corner'
  /** порядок модулей по линии — для пояснения */
  order: string[]
  /** гарнитур пришлось поставить и под окном: у глухих стен не поместился */
  atWindow: boolean
  /** от мойки до стояка и от плиты до вентканала, см */
  sinkToRiser?: number
  stoveToVent?: number
  /** что из предложенного не встало у коммуникаций: пенал, посудомойка */
  dropped: string[]
  /** холодильник — в нише у края стены */
  fridgeInNiche?: boolean
}

type Token = 'fridge' | 'tall' | 'sink' | 'dw' | 'stove' | 'C' | 'W' | 'C0'

/** участок стены под гарнитур: откуда, куда, что на нём */
interface Leg {
  /** начало участка по ходу гарнитура */
  origin: Pt
  /** направление хода */
  dir: Pt
  /** внутрь комнаты */
  n: Pt
  len: number
  rot: number
  /** окна на участке: отрезки по ходу, см */
  windows: [number, number][]
  /** выступы шахт: отрезок по ходу и насколько стена выступает, см */
  bumps: [number, number, number][]
}

const DEPTH = 60
/** глубже — выступ не обойти столешницей: тумба была бы уже 20 см */
const MAX_BUMP = 40
const TYPE: Record<Exclude<Token, 'C' | 'W' | 'C0'>, string> = { fridge: 'fridge', tall: 'tall-cabinet', sink: 'sink', dw: 'dishwasher', stove: 'stove' }
const isCounterToken = (t: Token) => t === 'C' || t === 'W' || t === 'C0'
const width = (t: Token): number => (t === 'C' || t === 'W' ? 60 : t === 'C0' ? 0 : CATALOG_MAP[TYPE[t]]?.w ?? 60)
const maxOf = (t: Token): number => (t === 'W' ? 120 : t === 'C' || t === 'C0' ? 100 : width(t))

/** столешница длиной c — из тумб каталога 60, 80 и 100 */
export function counters(c: number): number[] {
  const out: number[] = []
  let rest = c
  while (rest >= 60) {
    const take = rest <= 100 ? rest : rest - 100 >= 60 ? 100 : rest - 60
    out.push(take)
    rest -= take
  }
  return out
}

// ---------- контур: стены и шахты ----------

interface Edge {
  a: Pt
  b: Pt
  dir: Pt
  n: Pt
  L: number
}

function edgesAll(inner: Pt[]): Edge[] {
  return inner.map((a, i) => {
    const b = inner[(i + 1) % inner.length]
    const L = dist(a, b)
    const dir = L > 1e-6 ? norm(sub(b, a)) : { x: 1, y: 0 }
    let n = perp(dir)
    if (!pointInPoly(add(add(a, mul(dir, L / 2)), mul(n, 1.5)), inner)) n = mul(n, -1)
    return { a, b, dir, n, L }
  })
}

const orthogonal = (poly: Pt[]) =>
  poly.every((a, i) => {
    const b = poly[(i + 1) % poly.length]
    return Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1
  })

const signedArea = (poly: Pt[]) => poly.reduce((s, p, i) => s + p.x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * p.y, 0) / 2

/**
 * Шахты по контуру кухни: прямоугольный выступ стены внутрь комнаты (до 80 см
 * глубиной и 150 длиной) или срезанный угол до 90 × 90 — это вентканал со
 * стояками. Точка — середина выступа
 */
export function shaftsOf(poly: Pt[]): Pt[] {
  const n = poly.length
  if (n < 5 || !orthogonal(poly)) return []
  const s = Math.sign(signedArea(poly))
  const v = (i: number) => poly[((i % n) + n) % n]
  const convex = (i: number) => {
    const a = sub(v(i), v(i - 1))
    const b = sub(v(i + 1), v(i))
    return Math.sign(a.x * b.y - a.y * b.x) === s
  }
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    // выступ внутрь комнаты: у стены углы выпуклые, у лица выступа — вогнутые
    if (convex(i) && !convex(i + 1) && !convex(i + 2) && convex(i + 3)) {
      const side1 = dist(v(i), v(i + 1))
      const face = dist(v(i + 1), v(i + 2))
      const side2 = dist(v(i + 2), v(i + 3))
      if (side1 <= 80 && side2 <= 80 && Math.abs(side1 - side2) < 5 && face >= 20 && face <= 150) out.push(mul(add(v(i + 1), v(i + 2)), 0.5))
    }
    // срезанный угол комнаты: выпуклая, вогнутая, выпуклая, стороны до 70 см, а стены
    // по обе стороны — длинные (иначе это уступ стены, а не шахта)
    if (convex(i) && !convex(i + 1) && convex(i + 2)) {
      const e1 = dist(v(i), v(i + 1))
      const e2 = dist(v(i + 1), v(i + 2))
      const before = dist(v(i - 1), v(i))
      const after = dist(v(i + 2), v(i + 3))
      if (e1 >= 15 && e2 >= 15 && e1 <= 70 && e2 <= 70 && before >= 100 && after >= 100) out.push(mul(add(v(i), v(i + 2)), 0.5))
    }
  }
  return out
}

/**
 * Линии стен под гарнитур: стена с неглубокими выступами и нишами — одна
 * линия. База — самый длинный её отрезок; выступы (шахта) — где тумбы мельче
 */
interface Line {
  a: Pt
  dir: Pt
  n: Pt
  L: number
  rot: number
  /** выступы: [от, до, глубина] по линии */
  bumps: [number, number, number][]
  /** смещение стены от базы на каждом отрезке: + внутрь комнаты */
  parts: [number, number, number][]
  /** первый и последний отрезки лежат на базе — угол гарнитура возможен */
  startsOnBase: boolean
  endsOnBase: boolean
  /** индексы отрезков контура: первый и последний */
  first: number
  last: number
}

function linesOf(inner: Pt[]): Line[] {
  const edges = edgesAll(inner)
  const n = edges.length
  const parallel = (i: number, j: number) => edges[i].n.x * edges[j].n.x + edges[i].n.y * edges[j].n.y > 0.99
  const offset = (i: number, base: number) => (edges[i].a.x - edges[base].a.x) * edges[base].n.x + (edges[i].a.y - edges[base].a.y) * edges[base].n.y
  // продолжает ли отрезок i линию отрезка i − 2 через короткую перемычку
  const merge = orthogonal(inner)
  const continues = (i: number) => {
    if (!merge) return false
    const p = (i - 2 + n) % n
    const mid = (i - 1 + n) % n
    if (!parallel(i, p) || edges[mid].L > 45) return false
    const d = offset(i, p)
    return Math.abs(d) <= 45 && d <= MAX_BUMP + 5
  }
  const starts = edges.map((_, i) => !continues(i))
  if (!starts.some(Boolean)) return edges.map((_, i) => single(edges, i))
  const out: Line[] = []
  const used = new Set<number>()
  for (let i0 = 0; i0 < n; i0++) {
    if (!starts[i0] || used.has(i0)) continue
    const group = [i0]
    let i = i0
    while (continues((i + 2) % n) && !used.has((i + 2) % n) && (i + 2) % n !== i0) {
      used.add((i + 1) % n)
      i = (i + 2) % n
      group.push(i)
    }
    group.forEach((g) => used.add(g))
    const base = group.reduce((m, g) => (edges[g].L > edges[m].L ? g : m), group[0])
    const e = edges[base]
    const proj = (p: Pt) => (p.x - e.a.x) * e.dir.x + (p.y - e.a.y) * e.dir.y
    const t0 = proj(edges[group[0]].a)
    const parts: [number, number, number][] = group.map((g) => [proj(edges[g].a) - t0, proj(edges[g].b) - t0, offset(g, base)])
    const L = proj(edges[group[group.length - 1]].b) - t0
    const a = add(e.a, mul(e.dir, t0 - proj(e.a)))
    out.push({
      a,
      dir: e.dir,
      n: e.n,
      L,
      rot: normDeg((Math.atan2(-e.n.x, e.n.y) * 180) / Math.PI),
      bumps: parts.filter(([, , d]) => d > 0.5).map(([x, y, d]) => [x, y, d]),
      parts,
      startsOnBase: Math.abs(parts[0][2]) < 0.5,
      endsOnBase: Math.abs(parts[parts.length - 1][2]) < 0.5,
      first: group[0],
      last: group[group.length - 1],
    })
  }
  return out.filter((l) => l.L >= 20)
}

function single(edges: Edge[], i: number): Line {
  const e = edges[i]
  return { a: e.a, dir: e.dir, n: e.n, L: e.L, rot: normDeg((Math.atan2(-e.n.x, e.n.y) * 180) / Math.PI), bumps: [], parts: [[0, e.L, 0]], startsOnBase: true, endsOnBase: true, first: i, last: i }
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const L2 = vx * vx + vy * vy || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2))
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t))
}

/** окна стены — отрезками по её длине */
function windowsOn(l: Line, windows: [Pt, Pt][]): [number, number][] {
  const out: [number, number][] = []
  for (const [p, q] of windows) {
    // окно в этой стене: оба конца у её линии (толщина стены — до 60 см)
    const off = (x: Pt) => Math.abs((x.x - l.a.x) * l.n.x + (x.y - l.a.y) * l.n.y)
    if (off(p) > 40 || off(q) > 40) continue
    const tp = (p.x - l.a.x) * l.dir.x + (p.y - l.a.y) * l.dir.y
    const tq = (q.x - l.a.x) * l.dir.x + (q.y - l.a.y) * l.dir.y
    const lo = Math.max(0, Math.min(tp, tq))
    const hi = Math.min(l.L, Math.max(tp, tq))
    if (hi > lo) out.push([lo, hi])
  }
  return out
}

/** где встаёт тумба: внутри комнаты, мимо дверей, того, что стоит, и — если нельзя — окна */
function freeRuns(l: Line, inp: KitchenInput, wins: [number, number][]): [number, number][] {
  const step = 5
  const runs: [number, number][] = []
  let start = -1
  const inside = (p: Pt) => pointInPoly(p, inp.inner) || inp.inner.some((q, i) => segDist(p, q, inp.inner[(i + 1) % inp.inner.length]) < 2)
  const wallAt = (t: number) => l.parts.find(([a, b]) => t >= a - 0.01 && t <= b + 0.01)?.[2] ?? 0
  for (let t = 0; t < l.L - 0.01; t += step) {
    const t1 = Math.min(l.L, t + step)
    const back = Math.max(0, wallAt((t + t1) / 2)) + 1
    const rect = [add(l.a, add(mul(l.dir, t + 0.5), mul(l.n, back))), add(l.a, add(mul(l.dir, t1 - 0.5), mul(l.n, back))), add(l.a, add(mul(l.dir, t1 - 0.5), mul(l.n, DEPTH + 5))), add(l.a, add(mul(l.dir, t + 0.5), mul(l.n, DEPTH + 5)))]
    const underWindow = !inp.allowWindow && (wins.some(([a, b]) => t < b + 10 && t1 > a - 10) || (inp.windowZones ?? []).some((z) => convexOverlap(rect, z, 0.5)))
    const ok = !underWindow && wallAt((t + t1) / 2) <= MAX_BUMP && rect.every(inside) && !inp.blockers.some((b) => convexOverlap(rect, b, 0.5)) && !inp.doorZones.some((z) => convexOverlap(rect, z, 0.5))
    if (ok && start < 0) start = t
    if (!ok && start >= 0) {
      runs.push([start, t])
      start = -1
    }
  }
  if (start >= 0) runs.push([start, l.L])
  return runs
}

/** участок линии по ходу гарнитура: прямо или задом наперёд */
function leg(l: Line, from: number, to: number, reverse: boolean, windows: [number, number][]): Leg {
  const len = to - from
  const clip = (list: [number, number, number][]) => list.filter(([a, b]) => b > from + 0.5 && a < to - 0.5).map(([a, b, d]) => [Math.max(a, from), Math.min(b, to), d] as [number, number, number])
  const bumps = clip(l.bumps)
  const wins = windows.map(([a, b]) => [a, b, 0] as [number, number, number])
  if (!reverse) {
    return {
      origin: add(l.a, mul(l.dir, from)),
      dir: l.dir,
      n: l.n,
      len,
      rot: l.rot,
      windows: wins.map(([a, b]) => [a - from, b - from]),
      bumps: bumps.map(([a, b, d]) => [a - from, b - from, d]),
    }
  }
  return {
    origin: add(l.a, mul(l.dir, to)),
    dir: mul(l.dir, -1),
    n: l.n,
    len,
    rot: l.rot,
    windows: wins.map(([a, b]) => [to - b, to - a]),
    bumps: bumps.map(([a, b, d]) => [to - b, to - a, d] as [number, number, number]).sort((x, y) => x[0] - y[0]),
  }
}

/**
 * Порядок модулей: холодильник с краю, мойка с посудомойкой, у плиты столешница
 * с обеих сторон. Пенал и посудомойку, если они не встают, можно не ставить —
 * это дешевле, чем увести мойку от стояка
 */
function variants(has: { dw: boolean; tall: boolean }): { order: Token[]; dropped: string[] }[] {
  const out: { order: Token[]; dropped: string[] }[] = []
  for (const dw of has.dw ? [true, false] : [false]) {
    for (const tall of has.tall ? [true, false] : [false]) {
      const dropped = [...(has.dw && !dw ? ['посудомойка'] : []), ...(has.tall && !tall ? ['пенал'] : [])]
      for (const order of orders({ dw, tall })) out.push({ order, dropped })
    }
  }
  return out
}

function orders(has: { dw: boolean; tall: boolean }): Token[][] {
  const base: Token[][] = [
    ['fridge', 'C', 'sink', 'dw', 'W', 'stove', 'C'],
    ['fridge', 'C', 'dw', 'sink', 'W', 'stove', 'C'],
    ['fridge', 'C', 'stove', 'W', 'sink', 'dw', 'C0'],
    ['fridge', 'C', 'stove', 'W', 'dw', 'sink', 'C0'],
  ]
  const withDw = base.map((o) => o.filter((t) => t !== 'dw' || has.dw))
  // рабочую столешницу между мойкой и плитой может дать угол или столешница над шахтой
  const noW = withDw.map((o) => o.filter((t) => t !== 'W'))
  return [...withDw, ...noW].map((o) => (has.tall ? (['fridge', 'tall', ...o.slice(1)] as Token[]) : o))
}

/**
 * Ниша у края стены: стена там отступает на 8–45 см — туда просится холодильник.
 * Он встаёт спиной к задней стене ниши, вплотную к гарнитуру, и не отнимает
 * столешницу; фасад чуть глубже тумб — так и задумано
 */
interface Pocket {
  line: number
  /** участок по задней стене ниши, по ходу линии */
  leg: Leg
  /** граница ниши на линии: отсюда идёт гарнитур */
  mouth: number
  atStart: boolean
}

function pocketsOf(lines: Line[], wins: [number, number][][]): Pocket[] {
  const fw = CATALOG_MAP.fridge?.w ?? 60
  const out: Pocket[] = []
  lines.forEach((l, i) => {
    if (l.parts.length < 2) return
    for (const [[a, b, d], atStart] of [
      [l.parts[0], true],
      [l.parts[l.parts.length - 1], false],
    ] as [[number, number, number], boolean][]) {
      if (d > -8 || d < -45 || b - a < fw) continue
      const windows = wins[i].filter(([x, y]) => y > a && x < b).map(([x, y]) => [Math.max(x, a) - a, Math.min(y, b) - a] as [number, number])
      out.push({ line: i, leg: { origin: add(l.a, add(mul(l.dir, a), mul(l.n, d))), dir: l.dir, n: l.n, len: b - a, rot: l.rot, windows, bumps: [] }, mouth: atStart ? b : a, atStart })
    }
  })
  return out
}

// ---------- раскладка ----------

interface Placed {
  token: Token | 'cover'
  leg: Leg
  s: number
  w: number
  d: number
  /** столешница над шахтой: насколько стена выступает (тумба мельче) */
  bump?: number
  /** холодильник в нише */
  pocket?: boolean
}

/**
 * Разложить модули по одному участку от «якоря» — угла или начала участка.
 * Шахта (выступ) — неподвижная вставка: модули до неё и после, столешница
 * над ней и в зазоре перед ней. Возвращает варианты: куда встала шахта
 * между модулями
 */
function packLeg(tokens: Token[], lg: Leg, anchoredAtEnd: boolean, reserve: number): Placed[][] {
  const avail = lg.len - reserve
  if (avail < 0) return []
  // всё — в системе «расстояние от якоря»
  const toU = (s0: number, s1: number): [number, number] => (anchoredAtEnd ? [lg.len - reserve - s1, lg.len - reserve - s0] : [s0 - reserve, s1 - reserve])
  const blocks = lg.bumps
    .map(([a, b, d]) => [...toU(a, b), d] as [number, number, number])
    .filter(([a, b]) => b > 0 && a < avail)
    .sort((x, y) => x[0] - y[0])
  const out: Placed[][] = []
  // сколько шахт гарнитур проходит; за последней — свободная стена
  for (let m = 0; m <= blocks.length; m++) {
    const kept = blocks.slice(0, m)
    const end = m < blocks.length ? blocks[m][0] : avail
    if (kept.some(([a]) => a < 0)) continue
    // раскладка модулей по отрезкам между шахтами
    const comps = compositions(tokens.length, m + 1)
    for (const counts of comps) {
      let k = 0
      const items: { token: Token | 'cover'; u: number; w: number; bump?: number }[] = []
      let ok = true
      for (let seg = 0; seg <= m && ok; seg++) {
        const segStart = seg === 0 ? 0 : kept[seg - 1][1]
        const segEnd = seg < m ? kept[seg][0] : end
        const segTokens = tokens.slice(k, k + counts[seg])
        k += counts[seg]
        const fit = stretch(segTokens, segEnd - segStart)
        if (!fit) {
          ok = false
          break
        }
        let u = segStart
        segTokens.forEach((t, i) => {
          if (fit.sizes[i] > 0) items.push({ token: t, u, w: fit.sizes[i] })
          u += fit.sizes[i]
        })
        if (seg < m) {
          // столешница от последнего модуля до шахты и над ней
          const [b0, b1, depth] = kept[seg]
          if (segEnd - u > 0.5) items.push({ token: 'cover', u, w: segEnd - u })
          items.push({ token: 'cover', u: b0, w: b1 - b0, bump: depth })
        }
      }
      if (!ok) continue
      out.push(
        items.map((it) => {
          const [s0] = anchoredAtEnd ? [lg.len - reserve - (it.u + it.w)] : [it.u + reserve]
          return { token: it.token, leg: lg, s: s0, w: it.w, d: it.token === 'fridge' ? (CATALOG_MAP.fridge?.d ?? 65) : DEPTH, bump: it.bump }
        }),
      )
    }
  }
  return out
}

/** все раскладки n предметов по k отрезкам по порядку (отрезки могут быть пустыми) */
function compositions(n: number, k: number): number[][] {
  if (k === 1) return [[n]]
  const out: number[][] = []
  for (let i = 0; i <= n; i++) for (const rest of compositions(n - i, k - 1)) out.push([i, ...rest])
  return out
}

/** растянуть столешницы, чтобы модули заняли отрезок; null — не влезают */
function stretch(tokens: Token[], room: number): { sizes: number[]; rest: number } | null {
  const sizes = tokens.map(width)
  let rest = room - sizes.reduce((a, b) => a + b, 0)
  if (rest < -0.5) return null
  for (const kind of ['W', 'C', 'C0'] as Token[]) {
    let grew = true
    while (rest >= 20 && grew) {
      grew = false
      for (let i = 0; i < tokens.length && rest >= 20; i++) {
        if (tokens[i] !== kind || sizes[i] + 20 > maxOf(kind)) continue
        // столешница 20 или 40 см не бывает: пустая — сразу 60
        const step = sizes[i] === 0 ? 60 : 20
        if (step > rest) continue
        sizes[i] += step
        rest -= step
        grew = true
      }
    }
  }
  return { sizes, rest }
}

/** предметы гарнитура из разложенных модулей */
function toFurniture(placed: Placed[], cornerAt: { leg: Leg } | null): Furniture[] {
  const out: Furniture[] = []
  const at = (lg: Leg, s: number, w: number, back: number, d: number) => add(lg.origin, add(mul(lg.dir, s + w / 2), mul(lg.n, back + d / 2 + 0.5)))
  const put = (type: string, lg: Leg, s: number, w: number, d: number, back = 0) => {
    const c = at(lg, s, w, back, d)
    out.push({ id: uid('f'), type, x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, w: Math.round(w * 10) / 10, d, rot: lg.rot })
  }
  for (const p of placed) {
    if (p.token === 'cover') {
      // над шахтой — столешница на мелких тумбах: фасад в линию с остальными
      if (p.bump) put('counter-top', p.leg, p.s, p.w, DEPTH - p.bump, p.bump)
      else if (p.w >= 60 && Math.abs(p.w - Math.round(p.w / 20) * 20) < 0.5) counters(Math.round(p.w)).reduce((s, w) => (put(`counter-${w}`, p.leg, s, w, DEPTH), s + w), p.s)
      else put('counter-top', p.leg, p.s, p.w, DEPTH)
      continue
    }
    if (isCounterToken(p.token)) {
      counters(p.w).reduce((s, w) => (put(`counter-${w}`, p.leg, s, w, DEPTH), s + w), p.s)
      continue
    }
    put(TYPE[p.token as Exclude<Token, 'C' | 'W' | 'C0'>], p.leg, p.s, p.w, p.d)
  }
  if (cornerAt) {
    // угловой модуль — в углу между участками
    const lg = cornerAt.leg
    const c = add(lg.origin, add(mul(lg.dir, lg.len - 45), mul(lg.n, 45.5)))
    out.push({ id: uid('f'), type: 'counter-corner', x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, w: 90, d: 90, rot: lg.rot })
  }
  return out
}

/** Собрать гарнитур; null — ни одна раскладка не встала */
export function composeKitchen(inp: KitchenInput): KitchenRun | null {
  // сначала — у глухих стен; не встал — и под окном, с пометкой
  const first = compose(inp)
  if (first || inp.allowWindow) return first ? { ...first, atWindow: !!inp.allowWindow } : null
  const second = compose({ ...inp, allowWindow: true })
  return second ? { ...second, atWindow: true } : null
}

function compose(inp: KitchenInput): Omit<KitchenRun, 'atWindow'> | null {
  const want = new Set(inp.proposed.map((p) => p.type))
  const has = { dw: want.has('dishwasher'), tall: want.has('tall-cabinet') }
  const lines = linesOf(inp.inner)
  const wins = lines.map((l) => windowsOn(l, inp.windows))
  const runs = lines.map((l, i) => freeRuns(l, inp, wins[i]))
  const area = signedArea(inp.inner)

  type Cand = { legs: Leg[]; corner: boolean; pocket?: Pocket }
  const candidates: Cand[] = []
  lines.forEach((l, i) => {
    for (const [a, b] of runs[i]) {
      if (b - a < 240) continue
      for (const rev of [false, true]) candidates.push({ legs: [leg(l, a, b, rev, wins[i])], corner: false })
    }
  })
  // угол — там, где линии сходятся в вершине контура и обе у угла на своей базе
  const cornerAt = (i: number, j: number) => {
    const l1 = lines[i]
    const l2 = lines[j]
    if (!l1.endsOnBase || !l2.startsOnBase) return false
    if (dist(add(l1.a, mul(l1.dir, l1.L)), l2.a) > 1) return false
    const cross = l1.dir.x * l2.dir.y - l1.dir.y * l2.dir.x
    return Math.abs(cross) >= 0.9 && Math.sign(cross) === Math.sign(area)
  }
  for (let i = 0; i < lines.length; i++) {
    const l1 = lines[i]
    const j = (i + 1) % lines.length
    const l2 = lines[j]
    if (!cornerAt(i, j)) continue
    const r1 = runs[i].find(([, b]) => b >= l1.L - 5)
    const r2 = runs[j].find(([a]) => a <= 5)
    if (!r1 || !r2 || l1.L - r1[0] < 150 || r2[1] < 150) continue
    // по ходу: от края первой стены к углу и дальше по второй — или наоборот
    candidates.push({ legs: [leg(l1, r1[0], l1.L, false, wins[i]), leg(l2, 0, r2[1], false, wins[j])], corner: true })
    candidates.push({ legs: [leg(l2, 0, r2[1], true, wins[j]), leg(l1, r1[0], l1.L, true, wins[i])], corner: true })
  }
  // холодильник в нише у края стены, гарнитур — от ниши: вдоль стены или до угла
  for (const pk of pocketsOf(lines, wins)) {
    const i = pk.line
    const l = lines[i]
    if (pk.atStart) {
      const r = runs[i].find(([a, b]) => a <= pk.mouth + 5 && b > pk.mouth + 5)
      if (!r) continue
      if (r[1] - pk.mouth >= 180) candidates.push({ legs: [leg(l, pk.mouth, r[1], false, wins[i])], corner: false, pocket: pk })
      const j = (i + 1) % lines.length
      const r2 = runs[j].find(([a]) => a <= 5)
      if (r[1] >= l.L - 5 && cornerAt(i, j) && r2 && r2[1] >= 150) candidates.push({ legs: [leg(l, pk.mouth, l.L, false, wins[i]), leg(lines[j], 0, r2[1], false, wins[j])], corner: true, pocket: pk })
    } else {
      const r = runs[i].find(([a, b]) => b >= pk.mouth - 5 && a < pk.mouth - 5)
      if (!r) continue
      if (pk.mouth - r[0] >= 180) candidates.push({ legs: [leg(l, r[0], pk.mouth, true, wins[i])], corner: false, pocket: pk })
      const h = (i - 1 + lines.length) % lines.length
      const r1 = runs[h].find(([, b]) => b >= lines[h].L - 5)
      if (r[0] <= 5 && cornerAt(h, i) && r1 && lines[h].L - r1[0] >= 150) candidates.push({ legs: [leg(l, 0, pk.mouth, true, wins[i]), leg(lines[h], r1[0], lines[h].L, true, wins[h])], corner: true, pocket: pk })
    }
  }

  const pos = (type: string) => inp.proposed.find((p) => p.type === type)
  type Best = { score: number; furniture: Furniture[]; shape: 'line' | 'corner'; order: Token[]; corner: number; dropped: string[]; pocket: boolean }
  let best: Best | null = null
  const consider = (placed: Placed[], cand: Cand, order: Token[], corner: number, dropped: string[]) => {
    const furniture = toFurniture(placed, cand.corner ? { leg: cand.legs[0] } : null)
    const base = scoreRun(placed, furniture, inp, pos)
    if (base === null) return
    // каждый оставленный за бортом модуль — заметный минус: его просили
    const score = base + dropped.length * 120
    if (!best || score < best.score) best = { score, furniture, shape: cand.corner ? 'corner' : 'line', order, corner, dropped, pocket: !!cand.pocket }
  }
  const fw = CATALOG_MAP.fridge?.w ?? 60
  for (const cand of candidates) {
    const pk = cand.pocket
    // холодильник в нише — вплотную к гарнитуру; остальное — от ниши
    const pre: Placed[] = pk ? [{ token: 'fridge', leg: pk.leg, s: pk.atStart ? pk.leg.len - fw : 0, w: fw, d: CATALOG_MAP.fridge?.d ?? 65, pocket: true }] : []
    for (const { order: full, dropped } of variants(has)) {
      // холодильник в нише стоит глубже ряда: тумба за ним — по месту, не обязательно
      const order = pk ? full.slice(1).map((t, i) => (i === 0 && t === 'C' ? 'C0' : t)) : full
      const shift = pk ? 1 : 0
      if (!cand.corner) {
        for (const placed of packLeg(order, cand.legs[0], false, 0)) consider([...pre, ...placed], cand, full, -1, dropped)
        continue
      }
      for (let k = 1; k <= order.length; k++) {
        // на первом участке — от края к углу, на втором — от угла; всё на первом — за углом столешница
        const p0 = packLeg(order.slice(0, k).reverse(), cand.legs[0], true, 90)
        if (!p0.length) continue
        const p1 = packLeg(k < order.length ? order.slice(k) : ['C'], cand.legs[1], false, 90)
        for (const a of p0) {
          // от ниши до первого модуля — столешница: холодильник не стоит особняком
          const gap = pk ? Math.min(...a.map((q) => q.s)) : 0
          // до 10 см — просто зазор: холодильнику он и нужен, чтобы дышать
          const fill: Placed[] = gap >= 10 ? [{ token: 'cover', leg: cand.legs[0], s: 0, w: gap, d: DEPTH }] : []
          for (const b of p1) consider([...pre, ...fill, ...a, ...b], cand, full, k + shift, dropped)
        }
      }
    }
  }
  if (!best) return null
  const b = best as Best
  const names: Partial<Record<Token, string>> = { fridge: 'холодильник', tall: 'пенал', sink: 'мойка', dw: 'посудомойка', stove: 'плита' }
  const order = [...b.order.flatMap((t, i) => [...(i === b.corner ? ['угол'] : []), ...(names[t] ? [names[t]!] : [])]), ...(b.corner >= b.order.length ? ['угол'] : [])]
  const one = (type: string) => b.furniture.find((f) => f.type === type)
  const near = (p: Pt | undefined, list?: Pt[]) => (p && list?.length ? Math.round(Math.min(...list.map((q) => dist(p, q)))) : undefined)
  return { furniture: b.furniture, shape: b.shape, order, sinkToRiser: near(one('sink'), inp.risers), stoveToVent: near(one('stove'), inp.vents), dropped: b.dropped, fridgeInNiche: b.pocket }
}

/** Оценка раскладки: меньше — лучше; null — нельзя */
function scoreRun(placed: Placed[], furniture: Furniture[], inp: KitchenInput, pos: (type: string) => { x: number; y: number } | undefined): number | null {
  for (const f of furniture) {
    const body = obbCorners(f.x, f.y, f.w, f.d, f.rot)
    if (!body.every((p) => pointInPoly(p, inp.inner) || inp.inner.some((q, i) => segDist(p, q, inp.inner[(i + 1) % inp.inner.length]) < 2.5))) return null
    if (inp.blockers.some((b) => convexOverlap(body, b, 1.5)) || inp.doorZones.some((z) => convexOverlap(body, z, 1.5))) return null
    if (!inp.allowWindow && (inp.windowZones ?? []).some((z) => convexOverlap(body, z, 0.5))) return null
  }
  let score = 0
  const winHit = (p: Placed, margin = 0) => p.leg.windows.some(([a, b]) => p.s < b + margin && p.s + p.w > a - margin)
  for (const p of placed) {
    // высокое не закрывает окно
    if ((p.token === 'fridge' || p.token === 'tall') && winHit(p)) return null
    // плита у окна: штора, сквозняк задувает огонь
    if (p.token === 'stove' && winHit(p, 30)) score += 250
    // мойку у окна просили сами — уважим
    if (p.token === 'sink' && inp.allowWindow && winHit(p)) score -= 40
  }
  const one = (type: string) => furniture.find((f) => f.type === type)
  const fridge = one('fridge')
  const sink = one('sink')
  const stove = one('stove')
  if (!fridge || !sink || !stove) return null
  if (dist(stove, fridge) < 65) return null
  // у плиты с обеих сторон — столешница (тумба, столешница над шахтой или угол), а не край и не холодильник
  const stoveP = placed.find((p) => p.token === 'stove')!
  const corner = furniture.find((f) => f.type === 'counter-corner')
  for (const side of [-1, 1]) {
    const edge = side < 0 ? stoveP.s : stoveP.s + stoveP.w
    const nb = placed.find((q) => q !== stoveP && q.leg === stoveP.leg && Math.abs((side < 0 ? q.s + q.w : q.s) - edge) < 1)
    if (nb) {
      if (!(nb.token === 'cover' || isCounterToken(nb.token as Token))) return null
    } else if (!corner || dist(corner, stove) > 85) return null
  }
  // рабочий треугольник — как считает «Проверка»; чуть больше нормы — небольшой минус,
  // иначе мойка уйдёт от стояка ради лишних 20 см
  const tri = workTriangle(fridge, sink, stove)
  if (!tri.ok) {
    const over = tri.linear
      ? Math.max(0, tri.path - 450) + 30
      : tri.sides.reduce((s, x) => s + Math.max(0, x - 270) + Math.max(0, 90 - x), 0) + Math.max(0, tri.total - 800) + Math.max(0, 360 - tri.total)
    score += Math.min(300, 60 + over * 3)
  }
  // посудомойка — вплотную к мойке: через угол к ней тянуть шланги
  const dw = one('dishwasher')
  if (dw) {
    const sinkP = placed.find((p) => p.token === 'sink')!
    const dwP = placed.find((p) => p.token === 'dw')!
    const touching = sinkP.leg === dwP.leg && (Math.abs(sinkP.s + sinkP.w - dwP.s) < 1 || Math.abs(dwP.s + dwP.w - sinkP.s) < 1)
    if (!touching) score += 200
  }
  // высокое — не вплотную к окну и сбоку от него: тень на подоконник, откос не открыть
  // холодильник в нише — туда его и задумали, даже у окна
  const niche = placed.some((p) => p.pocket)
  for (const tall of furniture.filter((f) => (f.type === 'fridge' && !niche) || f.type === 'tall-cabinet')) {
    for (const [a, b] of inp.windows) if (segDist(tall, a, b) < Math.max(tall.w, tall.d) / 2 + 40) score += 80
  }
  // коммуникации — главное: мойка у стояка, плита у вентканала
  if (inp.risers?.length) {
    const d = Math.min(...inp.risers.map((r) => dist(r, sink)))
    score += d * 0.8 + (d > 250 ? 250 : 0)
  }
  if (inp.vents?.length) {
    const d = Math.min(...inp.vents.map((v) => dist(v, stove)))
    score += d * 0.4 + (d > 350 ? 150 : 0)
  }
  // холодильник ближе к входу: продукты не несут через всю кухню
  if (inp.doors.length) score += Math.min(...inp.doors.map((d) => dist(d, fridge))) * 0.15
  // где модель хотела мойку, плиту и холодильник — там и стараемся
  for (const f of [fridge, sink, stove]) {
    const p = pos(f.type)
    if (p) score += Math.min(dist(p, f), 400) * 0.1
  }
  // холодильник в нише: не торчит из гарнитура и не отнимает столешницу
  if (placed.some((p) => p.pocket)) score -= 150
  // больше столешницы — удобнее готовить
  const worktop = furniture.filter((f) => f.type.startsWith('counter-')).reduce((s, f) => s + f.w, 0)
  score -= worktop * 0.2
  return score
}
