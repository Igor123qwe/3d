// Проверка расстановки, предложенной моделью, и починка того, что не встало.
//
// Модель рассуждает про эргономику неплохо, но координаты у неё приблизительные:
// предмет может вылезти за стену, наехать на соседний или встать в дверной
// проём. Раньше такой предмет просто выбрасывался, и в спальне не оказывалось
// кровати. Теперь предложенное место — это намерение: если оно не подходит,
// ищем ближайшее, где предмет встаёт честно, — спинкой к стене, как ставит
// магнит, мимо двери и соседей. Не нашлось — пробуем тот же предмет поменьше
// (кровать 140 вместо 160). И только если нигде нет места, отказываем —
// с причиной. Судья один с «Проверкой»: что прошло здесь, там не станет красным.
import type { AiPlacement } from './aicontract'
import type { Furniture, Plan, Pt, Room, Wall } from './types'
import { uid } from './types'
import { CATALOG, CATALOG_MAP, dims3d, type CatalogItem } from './catalog'
import { furnitureBody, openingGeom, wallBody, zonesOf } from './checks'
import { add, convexOverlap, dist, mul, norm, normDeg, obbCorners, perp, pointInPoly, rotate, sub } from './geometry'

export interface PlacementCheck {
  item: AiPlacement
  ok: boolean
  /** почему предмет не приняли */
  reason?: string
  furniture?: Furniture
  /** на сколько сантиметров место отличается от предложенного моделью */
  moved?: number
  /** поставлен предмет поменьше: какой был предложен */
  replaced?: string
  /** модель этого не предлагала — добавлено по правилу (тумбы к кровати) */
  added?: boolean
  /** шкаф растянут на всю нишу: новая ширина, см */
  widened?: number
}

export interface LayoutOptions {
  /** насколько предмету позволено выступать за контур комнаты, см */
  outTolerance?: number
  /** с какого расстояния предмет притягивается к стене вплотную, см */
  snapCm?: number
  /** назначение комнаты, под которое спрашивали модель; нет — по имени комнаты */
  purpose?: string
}

export const DEFAULT_LAYOUT: Required<Omit<LayoutOptions, 'purpose'>> = { outTolerance: 2, snapCm: 25 }

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

type Fail = 'room' | 'wall' | 'door' | 'other'

interface Ctx {
  /** контур по внутренним граням: здесь предмету место */
  inner: Pt[]
  walls: Pt[][]
  swings: Pt[][]
  /** точки у окон со стороны комнаты: высокий шкаф их закрывать не должен */
  windowPts: Pt[]
  taken: Pt[][]
  /** зоны подхода уже стоящих предметов: новый предмет их не перекрывает */
  takenZones: Pt[][]
  tol: number
  /** двуспальные кровати, что уже встали: к ним — тумбы по бокам */
  beds?: Furniture[]
}

/** двуспальная кровать: по центру стены, подход с двух сторон, тумбы по бокам */
const isDoubleBed = (cat: CatalogItem | undefined) => cat?.glyph === 'bed' && cat.w >= 140

/** Сколько свободно сбоку от предмета: от боковой грани наружу до стены или соседа, см */
function sideRoom(f: Furniture, side: -1 | 1, c: Ctx, limit = 250): number {
  const out = rotate({ x: side, y: 0 }, f.rot)
  // посередине длины кровати: там, где к ней подходят
  const start = add({ x: f.x, y: f.y }, rotate({ x: (side * f.w) / 2, y: 0 }, f.rot))
  for (let k = 5; k <= limit; k += 5) {
    const q = add(start, mul(out, k))
    if (!pointInPoly(q, c.inner) || c.taken.some((t) => pointInPoly(q, t))) return k - 5
  }
  return limit
}

