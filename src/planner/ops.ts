// Операции над планом: чистые функции Plan -> Plan
import type { DimensionLine, Furniture, Opening, OpeningKind, Plan, Pt, Room, RoomMeta, Selection, Underlay, Wall } from './types'
import { uid } from './types'
import { CATALOG_MAP, type CatalogItem } from './catalog'
import { add, bboxOf, dist, eq, lerp, mul, norm, normDeg, obbCorners, perp, pointInPoly, projectT, rotate, segIntersect, sub } from './geometry'

export const OPENING_DEFAULT_WIDTH: Record<OpeningKind, number> = { door: 80, window: 150, doorway: 90 }
export const OPENING_WIDTHS: Record<OpeningKind, number[]> = {
  door: [60, 70, 80, 90, 100, 120, 160],
  window: [60, 90, 120, 150, 180, 210, 240, 300],
  doorway: [80, 90, 100, 120, 150, 200, 250],
}
export const WALL_THICKNESSES = [8, 10, 12, 15, 20, 25, 30, 38, 40, 51]
/** ниже этой длины стена теряет смысл, см */
export const MIN_WALL_LENGTH = 20
/** минимальная ширина проёма, см */
export const MIN_OPENING_WIDTH = 30
/** какой длины должна быть стена, чтобы принять проём такой ширины */
export const wallNeededFor = (width: number): number => width + 2

export function addWall(plan: Plan, a: Pt, b: Pt, thickness: number): Plan {
  if (dist(a, b) < 1) return plan
  return { ...plan, walls: [...plan.walls, { id: uid('w'), a: { ...a }, b: { ...b }, thickness }] }
}

/**
 * Прямоугольник из четырёх стен. Там, где новая стена ложится на уже нарисованную
 * (общая стена двух комнат, в том числе частично — Т-стык), добавляется только
 * непокрытый остаток: дублей и наложений не бывает, а комнаты замыкаются.
 */
export function addRect(plan: Plan, a: Pt, b: Pt, thickness: number): Plan {
  const x0 = Math.min(a.x, b.x)
  const x1 = Math.max(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const y1 = Math.max(a.y, b.y)
  if (x1 - x0 < 20 || y1 - y0 < 20) return plan
  const EPS = 0.75
  let p = plan
  const edges: { vertical: boolean; at: number; from: number; to: number }[] = [
    { vertical: false, at: y0, from: x0, to: x1 },
    { vertical: true, at: x1, from: y0, to: y1 },
    { vertical: false, at: y1, from: x0, to: x1 },
    { vertical: true, at: x0, from: y0, to: y1 },
  ]
  for (const e of edges) {
    // участки, уже занятые стенами на той же оси
    const covered: [number, number][] = []
    for (const w of p.walls) {
      const vertical = Math.abs(w.a.x - w.b.x) <= EPS
      const horizontal = Math.abs(w.a.y - w.b.y) <= EPS
      if (e.vertical ? !vertical : !horizontal) continue
      const at = e.vertical ? w.a.x : w.a.y
      if (Math.abs(at - e.at) > EPS) continue
      const lo = e.vertical ? Math.min(w.a.y, w.b.y) : Math.min(w.a.x, w.b.x)
      const hi = e.vertical ? Math.max(w.a.y, w.b.y) : Math.max(w.a.x, w.b.x)
      if (hi <= e.from + EPS || lo >= e.to - EPS) continue
      covered.push([Math.max(lo, e.from), Math.min(hi, e.to)])
    }
    covered.sort((u, v) => u[0] - v[0])
    let cursor = e.from
    const gaps: [number, number][] = []
    for (const [lo, hi] of covered) {
      if (lo > cursor + EPS) gaps.push([cursor, lo])
      cursor = Math.max(cursor, hi)
    }
    if (cursor < e.to - EPS) gaps.push([cursor, e.to])
    for (const [lo, hi] of gaps) {
      if (hi - lo < 2) continue
      const s = e.vertical ? { x: e.at, y: lo } : { x: lo, y: e.at }
      const t = e.vertical ? { x: e.at, y: hi } : { x: hi, y: e.at }
      p = addWall(p, s, t, thickness)
    }
  }
  return p
}

/** сдвиг узлов: все концы стен в точке from переезжают в to */
// ---------- локальная правка участка ----------
//
// «Уточнить участок»: пользователь обводит место на чертеже и говорит, что там
// на самом деле. Правка не трогает остальной чертёж: стены за пределами участка
// остаются как есть, а те, что входят в него, обрезаются ровно по его границе.

export interface Area {
  x1: number
  y1: number
  x2: number
  y2: number
}

export const normalizeArea = (a: Pt, b: Pt): Area => ({ x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) })

