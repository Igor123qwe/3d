// Электрика: автоматическая расстановка по правилам и умный дом.
// Всё считается от плана — комнат, мебели и проёмов.
import type { ElectricKind, Furniture, Opening, Plan, Pt, Room, Wall } from './types'
import { uid } from './types'
import { CATALOG_MAP } from './catalog'
import { openingGeom } from './checks'
import { add, angleDeg, dist, lerp, mul, norm, perp, pointInPoly, pointSegDist, rotate, sub } from './geometry'

/** высота установки над полом, см — идёт в подпись и в ведомость */
export const MOUNT_HEIGHT: Record<ElectricKind, number> = {
  outlet: 30,
  switch: 90,
  'switch-master': 90,
  dimmer: 90,
  light: 270,
  spot: 270,
  'wall-lamp': 170,
  'motion-sensor': 220,
  'leak-sensor': 2,
  thermostat: 90,
  'curtain-motor': 250,
  'smart-outlet': 30,
  'smart-switch': 90,
  panel: 160,
}

/** Что ставить автоматически: набор включаемых правил */
export interface AutoElectricOptions {
  outlets: boolean
  switches: boolean
  lights: boolean
  /** умный дом: мастер-выключатель, датчики, электрокарнизы */
  smart: boolean
  /** электрокарнизы на окна */
  curtains: boolean
  /** датчики протечки в мокрых зонах */
  leak: boolean
  /** датчики движения в коридорах и санузлах */
  motion: boolean
  /** щит умного дома */
  panel: boolean
}

export const DEFAULT_AUTO: AutoElectricOptions = {
  outlets: true,
  switches: true,
  lights: true,
  smart: false,
  curtains: false,
  leak: false,
  motion: false,
  panel: false,
}

const WET_ROOMS = ['Санузел', 'Ванная', 'Туалет']
const HALL_ROOMS = ['Прихожая', 'Коридор']
const KITCHEN_ROOMS = ['Кухня', 'Кухня-гостиная']

const isWet = (name: string) => WET_ROOMS.some((n) => name.includes(n))
const isHall = (name: string) => HALL_ROOMS.some((n) => name.includes(n))
const isKitchen = (name: string) => KITCHEN_ROOMS.some((n) => name.includes(n))

/** предмет внутри комнаты? */
const inRoom = (f: Furniture, r: Room) => pointInPoly({ x: f.x, y: f.y }, r.polygon)

/** ближайшая к точке стена и положение точки на её грани */
function nearestWall(walls: Wall[], p: Pt): { wall: Wall; at: Pt; rot: number } | null {
  let best: { wall: Wall; at: Pt; rot: number } | null = null
  let bestD = Infinity
  for (const w of walls) {
    const L = dist(w.a, w.b)
    if (L < 1) continue
    const d = pointSegDist(p, w.a, w.b)
    if (d >= bestD) continue
    const dir = norm(sub(w.b, w.a))
    const t = Math.min(L, Math.max(0, (p.x - w.a.x) * dir.x + (p.y - w.a.y) * dir.y))
    const onAxis = add(w.a, mul(dir, t))
    const n = perp(dir)
    // разворачиваем нормаль в сторону точки, чтобы прибор смотрел в комнату
    const side = (p.x - onAxis.x) * n.x + (p.y - onAxis.y) * n.y >= 0 ? 1 : -1
    const at = add(onAxis, mul(n, side * (w.thickness / 2)))
    bestD = d
    best = { wall: w, at, rot: angleDeg({ x: 0, y: 0 }, mul(n, side)) - 90 }
  }
  return best
}

/** точка у стены комнаты на заданном расстоянии от опорной точки вдоль стены */
function alongWall(w: Wall, from: Pt, offset: number, thickness: number, inward: Pt): Pt {
  const dir = norm(sub(w.b, w.a))
  const n = perp(dir)
  const side = (inward.x - from.x) * n.x + (inward.y - from.y) * n.y >= 0 ? 1 : -1
  return add(add(from, mul(dir, offset)), mul(n, side * (thickness / 2)))
}

function place(kind: ElectricKind, x: number, y: number, rot: number, why: string, label?: string): Furniture {
  const cat = CATALOG_MAP[catalogTypeOf(kind)]
  return {
    id: uid('e'),
    type: catalogTypeOf(kind),
    x: Math.round(x),
    y: Math.round(y),
    w: cat?.w ?? 10,
    d: cat?.d ?? 5,
    rot: ((rot % 360) + 360) % 360,
    label: label ?? ELECTRIC_NAMES[kind],
    electric: { kind, why, height: MOUNT_HEIGHT[kind] ?? 90 },
  }
}

