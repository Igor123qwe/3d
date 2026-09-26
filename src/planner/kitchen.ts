// Кухонный гарнитур собирает программа, а не модель.
//
// Модель ставила модули по одному: плита одна у противоположной стены,
// тумбы с зазорами, мойка отдельно от посудомойки — «ноль понимания». Гарнитур —
// это не набор предметов, а одна линия столешницы с порядком модулей, и его
// правила строгие: холодильник с краю, между ним и мойкой — столешница, рядом
// с мойкой — посудомойка, у плиты столешница с обеих сторон, плита не у окна и
// не вплотную к холодильнику, рабочий треугольник 4–8 м.
//
// Здесь: свободные участки стен (мимо дверей и того, что уже стоит), варианты —
// прямая вдоль одной стены или угловая «буквой Г» с угловым модулем, разный
// порядок и направление, — и выбор лучшего. От модели берётся состав (есть ли
// посудомойка и пенал) и стена, у которой она хотела кухню.
import type { Furniture, Pt } from './types'
import { uid } from './types'
import { CATALOG_MAP } from './catalog'
import { add, convexOverlap, dist, mul, norm, normDeg, obbCorners, perp, pointInPoly, sub } from './geometry'

/** модули гарнитура: их расставляет сборщик, а не проверка по одному */
export const KITCHEN_MODULES = new Set(['counter-60', 'counter-80', 'counter-100', 'counter-corner', 'sink', 'stove', 'fridge', 'dishwasher', 'tall-cabinet'])

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
  /** что предложила модель: состав и где она хотела кухню */
  proposed: { type: string; x: number; y: number }[]
}

export interface KitchenRun {
  furniture: Furniture[]
  /** прямая или угловая */
  shape: 'line' | 'corner'
  /** порядок модулей по линии — для пояснения */
  order: string[]
}

type Token = 'fridge' | 'tall' | 'sink' | 'dw' | 'stove' | 'corner' | 'C' | 'W' | 'C0'

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
}

const DEPTH = 60
const TYPE: Record<Exclude<Token, 'C' | 'W' | 'C0'>, string> = { fridge: 'fridge', tall: 'tall-cabinet', sink: 'sink', dw: 'dishwasher', stove: 'stove', corner: 'counter-corner' }
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

interface Edge {
  a: Pt
  b: Pt
  dir: Pt
  n: Pt
  L: number
  rot: number
}

function edgesOf(inner: Pt[]): Edge[] {
  const out: Edge[] = []
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i]
    const b = inner[(i + 1) % inner.length]
    const L = dist(a, b)
    if (L < 20) continue
    const dir = norm(sub(b, a))
    let n = perp(dir)
    if (!pointInPoly(add(add(a, mul(dir, L / 2)), mul(n, 2)), inner)) n = mul(n, -1)
    out.push({ a, b, dir, n, L, rot: normDeg((Math.atan2(-n.x, n.y) * 180) / Math.PI) })
  }
  return out
}

/** участки стены, где встаёт тумба глубиной 60: внутри комнаты, мимо дверей и того, что стоит */
function freeRuns(e: Edge, inp: KitchenInput): [number, number][] {
  const step = 5
  const runs: [number, number][] = []
  let start = -1
  const inside = (p: Pt) => pointInPoly(p, inp.inner) || inp.inner.some((q, i) => segDist(p, q, inp.inner[(i + 1) % inp.inner.length]) < 2)
  for (let t = 0; t < e.L - 0.01; t += step) {
    const t1 = Math.min(e.L, t + step)
    const rect = [add(e.a, add(mul(e.dir, t + 0.5), mul(e.n, 1))), add(e.a, add(mul(e.dir, t1 - 0.5), mul(e.n, 1))), add(e.a, add(mul(e.dir, t1 - 0.5), mul(e.n, DEPTH + 5))), add(e.a, add(mul(e.dir, t + 0.5), mul(e.n, DEPTH + 5)))]
    const ok = rect.every(inside) && !inp.blockers.some((b) => convexOverlap(rect, b, 0.5)) && !inp.doorZones.some((z) => convexOverlap(rect, z, 0.5))
    if (ok && start < 0) start = t
    if (!ok && start >= 0) {
      runs.push([start, t])
      start = -1
    }
  }
  if (start >= 0) runs.push([start, e.L])
  return runs
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const L2 = vx * vx + vy * vy || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2))
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t))
}

/** окна стены — отрезками по её длине */
function windowsOn(e: Edge, windows: [Pt, Pt][]): [number, number][] {
  const out: [number, number][] = []
  for (const [p, q] of windows) {
    // окно в этой стене: оба конца у её линии (толщина стены — до 60 см)
    const off = (x: Pt) => Math.abs((x.x - e.a.x) * e.n.x + (x.y - e.a.y) * e.n.y)
    if (off(p) > 40 || off(q) > 40) continue
    const tp = (p.x - e.a.x) * e.dir.x + (p.y - e.a.y) * e.dir.y
    const tq = (q.x - e.a.x) * e.dir.x + (q.y - e.a.y) * e.dir.y
    const lo = Math.max(0, Math.min(tp, tq))
    const hi = Math.min(e.L, Math.max(tp, tq))
    if (hi > lo) out.push([lo, hi])
  }
  return out
}