const inArea = (p: Pt, r: Area): boolean => p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2

/** отрезок стены внутри участка: доли t вдоль стены, null — не заходит */
function areaSpan(w: Wall, r: Area): { t0: number; t1: number } | null {
  const dx = w.b.x - w.a.x
  const dy = w.b.y - w.a.y
  let t0 = 0
  let t1 = 1
  // отсечение отрезка прямоугольником (Лианг — Барски)
  for (const [p, q] of [
    [-dx, w.a.x - r.x1],
    [dx, r.x2 - w.a.x],
    [-dy, w.a.y - r.y1],
    [dy, r.y2 - w.a.y],
  ]) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return null
      continue
    }
    const t = q / p
    if (p < 0) t0 = Math.max(t0, t)
    else t1 = Math.min(t1, t)
    if (t0 > t1) return null
  }
  return { t0, t1 }
}

/**
 * Убрать стены внутри участка: то, что целиком внутри, удаляется, то, что
 * пересекает границу, обрезается по ней, а стена насквозь делится надвое.
 * Проёмы, оставшиеся без стены или попавшие в вырезанный кусок, убираются.
 */
export function clearWallsIn(plan: Plan, area: Area): Plan {
  const walls: Wall[] = []
  const keep = new Map<string, string[]>()
  for (const w of plan.walls) {
    const span = areaSpan(w, area)
    if (!span) {
      walls.push(w)
      keep.set(w.id, [w.id])
      continue
    }
    const parts: string[] = []
    const piece = (t0: number, t1: number) => {
      const a = lerp(w.a, w.b, t0)
      const b = lerp(w.a, w.b, t1)
      if (dist(a, b) < MIN_WALL_LENGTH) return
      const id = uid('w')
      walls.push({ ...w, id, a, b })
      parts.push(id)
    }
    piece(0, span.t0)
    piece(span.t1, 1)
    keep.set(w.id, parts)
  }
  // проём переезжает на тот кусок, куда он попал целиком
  const openings = plan.openings.flatMap((o) => {
    const w0 = plan.walls.find((x) => x.id === o.wallId)
    const parts = keep.get(o.wallId)
    if (!w0 || !parts) return []
    if (parts.length === 1 && parts[0] === o.wallId) return [o]
    const c = lerp(w0.a, w0.b, o.t)
    for (const id of parts) {
      const w = walls.find((x) => x.id === id)!
      const L = dist(w.a, w.b)
      const t = projectT(c, w.a, w.b)
      const half = o.width / 2 / L
      if (t >= half && t <= 1 - half) return [{ ...o, wallId: id, t }]
    }
    return []
  })
  return { ...plan, walls, openings }
}

/** дотянуть конец стены до ближайшей поперечной стены, если она рядом: иначе контур не замкнётся */
function reachWall(walls: Wall[], from: Pt, to: Pt, reach: number): Pt {
  const dir = norm(sub(to, from))
  let best = to
  let bestD = reach
  for (const w of walls) {
    const hit = segIntersect(to, add(to, mul(dir, reach)), w.a, w.b)
    if (!hit) continue
    const d = dist(to, hit.p)
    if (d <= bestD) {
      bestD = d
      best = hit.p
    }
  }
  return best
}

/**
 * Поставить стену по участку: вдоль его длинной стороны, посередине короткой.
 * Так обведённая полоска превращается в стену там, где распознавание её
 * пропустило; всё лишнее внутри участка перед этим убирается, а концы
 * дотягиваются до соседних стен — иначе комната не замкнётся.
 */
export function wallInArea(plan: Plan, area: Area, thickness: number, reach = 60): Plan {
  const w = area.x2 - area.x1
  const h = area.y2 - area.y1
  if (Math.max(w, h) < MIN_WALL_LENGTH) return plan
  const cleared = clearWallsIn(plan, area)
  const [a0, b0] =
    w >= h
      ? [{ x: area.x1, y: (area.y1 + area.y2) / 2 }, { x: area.x2, y: (area.y1 + area.y2) / 2 }]
      : [{ x: (area.x1 + area.x2) / 2, y: area.y1 }, { x: (area.x1 + area.x2) / 2, y: area.y2 }]
  const a = reachWall(cleared.walls, b0, a0, reach)
  const b = reachWall(cleared.walls, a0, b0, reach)
  return cleanupWalls(addWall(cleared, a, b, thickness))
}

