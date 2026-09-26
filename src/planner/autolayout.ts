// Проверка расстановки, предложенной моделью.
//
// Модель рассуждает про эргономику неплохо, но координаты у неё приблизительные:
// предмет может вылезти за стену, наехать на соседний или встать в дверной проём.
// Поэтому ни один предмет не попадает в план без геометрической проверки — что
// не прошло, отбрасывается с причиной. Лучше меньше мебели, чем чушь на чертеже.
import type { AiPlacement } from './aicontract'
import type { Furniture, Plan, Pt, Room, Wall } from './types'
import { uid } from './types'
import { CATALOG, CATALOG_MAP, type CatalogItem } from './catalog'
import { furnitureBody, openingGeom } from './checks'
import { convexOverlap, dist, pointInPoly } from './geometry'

export interface PlacementCheck {
  item: AiPlacement
  ok: boolean
  /** почему предмет не приняли */
  reason?: string
  furniture?: Furniture
}

export interface LayoutOptions {
  /** насколько предмету позволено выступать за контур комнаты, см */
  outTolerance?: number
  /** с какого расстояния предмет притягивается к стене вплотную, см */
  snapCm?: number
}

export const DEFAULT_LAYOUT: Required<LayoutOptions> = { outTolerance: 8, snapCm: 25 }

/** Все ли углы предмета внутри комнаты */
function insideRoom(body: Pt[], room: Room, tol: number): boolean {
  for (const c of body) {
    if (pointInPoly(c, room.polygon)) continue
    // угол может чуть выйти за ось стены — это ещё не повод выбрасывать
    let near = false
    const poly = room.polygon
    for (let i = 0; i < poly.length && !near; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      near = pointSegDist(c, a, b) <= tol
    }
    if (!near) return false
  }
  return true
}

function pointSegDist(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const L2 = vx * vx + vy * vy
  if (L2 < 1e-9) return dist(p, a)
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2
  t = Math.min(1, Math.max(0, t))
  return dist(p, { x: a.x + vx * t, y: a.y + vy * t })
}

/** Притянуть предмет вплотную к ближайшей стене, если он уже почти у неё */
export function snapToWall(f: Furniture, walls: Wall[], snapCm: number): Furniture {
  let best: { w: Wall; d: number; n: Pt } | null = null
  for (const w of walls) {
    const vx = w.b.x - w.a.x
    const vy = w.b.y - w.a.y
    const L = Math.hypot(vx, vy)
    if (L < 1) continue
    const ux = vx / L
    const uy = vy / L
    const rel = { x: f.x - w.a.x, y: f.y - w.a.y }
    const along = rel.x * ux + rel.y * uy
    if (along < -f.w / 2 || along > L + f.w / 2) continue
    const off = rel.x * -uy + rel.y * ux
    const d = Math.abs(off)
    if (!best || d < best.d) best = { w, d, n: { x: -uy * Math.sign(off || 1), y: ux * Math.sign(off || 1) } }
  }
  if (!best) return f
  // нужный зазор: половина глубины предмета плюс половина толщины стены
  const want = f.d / 2 + best.w.thickness / 2
  const shift = best.d - want
  if (shift <= 0 || shift > snapCm) return f
  return { ...f, x: f.x - best.n.x * shift, y: f.y - best.n.y * shift }
}

/**
 * Проверить предложенную расстановку и превратить её в предметы плана.
 * Порядок важен: что модель назвала первым, то и приоритетнее при конфликте.
 */