/** Где встают тумбы у кровати: вплотную к бокам изголовья, спинкой к той же стене */
function nightstandSpots(bed: Furniture, w: number, d: number): Spot[] {
  return ([-1, 1] as const).map((side) => {
    const c = add({ x: bed.x, y: bed.y }, rotate({ x: side * (bed.w / 2 + w / 2 + 2), y: -bed.d / 2 + d / 2 }, bed.rot))
    return { x: c.x, y: c.y, rot: bed.rot }
  })
}

/** Встаёт ли предмет честно; нет — что мешает */
function fits(f: Furniture, c: Ctx): Fail | null {
  const body = furnitureBody(f)
  for (const p of body) if (!pointInPoly(p, c.inner) && pointSegDistPoly(p, c.inner) > c.tol) return 'room'
  // комната с выступом: угол выступа внутри предмета — значит предмет режет стену
  const core = obbCorners(f.x, f.y, Math.max(1, f.w - 4), Math.max(1, f.d - 4), f.rot)
  if (c.inner.some((v) => pointInPoly(v, core))) return 'room'
  if (c.walls.some((w) => convexOverlap(body, w, 1.5))) return 'wall'
  if (c.swings.some((s) => convexOverlap(s, body, 2))) return 'door'
  if (c.taken.some((t) => convexOverlap(t, body, 1.5))) return 'other'
  return null
}

/** Насколько место неудобно: закрытые зоны подхода — свои и соседей, высокий предмет перед окном */
function penalty(f: Furniture, cat: CatalogItem, c: Ctx): number {
  let p = 0
  for (const z of zonesOf(f, cat)) {
    const blocked = c.walls.some((w) => convexOverlap(z.poly, w, 1.5)) || c.taken.some((t) => convexOverlap(z.poly, t, 1.5)) || c.swings.some((s) => convexOverlap(z.poly, s, 2))
    // дверцы шкафа и ящики комода, упёртые в кровать, — не открыть: это дороже узкого прохода
    if (blocked) p += z.side === 'front' && (cat.glyph === 'wardrobe' || cat.glyph === 'drawers') ? 160 : 80
  }
  const body = furnitureBody(f)
  for (const z of c.takenZones) if (convexOverlap(body, z, 1.5)) p += 80
  // окно: высокое его не закрывает; изголовье не под окном; зеркало столика — не спиной к свету
  if (c.windowPts.length) {
    const near = obbCorners(f.x, f.y, f.w + 8, f.d + 8, f.rot)
    const atWindow = c.windowPts.some((q) => pointInPoly(q, near))
    if (atWindow && dims3d(f).h >= 90) p += 250
    const bc = add({ x: f.x, y: f.y }, rotate({ x: 0, y: -f.d / 2 }, f.rot))
    const backToWindow = atWindow && c.windowPts.some((q) => pointInPoly(q, obbCorners(bc.x, bc.y, f.w + 8, 30, f.rot)))
    // изголовье под окном — дует и светит в глаза; зеркало и стол спиной к окну — сам себе тень.
    // Дороже переноса через всю комнату: такое место берётся, только если другого нет
    if (backToWindow && (cat.glyph === 'bed' || f.type === 'vanity')) p += 320
    // столик и стол — рядом с окном боком к нему: свет сбоку
    if (!backToWindow && (f.type === 'vanity' || cat.glyph === 'desk') && c.windowPts.some((q) => dist(q, f) < Math.max(f.w, f.d) / 2 + 90)) p -= 40
  }
  // двуспальная кровать: к ней подходят с двух сторон — по центру стены, не меньше 60 см с каждой
  if (isDoubleBed(cat)) {
    const l = sideRoom(f, -1, c)
    const r = sideRoom(f, 1, c)
    if (Math.min(l, r) < 60) p += (60 - Math.min(l, r)) * 3
    p += Math.min(Math.abs(l - r), 200) * 0.8
  }
  // тумба — у изголовья кровати, а не где пришлось
  if (f.type === 'nightstand' && c.beds?.length) {
    let best = Infinity
    for (const b of c.beds) for (const s of nightstandSpots(b, f.w, f.d)) best = Math.min(best, dist(s, f))
    p += Math.min(best, 200)
  }
  return p
}