/** какой элемент каталога рисует этот прибор */
export function catalogTypeOf(kind: ElectricKind): string {
  switch (kind) {
    case 'outlet':
    case 'smart-outlet':
      return 'outlet'
    case 'switch':
    case 'smart-switch':
    case 'switch-master':
    case 'dimmer':
      return 'switch'
    case 'light':
      return 'light'
    case 'spot':
      return 'spot'
    case 'wall-lamp':
      return 'wall-lamp'
    case 'motion-sensor':
      return 'motion-sensor'
    case 'leak-sensor':
      return 'leak-sensor'
    case 'thermostat':
      return 'thermostat'
    case 'curtain-motor':
      return 'curtain-motor'
    case 'panel':
      return 'panel'
  }
}

export const ELECTRIC_NAMES: Record<ElectricKind, string> = {
  outlet: 'Розетка',
  switch: 'Выключатель',
  light: 'Светильник',
  spot: 'Спот',
  'wall-lamp': 'Бра',
  'smart-outlet': 'Умная розетка',
  'smart-switch': 'Умный выключатель',
  'switch-master': 'Мастер-выключатель',
  dimmer: 'Диммер',
  'motion-sensor': 'Датчик движения',
  'leak-sensor': 'Датчик протечки',
  thermostat: 'Термостат тёплого пола',
  'curtain-motor': 'Электрокарниз',
  panel: 'Щит умного дома',
}

/** Розетки у мебели: у изголовья кровати, у дивана, у стола, у техники */
function outletsForFurniture(f: Furniture, plan: Plan, room: Room): Furniture[] {
  const cat = CATALOG_MAP[f.type]
  const out: Furniture[] = []
  const back = (o: number) => add({ x: f.x, y: f.y }, rotate({ x: o, y: -f.d / 2 - 6 }, f.rot))
  const front = (o: number) => add({ x: f.x, y: f.y }, rotate({ x: o, y: f.d / 2 + 6 }, f.rot))
  const wallRot = (p: Pt) => nearestWall(plan.walls, p)?.rot ?? f.rot

  if (cat?.glyph === 'bed' || cat?.glyph === 'crib') {
    // по две розетки с каждой стороны изголовья
    for (const s of [-1, 1]) {
      const p = back(s * (f.w / 2 + 18))
      out.push(place('outlet', p.x, p.y, wallRot(p), 'у изголовья кровати'))
      const q = back(s * (f.w / 2 + 30))
      out.push(place('outlet', q.x, q.y, wallRot(q), 'у изголовья кровати'))
    }
    return out
  }
  if (['sofa-3', 'sofa-2', 'sofa-corner', 'armchair'].includes(f.type)) {
    for (const s of [-1, 1]) {
      const p = back(s * (f.w / 2 - 10))
      out.push(place('outlet', p.x, p.y, wallRot(p), 'у дивана: торшер и зарядка'))
    }
    return out
  }
  if (['desk', 'desk-160', 'kid-desk', 'vanity'].includes(f.type)) {
    const p = back(0)
    out.push(place('outlet', p.x, p.y, wallRot(p), 'рабочее место: техника'))
    const q = back(f.w / 4)
    out.push(place('outlet', q.x, q.y, wallRot(q), 'рабочее место: техника'))
    return out
  }
  if (f.type === 'tv' || f.type === 'tv-stand') {
    const p = back(0)
    out.push(place('outlet', p.x, p.y, wallRot(p), 'телевизор'))
    return out
  }
  if (['fridge', 'washer', 'dishwasher', 'stove', 'tall-cabinet'].includes(f.type)) {
    const p = back(0)
    out.push(place('outlet', p.x, p.y, wallRot(p), `подключение: ${cat?.name ?? f.type}`))
    return out
  }
  if (isKitchen(room.meta.name) && cat?.glyph === 'counter') {
    // розетки над рабочей поверхностью
    const p = back(0)
    out.push(place('outlet', p.x, p.y, wallRot(p), 'над столешницей'))
    return out
  }
  void front
  return out
}