/** участок стены по ходу гарнитура: прямо или задом наперёд */
function leg(e: Edge, from: number, to: number, reverse: boolean, windows: [number, number][]): Leg {
  const len = to - from
  if (!reverse) return { origin: add(e.a, mul(e.dir, from)), dir: e.dir, n: e.n, len, rot: e.rot, windows: windows.map(([a, b]) => [a - from, b - from]) }
  return { origin: add(e.a, mul(e.dir, to)), dir: mul(e.dir, -1), n: e.n, len, rot: e.rot, windows: windows.map(([a, b]) => [to - b, to - a]) }
}

/** порядок модулей: холодильник с краю, мойка с посудомойкой, у плиты столешница с обеих сторон */
function orders(has: { dw: boolean; tall: boolean }): Token[][] {
  const base: Token[][] = [
    ['fridge', 'C', 'sink', 'dw', 'W', 'stove', 'C'],
    ['fridge', 'C', 'dw', 'sink', 'W', 'stove', 'C'],
    ['fridge', 'C', 'stove', 'W', 'sink', 'dw', 'C0'],
    ['fridge', 'C', 'stove', 'W', 'dw', 'sink', 'C0'],
  ]
  return base.map((o) => o.filter((t) => t !== 'dw' || has.dw)).map((o) => (has.tall ? (['fridge', 'tall', ...o.slice(1)] as Token[]) : o))
}

interface Placed {
  token: Token
  leg: Leg
  s: number
  w: number
  d: number
}

/**
 * Разложить модули по участкам: на первом — от края к углу, на втором — от
 * угла дальше. Лишняя длина — в столешницы (рабочая между мойкой и плитой до
 * 120 см, остальные до 100), что не влезло — свободная стена у края
 */
function layOut(parts: Token[][], legs: Leg[], corner: boolean): Placed[] | null {
  const out: Placed[] = []
  for (let k = 0; k < parts.length; k++) {
    const tokens = parts[k]
    const lg = legs[k]
    const room = lg.len - (corner ? 90 : 0)
    const sizes = tokens.map(width)
    let rest = room - sizes.reduce((a, b) => a + b, 0)
    if (rest < 0) return null
    // прибавка по 20 см: сперва рабочей столешнице, потом остальным
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
    // первый участок прижат к углу (или к началу, если угла нет), второй — от угла
    let s = k === 0 ? (corner ? lg.len - 90 - (room - rest) : 0) : 90
    for (let i = 0; i < tokens.length; i++) {
      if (sizes[i] > 0) out.push({ token: tokens[i], leg: lg, s, w: sizes[i], d: tokens[i] === 'fridge' ? (CATALOG_MAP.fridge?.d ?? 65) : DEPTH })
      s += sizes[i]
    }
  }
  return out
}