interface Spot {
  x: number
  y: number
  rot: number
}

/** стороны комнаты: отрезок и нормаль внутрь */
function edgesOf(inner: Pt[]): { a: Pt; dir: Pt; n: Pt; L: number }[] {
  const out: { a: Pt; dir: Pt; n: Pt; L: number }[] = []
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i]
    const b = inner[(i + 1) % inner.length]
    const L = dist(a, b)
    if (L < 20) continue
    const dir = norm(sub(b, a))
    let n = perp(dir)
    const mid = add(a, mul(dir, L / 2))
    if (!pointInPoly(add(mid, mul(n, 2)), inner)) n = mul(n, -1)
    out.push({ a, dir, n, L })
  }
  return out
}

/** Места для предмета размером w×d: спинкой к каждой стене с шагом 10 см */
function wallSpots(w: number, d: number, inner: Pt[]): Spot[] {
  const out: Spot[] = []
  for (const e of edgesOf(inner)) {
    if (e.L < w) continue
    const rot = normDeg((Math.atan2(-e.n.x, e.n.y) * 180) / Math.PI)
    for (let t = w / 2; t <= e.L - w / 2 + 0.01; t += 10) {
      const c = add(add(e.a, mul(e.dir, t)), mul(e.n, d / 2 + 0.5))
      out.push({ x: c.x, y: c.y, rot })
    }
    // и вплотную к правому концу стены
    const c = add(add(e.a, mul(e.dir, e.L - w / 2)), mul(e.n, d / 2 + 0.5))
    out.push({ x: c.x, y: c.y, rot })
  }
  return out
}

/** Свободные места вокруг точки: сетка с шагом step в радиусе r */
function gridSpots(p: Spot, r: number, step: number): Spot[] {
  const out: Spot[] = []
  for (let dx = -r; dx <= r; dx += step) for (let dy = -r; dy <= r; dy += step) if (dx * dx + dy * dy <= r * r) for (const k of [0, 90]) out.push({ x: p.x + dx, y: p.y + dy, rot: normDeg(p.rot + k) })
  return out
}

const angleGap = (a: number, b: number) => {
  const d = Math.abs(normDeg(a) - normDeg(b)) % 360
  return Math.min(d, 360 - d)
}

/**
 * Лучшее честное место для предмета cat рядом с предложенным want.
 * null — нигде в комнате не встаёт; fail — что мешало чаще всего
 */
function findSpot(cat: CatalogItem, want: Spot, c: Ctx): { spot: Spot; moved: number; cost: number } | { fail: Fail } {
  const make = (s: Spot): Furniture => ({ id: 'probe', type: cat.type, x: s.x, y: s.y, w: cat.w, d: cat.d, rot: s.rot })
  const fails: Record<Fail, number> = { room: 0, wall: 0, door: 0, other: 0 }
  let best: { spot: Spot; cost: number } | null = null
  const consider = (s: Spot, extra = 0) => {
    const f = make(s)
    const why = fits(f, c)
    if (why) {
      fails[why]++
      return
    }
    // расстояние до предложенного — главное, но не больше 3 м: если модель
    // промахнулась мимо комнаты, место выбирают удобство и проходы, а не «ближе к промаху»
    const cost = Math.min(dist(s, want), 300) + (angleGap(s.rot, want.rot) > 1 ? 40 : 0) + penalty(f, cat, c) + extra
    if (!best || cost < best.cost) best = { spot: s, cost }
  }
  const wallish = !!cat.wallSnap
  // 1. как предложено; у предмета «к стене» — со штрафом за зазор до стены,
  //    чтобы шкаф в 20 см от стены встал к ней вплотную
  let gapToWall = Infinity
  for (const p of furnitureBody(make(want))) gapToWall = Math.min(gapToWall, pointSegDistPoly(p, c.inner))
  consider(want, wallish && gapToWall < 60 ? gapToWall * 1.5 + 1 : 0)
  // 2. спинкой к стене — для всего, что к стене и ставится; тумбам — места у изголовья
  if (wallish) for (const s of wallSpots(cat.w, cat.d, c.inner)) consider(s)
  if (cat.type === 'nightstand') for (const b of c.beds ?? []) for (const s of nightstandSpots(b, cat.w, cat.d)) consider(s)
  // 3. рядом с предложенным, потом по всей комнате
  if (!best) for (const s of gridSpots(want, 250, 10)) consider(s)
  if (!best) {
    const xs = c.inner.map((p) => p.x)
    const ys = c.inner.map((p) => p.y)
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 15) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 15) for (const k of [0, 90]) consider({ x, y, rot: normDeg(want.rot + k) })
  }
  if (best) {
    const b = best as { spot: Spot; cost: number }
    return { spot: b.spot, moved: dist(b.spot, want), cost: b.cost }
  }
  const order: Fail[] = ['other', 'door', 'wall', 'room']
  const top = order.reduce((m, k) => (fails[k] > fails[m] ? k : m), order[0])
  return { fail: top }
}

