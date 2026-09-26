// Приёмы дизайнера: где стоят вещи относительно друг друга.
//
// Модель называет предметы, но композицию держит плохо: журнальный стол в метре
// от дивана, телевизор сбоку, торшер посреди комнаты, ковёр где придётся. У
// дизайнера на это правила, и они геометрические:
// - журнальный стол — перед диваном на 40–45 см: дотянуться рукой, пройти коленями;
// - кресла — по бокам журнального стола, лицом к нему: разговорная зона;
// - телевизор — на стене напротив дивана, в 2–3,5 м;
// - торшер — у кресла или у края дивана: уголок для чтения;
// - растение — у окна, не закрывая его;
// - ковёр под кроватью — под нижние две трети, с запасом по бокам, чтобы утром
//   ступать на тёплое; под диваном — передние ножки на ковре; под обеденным
//   столом — с запасом, чтобы отодвинутый стул не съезжал с ковра.
import type { Furniture, Pt } from './types'
import { add, dist, mul, norm, normDeg, pointInPoly, rotate, sub } from './geometry'

export interface Spot {
  x: number
  y: number
  rot: number
}

/** точка в системе предмета: x вправо, y к фасаду */
const local = (f: { x: number; y: number; rot: number }, lx: number, ly: number): Pt => add({ x: f.x, y: f.y }, rotate({ x: lx, y: ly }, f.rot))

/** журнальный стол перед диваном: зазор 45 см; у углового — перед длинной частью */
export function coffeeSpot(sofa: Furniture, corner: boolean, table: { d: number }): Spot {
  const seat = Math.min(95, sofa.d * 0.6)
  const p = corner ? local(sofa, -seat / 2, -sofa.d / 2 + seat + 45 + table.d / 2) : local(sofa, 0, sofa.d / 2 + 45 + table.d / 2)
  return { ...p, rot: sofa.rot }
}

/**
 * Кресла у журнального стола: по бокам лицом к нему и напротив дивана.
 * Кресло шире стола, поэтому по бокам его сдвигаем от дивана — проход
 * перед диваном остаётся свободным
 */
export function armchairSpots(table: Furniture, chair: { w: number; d: number }): Spot[] {
  const side = table.w / 2 + 25 + chair.d / 2
  const away = Math.max(0, chair.w / 2 - table.d / 2) + 5
  return [
    { ...local(table, side, away), rot: normDeg(table.rot + 90) },
    { ...local(table, -side, away), rot: normDeg(table.rot + 270) },
    { ...local(table, 0, table.d / 2 + 35 + chair.d / 2), rot: normDeg(table.rot + 180) },
  ]
}

/** торшер у кресла или у края дивана — сбоку от спинки */
export function lampSpots(host: Furniture, lamp: { w: number; d: number }): Spot[] {
  const x = host.w / 2 + lamp.w / 2 + 4
  const y = -host.d / 2 + lamp.d / 2 + 4
  return [
    { ...local(host, x, y), rot: 0 },
    { ...local(host, -x, y), rot: 0 },
  ]
}

/**
 * Телевизор на стене напротив дивана: луч от дивана вперёд до стены.
 * null — стены напротив нет или она ближе 1,5 м / дальше 4,5 м: так не смотрят
 */
export function tvSpot(sofa: Furniture, inner: Pt[], tv: { d: number }): Spot | null {
  const dir = rotate({ x: 0, y: 1 }, sofa.rot)
  const o = { x: sofa.x, y: sofa.y }
  let best: { t: number; n: Pt } | null = null
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i]
    const b = inner[(i + 1) % inner.length]
    const e = sub(b, a)
    const den = dir.x * e.y - dir.y * e.x
    if (Math.abs(den) < 1e-6) continue
    const t = ((a.x - o.x) * e.y - (a.y - o.y) * e.x) / den
    const u = ((a.x - o.x) * dir.y - (a.y - o.y) * dir.x) / den
    if (t <= sofa.d / 2 || u < 0 || u > 1) continue
    if (!best || t < best.t) best = { t, n: norm({ x: -e.y, y: e.x }) }
  }
  if (!best) return null
  // стена напротив — поперёк взгляда, а не вдоль
  if (Math.abs(best.n.x * dir.x + best.n.y * dir.y) < 0.9) return null
  const view = best.t - sofa.d / 2 - tv.d
  if (view < 150 || view > 450) return null
  const p = add(o, mul(dir, best.t - tv.d / 2 - 0.5))
  return { ...p, rot: normDeg(sofa.rot + 180) }
}

