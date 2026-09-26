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
    if (blocked) p += 80
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
function findSpot(cat: CatalogItem, want: Spot, c: Ctx): { spot: Spot; moved: number } | { fail: Fail } {
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
    return { spot: b.spot, moved: dist(b.spot, want) }
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
  const order = items.map((it, i) => i).sort((a, b) => area(items[b]) - area(items[a]) || a - b)
  const done = new Map<number, PlacementCheck>()
  for (const idx of order) {
    const item = items[idx]
    const out = { push: (c: PlacementCheck) => done.set(idx, c) }
    const cat: CatalogItem | undefined = CATALOG_MAP[item.type]
    if (!cat) {
      out.push({ item, ok: false, reason: `в каталоге нет типа «${item.type}»` })
      continue
    }
    if (!fitting.has(item.type)) {
      out.push({ item, ok: false, reason: `${cat.name}: не к месту в этой комнате` })
      continue
    }
    const want: Spot = { x: item.x, y: item.y, rot: normDeg(item.rot) }
    let used = cat
    let found = findSpot(cat, want, ctx)
    if ('fail' in found) {
      for (const smaller of smallerOf(cat)) {
        const r = findSpot(smaller, want, ctx)
        if (!('fail' in r)) {
          used = smaller
          found = r
          break
        }
      }
    }
    if ('fail' in found) {
      out.push({ item, ok: false, reason: `${cat.name}: ${FAIL_TEXT[found.fail]}` })
      continue
    }
    const moved = Math.round(found.moved)
    const notes = [item.why || '']
    if (used !== cat) notes.push(`${used.name} вместо ${cat.name.toLowerCase()}: большой не помещается`)
    else if (moved > 20) notes.push(`место поправлено на ${moved} см: предложенное не подходило`)
    // пояснение идёт в note: подпись на чертеже должна оставаться короткой
    const f: Furniture = { id: uid('f'), type: used.type, x: Math.round(found.spot.x * 10) / 10, y: Math.round(found.spot.y * 10) / 10, w: used.w, d: used.d, rot: found.spot.rot, note: notes.filter(Boolean).join(' · ') || undefined }
    ctx.taken.push(furnitureBody(f))
    ctx.takenZones.push(...zonesOf(f, used).map((z) => z.poly))
    if (isDoubleBed(used)) ctx.beds = [...(ctx.beds ?? []), f]
    out.push({ item, ok: true, furniture: f, moved, replaced: used !== cat ? cat.name : undefined })
  }
  // в отчёте — предложение модели как было
  const result = items.map((_, i) => ({ ...done.get(i)!, item: proposed[i] }))
  // Двуспальная кровать без тумб выглядит недоделанной: если модель их не
  // предложила, а у изголовья есть место — ставим по бокам и говорим об этом
  const nightCat = CATALOG_MAP.nightstand
  if (nightCat && fitting.has('nightstand') && ctx.beds?.length && !items.some((it) => it.type === 'nightstand')) {
    for (const bed of ctx.beds) {
      for (const s of nightstandSpots(bed, nightCat.w, nightCat.d)) {
        const f: Furniture = { id: uid('f'), type: 'nightstand', x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10, w: nightCat.w, d: nightCat.d, rot: s.rot, note: 'у изголовья: к двуспальной кровати — тумбы с двух сторон' }
        if (fits(f, ctx)) continue
        ctx.taken.push(furnitureBody(f))
        result.push({ item: { type: 'nightstand', x: f.x, y: f.y, rot: f.rot, why: 'добавлено к кровати' }, ok: true, furniture: f, moved: 0, added: true })
      }
    }
  }
  return result
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
  const movedN = checks.filter((c) => c.ok && !c.replaced && (c.moved ?? 0) > 20).length
  const smaller = checks.filter((c) => c.ok && c.replaced).length
  const fixes = [movedN ? `место поправлено у ${movedN}` : '', smaller ? `поменьше вместо большого — ${smaller}` : ''].filter(Boolean).join(', ')
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
  // радиатор и колонна — часть здания, «произвольный объект» — заготовка: их не расставляют;
  // пианино — только там, где гостиная
  const never = new Set(['radiator', 'column', 'box'])
  return all
    .filter((c) => !c.symbol && !never.has(c.type) && (cats.has(c.category) || extra.has(c.type)))
    .filter((c) => c.type !== 'piano' || cats.has('living'))
    .map((c) => ({ type: c.type, name: c.name, w: c.w, d: c.d }))
}