/** центр предмета, если x, y у модели — левый верхний угол его рамки */
function cornerToCenter(it: AiPlacement): AiPlacement {
  const cat = CATALOG_MAP[it.type]
  if (!cat) return it
  const side = Math.round(normDeg(it.rot) / 90) % 2 === 1
  return { ...it, x: it.x + (side ? cat.d : cat.w) / 2, y: it.y + (side ? cat.w : cat.d) / 2 }
}

/** Прочесть ответ как центры (как просили) или как углы — что честнее встаёт */
export function readPlacements(items: AiPlacement[], c: { inner: Pt[]; walls: Pt[][]; swings: Pt[][]; windowPts: Pt[]; taken: Pt[][]; takenZones: Pt[][]; tol: number }): AiPlacement[] {
  const misses = (list: AiPlacement[]) =>
    list.reduce((n, it) => {
      const cat = CATALOG_MAP[it.type]
      if (!cat) return n
      return n + (fits({ id: 'probe', type: it.type, x: it.x, y: it.y, w: cat.w, d: cat.d, rot: normDeg(it.rot) }, c) ? 1 : 0)
    }, 0)
  const corners = items.map(cornerToCenter)
  return misses(corners) < misses(items) ? corners : items
}

/** цена места, как её считает findSpot: близость к предложенному плюс неудобства */
function spotCost(f: Furniture, cat: CatalogItem, want: Spot, c: Ctx): number {
  return Math.min(dist(f, want), 300) + (angleGap(f.rot, want.rot) > 1 ? 40 : 0) + penalty(f, cat, c)
}

/** чем заменить, если так удобнее: распашному шкафу перед кроватью не хватает места на дверцы — купе */
const ALTERNATIVES: Record<string, string[]> = { wardrobe: ['wardrobe-slide'] }

/** шкафы растягиваются на всю нишу или стену, где встали */
const FILLS = new Set(['wardrobe', 'wardrobe-slide'])
const FILL_MAX = 300

/**
 * Растянуть шкаф вдоль стены на всё свободное место: до угла, выступа,
 * двери, окна или соседа — как встроенный шкаф в нишу. Не больше 3 м;
 * новых закрытых проходов соседям не добавлять
 */