export interface WindowSeg {
  /** концы окна по внутренней грани стены */
  a: Pt
  b: Pt
  /** внутрь комнаты */
  n: Pt
}

/** растение у окна: у края проёма, чуть отступив от стены, — окно открыто, растению светло */
export function plantSpots(windows: WindowSeg[], plant: { w: number; d: number }): Spot[] {
  const out: Spot[] = []
  for (const w of windows) {
    const dir = norm(sub(w.b, w.a))
    for (const [end, s] of [
      [w.a, -1],
      [w.b, 1],
    ] as const) {
      const p = add(add(end, mul(dir, s * (plant.w / 2 + 6))), mul(w.n, plant.d / 2 + 8))
      out.push({ ...p, rot: 0 })
    }
  }
  return out
}

export interface RugPlace {
  x: number
  y: number
  w: number
  d: number
  rot: number
}

/** ковёр под кроватью: нижние две трети и по 50 см с боков */
export function rugUnderBed(bed: Furniture): RugPlace {
  const w = Math.min(bed.w + 100, 300)
  const d = Math.min(Math.round(bed.d * 0.65 + 50), 220)
  // от трети кровати до 50 см за изножьем
  const top = -bed.d / 2 + bed.d * 0.35
  const p = local(bed, 0, top + d / 2)
  return { ...p, w, d, rot: bed.rot }
}

/** ковёр перед диваном: передние ножки на ковре, журнальный стол — посередине */
export function rugBeforeSofa(sofa: Furniture, corner: boolean): RugPlace {
  const seat = Math.min(95, sofa.d * 0.6)
  const w = Math.min((corner ? sofa.w - seat : sofa.w) + 40, 300)
  const d = 170
  const front = corner ? -sofa.d / 2 + seat : sofa.d / 2
  const p = local(sofa, corner ? -seat / 2 : 0, front - 20 + d / 2)
  return { ...p, w, d, rot: sofa.rot }
}

/** ковёр под обеденным столом: по 60 см с каждой стороны — стул не съезжает с края */
export function rugUnderTable(table: Furniture): RugPlace {
  return { x: table.x, y: table.y, w: Math.min(table.w + 120, 320), d: Math.min(table.d + 120, 280), rot: table.rot }
}

/**
 * Тот же ковёр поменьше — если большой не лёг: уже по бокам и короче с дальнего
 * края. Край у кровати или дивана остаётся на месте — ковёр по-прежнему под ними
 */
export function smallerRugs(r: RugPlace, anchored: boolean, minW: number, minD: number): RugPlace[] {
  const out: RugPlace[] = []
  for (const dd of [0, 20, 40, 60]) {
    for (const dw of [0, 20, 40, 60, 80, 100]) {
      if (!dd && !dw) continue
      const w = r.w - dw
      const d = r.d - dd
      if (w < minW || d < minD) continue
      const shift = anchored ? -dd / 2 : 0
      out.push({ ...local(r, 0, shift), w, d, rot: r.rot })
    }
  }
  return out
}

/** ковёр целиком в комнате */
export function rugInside(r: RugPlace, inner: Pt[]): boolean {
  const pts = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => add({ x: r.x, y: r.y }, rotate({ x: (sx * r.w) / 2, y: (sy * r.d) / 2 }, r.rot)))
  return pts.every((p) => pointInPoly(p, inner) || inner.some((q, i) => segDist(p, q, inner[(i + 1) % inner.length]) < 2))
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const L2 = vx * vx + vy * vy || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2))
  return dist(p, { x: a.x + vx * t, y: a.y + vy * t })
}