/** Точка у двери со стороны ручки — место для выключателя */
function switchSpot(op: Opening, wall: Wall, room: Room): { p: Pt; rot: number } | null {
  const g = openingGeom(op, wall)
  const dir = g.dir
  const n = g.n
  // выключатель ставим со стороны, противоположной петлям, в комнате
  const side = pointInPoly(add(g.center, mul(n, wall.thickness / 2 + 20)), room.polygon) ? 1 : -1
  const along = op.hinge === 'a' ? g.hw + 20 : -(g.hw + 20)
  const p = add(add(g.center, mul(dir, along)), mul(n, side * (wall.thickness / 2)))
  if (!pointInPoly(add(p, mul(n, side * 10)), room.polygon)) return null
  return { p, rot: angleDeg({ x: 0, y: 0 }, mul(n, side)) - 90 }
}

/** Двери и окна, выходящие в комнату */
function openingsOf(plan: Plan, room: Room, kinds: Opening['kind'][]): { op: Opening; wall: Wall }[] {
  const out: { op: Opening; wall: Wall }[] = []
  for (const op of plan.openings) {
    if (!kinds.includes(op.kind)) continue
    const wall = plan.walls.find((w) => w.id === op.wallId)
    if (!wall) continue
    const c = lerp(wall.a, wall.b, op.t)
    for (let i = 0; i < room.polygon.length; i++) {
      if (pointSegDist(c, room.polygon[i], room.polygon[(i + 1) % room.polygon.length]) < wall.thickness / 2 + 1) {
        out.push({ op, wall })
        break
      }
    }
  }
  return out
}

/**
 * Разложить электрику по плану.
 * Возвращает новые предметы — вызывающий решает, добавить их или заменить старые.
 */
export function autoElectrics(plan: Plan, rooms: Room[], o: AutoElectricOptions): Furniture[] {
  const out: Furniture[] = []
  const entry = rooms.find((r) => isHall(r.meta.name)) ?? rooms[0]

  for (const room of rooms) {
    const name = room.meta.name
    const wet = isWet(name)
    const kitchen = isKitchen(name)
    const hall = isHall(name)
    const furniture = plan.furniture.filter((f) => !CATALOG_MAP[f.type]?.symbol && inRoom(f, room))

    // общий свет
    if (o.lights) {
      out.push(place('light', room.meta.anchor.x, room.meta.anchor.y, 0, `общий свет: ${name}`))
      if (room.area > 18) {
        // большой комнате — второй источник
        const shift = Math.sqrt(room.area) * 25
        out.push(place('light', room.meta.anchor.x + shift, room.meta.anchor.y, 0, `второй источник: ${name} больше 18 м²`))
      }
    }

    // выключатели у дверей
    if (o.switches) {
      for (const { op, wall } of openingsOf(plan, room, ['door', 'doorway'])) {
        const spot = switchSpot(op, wall, room)
        if (!spot) continue
        const smart = o.smart
        out.push(
          place(
            smart ? 'smart-switch' : 'switch',
            spot.p.x,
            spot.p.y,
            spot.rot,
            wet ? 'у входа в санузел, снаружи' : 'у двери со стороны ручки',
          ),
        )
      }
    }

    // розетки: в мокрой зоне только для техники
    if (o.outlets) {
      for (const f of furniture) {
        if (wet && !['washer', 'basin-cabinet', 'basin'].includes(f.type)) continue
        out.push(...outletsForFurniture(f, plan, room))
      }
      if (kitchen) {
        // ряд розеток над столешницей каждые 80 см
        const counters = furniture.filter((f) => CATALOG_MAP[f.type]?.glyph === 'counter')
        for (const c of counters) {
          const p = add({ x: c.x, y: c.y }, rotate({ x: 0, y: -c.d / 2 - 6 }, c.rot))
          out.push(place('outlet', p.x, p.y, nearestWall(plan.walls, p)?.rot ?? c.rot, 'рабочая зона кухни'))
        }
      }
      if (!wet && !kitchen && furniture.length === 0 && room.area > 4) {
        // пустая комната: хотя бы одна розетка у стены
        const w = plan.walls.find((x) => pointSegDist(room.meta.anchor, x.a, x.b) < 500)
        if (w) {
          const p = alongWall(w, w.a, dist(w.a, w.b) / 2, w.thickness, room.meta.anchor)
          out.push(place('outlet', p.x, p.y, nearestWall(plan.walls, p)?.rot ?? 0, `${name}: базовая розетка`))
        }
      }
    }

    // умный дом по комнатам
    if (o.motion && (hall || wet)) {
      out.push(place('motion-sensor', room.meta.anchor.x, room.meta.anchor.y, 0, `свет по движению: ${name}`))
    }
    if (o.leak && (wet || kitchen)) {
      const sink = furniture.find((f) => ['washer', 'sink', 'basin', 'basin-cabinet', 'dishwasher'].includes(f.type))
      const p = sink ? { x: sink.x, y: sink.y + sink.d / 2 + 10 } : room.meta.anchor
      out.push(place('leak-sensor', p.x, p.y, 0, `протечка: ${name}`))
    }
    if (o.smart && (wet || kitchen)) {
      out.push(place('thermostat', room.meta.anchor.x, room.meta.anchor.y - 40, 0, `тёплый пол: ${name}`))
    }
    if (o.curtains) {
      for (const { op, wall } of openingsOf(plan, room, ['window'])) {
        const g = openingGeom(op, wall)
        const side = pointInPoly(add(g.center, mul(g.n, wall.thickness / 2 + 20)), room.polygon) ? 1 : -1
        const p = add(g.center, mul(g.n, side * (wall.thickness / 2 + 8)))
        out.push(place('curtain-motor', p.x, p.y, angleDeg({ x: 0, y: 0 }, mul(g.n, side)) - 90, `электрокарниз: окно в «${name}»`))
      }
    }
  }

  // мастер-выключатель у входной двери и у кровати
  if (o.smart && entry) {
    const doors = openingsOf(plan, entry, ['door'])
    if (doors.length) {
      const spot = switchSpot(doors[0].op, doors[0].wall, entry)
      if (spot) out.push(place('switch-master', spot.p.x, spot.p.y - 20, spot.rot, 'сценарий «ухожу»: гасит весь свет'))
    }
    for (const room of rooms) {
      const bed = plan.furniture.find((f) => CATALOG_MAP[f.type]?.glyph === 'bed' && inRoom(f, room))
      if (!bed) continue
      const p = add({ x: bed.x, y: bed.y }, rotate({ x: bed.w / 2 + 25, y: -bed.d / 2 + 30 }, bed.rot))
      out.push(place('switch-master', p.x, p.y, nearestWall(plan.walls, p)?.rot ?? 0, 'сценарий «ночь» у кровати'))
    }
  }

  // щит
  if (o.panel && entry) {
    const p = { x: entry.meta.anchor.x, y: entry.meta.anchor.y - 60 }
    out.push(place('panel', p.x, p.y, 0, 'щит: автоматы, реле, модули умного дома'))
  }
  return out
}