/** стена, проходящая через участок дальше всех: её и правим */
export function wallThrough(plan: Plan, area: Area): { wall: Wall; t0: number; t1: number } | null {
  let best: { wall: Wall; t0: number; t1: number; L: number } | null = null
  for (const w of plan.walls) {
    const span = areaSpan(w, area)
    if (!span) continue
    const L = dist(w.a, w.b) * (span.t1 - span.t0)
    if (!best || L > best.L) best = { wall: w, t0: span.t0, t1: span.t1, L }
  }
  return best ? { wall: best.wall, t0: best.t0, t1: best.t1 } : null
}

/**
 * Проём на стене внутри участка: ширина — по длине куска стены в участке,
 * положение — по его середине. Старые проёмы на этом месте убираются, чтобы
 * уточнение не наложилось на прежнюю догадку.
 */
export function openingInArea(plan: Plan, area: Area, kind: OpeningKind, rooms: Room[]): { plan: Plan; id: string } {
  const hit = wallThrough(plan, area)
  if (!hit) return { plan, id: '' }
  const L = dist(hit.wall.a, hit.wall.b)
  const width = Math.max(MIN_OPENING_WIDTH, Math.min((hit.t1 - hit.t0) * L, L - 2))
  const t = (hit.t0 + hit.t1) / 2
  const cleaned: Plan = {
    ...plan,
    openings: plan.openings.filter((o) => {
      if (o.wallId !== hit.wall.id) return true
      return Math.abs(o.t - t) * L > (o.width + width) / 2
    }),
  }
  return addOpening(cleaned, kind, hit.wall.id, t, width, rooms)
}

export function moveNodes(plan: Plan, moves: { from: Pt; to: Pt }[]): Plan {
  const find = (p: Pt) => moves.find((m) => eq(m.from, p, 0.75))
  return {
    ...plan,
    walls: plan.walls.map((w) => {
      const ma = find(w.a)
      const mb = find(w.b)
      if (!ma && !mb) return w
      return { ...w, a: ma ? { ...ma.to } : w.a, b: mb ? { ...mb.to } : w.b }
    }),
  }
}

/** удаляем вырожденные стены и осиротевшие проёмы, прижимаем проёмы внутрь стен */
export function cleanupWalls(plan: Plan): Plan {
  const walls = plan.walls.filter((w) => dist(w.a, w.b) >= 2)
  const ids = new Set(walls.map((w) => w.id))
  const wmap = new Map(walls.map((w) => [w.id, w]))
  const openings = plan.openings
    .filter((o) => ids.has(o.wallId))
    .map((o) => {
      const w = wmap.get(o.wallId)!
      const L = dist(w.a, w.b)
      // стена стала короче — сужаем проём, а не выбрасываем его молча
      const width = Math.min(o.width, L - 2)
      if (width < MIN_OPENING_WIDTH) return null
      const hw = width / 2 / L
      const t = Math.min(1 - hw, Math.max(hw, o.t))
      return t === o.t && width === o.width ? o : { ...o, t, width }
    })
    .filter((o): o is Opening => !!o)
  if (walls.length === plan.walls.length && openings.length === plan.openings.length && openings.every((o, i) => o === plan.openings[i])) return plan
  return { ...plan, walls, openings }
}

export function updateWall(plan: Plan, id: string, patch: Partial<Wall>): Plan {
  return { ...plan, walls: plan.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)) }
}

export function setWallLength(plan: Plan, id: string, L: number): Plan {
  const w = plan.walls.find((x) => x.id === id)
  if (!w || !Number.isFinite(L) || L < MIN_WALL_LENGTH) return plan
  const dir = norm(sub(w.b, w.a))
  const nb = add(w.a, mul(dir, L))
  return cleanupWalls(moveNodes(plan, [{ from: w.b, to: nb }]))
}

export function setWallThickness(plan: Plan, id: string, thickness: number): Plan {
  return updateWall(plan, id, { thickness })
}