export function vetLayout(
  items: AiPlacement[],
  room: Room,
  plan: Plan,
  options: LayoutOptions = {},
): PlacementCheck[] {
  const o = { ...DEFAULT_LAYOUT, ...options }
  const walls = plan.walls
  // двери в этой комнате: в их створ и на дугу открывания ставить нельзя
  const swings: Pt[][] = []
  for (const op of plan.openings) {
    if (op.kind === 'window') continue
    const wall = walls.find((w) => w.id === op.wallId)
    if (!wall) continue
    const g = openingGeom(op, wall)
    if (pointInPoly(g.center, room.polygon) || pointSegDistPoly(g.center, room.polygon) < 60) swings.push(g.swing)
  }
  // мебель, которая уже стоит в этой комнате
  const taken: Pt[][] = plan.furniture.filter((f) => pointInPoly({ x: f.x, y: f.y }, room.polygon)).map(furnitureBody)

  // журнальный стол в санузле геометрию пройдёт, а смысл — нет: только уместные в комнате типы
  const fitting = new Set(catalogForRoom(room.meta.name, CATALOG).map((c) => c.type))
  const out: PlacementCheck[] = []
  for (const item of items) {
    const cat: CatalogItem | undefined = CATALOG_MAP[item.type]
    if (!cat) {
      out.push({ item, ok: false, reason: `в каталоге нет типа «${item.type}»` })
      continue
    }
    if (!fitting.has(item.type)) {
      out.push({ item, ok: false, reason: `${cat.name}: не к месту в этой комнате` })
      continue
    }
    // пояснение идёт в note: подпись на чертеже должна оставаться короткой
    let f: Furniture = { id: uid('f'), type: item.type, x: item.x, y: item.y, w: cat.w, d: cat.d, rot: item.rot, note: item.why || undefined }
    if (!pointInPoly({ x: f.x, y: f.y }, room.polygon)) {
      out.push({ item, ok: false, reason: `${cat.name}: не поместился в комнате` })
      continue
    }
    f = snapToWall(f, walls, o.snapCm)
    const body = furnitureBody(f)
    if (!insideRoom(body, room, o.outTolerance)) {
      out.push({ item, ok: false, reason: `${cat.name}: не поместился в комнате` })
      continue
    }
    const hitsDoor = swings.some((s) => convexOverlap(s, body, 2))
    if (hitsDoor) {
      out.push({ item, ok: false, reason: `${cat.name}: мешает двери` })
      continue
    }
    const hitsOther = taken.some((t) => convexOverlap(t, body, 2))
    if (hitsOther) {
      out.push({ item, ok: false, reason: `${cat.name}: мешает другому предмету` })
      continue
    }
    taken.push(body)
    out.push({ item, ok: true, furniture: f })
  }
  return out
}

function pointSegDistPoly(p: Pt, poly: Pt[]): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const d = pointSegDist(p, poly[i], poly[(i + 1) % poly.length])
    if (d < best) best = d
  }
  return best
}

/** Положить принятые предметы в план */
export function applyLayout(plan: Plan, checks: PlacementCheck[]): Plan {
  const add = checks.filter((c) => c.ok && c.furniture).map((c) => c.furniture as Furniture)
  if (!add.length) return plan
  return { ...plan, furniture: [...plan.furniture, ...add] }
}

/** Что показать пользователю после проверки */
export function layoutSummary(checks: PlacementCheck[]): string {
  const ok = checks.filter((c) => c.ok).length
  const bad = checks.length - ok
  if (!bad) return `Поставлено предметов: ${ok}`
  const reasons = new Map<string, number>()
  for (const c of checks) if (!c.ok && c.reason) reasons.set(c.reason, (reasons.get(c.reason) ?? 0) + 1)
  const why = [...reasons].map(([r, n]) => `${r} — ${n}`).join(', ')
  return `Поставлено предметов: ${ok}. Отклонено ${bad}: ${why}`
}

/** Какие типы предложить модели для этой комнаты */
export function catalogForRoom(name: string, all: CatalogItem[]): { type: string; name: string; w: number; d: number }[] {
  const n = name.toLowerCase()
  const cats = new Set<string>(['misc'])
  if (/кухн/.test(n)) cats.add('kitchen')
  if (/ванн|санузел|туалет|душ|уборн/.test(n)) cats.add('bath')
  if (/спальн/.test(n)) cats.add('bedroom')
  if (/детск/.test(n)) cats.add('kids')
  if (/кабинет/.test(n)) cats.add('office')
  if (/прихож|коридор|холл|тамбур/.test(n)) cats.add('hall')
  if (/гостин|зал|студи|комнат/.test(n)) {
    cats.add('living')
    cats.add('bedroom')
  }
  // если комната не опознана, даём жилой набор
  if (cats.size === 1) {
    cats.add('living')
    cats.add('bedroom')
  }
  return all
    .filter((c) => cats.has(c.category) && !c.symbol)
    .map((c) => ({ type: c.type, name: c.name, w: c.w, d: c.d }))
}