/** предметы гарнитура из разложенных модулей */
function toFurniture(placed: Placed[], cornerAt: { leg: Leg } | null): Furniture[] {
  const out: Furniture[] = []
  const at = (lg: Leg, s: number, w: number, d: number) => add(lg.origin, add(mul(lg.dir, s + w / 2), mul(lg.n, d / 2 + 0.5)))
  for (const p of placed) {
    const pieces = p.token === 'C' || p.token === 'W' || p.token === 'C0' ? counters(p.w) : [p.w]
    let s = p.s
    for (const w of pieces) {
      const type = p.token === 'C' || p.token === 'W' || p.token === 'C0' ? `counter-${w}` : TYPE[p.token]
      const c = at(p.leg, s, w, p.d)
      out.push({ id: uid('f'), type, x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, w: CATALOG_MAP[type]?.w ?? w, d: p.d, rot: p.leg.rot })
      s += w
    }
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
  const want = new Set(inp.proposed.map((p) => p.type))
  const has = { dw: want.has('dishwasher'), tall: want.has('tall-cabinet') }
  const edges = edgesOf(inp.inner)
  const runs = edges.map((e) => freeRuns(e, inp))
  const wins = edges.map((e) => windowsOn(e, inp.windows))
  // направление обхода контура: угол «внутрь комнаты» — там, где поворот в ту же сторону
  const area = inp.inner.reduce((s, p, i) => {
    const q = inp.inner[(i + 1) % inp.inner.length]
    return s + p.x * q.y - q.x * p.y
  }, 0)

  const candidates: { legs: Leg[]; corner: boolean }[] = []
  edges.forEach((e, i) => {
    for (const [a, b] of runs[i]) {
      if (b - a < 240) continue
      for (const rev of [false, true]) candidates.push({ legs: [leg(e, a, b, rev, wins[i])], corner: false })
    }
  })
  for (let i = 0; i < edges.length; i++) {
    const e1 = edges[i]
    const j = (i + 1) % edges.length
    const e2 = edges[j]
    if (dist(e1.b, e2.a) > 1) continue
    const cross = e1.dir.x * e2.dir.y - e1.dir.y * e2.dir.x
    if (Math.abs(cross) < 0.9 || Math.sign(cross) !== Math.sign(area)) continue
    const r1 = runs[i].find(([, b]) => b >= e1.L - 5)
    const r2 = runs[j].find(([a]) => a <= 5)
    if (!r1 || !r2 || e1.L - r1[0] < 150 || r2[1] < 150) continue
    // по ходу: от края первой стены к углу и дальше по второй — или наоборот
    candidates.push({ legs: [leg(e1, r1[0], e1.L, false, wins[i]), leg(e2, 0, r2[1], false, wins[j])], corner: true })
    candidates.push({ legs: [leg(e2, 0, r2[1], true, wins[j]), leg(e1, r1[0], e1.L, true, wins[i])], corner: true })
  }

  const pos = (type: string) => inp.proposed.find((p) => p.type === type)
  let best: { score: number; furniture: Furniture[]; shape: 'line' | 'corner'; order: string[] } | null = null
  for (const cand of candidates) {
    for (const order of orders(has)) {
      const splits = cand.corner ? order.map((_, k) => k).filter((k) => k >= 1 && k < order.length) : [order.length]
      for (const k of splits) {
        const variants: Token[][][] = cand.corner ? [[order.slice(0, k), order.slice(k)]] : [[order]]
        // в угловой кухне рабочая поверхность между мойкой и плитой — сам угловой модуль:
        // мойка ближе к холодильнику, треугольник короче
        if (cand.corner && order[k - 1] === 'W' && k > 1) variants.push([order.slice(0, k - 1), order.slice(k)])
        if (cand.corner && order[k] === 'W' && k + 1 < order.length) variants.push([order.slice(0, k), order.slice(k + 1)])
        for (const parts of variants) {
          const placed = layOut(parts, cand.legs, cand.corner)
          if (!placed) continue
          const furniture = toFurniture(placed, cand.corner ? { leg: cand.legs[0] } : null)
          const score = scoreRun(placed, furniture, inp, pos)
          if (score === null) continue
          if (!best || score < best.score) best = { score, furniture, shape: cand.corner ? 'corner' : 'line', order: cand.corner ? [...parts[0], 'corner', ...parts[1]] : order }
        }
      }
    }
  }
  if (!best) return null
  const names: Record<string, string> = { fridge: 'холодильник', tall: 'пенал', sink: 'мойка', dw: 'посудомойка', stove: 'плита', corner: 'угол' }
  const order = best.order.filter((t) => names[t]).map((t) => names[t])
  return { furniture: best.furniture, shape: best.shape, order }
}

/** Оценка раскладки: меньше — лучше; null — нельзя (холодильник у окна, плита вплотную к нему, не встаёт) */
function scoreRun(placed: Placed[], furniture: Furniture[], inp: KitchenInput, pos: (type: string) => { x: number; y: number } | undefined): number | null {
  for (const f of furniture) {
    const body = obbCorners(f.x, f.y, f.w, f.d, f.rot)
    if (!body.every((p) => pointInPoly(p, inp.inner) || inp.inner.some((q, i) => segDist(p, q, inp.inner[(i + 1) % inp.inner.length]) < 2.5))) return null
    if (inp.blockers.some((b) => convexOverlap(body, b, 1.5)) || inp.doorZones.some((z) => convexOverlap(body, z, 1.5))) return null
  }
  let score = 0
  const winHit = (p: Placed, margin = 0) => p.leg.windows.some(([a, b]) => p.s < b + margin && p.s + p.w > a - margin)
  for (const p of placed) {
    // высокое не закрывает окно
    if ((p.token === 'fridge' || p.token === 'tall') && winHit(p)) return null
    // плита у окна: штора, сквозняк задувает огонь
    if (p.token === 'stove' && winHit(p, 30)) score += 250
    // мойка у окна — светло и видно улицу
    if (p.token === 'sink' && winHit(p)) score -= 60
  }
  const one = (type: string) => furniture.find((f) => f.type === type)
  const fridge = one('fridge')
  const sink = one('sink')
  const stove = one('stove')
  if (!fridge || !sink || !stove) return null
  if (dist(stove, fridge) < 65) return null
  // рабочий треугольник — как считает «Проверка»: 3,6–8 м, каждая сторона 0,9–2,7 м
  const sides = [dist(fridge, sink), dist(sink, stove), dist(stove, fridge)]
  const total = sides.reduce((a, b) => a + b, 0)
  if (!(total >= 360 && total <= 800 && sides.every((s) => s >= 90 && s <= 270))) score += 300
  // холодильник ближе к входу: продукты не несут через всю кухню
  if (inp.doors.length) score += Math.min(...inp.doors.map((d) => dist(d, fridge))) * 0.15
  // где модель хотела мойку, плиту и холодильник — там и стараемся
  for (const f of [fridge, sink, stove]) {
    const p = pos(f.type)
    if (p) score += Math.min(dist(p, f), 400) * 0.15
  }
  // больше столешницы — удобнее готовить
  const worktop = furniture.filter((f) => f.type.startsWith('counter-')).reduce((s, f) => s + f.w, 0)
  score -= worktop * 0.3
  return score
}