/** выбираем сторону открывания: внутрь комнаты, если стена наружная */
export function pickOpeningSide(wall: Wall, t: number, rooms: Room[]): 1 | -1 {
  const dir = norm(sub(wall.b, wall.a))
  const n = perp(dir)
  const c = lerp(wall.a, wall.b, t)
  const inPlus = rooms.some((r) => pointInPoly(add(c, mul(n, wall.thickness / 2 + 20)), r.polygon))
  const inMinus = rooms.some((r) => pointInPoly(add(c, mul(n, -(wall.thickness / 2 + 20))), r.polygon))
  if (inPlus && !inMinus) return 1
  if (inMinus && !inPlus) return -1
  return 1
}

export function addOpening(plan: Plan, kind: OpeningKind, wallId: string, t: number, width: number, rooms: Room[]): { plan: Plan; id: string } {
  const wall = plan.walls.find((w) => w.id === wallId)
  if (!wall) return { plan, id: '' }
  const L = dist(wall.a, wall.b)
  // проём шире стены оставил бы дыру за её пределами — сужаем по месту
  const w = Math.min(width, L - 2)
  if (w < MIN_OPENING_WIDTH) return { plan, id: '' }
  const hw = w / 2 / L
  const id = uid('o')
  const op: Opening = {
    id,
    kind,
    wallId,
    t: Math.min(1 - hw, Math.max(hw, t)),
    width: w,
    hinge: 'a',
    side: pickOpeningSide(wall, t, rooms),
  }
  return { plan: { ...plan, openings: [...plan.openings, op] }, id }
}

export function updateOpening(plan: Plan, id: string, patch: Partial<Opening>): Plan {
  return cleanupWalls({ ...plan, openings: plan.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)) })
}

export function addFurniture(plan: Plan, cat: CatalogItem, x: number, y: number, rot: number, size?: { w: number; d: number }): { plan: Plan; id: string } {
  const id = uid('f')
  const f: Furniture = {
    id,
    type: cat.type,
    x,
    y,
    w: size?.w ?? cat.w,
    d: size?.d ?? cat.d,
    rot: normDeg(rot),
    ...(cat.h ? { h: cat.h } : {}),
    ...(cat.model ? { model: cat.model, label: cat.name } : {}),
    ...(cat.electric ? { electric: cat.electric, label: cat.name } : {}),
    ...(cat.product ? { product: cat.product, label: cat.product.name } : {}),
  }
  return { plan: { ...plan, furniture: [...plan.furniture, f] }, id }
}

export function updateFurniture(plan: Plan, id: string, patch: Partial<Furniture>): Plan {
  return { ...plan, furniture: plan.furniture.map((f) => (f.id === id ? { ...f, ...patch } : f)) }
}

export function rotateFurniture(plan: Plan, id: string, deg: number): Plan {
  const f = plan.furniture.find((x) => x.id === id)
  if (!f) return plan
  return updateFurniture(plan, id, { rot: normDeg(f.rot + deg) })
}

/**
 * Копия предмета рядом с оригиналом. Место ищется по кругу: вдоль ширины
 * вправо (стулья и тумбы встают в ряд), влево, вперёд, назад, потом дальше —
 * первое, где копия не ложится на другой предмет и не уходит из комнаты
 * оригинала (когда комнаты даны). Свободного места нет — копия справа, как есть
 */
export function duplicateFurniture(plan: Plan, id: string, rooms: Room[] = []): { plan: Plan; id: string } {
  const f = plan.furniture.find((x) => x.id === id)
  if (!f) return { plan, id }
  const cat = CATALOG_MAP[f.type]
  const nid = uid('f')
  const symbol = !!cat?.symbol
  const stepW = symbol ? 30 : f.w + 10
  const stepD = symbol ? 30 : f.d + 10
  const home = rooms.find((r) => pointInPoly({ x: f.x, y: f.y }, r.polygon))
  const others = plan.furniture.filter((x) => x.id !== id && !CATALOG_MAP[x.type]?.symbol)
  const free = (c: Pt): boolean => {
    if (home && !pointInPoly(c, home.polygon)) return false
    if (symbol) return true
    const my = bboxOf(obbCorners(c.x, c.y, f.w, f.d, f.rot))
    return !others.some((o) => {
      const ob = bboxOf(obbCorners(o.x, o.y, o.w, o.d, o.rot))
      return my.minX < ob.maxX - 1 && my.maxX > ob.minX + 1 && my.minY < ob.maxY - 1 && my.maxY > ob.minY + 1
    })
  }
  const dirs = [rotate({ x: 1, y: 0 }, f.rot), rotate({ x: -1, y: 0 }, f.rot), rotate({ x: 0, y: 1 }, f.rot), rotate({ x: 0, y: -1 }, f.rot)]
  let at: Pt | null = null
  for (let k = 1; k <= 3 && !at; k++) {
    for (let i = 0; i < dirs.length && !at; i++) {
      const c = add({ x: f.x, y: f.y }, mul(dirs[i], (i < 2 ? stepW : stepD) * k))
      if (free(c)) at = c
    }
  }
  const c = at ?? add({ x: f.x, y: f.y }, mul(dirs[0], stepW))
  const copy: Furniture = { ...f, id: nid, x: c.x, y: c.y }
  return { plan: { ...plan, furniture: [...plan.furniture, copy] }, id: nid }
}

