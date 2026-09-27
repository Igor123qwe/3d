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
import { frontBlockedShare, furnitureBody, isWideStorage, openingGeom, runChecks, TOLERATED_FRONT_SHARE, wallBody, zonesOf } from './checks'
import { findNiches, largestRect, nicheSpot, nicheText, type Niche } from './niches'
import { composeKitchen, KITCHEN_MODULES, shaftsOf } from './kitchen'
import { roomKind } from './roomkind'
import { armchairSpots, coffeeSpot, lampSpots, plantSpots, rugBeforeSofa, rugInside, rugUnderBed, rugUnderTable, smallerRugs, tvSpot, type RugPlace, type WindowSeg } from './decor'
import { paletteFor } from './palette'
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
  /** придвинут к своей паре: тумба к изголовью, стул к столу */
  paired?: string
  /** шкаф или гардеробная встали в нишу комнаты */
  niche?: string
  /** модуль кухонного гарнитура, собранного программой; у первого — как собран */
  kitchen?: string | true
  /** штрих дизайнера: ковёр, торшер, растение — что и зачем */
  touch?: string
  /** палитра текстиля комнаты — у первого предмета */
  palette?: string
}

export interface LayoutOptions {
  /** насколько предмету позволено выступать за контур комнаты, см */
  outTolerance?: number
  /** с какого расстояния предмет притягивается к стене вплотную, см */
  snapCm?: number
  /** назначение комнаты, под которое спрашивали модель; нет — по имени комнаты */
  purpose?: string
  /** пожелания хозяина: просили гардеробную — шкаф в нише становится гардеробной */
  wishes?: string
  /** штрихи дизайнера и палитра: ковёр, торшер, растение, цвета текстиля; по умолчанию — нет, диалог включает */
  touches?: boolean
  /** куда нельзя ставить ничего: рабочий проход перед кухонным гарнитуром, проход у двери */
  forbidden?: Pt[][]
  /** все комнаты плана: для кухни — где санузел, за стеной которого стояки */
  rooms?: Room[]
}

export const DEFAULT_LAYOUT: Required<Omit<LayoutOptions, 'purpose' | 'wishes' | 'touches' | 'forbidden' | 'rooms'>> = { outTolerance: 2, snapCm: 25 }

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

/** зона подхода к предмету; allow — что в ней стоять может (стул у стола, тумба у кровати) */
interface Zone {
  poly: Pt[]
  allow?: string[]
}

const zonesFor = (f: Furniture, cat: CatalogItem | undefined): Zone[] => zonesOf(f, cat).map((z) => ({ poly: z.poly, allow: cat?.allowInZone }))

interface Ctx {
  /** контур по внутренним граням: здесь предмету место */
  inner: Pt[]
  walls: Pt[][]
  swings: Pt[][]
  /** точки у окон со стороны комнаты: высокий шкаф их закрывать не должен */
  windowPts: Pt[]
  taken: Pt[][]
  /** типы занявших место — по порядку taken: стулу у стола его зона не помеха */
  takenKinds: string[]
  /** зоны подхода уже стоящих предметов: новый предмет их не перекрывает */
  takenZones: Zone[]
  tol: number
  /** двуспальные кровати, что уже встали: к ним — тумбы по бокам */
  beds?: Furniture[]
  /** ниши комнаты: хранению — туда */
  niches: Niche[]
  /** окна по внутренней грани: растению — к ним */
  windows: WindowSeg[]
  /** куда нельзя ничего: рабочий проход перед гарнитуром, проход у двери */
  forbidden: Pt[][]
}

/** шкафы и гардеробные: им место в нише (кухонный пенал — не про это) */
const isStorage = (cat: CatalogItem) => (cat.glyph === 'wardrobe' || cat.glyph === 'wardrobe-slide') && cat.category !== 'kitchen'

/** Ниша, в которой стоит предмет; с окном не в счёт — высокий шкаф его закроет */
const nicheOf = (f: { x: number; y: number }, c: { niches: Niche[] }) => c.niches.find((n) => !n.window && f.x > n.x0 && f.x < n.x1 && f.y > n.y0 && f.y < n.y1)

/**
 * Хранение в нише — почти всегда верно: ниша не отнимает места у комнаты и
 * проходов. Выигрыш больше, чем штраф за уход от предложенного места: модель
 * ниш не видит, и шкаф, поставленный ею поперёк комнаты, уходит в нишу
 */
const NICHE_BONUS = 400

/** на чём сидят за столом: им место в зоне стола */
const SEAT_TYPES = new Set(['chair', 'office-chair', 'bar-stool'])

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

/** Где сесть за стол: к письменному — один стул спереди, к обеденному — по сторонам */
function seatSpots(host: Furniture, hostCat: CatalogItem, seat: CatalogItem): Spot[] {
  const at = (lx: number, ly: number, turn: number): Spot => {
    const c = add({ x: host.x, y: host.y }, rotate({ x: lx, y: ly }, host.rot))
    return { x: c.x, y: c.y, rot: normDeg(host.rot + turn) }
  }
  // стул смотрит на стол, спинкой в комнату; 3 см — чтобы не касаться столешницы
  const front = (off: number) => at(off, host.d / 2 + seat.d / 2 + 3, 180)
  const back = (off: number) => at(off, -(host.d / 2 + seat.d / 2 + 3), 0)
  const left = (off: number) => at(-(host.w / 2 + seat.d / 2 + 3), off, 270)
  const right = (off: number) => at(host.w / 2 + seat.d / 2 + 3, off, 90)
  // сколько стульев в ряд вдоль стороны длиной L: на человека 60 см
  const row = (L: number, per: number) => {
    const n = Math.max(1, Math.floor(L / per))
    return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * per)
  }
  if (hostCat.glyph === 'desk') return [front(0)]
  if (hostCat.type === 'island') return row(hostCat.w, 50).map(front)
  if (hostCat.type === 'kitchen-table') return [left(0), right(0), ...row(host.w, 60).map(front)]
  if (hostCat.glyph === 'table-round') return [front(0), back(0), left(0), right(0)]
  return [...row(host.w, 60).map(front), ...row(host.w, 60).map(back), left(0), right(0)]
}

/**
 * Предметы, которые без пары не имеют смысла: тумба стоит у изголовья,
 * стул — у стола. Модель ставит их «рядом по смыслу», но не по месту —
 * тумба посреди стены, кресло в метре от стола; здесь они придвигаются.
 * soft — нет пары, и пусть стоит где стоит (банкетка бывает и у окна)
 */
interface PairRule {
  hosts: (cat: CatalogItem) => boolean
  spots: (host: Furniture, hostCat: CatalogItem, cat: CatalogItem, c: Ctx) => Spot[]
  /** очередь: кресло встаёт к журнальному столу, когда тот уже у дивана, торшер — к креслу */
  rank?: number
  /** пояснение к месту */
  note: (hostCat: CatalogItem) => string
  /** почему не встал: пары нет вовсе */
  alone: string
  /** почему не встал: у пары не осталось места */
  full: string
  soft?: boolean
}

const DESKS = (c: CatalogItem) => c.glyph === 'desk'
const SOFAS = (c: CatalogItem) => c.glyph === 'sofa' || c.glyph === 'sofa-corner'
const TABLES = (c: CatalogItem) => ['dining-table', 'table-round', 'kitchen-table'].includes(c.type)
const toSeat = (host: CatalogItem) => (host.type === 'vanity' ? 'к туалетному столику' : 'к столу')