function fillAlongWall(f: Furniture, cat: CatalogItem, c: Ctx): Furniture {
  const dir = rotate({ x: 1, y: 0 }, f.rot)
  // и чужие проходы, и свой фронт: дверцы у края шкафа тоже должны открываться
  const zonesHit = (g: Furniture) => {
    const body = furnitureBody(g)
    const others = c.takenZones.filter((z) => convexOverlap(body, z, 1.5)).length
    const own = zonesOf(g, cat).filter((z) => c.taken.some((t) => convexOverlap(z.poly, t, 1.5)) || c.swings.some((s) => convexOverlap(z.poly, s, 2))).length
    return others + own
  }
  const nearWindow = (g: Furniture) => {
    const near = obbCorners(g.x, g.y, g.w + 8, g.d + 8, g.rot)
    return c.windowPts.some((q) => pointInPoly(q, near))
  }
  const base = zonesHit(f)
  let cur = f
  for (let k = 0; k < 80; k++) {
    let grew = false
    for (const side of [-1, 1] as const) {
      if (cur.w + 5 > FILL_MAX) break
      const ctr = add({ x: cur.x, y: cur.y }, mul(dir, side * 2.5))
      const next: Furniture = { ...cur, x: ctr.x, y: ctr.y, w: cur.w + 5 }
      if (fits(next, c) || zonesHit(next) > base || nearWindow(next)) continue
      cur = next
      grew = true
    }
    if (!grew) break
  }
  if (cur.w - f.w < 10) return f
  return { ...cur, x: Math.round(cur.x * 10) / 10, y: Math.round(cur.y * 10) / 10, w: Math.round(cur.w) }
}

/** тот же предмет поменьше: кровать 140 вместо 160 */
function smallerOf(cat: CatalogItem): CatalogItem[] {
  return CATALOG.filter((c) => c.type !== cat.type && c.category === cat.category && c.glyph === cat.glyph && !c.symbol && c.w * c.d < cat.w * cat.d).sort((a, b) => b.w * b.d - a.w * a.d)
}

const FAIL_TEXT: Record<Fail, string> = {
  room: 'не помещается в комнате',
  wall: 'не помещается между стенами',
  door: 'всюду мешает двери',
  other: 'не осталось места — мешают другие предметы',
}

/**
 * Проверить предложенную расстановку, поправить места и превратить её в предметы плана.
 * Порядок важен: что модель назвала первым, то и приоритетнее при конфликте.
 */