export interface SpecRow {
  kind: ElectricKind
  name: string
  count: number
  height: number
  /** по комнатам: где именно */
  where: string[]
}

/** Ведомость электрики: что и сколько */
export function electricSpec(plan: Plan, rooms: Room[]): SpecRow[] {
  const byKind = new Map<ElectricKind, SpecRow>()
  for (const f of plan.furniture) {
    const e = f.electric
    if (!e) continue
    const room = rooms.find((r) => inRoom(f, r))
    const row = byKind.get(e.kind) ?? { kind: e.kind, name: ELECTRIC_NAMES[e.kind], count: 0, height: e.height, where: [] }
    row.count += 1
    const place = room?.meta.name ?? 'вне комнат'
    if (!row.where.includes(place)) row.where.push(place)
    byKind.set(e.kind, row)
  }
  return [...byKind.values()].sort((a, b) => b.count - a.count)
}

/** Грубая оценка длины кабеля: от щита до каждой точки с запасом на штробы */
export function cableEstimate(plan: Plan, rooms: Room[]): { groups: number; meters: number } {
  const panel = plan.furniture.find((f) => f.electric?.kind === 'panel')
  const origin = panel ? { x: panel.x, y: panel.y } : (rooms[0]?.meta.anchor ?? { x: 0, y: 0 })
  let meters = 0
  let points = 0
  for (const f of plan.furniture) {
    if (!f.electric || f.electric.kind === 'panel') continue
    points++
    // путь по стенам считаем как манхэттенское расстояние плюс подъём по высоте
    const run = Math.abs(f.x - origin.x) + Math.abs(f.y - origin.y) + (f.electric.height ?? 90) + 100
    meters += run / 100
  }
  // группы: свет, розетки, техника, слаботочка
  const kinds = new Set(plan.furniture.map((f) => f.electric?.kind).filter(Boolean))
  const groups = Math.max(1, Math.ceil(points / 8)) + (kinds.has('light') ? 1 : 0)
  return { groups, meters: Math.round(meters) }
}