const PAIRS: Record<string, PairRule> = {
  nightstand: {
    hosts: (c) => c.glyph === 'bed',
    spots: (bed, _, cat) => nightstandSpots(bed, cat.w, cat.d),
    note: () => 'у изголовья кровати',
    alone: 'нет кровати, у которой её поставить',
    full: 'у изголовья кровати нет места',
  },
  'office-chair': { hosts: DESKS, spots: seatSpots, note: toSeat, alone: 'нет стола, к которому его придвинуть', full: 'у стола не осталось места' },
  chair: { hosts: (c) => DESKS(c) || TABLES(c), spots: seatSpots, note: toSeat, alone: 'нет стола, к которому его придвинуть', full: 'у стола не осталось места' },
  'bar-stool': { hosts: (c) => c.type === 'island' || c.type === 'kitchen-table', spots: seatSpots, note: (h) => (h.type === 'island' ? 'к острову' : 'к столу'), alone: 'нет острова или стола, к которому его придвинуть', full: 'у острова не осталось места' },
  // гостиная — как у дизайнера: стол перед диваном, кресла вокруг стола, телевизор напротив, торшер у кресла
  'coffee-table': {
    hosts: SOFAS,
    spots: (sofa, sc, cat) => [coffeeSpot(sofa, sc.glyph === 'sofa-corner', cat)],
    note: () => 'перед диваном на 45 см — дотянуться рукой и пройти',
    alone: '',
    full: '',
    soft: true,
  },
  armchair: {
    hosts: (c) => c.type === 'coffee-table',
    spots: (table, _, cat) => armchairSpots(table, cat),
    note: () => 'у журнального стола — разговорная зона',
    alone: '',
    full: '',
    soft: true,
    rank: 1,
  },
  'tv-stand': {
    hosts: SOFAS,
    spots: (sofa, _, cat, c) => [tvSpot(sofa, c.inner, cat)].filter((s): s is Spot => !!s),
    note: () => 'напротив дивана — смотреть, не поворачивая головы',
    alone: '',
    full: '',
    soft: true,
  },
  tv: {
    hosts: SOFAS,
    spots: (sofa, _, cat, c) => [tvSpot(sofa, c.inner, cat)].filter((s): s is Spot => !!s),
    note: () => 'напротив дивана — смотреть, не поворачивая головы',
    alone: '',
    full: '',
    soft: true,
  },
  lamp: {
    hosts: (c) => c.glyph === 'armchair' || c.glyph === 'sofa',
    spots: (host, _, cat) => lampSpots(host, cat),
    note: (h) => (h.glyph === 'armchair' ? 'у кресла — уголок для чтения' : 'у дивана — мягкий свет вечером'),
    alone: '',
    full: '',
    soft: true,
    rank: 2,
  },
  bench: {
    hosts: (c) => c.glyph === 'bed',
    // в ногах кровати, вдоль неё
    spots: (bed, _, cat) => [{ ...add({ x: bed.x, y: bed.y }, rotate({ x: 0, y: bed.d / 2 + cat.d / 2 + 3 }, bed.rot)), rot: normDeg(bed.rot + 180) }],
    note: () => 'в ногах кровати',
    alone: '',
    full: '',
    soft: true,
  },
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
  if (c.forbidden.some((z) => convexOverlap(z, body, 1.5))) return 'other'
  if (c.taken.some((t) => convexOverlap(t, body, 1.5))) return 'other'
  return null
}