export function vetLayout(proposed: AiPlacement[], room: Room, plan: Plan, options: LayoutOptions = {}): PlacementCheck[] {
  let items = proposed
  const o = { ...DEFAULT_LAYOUT, ...options }
  const walls = plan.walls
  const inner = room.inner.length >= 3 ? room.inner : room.polygon
  // двери в этой комнате: в их створ и на дугу открывания ставить нельзя; окна — не закрывать высоким
  const swings: Pt[][] = []
  const windowPts: Pt[] = []
  for (const op of plan.openings) {
    const wall = walls.find((w) => w.id === op.wallId)
    if (!wall) continue
    const g = openingGeom(op, wall)
    const near = pointInPoly(g.center, room.polygon) || pointSegDistPoly(g.center, room.polygon) < 60
    if (!near) continue
    if (op.kind !== 'window') {
      swings.push(g.swing)
      continue
    }
    const n = perp(norm(sub(wall.b, wall.a)))
    for (const side of [1, -1]) {
      for (let k = -2; k <= 2; k++) {
        const q = add(add(g.center, mul(norm(sub(wall.b, wall.a)), (k / 2) * (op.width / 2 - 5))), mul(n, side * (wall.thickness / 2 + 6)))
        if (pointInPoly(q, inner)) windowPts.push(q)
      }
    }
  }
  // стены рядом с комнатой: внутренние выступы, колонны, перегородки
  const xs = room.polygon.map((p) => p.x)
  const ys = room.polygon.map((p) => p.y)
  const [x0, x1, y0, y1] = [Math.min(...xs) - 60, Math.max(...xs) + 60, Math.min(...ys) - 60, Math.max(...ys) + 60]
  const wallPolys = walls.filter((w) => Math.max(w.a.x, w.b.x) >= x0 && Math.min(w.a.x, w.b.x) <= x1 && Math.max(w.a.y, w.b.y) >= y0 && Math.min(w.a.y, w.b.y) <= y1).map(wallBody)
  // мебель, которая уже стоит в этой комнате (символы электрики не мешают)
  const standing = plan.furniture.filter((f) => !CATALOG_MAP[f.type]?.symbol && pointInPoly({ x: f.x, y: f.y }, room.polygon))
  const taken: Pt[][] = standing.map(furnitureBody)
  const takenZones: Pt[][] = standing.flatMap((f) => zonesOf(f, CATALOG_MAP[f.type]).map((z) => z.poly))
  const ctx: Ctx = { inner, walls: wallPolys, swings, windowPts, taken, takenZones, tol: o.outTolerance }

  // журнальный стол в санузле геометрию пройдёт, а смысл — нет: только уместные в комнате типы
  // список тот же, что ушёл модели: по назначению, а не по старому имени комнаты
  const fitting = new Set(catalogForRoom(options.purpose || room.meta.name, CATALOG).map((c) => c.type))
  // Модель могла дать не центр, а левый верхний угол предмета — так рисуют
  // прямоугольники в вёрстке, и тогда мимо ушло бы всё. Ответ одной модели
  // единообразен: читаем его целиком так, как он лучше ложится в комнату
  items = readPlacements(items, ctx)

  // Крупное — первым: кровать и шкаф выбирают стену, мелочь встаёт в оставшееся.
  // При равных размерах — как предложила модель. Отчёт — в её порядке
  const area = (it: AiPlacement) => (CATALOG_MAP[it.type] ? CATALOG_MAP[it.type].w * CATALOG_MAP[it.type].d : 0)
  const order = items.map((_, i) => i).sort((a, b) => area(items[b]) - area(items[a]) || a - b)
  const done = new Map<number, PlacementCheck>()
  interface Placed {
    idx: number
    want: Spot
    cat: CatalogItem
    used: CatalogItem
    f: Furniture
  }
  const placed: Placed[] = []
  const standingZones = [...takenZones]
  const standingBodies = [...taken]
  /** собрать занятое заново: без предметов skip — их место пересматривается */
  const rebuild = (skip: Set<number> = new Set()) => {
    const others = placed.filter((p) => !skip.has(p.idx))
    ctx.taken = [...standingBodies, ...others.map((p) => furnitureBody(p.f))]
    ctx.takenZones = [...standingZones, ...others.flatMap((p) => zonesOf(p.f, p.used).map((z) => z.poly))]
    ctx.beds = others.filter((p) => isDoubleBed(p.used)).map((p) => p.f)
  }
  const kinds = (cat: CatalogItem) => [cat, ...(ALTERNATIVES[cat.type] ?? []).map((t) => CATALOG_MAP[t]).filter((c): c is CatalogItem => !!c && fitting.has(c.type))]
  /** лучшее место среди самого предмета и его замен (купе вместо распашного) */
  const bestOf = (cat: CatalogItem, want: Spot) => {
    let best: { used: CatalogItem; spot: Spot; moved: number; cost: number } | null = null
    let fail: Fail | null = null
    for (const k of kinds(cat)) {
      const r = findSpot(k, want, ctx)
      if ('fail' in r) {
        if (k === cat) fail = r.fail
        continue
      }
      const cost = r.cost + (k === cat ? 0 : 30)
      if (!best || cost < best.cost) best = { used: k, spot: r.spot, moved: r.moved, cost }
    }
    return { best, fail }
  }
  const toFurniture = (used: CatalogItem, spot: Spot, id = uid('f')): Furniture => ({ id, type: used.type, x: Math.round(spot.x * 10) / 10, y: Math.round(spot.y * 10) / 10, w: used.w, d: used.d, rot: spot.rot })

  for (const idx of order) {
    const item = items[idx]
    const cat: CatalogItem | undefined = CATALOG_MAP[item.type]
    if (!cat) {
      done.set(idx, { item, ok: false, reason: `в каталоге нет типа «${item.type}»` })
      continue
    }
    if (!fitting.has(item.type)) {
      done.set(idx, { item, ok: false, reason: `${cat.name}: не к месту в этой комнате` })
      continue
    }
    const want: Spot = { x: item.x, y: item.y, rot: normDeg(item.rot) }
    let { best, fail } = bestOf(cat, want)
    if (!best) {
      for (const smaller of smallerOf(cat)) {
        const r = findSpot(smaller, want, ctx)
        if (!('fail' in r)) {
          best = { used: smaller, spot: r.spot, moved: r.moved, cost: r.cost }
          break
        }
      }
    }
    if (!best) {
      done.set(idx, { item, ok: false, reason: `${cat.name}: ${FAIL_TEXT[fail ?? 'room']}` })
      continue
    }
    placed.push({ idx, want, cat, used: best.used, f: toFurniture(best.used, best.spot) })
    rebuild()
  }

  // Второй проход — как дизайнер, который отходит и смотрит на комнату целиком:
  // каждый предмет пересматривается с учётом всех соседей (кровать сдвинется,
  // чтобы шкафу хватило прохода; распашной станет купе, если дверцам тесно)
  for (let round = 0; round < 3; round++) {
    let changed = false
    for (const p of placed) {
      // тумбы у изголовья едут вместе с кроватью: иначе они держат её на месте
      const attached = isDoubleBed(p.used) ? placed.filter((q) => q.used.type === 'nightstand' && nightstandSpots(p.f, q.used.w, q.used.d).some((s) => dist(s, q.f) < 40)) : []
      rebuild(new Set([p.idx, ...attached.map((q) => q.idx)]))
      const now = spotCost(p.f, p.used, p.want, ctx) + (p.used === p.cat ? 0 : 30)
      const { best } = bestOf(p.cat, p.want)
      if (!best || best.cost >= now - 10) continue
      const moved = toFurniture(best.used, best.spot, p.f.id)
      // тумбы — к новым бокам изголовья; не встают — кровать остаётся где была
      const follow: Furniture[] = []
      const occupied = [...ctx.taken, furnitureBody(moved)]
      let okAll = true
      for (const q of attached) {
        const spots = nightstandSpots(moved, q.used.w, q.used.d).sort((a, b) => dist(a, q.f) - dist(b, q.f))
        const next = spots.map((s) => toFurniture(q.used, s, q.f.id)).find((g) => !fits(g, { ...ctx, taken: occupied }) && !follow.some((h) => convexOverlap(furnitureBody(h), furnitureBody(g), 1.5)))
        if (!next) {
          okAll = false
          break
        }
        follow.push(next)
        occupied.push(furnitureBody(next))
      }
      if (!okAll) continue
      p.used = best.used
      p.f = moved
      attached.forEach((q, k) => (q.f = follow[k]))
      changed = true
    }
    rebuild()
    if (!changed) break
  }

  // Двуспальная кровать без тумб выглядит недоделанной: если модель их не
  // предложила, а у изголовья есть место — ставим по бокам и говорим об этом
  const added: PlacementCheck[] = []
  const nightCat = CATALOG_MAP.nightstand
  if (nightCat && fitting.has('nightstand') && ctx.beds?.length && !items.some((it) => it.type === 'nightstand')) {
    for (const bed of ctx.beds) {
      for (const s of nightstandSpots(bed, nightCat.w, nightCat.d)) {
        const f: Furniture = { ...toFurniture(nightCat, s), note: 'у изголовья: к двуспальной кровати — тумбы с двух сторон' }
        if (fits(f, ctx)) continue
        ctx.taken.push(furnitureBody(f))
        ctx.takenZones.push(...zonesOf(f, nightCat).map((z) => z.poly))
        added.push({ item: { type: 'nightstand', x: f.x, y: f.y, rot: f.rot, why: 'добавлено к кровати' }, ok: true, furniture: f, moved: 0, added: true })
      }
    }
  }

  // сдвиг от предложенного — до растяжки шкафа: растяжка не «поправка места»
  const movedOf = new Map(placed.map((p) => [p.idx, Math.round(dist(p.f, p.want))]))
  // шкаф — на всю нишу или стену, где встал: встроенный шкаф без щелей по краям
  for (const p of placed) {
    if (!FILLS.has(p.used.type) || p.used.resizable === false) continue
    const i = ctx.taken.findIndex((t) => JSON.stringify(t) === JSON.stringify(furnitureBody(p.f)))
    if (i >= 0) ctx.taken.splice(i, 1)
    const grown = fillAlongWall(p.f, p.used, ctx)
    p.f = grown
    ctx.taken.push(furnitureBody(grown))
  }

  for (const p of placed) {
    const item = items[p.idx]
    const moved = movedOf.get(p.idx) ?? 0
    const notes = [item.why || '']
    const bigger = p.f.w - p.used.w
    if (p.used !== p.cat && ALTERNATIVES[p.cat.type]?.includes(p.used.type)) notes.push(`${p.used.name} вместо ${p.cat.name.toLowerCase()}: дверцам распашного здесь не хватает места`)
    else if (p.used !== p.cat) notes.push(`${p.used.name} вместо ${p.cat.name.toLowerCase()}: большой не помещается`)
    else if (moved > 20) notes.push(`место поправлено на ${moved} см: предложенное не подходило`)
    if (bigger >= 10) notes.push(`во всю нишу: ${Math.round(p.f.w)} см вместо ${p.used.w}`)
    p.f = { ...p.f, note: notes.filter(Boolean).join(' · ') || undefined }
    done.set(p.idx, { item, ok: true, furniture: p.f, moved, replaced: p.used !== p.cat ? p.cat.name : undefined, widened: bigger >= 10 ? Math.round(p.f.w) : undefined })
  }
  // в отчёте — предложение модели как было
  return [...items.map((_, i) => ({ ...done.get(i)!, item: proposed[i] })), ...added]
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
  const movedN = checks.filter((c) => c.ok && !c.replaced && !c.added && (c.moved ?? 0) > 20).length
  const smaller = checks.filter((c) => c.ok && c.replaced).length
  const widened = checks.filter((c) => c.ok && c.widened).length
  const fixes = [movedN ? `место поправлено у ${movedN}` : '', smaller ? `замена на подходящий — ${smaller}` : '', widened ? `шкаф во всю нишу` : ''].filter(Boolean).join(', ')
  const names = checks.filter((c) => c.ok && c.furniture).map((c) => CATALOG_MAP[c.furniture!.type]?.name ?? c.furniture!.type)
  const head = `Поставлено предметов: ${ok}${names.length ? ` — ${names.join(', ')}` : ''}${fixes ? ` (${fixes})` : ''}`
  if (!bad) return head
  const reasons = new Map<string, number>()
  for (const c of checks) if (!c.ok && c.reason) reasons.set(c.reason, (reasons.get(c.reason) ?? 0) + 1)
  const why = [...reasons].map(([r, n]) => `${r} — ${n}`).join(', ')
  return `${head}. Отклонено ${bad}: ${why}`
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
  // детская растёт вместе с ребёнком: школьнику нужны обычная кровать, стол и шкаф
  const extra = new Set<string>()
  if (cats.has('kids')) for (const t of ['bed-90', 'bed-140', 'nightstand', 'wardrobe', 'desk', 'office-chair', 'office-shelf']) extra.add(t)
  if (cats.has('office')) for (const t of ['armchair', 'sofa-2']) extra.add(t)
  // в спальне часто и работают: стол со стулом у окна
  if (cats.has('bedroom') && !cats.has('living')) for (const t of ['desk', 'office-chair']) extra.add(t)
  // радиатор и колонна — часть здания, «произвольный объект» — заготовка: их не расставляют;
  // пианино — только там, где гостиная
  const never = new Set(['radiator', 'column', 'box'])
  return all
    .filter((c) => !c.symbol && !never.has(c.type) && (cats.has(c.category) || extra.has(c.type)))
    .filter((c) => c.type !== 'piano' || cats.has('living'))
    .map((c) => ({ type: c.type, name: c.name, w: c.w, d: c.d }))
}