export function nudgeFurniture(plan: Plan, id: string, dx: number, dy: number): Plan {
  const f = plan.furniture.find((x) => x.id === id)
  if (!f) return plan
  return updateFurniture(plan, id, { x: f.x + dx, y: f.y + dy })
}

export function setUnderlay(plan: Plan, underlay: Underlay | undefined): Plan {
  return { ...plan, underlay }
}

export function updateUnderlay(plan: Plan, patch: Partial<Underlay>): Plan {
  if (!plan.underlay) return plan
  return { ...plan, underlay: { ...plan.underlay, ...patch } }
}

export function updateRoomMeta(plan: Plan, id: string, patch: Partial<RoomMeta>): Plan {
  return { ...plan, rooms: plan.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) }
}

export function addDim(plan: Plan, a: Pt, b: Pt, offset = 30): Plan {
  const d: DimensionLine = { id: uid('d'), a: { ...a }, b: { ...b }, offset }
  return { ...plan, dims: [...plan.dims, d] }
}

export function updateDim(plan: Plan, id: string, patch: Partial<DimensionLine>): Plan {
  return { ...plan, dims: plan.dims.map((d) => (d.id === id ? { ...d, ...patch } : d)) }
}

export function deleteSelection(plan: Plan, sel: Selection): Plan {
  if (!sel) return plan
  switch (sel.kind) {
    case 'wall':
      return cleanupWalls({ ...plan, walls: plan.walls.filter((w) => w.id !== sel.id) })
    case 'opening':
      return { ...plan, openings: plan.openings.filter((o) => o.id !== sel.id) }
    case 'furniture':
      return { ...plan, furniture: plan.furniture.filter((f) => f.id !== sel.id) }
    case 'dim':
      return { ...plan, dims: plan.dims.filter((d) => d.id !== sel.id) }
    case 'room':
      // комната — это не объект, а следствие замкнутого контура стен:
      // удалять нечего, убрать её можно только удалением стены
      return plan
  }
}

export const isEmptyPlan = (p: Plan): boolean => p.walls.length === 0 && p.furniture.length === 0 && p.dims.length === 0

/**
 * Масштабировать чертёж вокруг точки: стены, мебель (положения, не размеры),
 * размерные линии, якоря комнат и подложку. Нужно, когда план обведён по
 * картинке в неверном масштабе, а потом стала известна площадь комнаты.
 */
export function scalePlan(plan: Plan, k: number, origin: Pt): Plan {
  if (!Number.isFinite(k) || k <= 0 || Math.abs(k - 1) < 1e-9) return plan
  const s = (p: Pt): Pt => ({ x: origin.x + (p.x - origin.x) * k, y: origin.y + (p.y - origin.y) * k })
  return {
    ...plan,
    walls: plan.walls.map((w) => ({ ...w, a: s(w.a), b: s(w.b) })),
    furniture: plan.furniture.map((f) => ({ ...f, ...s({ x: f.x, y: f.y }) })),
    dims: plan.dims.map((d) => ({ ...d, a: s(d.a), b: s(d.b) })),
    rooms: plan.rooms.map((r) => ({ ...r, anchor: s(r.anchor) })),
    underlay: plan.underlay ? { ...plan.underlay, ...s({ x: plan.underlay.x, y: plan.underlay.y }), scale: plan.underlay.scale * k } : plan.underlay,
  }
}