/** Насколько место неудобно: закрытые зоны подхода — свои и соседей, высокий предмет перед окном */
function penalty(f: Furniture, cat: CatalogItem, c: Ctx): number {
  let p = 0
  for (const z of zonesOf(f, cat)) {
    const blocked =
      c.walls.some((w) => convexOverlap(z.poly, w, 1.5)) ||
      c.taken.some((t, i) => !cat.allowInZone?.includes(c.takenKinds[i]) && convexOverlap(z.poly, t, 1.5)) ||
      c.swings.some((s) => convexOverlap(z.poly, s, 2))
    if (!blocked) continue
    const front = z.side === 'front' && (cat.glyph === 'wardrobe' || cat.glyph === 'wardrobe-slide' || cat.glyph === 'drawers')
    // широкий шкаф с закрытым краем фронта: одна секция из многих — мелочь, как и в «Проверке»
    if (front && isWideStorage(f, cat)) {
      const share = frontBlockedShare(f, z.size, [...c.walls, ...c.taken.filter((_, i) => !cat.allowInZone?.includes(c.takenKinds[i])), ...c.swings])
      if (share <= TOLERATED_FRONT_SHARE) {
        p += 160 * share
        continue
      }
    }
    // дверцы шкафа и ящики комода, упёртые в кровать, — не открыть: это дороже узкого прохода
    p += front ? 160 : 80
  }
  if (isStorage(cat) && nicheOf(f, c)) p -= NICHE_BONUS
  const body = furnitureBody(f)
  // стул в зоне стола и тумба в зоне кровати — на своём месте, остальное мешает подойти
  for (const z of c.takenZones) if (!z.allow?.includes(f.type) && convexOverlap(body, z.poly, 1.5)) p += 80
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
  // за столом сидят: место для стула перед ним — тоже часть стола, и проходы соседей оно не перекрывает
  if (cat.glyph === 'desk') {
    const sc = add({ x: f.x, y: f.y }, rotate({ x: 0, y: f.d / 2 + 30 }, f.rot))
    const seat = obbCorners(sc.x, sc.y, 60, 60, f.rot)
    for (const z of c.takenZones) if (!z.allow?.includes('office-chair') && convexOverlap(seat, z.poly, 1.5)) p += 60
    if (c.taken.some((t, i) => !SEAT_TYPES.has(c.takenKinds[i]) && convexOverlap(seat, t, 1.5))) p += 60
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
  // шкафу — ниша, даже если модель поставила его в другой конец комнаты
  if (isStorage(cat)) for (const n of c.niches) if (!n.window) consider(nicheSpot(n, cat.w, cat.d))
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
export function readPlacements(items: AiPlacement[], c: Ctx): AiPlacement[] {
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
const ALTERNATIVES: Record<string, string[]> = { wardrobe: ['wardrobe-slide'], closet: ['wardrobe-slide'], 'dining-table': ['table-round', 'kitchen-table'] }
/** почему заменили — в пояснение */
const ALTERNATIVE_WHY: Record<string, string> = {
  wardrobe: 'дверцам распашного здесь не хватает места',
  closet: 'подходящей ниши в комнате нет',
  'dining-table': 'вокруг большого стола здесь не хватает проходов',
}

/** шкафы растягиваются на всю нишу или стену, где встали */
const FILLS = new Set(['wardrobe', 'wardrobe-slide', 'closet'])

/**
 * Гардеробная — только в нише и во всю её ширину; глубина — вся ниша или чуть
 * меньше, чтобы у соседей остался проход (кровать рядом с нишей)
 */
function closetKinds(cat: CatalogItem, niches: Niche[]): CatalogItem[] {
  const out: CatalogItem[] = []
  for (const n of niches) {
    if (n.window || n.depth < 55) continue
    // мельче 1,2 м внутрь не зайти: хватит 60–70 см под штанги и двери, остальное — проходу у кровати;
    // глубже — гардеробная, куда заходят, во всю глубину
    const depths = n.depth >= 120 ? [Math.min(n.depth, 150), n.depth - 10] : [Math.min(n.depth, 70), 60]
    for (const d of new Set(depths)) out.push({ ...cat, w: n.width, d })
  }
  return out
}
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
    const others = c.takenZones.filter((z) => convexOverlap(body, z.poly, 1.5)).length
    const own = zonesOf(g, cat).filter((z) => {
      const hit = c.taken.some((t) => convexOverlap(z.poly, t, 1.5)) || c.swings.some((s) => convexOverlap(z.poly, s, 2))
      // у широкого шкафа закрытый край фронта не мешает расти дальше
      if (hit && z.side === 'front' && isWideStorage(g, cat)) return frontBlockedShare(g, z.size, [...c.taken, ...c.swings]) > TOLERATED_FRONT_SHARE
      return hit
    }).length
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
export function vetLayout(asked: AiPlacement[], room: Room, plan: Plan, options: LayoutOptions = {}): PlacementCheck[] {
  const proposed = closetIfAsked(asked, room, plan, options)
  if (proposed !== asked) {
    // в отчёте — что предложила модель, а ставится гардеробная
    return vetLayout(proposed, room, plan, { ...options, wishes: undefined }).map((c, i) => (i < asked.length ? { ...c, item: asked[i] } : c))
  }
  const kitchen = kitchenFirst(proposed, room, plan, options)
  if (kitchen) return kitchen
  const first = vetOnce(proposed, room, plan, options)
  // Модель ниш не видит: шкаф встаёт поперёк комнаты, а кровать, поставленная
  // раньше, закрывает нишу. Пробуем тот же замысел, но шкаф — в нишу, и берём
  // вариант, после которого у «Проверки» меньше замечаний
  if (!first.niches.length || first.checks.some((c) => c.ok && c.niche)) return first.checks
  const idx = proposed.findIndex((it, i) => {
    const cat = CATALOG_MAP[it.type]
    return !!cat && isStorage(cat) && first.checks[i]?.ok
  })
  if (idx < 0) return first.checks
  const cat = CATALOG_MAP[proposed[idx].type]
  let best = first.checks
  let bestScore = scoreLayout(best, plan)
  for (const n of first.niches) {
    if (n.window) continue
    const s = nicheSpot(n, Math.min(cat.w, n.width), cat.d)
    const variant = proposed.map((it, i) => (i === idx ? { ...it, x: s.x, y: s.y, rot: s.rot } : it))
    const alt = vetOnce(variant, room, plan, options).checks
    // в отчёте — предложение модели как было, и сдвиг — от него
    alt.forEach((c, i) => {
      if (i >= proposed.length) return
      c.item = proposed[i]
      if (c.furniture) c.moved = Math.round(dist(c.furniture, proposed[i]))
    })
    const score = scoreLayout(alt, plan)
    if (score < bestScore) {
      best = alt
      bestScore = score
    }
  }
  return best
}

/** ниши комнаты по её контуру, дверям и окнам */
function roomNiches(room: Room, plan: Plan): Niche[] {
  const doors: Pt[] = []
  const windows: Pt[] = []
  for (const op of plan.openings) {
    const wall = plan.walls.find((w) => w.id === op.wallId)
    if (!wall) continue
    const g = openingGeom(op, wall)
    if (!(pointInPoly(g.center, room.polygon) || pointSegDistPoly(g.center, room.polygon) < 60)) continue
    ;(op.kind === 'window' ? windows : doors).push(g.center)
  }
  return findNiches(room.inner.length >= 3 ? room.inner : room.polygon, { doors, windows })
}

/**
 * Просили гардеробную, а модель дала шкаф (так ответила Gemini у пользователя:
 * «полноценную гардеробную» — шкаф-купе вдоль стены). Есть ниша — шкаф
 * становится гардеробной: она встанет в нишу во всю её ширину
 */
function closetIfAsked(proposed: AiPlacement[], room: Room, plan: Plan, options: LayoutOptions): AiPlacement[] {
  if (!/гардеробн/i.test(options.wishes ?? '') || proposed.some((p) => p.type === 'closet')) return proposed
  const i = proposed.findIndex((p) => p.type === 'wardrobe' || p.type === 'wardrobe-slide')
  if (i < 0 || !catalogForRoom(options.purpose || room.meta.name, CATALOG).some((c) => c.type === 'closet')) return proposed
  if (!roomNiches(room, plan).some((n) => !n.window && n.depth >= 55)) return proposed
  return proposed.map((p, k) => (k === i ? { ...p, type: 'closet' } : p))
}

/** что пишут у модуля гарнитура */
const KITCHEN_NOTE: Record<string, string> = {
  fridge: 'с края гарнитура, ближе к входу',
  sink: 'в линии гарнитура, рядом посудомойка',
  stove: 'столешница с обеих сторон, не у окна и не вплотную к холодильнику',
  dishwasher: 'рядом с мойкой — короче трубы',
  'tall-cabinet': 'высокое — с края, рядом с холодильником',
  'counter-corner': 'угол гарнитура',
}

/**
 * Кухня: гарнитур собирает программа — одной линией или буквой Г, в правильном
 * порядке и без зазоров, — а стол и стулья ставятся в то, что осталось.
 * null — это не кухня, гарнитур уже стоит или ни одна раскладка не встала
 */
function kitchenFirst(proposed: AiPlacement[], room: Room, plan: Plan, options: LayoutOptions): PlacementCheck[] | null {
  const purpose = options.purpose || room.meta.name
  const mods = proposed.filter((p) => KITCHEN_MODULES.has(p.type))
  const core = new Set(mods.map((m) => m.type).filter((t) => t === 'fridge' || t === 'sink' || t === 'stove'))
  if (core.size < 2 && !(/кухн/i.test(purpose) && mods.length >= 2)) return null
  const fitting = new Set(catalogForRoom(purpose, CATALOG).map((c) => c.type))
  if (!['fridge', 'sink', 'stove'].every((t) => fitting.has(t))) return null
  const standing = plan.furniture.filter((f) => !CATALOG_MAP[f.type]?.symbol && (CATALOG_MAP[f.type]?.z ?? 1) === 1 && pointInPoly({ x: f.x, y: f.y }, room.polygon))
  // гарнитур уже стоит — не пересобираем, дополняем по одному
  if (standing.some((f) => KITCHEN_MODULES.has(f.type))) return null
  const inner = room.inner.length >= 3 ? room.inner : room.polygon
  const doorZones: Pt[][] = []
  const doors: Pt[] = []
  const windows: [Pt, Pt][] = []
  const windowZones: Pt[][] = []
  for (const op of plan.openings) {
    const wall = plan.walls.find((w) => w.id === op.wallId)
    if (!wall) continue
    const g = openingGeom(op, wall)
    if (!(pointInPoly(g.center, room.polygon) || pointSegDistPoly(g.center, room.polygon) < 60)) continue
    if (op.kind === 'window') {
      windows.push([add(g.center, mul(g.dir, -g.hw)), add(g.center, mul(g.dir, g.hw))])
      // пол перед окном: батарея и подоконник — глубина тумбы вглубь, по 5 см за откосы
      const side = pointInPoly(add(g.center, mul(g.n, g.th / 2 + 5)), inner) ? 1 : -1
      const c = add(g.center, mul(g.n, side * (g.th / 2 + 30)))
      windowZones.push(obbCorners(c.x, c.y, g.hw * 2 + 10, 60, (Math.atan2(g.dir.y, g.dir.x) * 180) / Math.PI))
      continue
    }
    doors.push(g.center)
    doorZones.push(g.swing)
    // проход перед дверью, куда бы она ни открывалась
    doorZones.push(obbCorners(g.center.x, g.center.y, g.hw * 2 + 10, 180, (Math.atan2(g.dir.y, g.dir.x) * 180) / Math.PI))
  }
  const xs = room.polygon.map((p) => p.x)
  const ys = room.polygon.map((p) => p.y)
  const [x0, x1, y0, y1] = [Math.min(...xs) - 60, Math.max(...xs) + 60, Math.min(...ys) - 60, Math.max(...ys) + 60]
  const walls = plan.walls.filter((w) => Math.max(w.a.x, w.b.x) >= x0 && Math.min(w.a.x, w.b.x) <= x1 && Math.max(w.a.y, w.b.y) >= y0 && Math.min(w.a.y, w.b.y) <= y1).map(wallBody)

  // Коммуникации — первое, что смотрит дизайнер кухни: стояки и вентканал не
  // переносят. Метки на плане; колонна или выступ шахты в стене кухни; нет
  // ничего — стена, общая с санузлом
  const comm = communications(room, plan, inner, options.rooms)
  // мойку под окном — только если об этом попросили
  const allowWindow = /(мойк|раковин)[^.,;]{0,24}(у|под|возле)\s+окн|(у|под)\s+окн[^.,;]{0,24}(мойк|раковин)/i.test(options.wishes ?? '')
  const run = composeKitchen({ inner, blockers: [...walls, ...standing.map(furnitureBody)], doorZones, doors, windows, windowZones, proposed: mods, risers: comm.risers, vents: comm.vents, allowWindow })
  if (!run) return null

  const m = (cm: number) => `${(cm / 100).toFixed(1).replace('.', ',')} м`
  const commText = [run.sinkToRiser !== undefined ? `от мойки до ${comm.riserWord} ${m(run.sinkToRiser)}` : '', run.stoveToVent !== undefined ? `от плиты до ${comm.ventWord} ${m(run.stoveToVent)}` : ''].filter(Boolean)
  const how =
    `кухня собрана гарнитуром ${run.shape === 'corner' ? 'буквой Г' : 'вдоль стены'}: ${run.order.join(' — ')}` +
    (commText.length ? `; ${commText.join(', ')}` : '') +
    (run.fridgeInNiche ? '; холодильник — в нише: не торчит и не отнимает столешницу' : '') +
    (run.dropped.length ? `; места у коммуникаций не хватило: ${run.dropped.join(', ')}` : '') +
    (windows.length ? (run.atWindow ? '; у глухих стен не поместился — часть под окном' : '; под окном свободно') : '')
  const noteOf = (f: Furniture): string => {
    if (f.type === 'sink' && run.sinkToRiser !== undefined) return `до ${comm.riserWord} ${m(run.sinkToRiser)} — короткий слив${run.furniture.some((g) => g.type === 'dishwasher') ? '; рядом посудомойка' : ''}`
    if (f.type === 'stove' && run.stoveToVent !== undefined) return `до ${comm.ventWord} ${m(run.stoveToVent)} — короткий воздуховод вытяжки; столешница с обеих сторон`
    if (f.type === 'fridge' && run.fridgeInNiche) return 'в нише у края стены — для него её и оставили: не торчит из гарнитура, столешница вся для работы'
    if (f.type === 'counter-top') return f.d < 58 ? 'столешница над выступом шахты — тумбы там мельче, фасад в линию' : 'добор столешницы до шахты'
    return KITCHEN_NOTE[f.type] ?? 'столешница гарнитура'
  }
  // что модель назвала — сопоставляем с собранным по типу; тумбы — с тумбами любой длины
  const left = [...run.furniture]
  const checks: PlacementCheck[] = []
  const isCounter = (t: string) => /^counter-(\d|top)/.test(t)
  for (const it of mods) {
    const i = left.findIndex((f) => f.type === it.type || (isCounter(it.type) && isCounter(f.type)))
    if (i < 0) continue
    const f = left.splice(i, 1)[0]
    checks.push({ item: it, ok: true, furniture: { ...f, note: noteOf(f) }, moved: Math.round(dist(f, it)), kitchen: true })
  }
  for (const f of left) checks.push({ item: { type: f.type, x: f.x, y: f.y, rot: f.rot, why: 'гарнитур' }, ok: true, furniture: { ...f, note: noteOf(f) }, moved: 0, added: true, kitchen: true })
  if (checks.length) checks[0].kitchen = how

  // Перед гарнитуром — рабочий проход 110 см: там не ставят ни стол, ни стул.
  // Стол — в самое большое свободное место, ближе к окну: там светло и далеко от плиты
  const AISLE = 110
  const aisles = run.furniture
    .filter((f) => f.type !== 'counter-corner')
    .map((f) => {
      const front = rotate({ x: 0, y: 1 }, f.rot)
      const c = add({ x: f.x, y: f.y }, mul(front, f.d / 2 + AISLE / 2))
      return obbCorners(c.x, c.y, f.w, AISLE, f.rot)
    })
  const forbidden = [...(options.forbidden ?? []), ...aisles, ...doorZones]
  const withRun = { ...plan, furniture: [...plan.furniture, ...run.furniture] }
  const dining = diningZone(inner, [...run.furniture.map(furnitureBody), ...standing.map(furnitureBody), ...walls, ...forbidden], windows)
  const rest = proposed.filter((p) => !KITCHEN_MODULES.has(p.type))
  const DINING = ['dining-table', 'table-round', 'kitchen-table']
  const tableIdx = rest.findIndex((p) => DINING.includes(p.type))
  const planned = [...rest]
  let tableNote = ''
  if (tableIdx >= 0 && dining) {
    const t = rest[tableIdx]
    // тип стола — по месту: круглому с четырьмя стульями нужен квадрат 2 × 2 м, большому — 2,5 × 1,9
    const short = Math.min(dining.w, dining.h)
    const long = Math.max(dining.w, dining.h)
    const fitsType = (type: string) => (type === 'table-round' ? short >= 216 : type === 'dining-table' ? short >= 190 && long >= 250 : short >= 120 && dining.walls.length > 0)
    const type = [t.type, 'table-round', 'kitchen-table'].find((x) => fitting.has(x) && fitsType(x)) ?? t.type
    const cat = CATALOG_MAP[type]
    const target = dining.window ?? { x: dining.x, y: dining.y }
    const clamp = (v: number, a: number, b: number) => (a > b ? (a + b) / 2 : Math.min(Math.max(v, a), b))
    let want: { x: number; y: number; rot: number }
    // стена, вдоль которой у свободного торца стола остаётся 75 см на стул (другим торцом — в угол), — ближайшая к окну
    const room = (side: string) => (side === 'left' || side === 'right' ? dining.h : dining.w)
    const wall =
      type === 'kitchen-table'
        ? [...dining.walls].sort((p, q) => Number(room(q.side) >= cat.w + 75) - Number(room(p.side) >= cat.w + 75) || dist(p.mid, target) - dist(q.mid, target))[0]
        : undefined
    if (wall) {
      // стол у стены — спинкой к стене свободного места, что ближе к окну, и не в угол: у торцов 75 см на стулья
      const along = wall.side === 'left' || wall.side === 'right' ? 'y' : 'x'
      const lo = (along === 'y' ? dining.y0 : dining.x0) + cat.w / 2 + 75
      const hi = (along === 'y' ? dining.y1 : dining.x1) - cat.w / 2 - 75
      let t0 = clamp(along === 'y' ? target.y : target.x, lo, hi)
      const off = cat.d / 2 + 0.5
      // у окна свободное место упирается в стену — стол торцом к ней, в угол у окна:
      // стулья с открытого бока и у дальнего торца
      if (dining.window) {
        const [a0, a1] = along === 'y' ? [dining.y0, dining.y1] : [dining.x0, dining.x1]
        const hiEnd = (along === 'y' ? target.y : target.x) > (a0 + a1) / 2
        const across = wall.side === 'left' ? dining.x0 + off : wall.side === 'right' ? dining.x1 - off : wall.side === 'top' ? dining.y0 + off : dining.y1 - off
        const edge = hiEnd ? a1 + 3 : a0 - 3
        const probe = along === 'y' ? { x: across, y: edge } : { x: edge, y: across }
        if (!pointInPoly(probe, inner) && a1 - a0 >= cat.w + 75) t0 = hiEnd ? a1 - cat.w / 2 - 0.5 : a0 + cat.w / 2 + 0.5
      }
      want =
        wall.side === 'left'
          ? { x: dining.x0 + off, y: t0, rot: 270 }
          : wall.side === 'right'
            ? { x: dining.x1 - off, y: t0, rot: 90 }
            : wall.side === 'top'
              ? { x: t0, y: dining.y0 + off, rot: 0 }
              : { x: t0, y: dining.y1 - off, rot: 180 }
    } else {
      // круглый и большой стол — к окну, но так, чтобы вокруг сели стулья
      const hw = cat.w / 2 + 55
      const hd = cat.d / 2 + 55
      want = { x: clamp(target.x, dining.x0 + hw, dining.x1 - hw), y: clamp(target.y, dining.y0 + hd, dining.y1 - hd), rot: t.rot }
    }
    planned[tableIdx] = { ...t, type, x: want.x, y: want.y, rot: want.rot }
    // стулья — к столу: пары их потом усадят с открытых сторон
    planned.forEach((p, i) => {
      if (p.type === 'chair' || p.type === 'bar-stool') planned[i] = { ...p, x: want.x, y: want.y }
    })
    tableNote = [type !== t.type ? `${cat.name} вместо ${CATALOG_MAP[t.type]?.name.toLowerCase() ?? t.type}: здесь для него мало места` : '', dining.window ? 'обеденная зона у окна' : 'обеденная зона', 'вне прохода у гарнитура'].filter(Boolean).join(' — ')
  }
  const restChecks = planned.length ? vetLayout(planned, room, withRun, { ...options, forbidden }) : []
  // в отчёте — предложение модели как было
  restChecks.forEach((c, i) => {
    if (i >= rest.length) return
    if (i === tableIdx && c.ok && c.furniture && tableNote) {
      c.furniture = { ...c.furniture, note: tableNote }
      if (rest[i].type !== planned[i].type) c.replaced = CATALOG_MAP[rest[i].type]?.name
      c.paired = dining?.window ? 'у окна, вне рабочего прохода' : 'вне рабочего прохода'
    }
    c.item = rest[i]
  })
  return [...checks, ...restChecks]
}

/** где стояки и вентканал: метки, колонны и шахты в контуре, стена с санузлом */
function communications(room: Room, plan: Plan, inner: Pt[], rooms?: Room[]): { risers: Pt[]; vents: Pt[]; riserWord: string; ventWord: string } {
  const near = (f: Furniture) => pointInPoly({ x: f.x, y: f.y }, room.polygon) || pointSegDistPoly({ x: f.x, y: f.y }, room.polygon) < 40
  const marks = plan.furniture.filter(near)
  const pt = (f: Furniture): Pt => ({ x: f.x, y: f.y })
  const markedRisers = marks.filter((f) => f.type === 'riser').map(pt)
  const markedVents = marks.filter((f) => f.type === 'vent-duct').map(pt)
  const shafts = [...shaftsOf(inner), ...marks.filter((f) => f.type === 'column').map(pt)]
  let risers = markedRisers.length ? markedRisers : shafts
  const vents = markedVents.length ? markedVents : shafts
  let riserWord = markedRisers.length ? 'стояка' : 'шахты со стояками'
  if (!risers.length && rooms) {
    // стена, общая с санузлом или ванной: стояки обычно за ней
    for (let i = 0; i < inner.length; i++) {
      const a = inner[i]
      const b = inner[(i + 1) % inner.length]
      const L = dist(a, b)
      if (L < 40) continue
      const dir = norm(sub(b, a))
      let n = perp(dir)
      const mid = add(a, mul(dir, L / 2))
      if (pointInPoly(add(mid, mul(n, 5)), inner)) n = mul(n, -1)
      for (const k of [0.25, 0.5, 0.75]) {
        const p = add(a, mul(dir, L * k))
        const behind = add(p, mul(n, 45))
        if (rooms.some((r) => r.meta.id !== room.meta.id && roomKind(r.meta.name) === 'wet' && pointInPoly(behind, r.polygon))) risers.push(p)
      }
    }
    if (risers.length) riserWord = 'стены санузла'
  }
  risers = risers.slice(0, 6)
  return { risers, vents, riserWord, ventWord: markedVents.length ? 'вентканала' : 'шахты' }
}

/**
 * Коммуникации кухни словами — модели: по контуру она шахту не видит и ставит
 * мойку куда придётся. Координаты — плана
 */
export function kitchenCommunications(room: Room, plan: Plan, rooms?: Room[]): { x: number; y: number; what: string }[] {
  const inner = room.inner.length >= 3 ? room.inner : room.polygon
  const c = communications(room, plan, inner, rooms)
  const key = (p: Pt) => `${Math.round(p.x)},${Math.round(p.y)}`
  const vents = new Set(c.vents.map(key))
  const out: { x: number; y: number; what: string }[] = []
  for (const p of c.risers) {
    const what = vents.has(key(p)) ? 'шахта: стояки воды и канализации, вентканал' : c.riserWord === 'стены санузла' ? 'стена санузла: стояки за ней' : 'стояк воды и канализации'
    out.push({ x: p.x, y: p.y, what })
  }
  for (const p of c.vents) if (!c.risers.some((q) => key(q) === key(p))) out.push({ x: p.x, y: p.y, what: 'вентканал: вытяжка над плитой' })
  return out
}

/**
 * Свободное место под обеденную зону: самый большой прямоугольник пола, где нет
 * гарнитура, рабочего прохода, дверей и стен; и точка у окна, если окно рядом
 */
function diningZone(
  inner: Pt[],
  blocked: Pt[][],
  windows: [Pt, Pt][],
): { x0: number; y0: number; x1: number; y1: number; x: number; y: number; w: number; h: number; window?: Pt; walls: { side: 'left' | 'right' | 'top' | 'bottom'; mid: Pt }[] } | null {
  const cell = 5
  const xs = inner.map((p) => p.x)
  const ys = inner.map((p) => p.y)
  const X0 = Math.min(...xs)
  const Y0 = Math.min(...ys)
  const nx = Math.ceil((Math.max(...xs) - X0) / cell)
  const ny = Math.ceil((Math.max(...ys) - Y0) / cell)
  if (nx < 4 || ny < 4 || nx * ny > 250_000) return null
  const grid = Array.from({ length: ny }, (_, j) =>
    Array.from({ length: nx }, (_, i) => {
      const p = { x: X0 + (i + 0.5) * cell, y: Y0 + (j + 0.5) * cell }
      return pointInPoly(p, inner) && !blocked.some((b) => pointInPoly(p, b))
    }),
  )
  // место, куда встанет хотя бы стол у стены со стульями (1,2 м в узкую сторону); нет такого — какое есть
  const r = largestRect(grid, nx, ny, Math.ceil(120 / cell)) ?? largestRect(grid, nx, ny)
  if (!r) return null
  const x0 = X0 + r.i0 * cell
  const x1 = X0 + (r.i1 + 1) * cell
  const y0 = Y0 + r.j0 * cell
  const y1 = Y0 + (r.j1 + 1) * cell
  const center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }
  // окно рядом с местом (до 1,2 м) — стол к нему
  let win: Pt | undefined
  for (const [a, b] of windows) {
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const dx = Math.max(x0 - c.x, 0, c.x - x1)
    const dy = Math.max(y0 - c.y, 0, c.y - y1)
    if (Math.hypot(dx, dy) < 120 && (!win || dist(c, center) < dist(win, center))) win = c
  }
  // какие стороны места — у стены комнаты: к ним можно прижать стол
  const outside = (p: Pt) => !pointInPoly(p, inner)
  const sideWall = (pts: Pt[]) => pts.every(outside)
  const k = [0.2, 0.5, 0.8]
  const walls: { side: 'left' | 'right' | 'top' | 'bottom'; mid: Pt }[] = []
  if (sideWall(k.map((t) => ({ x: x0 - 4, y: y0 + (y1 - y0) * t })))) walls.push({ side: 'left', mid: { x: x0, y: center.y } })
  if (sideWall(k.map((t) => ({ x: x1 + 4, y: y0 + (y1 - y0) * t })))) walls.push({ side: 'right', mid: { x: x1, y: center.y } })
  if (sideWall(k.map((t) => ({ x: x0 + (x1 - x0) * t, y: y0 - 4 })))) walls.push({ side: 'top', mid: { x: center.x, y: y0 } })
  if (sideWall(k.map((t) => ({ x: x0 + (x1 - x0) * t, y: y1 + 4 })))) walls.push({ side: 'bottom', mid: { x: center.x, y: y1 } })
  return { x0, y0, x1, y1, x: center.x, y: center.y, w: x1 - x0, h: y1 - y0, window: win, walls }
}

/**
 * Насколько расстановка плоха глазами «Проверки»: отказы, красные и жёлтые
 * замечания; хранение в нише — плюс; уход от замысла модели — немного минус
 */
function scoreLayout(checks: PlacementCheck[], plan: Plan): number {
  const before = runChecks(plan, []).issues
  const after = runChecks(applyLayout(plan, checks), []).issues
  const fresh = (level: string) => after.filter((i) => i.level === level).length - before.filter((i) => i.level === level).length
  let score = fresh('error') * 300 + fresh('warn') * 100
  for (const c of checks) {
    if (!c.ok) score += 1000
    else {
      if (c.niche) score -= 150
      score += Math.min(c.moved ?? 0, 300) * 0.1
    }
  }
  return score
}

/** одна проверка и починка расстановки; ниши — наружу, для сравнения вариантов */
function vetOnce(proposed: AiPlacement[], room: Room, plan: Plan, options: LayoutOptions): { checks: PlacementCheck[]; niches: Niche[] } {
  let items = proposed
  const o = { ...DEFAULT_LAYOUT, ...options }
  const walls = plan.walls
  const inner = room.inner.length >= 3 ? room.inner : room.polygon
  // двери в этой комнате: в их створ и на дугу открывания ставить нельзя; окна — не закрывать высоким
  const swings: Pt[][] = []
  const windowPts: Pt[] = []
  const doorCenters: Pt[] = []
  const windowCenters: Pt[] = []
  const windowSegs: WindowSeg[] = []
  for (const op of plan.openings) {
    const wall = walls.find((w) => w.id === op.wallId)
    if (!wall) continue
    const g = openingGeom(op, wall)
    const near = pointInPoly(g.center, room.polygon) || pointSegDistPoly(g.center, room.polygon) < 60
    if (!near) continue
    if (op.kind !== 'window') {
      swings.push(g.swing)
      doorCenters.push(g.center)
      continue
    }
    windowCenters.push(g.center)
    const n = perp(norm(sub(wall.b, wall.a)))
    // окно по внутренней грани: с той стороны стены, где комната
    const side = pointInPoly(add(g.center, mul(n, wall.thickness / 2 + 6)), inner) ? 1 : -1
    const face = mul(n, (side * wall.thickness) / 2)
    windowSegs.push({ a: add(add(g.center, mul(g.dir, -g.hw)), face), b: add(add(g.center, mul(g.dir, g.hw)), face), n: mul(n, side) })
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
  // ковёр под ногами — не препятствие: на нём стоят кровать и диван
  const standingAll = plan.furniture.filter((f) => !CATALOG_MAP[f.type]?.symbol && pointInPoly({ x: f.x, y: f.y }, room.polygon))
  const standing = standingAll.filter((f) => (CATALOG_MAP[f.type]?.z ?? 1) === 1)
  const taken: Pt[][] = standing.map(furnitureBody)
  const takenZones: Zone[] = standing.flatMap((f) => zonesFor(f, CATALOG_MAP[f.type]))
  const niches = findNiches(inner, { doors: doorCenters, windows: windowCenters })
  const ctx: Ctx = { inner, walls: wallPolys, swings, windowPts, taken, takenKinds: standing.map((f) => f.type), takenZones, tol: o.outTolerance, niches, windows: windowSegs, forbidden: options.forbidden ?? [] }

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
  const rugIdx: number[] = []
  interface Placed {
    idx: number
    /** что предложила модель — от него считается «место поправлено» */
    want: Spot
    /** куда целимся: место у пары (телевизор напротив дивана) или предложенное */
    target: Spot
    cat: CatalogItem
    used: CatalogItem
    f: Furniture
  }
  const placed: Placed[] = []
  const standingZones = [...takenZones]
  const standingBodies = [...taken]
  const standingKinds = standing.map((f) => f.type)
  /** собрать занятое заново: без предметов skip — их место пересматривается */
  const rebuild = (skip: Set<number> = new Set()) => {
    const others = placed.filter((p) => !skip.has(p.idx))
    ctx.taken = [...standingBodies, ...others.map((p) => furnitureBody(p.f))]
    ctx.takenKinds = [...standingKinds, ...others.map((p) => p.used.type)]
    ctx.takenZones = [...standingZones, ...others.flatMap((p) => zonesFor(p.f, p.used))]
    ctx.beds = others.filter((p) => isDoubleBed(p.used)).map((p) => p.f)
  }
  const kinds = (cat: CatalogItem) => [
    // гардеробная — только в нише: вне ниши ей нужны стены, которых нет
    ...(cat.type === 'closet' ? closetKinds(cat, niches) : [cat]),
    ...(ALTERNATIVES[cat.type] ?? []).map((t) => CATALOG_MAP[t]).filter((c): c is CatalogItem => !!c && fitting.has(c.type)),
  ]
  /** лучшее место среди самого предмета и его замен (купе вместо распашного) */
  const bestOf = (cat: CatalogItem, want: Spot) => {
    let best: { used: CatalogItem; spot: Spot; moved: number; cost: number } | null = null
    let fail: Fail | null = null
    for (const k of kinds(cat)) {
      const r = findSpot(k, want, ctx)
      if ('fail' in r) {
        if (k.type === cat.type) fail = r.fail
        continue
      }
      const cost = r.cost + (k.type === cat.type ? 0 : 30)
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
    // ковёр кладётся под мебель, когда она встала, — см. ниже
    if (cat.glyph === 'rug') {
      rugIdx.push(idx)
      continue
    }
    const want: Spot = { x: item.x, y: item.y, rot: normDeg(item.rot) }
    // у парного предмета пара уже стоит (диван раньше стола и телевизора): сразу целимся в место у неё,
    // иначе его займёт кто-то другой и телевизор встанет не напротив дивана
    const rule = PAIRS[cat.type]
    const aim = rule?.soft
      ? placed
          .filter((q) => rule.hosts(q.used))
          .flatMap((q) => rule.spots(q.f, q.used, cat, ctx))
          .filter((s) => !fits(toFurniture(cat, s), ctx))
          .sort((a, b) => dist(a, want) - dist(b, want))[0]
      : undefined
    let { best, fail } = bestOf(cat, aim ?? want)
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
    placed.push({ idx, want, target: aim ?? want, cat, used: best.used, f: toFurniture(best.used, best.spot) })
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
      const now = spotCost(p.f, p.used, p.target, ctx) + (p.used.type === p.cat.type ? 0 : 30)
      const { best } = bestOf(p.cat, p.target)
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

  // Пары: тумба — к изголовью, стул — к столу. Пары нет или у неё нет
  // свободного места — отказ с причиной: тумба посреди стены хуже, чем никакой
  const paired = new Map<number, string>()
  const hostsOf = (rule: PairRule, self: Placed) => [
    ...placed.filter((q) => q !== self && rule.hosts(q.used)).map((q) => ({ f: q.f, cat: q.used })),
    ...standing.filter((f) => CATALOG_MAP[f.type] && rule.hosts(CATALOG_MAP[f.type])).map((f) => ({ f, cat: CATALOG_MAP[f.type] })),
  ]
  const rankOf = (p: Placed) => PAIRS[p.used.type]?.rank ?? 0
  for (const p of [...placed].sort((a, b) => rankOf(a) - rankOf(b))) {
    const rule = PAIRS[p.used.type]
    if (!rule) continue
    rebuild(new Set([p.idx]))
    let best: { f: Furniture; cost: number; host: CatalogItem } | null = null
    const hosts = hostsOf(rule, p)
    for (const h of hosts) {
      for (const s of rule.spots(h.f, h.cat, p.used, ctx)) {
        const g = toFurniture(p.used, s, p.f.id)
        if (fits(g, ctx)) continue
        // ближе к тому, где стоял, и без помех проходам
        const cost = penalty(g, p.used, ctx) + Math.min(dist(g, p.f), 300) * 0.3
        if (!best || cost < best.cost) best = { f: g, cost, host: h.cat }
      }
    }
    if (best) {
      // пояснение — если место у пары не то, что предлагала модель
      if (dist(best.f, p.want) > 20 || best.f.rot !== p.want.rot) paired.set(p.idx, rule.note(best.host))
      p.f = best.f
    } else if (!rule.soft) {
      placed.splice(placed.indexOf(p), 1)
      done.set(p.idx, { item: items[p.idx], ok: false, reason: `${p.used.name}: ${hosts.length ? rule.full : rule.alone}` })
    }
    rebuild()
  }

  // Двуспальная кровать без тумб выглядит недоделанной: к ней — тумбы с обеих
  // сторон изголовья. Каких модель не дала, а место есть — ставим и говорим об этом
  const added: PlacementCheck[] = []
  const nightCat = CATALOG_MAP.nightstand
  if (nightCat && fitting.has('nightstand') && ctx.beds?.length) {
    const stands = placed.filter((q) => q.used.type === 'nightstand').map((q) => q.f)
    for (const bed of ctx.beds) {
      for (const s of nightstandSpots(bed, nightCat.w, nightCat.d)) {
        if (stands.some((n) => dist(n, s) < 15)) continue
        const f: Furniture = { ...toFurniture(nightCat, s), note: 'у изголовья: к двуспальной кровати — тумбы с двух сторон' }
        if (fits(f, ctx)) continue
        ctx.taken.push(furnitureBody(f))
        ctx.takenKinds.push(f.type)
        ctx.takenZones.push(...zonesFor(f, nightCat))
        stands.push(f)
        added.push({ item: { type: 'nightstand', x: f.x, y: f.y, rot: f.rot, why: 'добавлено к кровати' }, ok: true, furniture: f, moved: 0, added: true })
      }
    }
  }

  // Ковры — под то, что они собирают в зону: кровать, диван, обеденный стол
  const RUG_NOTE = { bed: 'под нижние две трети кровати — утром ступать на тёплое', sofa: 'передние ножки дивана на ковре — зона отдыха собрана', table: 'под столом с запасом — отодвинутый стул не съезжает с ковра' }
  const RUG_TOUCH = { bed: 'ковёр под кроватью', sofa: 'ковёр у дивана', table: 'ковёр под столом' }
  type RugHost = { f: Furniture; kind: 'bed' | 'sofa' | 'table'; corner?: boolean }
  const rugHosts = (): RugHost[] => [
    ...placed.filter((q) => isDoubleBed(q.used)).map((q) => ({ f: q.f, kind: 'bed' as const })),
    ...placed.filter((q) => SOFAS(q.used)).map((q) => ({ f: q.f, kind: 'sofa' as const, corner: q.used.glyph === 'sofa-corner' })),
    ...placed.filter((q) => q.used.type === 'dining-table' || q.used.type === 'table-round').map((q) => ({ f: q.f, kind: 'table' as const })),
  ]
  const rugOk = (r: RugPlace) => rugInside(r, inner) && !swings.some((sw) => convexOverlap(sw, obbCorners(r.x, r.y, r.w, r.d, r.rot), 2))
  /** ковёр под зону: самый большой, что ложится; не лёг даже поменьше — ковра нет */
  const rugFits = (h: RugHost): RugPlace | null => {
    const big = h.kind === 'bed' ? rugUnderBed(h.f) : h.kind === 'table' ? rugUnderTable(h.f) : rugBeforeSofa(h.f, !!h.corner)
    if (rugOk(big)) return big
    // уже кровати или стола ковёр не нужен: он должен выглядывать по бокам
    const minW = h.kind === 'sofa' ? 120 : h.f.w + 30
    return smallerRugs(big, h.kind !== 'table', minW, 100).find(rugOk) ?? null
  }
  const rugFurniture = (type: string, r: RugPlace, note?: string): Furniture => ({ id: uid('f'), type, x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.w), d: Math.round(r.d), rot: normDeg(r.rot), note })
  const rugTaken = new Set<Furniture>()
  for (const idx of rugIdx) {
    const item = items[idx]
    const cat = CATALOG_MAP[item.type]
    const host = rugHosts()
      .filter((h) => !rugTaken.has(h.f))
      .sort((a, b) => dist(a.f, item) - dist(b.f, item))
      .map((h) => ({ h, r: rugFits(h) }))
      .find((x) => x.r)
    if (host) {
      rugTaken.add(host.h.f)
      const f = rugFurniture(item.type, host.r!, RUG_NOTE[host.h.kind])
      done.set(idx, { item, ok: true, furniture: f, moved: Math.round(dist(f, item)), touch: RUG_TOUCH[host.h.kind] })
      continue
    }
    const r = { x: item.x, y: item.y, w: cat.w, d: cat.d, rot: normDeg(item.rot) }
    if (rugOk(r)) done.set(idx, { item, ok: true, furniture: rugFurniture(item.type, r, item.why || undefined), moved: 0 })
    else done.set(idx, { item, ok: false, reason: `${cat.name}: не помещается в комнате` })
  }

  // Штрихи дизайнера — чего модель не дала, а комната просит: ковёр собирает
  // зону, торшер у кресла — уголок для чтения, растение у окна — живой акцент
  const touched: PlacementCheck[] = []
  const touches = options.touches === true
  const has = (type: string) => placed.some((q) => q.used.type === type) || standingAll.some((f) => f.type === type)
  const addTouch = (f: Furniture, cat: CatalogItem, touch: string) => {
    if (cat.z !== 0) {
      ctx.taken.push(furnitureBody(f))
      ctx.takenKinds.push(f.type)
      ctx.takenZones.push(...zonesFor(f, cat))
    }
    touched.push({ item: { type: f.type, x: f.x, y: f.y, rot: f.rot, why: 'штрих дизайнера' }, ok: true, furniture: f, moved: 0, added: true, touch })
  }
  if (touches) {
    const rugCat = CATALOG_MAP.rug
    const anyRug = rugIdx.some((i) => done.get(i)?.ok) || standingAll.some((f) => CATALOG_MAP[f.type]?.glyph === 'rug')
    if (rugCat && fitting.has('rug') && !anyRug) {
      const host = rugHosts()
        .map((h) => ({ h, r: rugFits(h) }))
        .find((x) => x.r)
      if (host) addTouch(rugFurniture('rug', host.r!, RUG_NOTE[host.h.kind]), rugCat, RUG_TOUCH[host.h.kind])
    }
    const lampCat = CATALOG_MAP.lamp
    const reading = placed.find((q) => q.used.glyph === 'armchair')
    if (lampCat && fitting.has('lamp') && reading && !has('lamp')) {
      for (const s of lampSpots(reading.f, lampCat)) {
        const f = { ...toFurniture(lampCat, s), note: 'у кресла — уголок для чтения: свет сбоку и сзади' }
        if (!fits(f, ctx) && penalty(f, lampCat, ctx) < 40) {
          addTouch(f, lampCat, 'торшер у кресла')
          break
        }
      }
    }
    const plantCat = CATALOG_MAP.plant
    if (plantCat && fitting.has('plant') && room.area >= 9 && !has('plant')) {
      for (const s of plantSpots(ctx.windows, plantCat)) {
        const f = { ...toFurniture(plantCat, s), note: 'у окна — растению светло, окно открывается' }
        if (!fits(f, ctx) && penalty(f, plantCat, ctx) < 40) {
          addTouch(f, plantCat, 'растение у окна')
          break
        }
      }
    }
  }
  // палитра текстиля: основной цвет — диван и покрывало, акцент — кресла и банкетка, ковёр — свой
  const palette = touches ? paletteFor(options.purpose || room.meta.name) : null
  const paint = (f: Furniture, cat: CatalogItem | undefined): Furniture => {
    if (!palette || !cat || f.color) return f
    const color = SOFAS(cat) || cat.glyph === 'bed' ? palette.main : cat.glyph === 'armchair' || cat.glyph === 'bench' ? palette.accent : cat.glyph === 'rug' ? palette.rug : undefined
    return color ? { ...f, color } : f
  }

  // сдвиг от предложенного — до растяжки шкафа: растяжка не «поправка места»
  const movedOf = new Map(placed.map((p) => [p.idx, Math.round(dist(p.f, p.want))]))
  // шкаф — на всю нишу или стену, где встал: встроенный шкаф без щелей по краям
  for (const p of placed) {
    if (!FILLS.has(p.used.type) || p.used.resizable === false) continue
    const i = ctx.taken.findIndex((t) => JSON.stringify(t) === JSON.stringify(furnitureBody(p.f)))
    if (i >= 0) {
      ctx.taken.splice(i, 1)
      ctx.takenKinds.splice(i, 1)
    }
    const grown = fillAlongWall(p.f, p.used, ctx)
    p.f = grown
    ctx.taken.push(furnitureBody(grown))
    ctx.takenKinds.push(p.used.type)
  }

  for (const p of placed) {
    const item = items[p.idx]
    const moved = movedOf.get(p.idx) ?? 0
    const notes = [item.why || '']
    const bigger = p.f.w - p.used.w
    const pair = paired.get(p.idx)
    const swapped = p.used.type !== p.cat.type
    const niche = isStorage(p.used) ? nicheOf(p.f, ctx) : undefined
    if (swapped && ALTERNATIVES[p.cat.type]?.includes(p.used.type)) notes.push(`${p.used.name} вместо ${p.cat.name.toLowerCase()}: ${ALTERNATIVE_WHY[p.cat.type]}`)
    else if (swapped) notes.push(`${p.used.name} вместо ${p.cat.name.toLowerCase()}: большой не помещается`)
    else if (niche) notes.push(`в ${nicheText(niche)}: хранение там, где оно не отнимает места у комнаты`)
    else if (pair && moved > 20) notes.push(pair)
    else if (moved > 20) notes.push(`место поправлено на ${moved} см: предложенное не подходило`)
    if (p.used.type === 'closet') notes.push(`${Math.round(p.f.w)} × ${Math.round(p.f.d)} см, двери-купе`)
    else if (bigger >= 10) notes.push(`во всю нишу: ${Math.round(p.f.w)} см вместо ${p.used.w}`)
    p.f = paint({ ...p.f, note: notes.filter(Boolean).join(' · ') || undefined }, p.used)
    done.set(p.idx, {
      item,
      ok: true,
      furniture: p.f,
      moved,
      replaced: swapped ? p.cat.name : undefined,
      widened: bigger >= 10 ? Math.round(p.f.w) : undefined,
      paired: pair && moved > 20 ? pair : undefined,
      niche: niche ? nicheText(niche) : undefined,
    })
  }
  // в отчёте — предложение модели как было
  const all = [...items.map((_, i) => ({ ...done.get(i)!, item: proposed[i] })), ...added, ...touched].map((c) => (c.ok && c.furniture ? { ...c, furniture: paint(c.furniture, CATALOG_MAP[c.furniture.type]) } : c))
  if (palette && all.some((c) => c.ok && c.furniture?.color)) all[0] = { ...all[0], palette: palette.name }
  return { checks: all, niches }
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
  const movedN = checks.filter((c) => c.ok && !c.replaced && !c.added && !c.paired && !c.niche && !c.kitchen && CATALOG_MAP[c.item.type]?.glyph !== 'rug' && (c.moved ?? 0) > 20).length
  const smaller = checks.filter((c) => c.ok && c.replaced).length
  const widened = checks.filter((c) => c.ok && c.widened).length
  // «тумба — у изголовья кровати, кресло офисное — к столу»: что придвинуто к своей паре
  const pairs = [...new Set(checks.filter((c) => c.ok && c.paired).map((c) => `${(CATALOG_MAP[c.furniture!.type]?.name ?? '').toLowerCase()} — ${c.paired}`))]
  const inNiche = checks.filter((c) => c.ok && c.niche).map((c) => `${(CATALOG_MAP[c.furniture!.type]?.name ?? '').toLowerCase()} — в ${c.niche}`)
  const kitchen = checks.find((c) => typeof c.kitchen === 'string')?.kitchen as string | undefined
  const touches = checks.filter((c) => c.ok && c.touch).map((c) => c.touch!)
  const palette = checks.find((c) => c.palette)?.palette
  const fixes = [
    kitchen ?? '',
    movedN ? `место поправлено у ${movedN}` : '',
    pairs.join(', '),
    ...inNiche,
    smaller ? `замена на подходящий — ${smaller}` : '',
    widened ? `шкаф во всю нишу` : '',
    touches.length ? `штрихи дизайнера: ${touches.join(', ')}` : '',
    palette ? `палитра «${palette}»` : '',
  ]
    .filter(Boolean)
    .join(', ')
  // одинаковые — одной строкой: «Тумба 60 ×3», а не три раза подряд
  const count = new Map<string, number>()
  for (const c of checks) if (c.ok && c.furniture) {
    const name = CATALOG_MAP[c.furniture.type]?.name ?? c.furniture.type
    count.set(name, (count.get(name) ?? 0) + 1)
  }
  const names = [...count].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
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
  // жилым комнатам — ковёр, торшер и растение: то, чем дизайнер заканчивает комнату
  if (cats.has('bedroom') || cats.has('kids') || cats.has('office')) for (const t of ['rug', 'lamp', 'plant']) extra.add(t)
  // на кухне едят: обычные стулья и круглый стол тоже к месту
  if (cats.has('kitchen')) for (const t of ['chair', 'table-round', 'dining-table']) extra.add(t)
  // гардеробная в нишу прихожей — лучшее место для верхней одежды
  if (cats.has('hall')) extra.add('closet')
  // в спальне часто и работают: стол со стулом у окна
  if (cats.has('bedroom') && !cats.has('living')) for (const t of ['desk', 'office-chair']) extra.add(t)
  // радиатор и колонна — часть здания, «произвольный объект» — заготовка: их не расставляют;
  // пианино — только там, где гостиная
  // стояки, вентканалы и куски столешницы ставит человек или сборщик кухни, а не модель
  const never = new Set(['radiator', 'column', 'box', 'riser', 'vent-duct', 'counter-top'])
  return all
    .filter((c) => !c.symbol && !never.has(c.type) && (cats.has(c.category) || extra.has(c.type)))
    .filter((c) => c.type !== 'piano' || cats.has('living'))
    .map((c) => ({ type: c.type, name: c.name, w: c.w, d: c.d }))
}
