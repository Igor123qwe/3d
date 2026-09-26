// Электрика: автоматическая расстановка по правилам и умный дом.
// Всё считается от плана — комнат, мебели и проёмов.
import type { ElectricKind, ElectricPoint, ElectricSettings, Feed, Furniture, Opening, Plan, Pt, Room, Wall } from './types'
import { uid } from './types'
import { CATALOG_MAP, dims3d } from './catalog'
import { openingGeom } from './checks'
import { isHall, isKitchen, isOutdoor, isStorage, isWet } from './roomkind'
import { add, angleDeg, dist, lerp, mul, norm, obbCorners, perp, pointInPoly, pointSegDist, rotate, sub } from './geometry'

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

/** номинальная мощность потребителя по назначению розетки, Вт */
export const FEED_POWER: Record<Feed, number> = {
  general: 300,
  counter: 1000,
  tv: 200,
  fridge: 300,
  dishwasher: 2000,
  oven: 3000,
  cooktop: 7000,
  hood: 200,
  washer: 2200,
  boiler: 2000,
  ac: 1000,
  'floor-heating': 1500,
}

export const FEED_NAMES: Record<Feed, string> = {
  general: 'общего назначения',
  counter: 'над столешницей',
  tv: 'телевизор',
  fridge: 'холодильник',
  dishwasher: 'посудомоечная машина',
  oven: 'духовой шкаф',
  cooktop: 'варочная панель',
  hood: 'вытяжка',
  washer: 'стиральная машина',
  boiler: 'водонагреватель',
  ac: 'кондиционер',
  'floor-heating': 'тёплый пол',
}

/** высота установки розетки по назначению, см */
export const FEED_HEIGHT: Record<Feed, number> = {
  general: 30,
  counter: 110,
  tv: 120,
  fridge: 30,
  dishwasher: 30,
  oven: 15,
  cooktop: 15,
  hood: 210,
  washer: 100,
  boiler: 180,
  ac: 210,
  'floor-heating': 90,
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
  /** щит: ввод, реле напряжения, автоматы и УЗО групп */
  panel: boolean
  /** розетки под кондиционеры у окон жилых комнат */
  ac?: boolean
  /** водонагреватель в санузле */
  boiler?: boolean
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
  ac: false,
  boiler: false,
}

/** Исходные данные проекта по умолчанию: 10 кВт, электроплита, потолок 2,7 м */
export const DEFAULT_ELECTRIC: ElectricSettings = { allottedKw: 10, stove: 'electric', ceiling: 270 }


/** предмет внутри комнаты? */
const inRoom = (f: { x: number; y: number }, r: Room) => pointInPoly({ x: f.x, y: f.y }, r.polygon)

/** точка на грани стены комнаты: отрезок внутреннего контура, место вдоль него и поворот лицом в комнату */
interface Spot {
  p: Pt
  rot: number
  edge: number
  t: number
  /** насколько пришлось сдвинуть точку к стене */
  d: number
}

/** Ближайшая к точке грань стены комнаты — по внутреннему контуру */
function wallSpot(room: Room, p: Pt): Spot | null {
  const poly = room.inner
  let best: Spot | null = null
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const L = dist(a, b)
    if (L < 20) continue
    const dir = norm(sub(b, a))
    const t = Math.min(L, Math.max(0, (p.x - a.x) * dir.x + (p.y - a.y) * dir.y))
    const q = add(a, mul(dir, t))
    const d = dist(p, q)
    if (best && d >= best.d) continue
    let n = perp(dir)
    if (!pointInPoly(add(q, mul(n, 5)), poly)) n = mul(n, -1)
    best = { p: q, rot: angleDeg({ x: 0, y: 0 }, n) - 90, edge: i, t, d }
  }
  return best
}

/** точка на грани по номеру отрезка и месту вдоль него */
function spotAt(room: Room, edge: number, t: number): Spot {
  const a = room.inner[edge]
  const b = room.inner[(edge + 1) % room.inner.length]
  const dir = norm(sub(b, a))
  const q = add(a, mul(dir, t))
  let n = perp(dir)
  if (!pointInPoly(add(q, mul(n, 5)), room.inner)) n = mul(n, -1)
  return { p: q, rot: angleDeg({ x: 0, y: 0 }, n) - 90, edge, t, d: 0 }
}

/**
 * Где на отрезке грани нельзя: проёмы дверей и окон с запасом 15 см —
 * розетку в проём или вплотную к наличнику не ставят
 */
function blockedOn(plan: Plan, room: Room, edge: number): [number, number][] {
  const a = room.inner[edge]
  const b = room.inner[(edge + 1) % room.inner.length]
  const L = dist(a, b)
  const dir = norm(sub(b, a))
  const out: [number, number][] = []
  for (const op of plan.openings) {
    const wall = plan.walls.find((w) => w.id === op.wallId)
    if (!wall) continue
    const c = lerp(wall.a, wall.b, op.t)
    if (pointSegDist(c, a, b) > wall.thickness / 2 + 3) continue
    const t = (c.x - a.x) * dir.x + (c.y - a.y) * dir.y
    if (t < -op.width || t > L + op.width) continue
    out.push([t - op.width / 2 - 15, t + op.width / 2 + 15])
  }
  return out
}

/** сдвинуть точку вдоль грани из проёма к ближайшему свободному месту; нет места — null */
function freeSpot(plan: Plan, room: Room, s: Spot): Spot | null {
  const L = dist(room.inner[s.edge], room.inner[(s.edge + 1) % room.inner.length])
  const blocks = blockedOn(plan, room, s.edge)
  let t = s.t
  for (let k = 0; k < 4; k++) {
    const hit = blocks.find(([t0, t1]) => t > t0 && t < t1)
    if (!hit) break
    t = t - hit[0] < hit[1] - t ? hit[0] - 1 : hit[1] + 1
  }
  if (blocks.some(([t0, t1]) => t > t0 && t < t1) || t < 10 || t > L - 10) return null
  return t === s.t ? s : spotAt(room, s.edge, t)
}

/** расстояние от точки до предмета (0 — внутри) */
export function distToItem(p: Pt, f: Furniture): number {
  const body = obbCorners(f.x, f.y, f.w, f.d, f.rot)
  if (pointInPoly(p, body)) return 0
  let best = Infinity
  for (let i = 0; i < 4; i++) best = Math.min(best, pointSegDist(p, body[i], body[(i + 1) % 4]))
  return best
}

/**
 * Куда розетку нельзя: зоны 0–2 ванны и душа (60 см, ГОСТ Р 50571.7.701),
 * ближе 50 см к газовой плите, вплотную к мойке (30 см) — на рабочей высоте
 */
export function outletForbidden(plan: Plan, settings: ElectricSettings, p: Pt, height: number): string | null {
  for (const f of plan.furniture) {
    if (f.electric || CATALOG_MAP[f.type]?.symbol) continue
    if (/^bathtub|^shower/.test(f.type) && height <= 225 && distToItem(p, f) < 60) return 'зона ванны'
    if (height >= 150) continue
    if (f.type === 'stove' && settings.stove === 'gas' && distToItem(p, f) < 50) return 'газовая плита'
    if (f.type === 'sink' && distToItem(p, f) < 30) return 'мойка'
  }
  return null
}

/** высокая мебель у стены: розетка за шкафом бесполезна */
const behindTall = (plan: Plan, p: Pt) =>
  plan.furniture.some((f) => {
    if (f.electric || CATALOG_MAP[f.type]?.symbol) return false
    if (dims3d(f).h < 120) return false
    return pointInPoly(p, obbCorners(f.x, f.y, f.w + 12, f.d + 12, f.rot))
  })

function place(kind: ElectricKind, x: number, y: number, rot: number, why: string, label?: string, extra?: { feeds?: Feed; height?: number }): Furniture {
  const cat = CATALOG_MAP[catalogTypeOf(kind)]
  const e: ElectricPoint = { kind, why, height: extra?.height ?? (extra?.feeds ? FEED_HEIGHT[extra.feeds] : MOUNT_HEIGHT[kind]) ?? 90 }
  if (extra?.feeds && extra.feeds !== 'general') e.feeds = extra.feeds
  return {
    id: uid('e'),
    type: catalogTypeOf(kind),
    x: Math.round(x),
    y: Math.round(y),
    w: cat?.w ?? 10,
    d: cat?.d ?? 5,
    rot: ((Math.round(rot) % 360) + 360) % 360,
    label: label ?? ELECTRIC_NAMES[kind],
    electric: e,
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
  panel: 'Щит',
}

/** розетка, которую просит предмет: где (точка у него), зачем, на что и на какой высоте */
interface Want {
  p: Pt
  why: string
  feeds?: Feed
  height?: number
}

/** Розетки у мебели и техники: у изголовья, у дивана, над столом, у каждого прибора — своя линия */
function wantsFor(f: Furniture, room: Room, settings: ElectricSettings): Want[] {
  const cat = CATALOG_MAP[f.type]
  const back = (o: number) => add({ x: f.x, y: f.y }, rotate({ x: o, y: -f.d / 2 - 6 }, f.rot))
  const name = room.meta.name
  if (cat?.glyph === 'bed' || cat?.glyph === 'crib') {
    // по две розетки с каждой стороны изголовья, над тумбой
    return [-1, 1].flatMap((s) => [
      { p: back(s * (f.w / 2 + 18)), why: 'у изголовья кровати: ночник, зарядка', height: 70 },
      { p: back(s * (f.w / 2 + 30)), why: 'у изголовья кровати: ночник, зарядка', height: 70 },
    ])
  }
  if (['sofa-3', 'sofa-2', 'sofa-corner', 'armchair'].includes(f.type)) return [-1, 1].map((s) => ({ p: back(s * (f.w / 2 - 10)), why: 'у дивана: торшер и зарядка' }))
  if (['desk', 'desk-160', 'kid-desk', 'vanity'].includes(f.type))
    return [
      { p: back(-f.w / 4), why: 'рабочее место: над столешницей', height: 90 },
      { p: back(f.w / 4), why: 'рабочее место: над столешницей', height: 90 },
    ]
  if (f.type === 'tv')
    return [
      { p: back(0), why: 'телевизор: за экраном', feeds: 'tv' },
      { p: back(25), why: 'телевизор: приставка, роутер', height: 120 },
    ]
  if (f.type === 'tv-stand') return [{ p: back(0), why: 'телевизор на тумбе', feeds: 'tv', height: 60 }]
  if (f.type === 'fridge') return [{ p: back(0), why: 'подключение: холодильник, отдельная линия', feeds: 'fridge' }]
  if (f.type === 'washer') return [{ p: back(f.w / 2 + 15), why: 'стиральная машина: отдельная линия, УЗО, рядом, не за машиной', feeds: 'washer' }]
  if (f.type === 'dishwasher') return [{ p: back(f.w / 2 + 20), why: 'подключение: посудомоечная машина, отдельная линия, в соседней тумбе', feeds: 'dishwasher' }]
  if (f.type === 'tall-cabinet') return [{ p: back(0), why: 'подключение: духовой шкаф, отдельная линия', feeds: 'oven' }]
  if (f.type === 'stove') {
    const hood: Want = { p: back(0), why: 'вытяжка: над плитой', feeds: 'hood' }
    return settings.stove === 'electric'
      ? [{ p: back(0), why: 'подключение: варочная панель, силовая линия 32 А', feeds: 'cooktop' }, hood]
      : [{ p: back(f.w / 2 + 55), why: 'поджиг газовой плиты — не ближе 50 см к ней', height: 110 }, hood]
  }
  if (isKitchen(name) && cat?.glyph === 'counter') return [{ p: back(0), why: 'рабочая зона кухни: над столешницей', feeds: 'counter' }]
  if (f.type === 'basin' || f.type === 'basin-cabinet') return [{ p: back(f.w / 2 + 20), why: 'у раковины: фен, бритва — IP44, с УЗО', height: 100 }]
  return []
}

/**
 * Разложить электрику по плану.
 * Возвращает новые предметы — вызывающий решает, добавить их или заменить старые.
 * Всё, что на стене, садится на грань стены лицом в комнату, мимо проёмов.
 */
export function autoElectrics(plan: Plan, rooms: Room[], o: AutoElectricOptions, settings: ElectricSettings = plan.electric ?? DEFAULT_ELECTRIC): Furniture[] {
  const out: Furniture[] = []
  const entry = rooms.find((r) => isHall(r.meta.name)) ?? rooms[0]

  /**
   * Поставить на стену комнаты у точки p. Место в проёме, в зоне ванны, у
   * газовой плиты или мойки — точка едет вдоль стены к ближайшему
   * разрешённому, не дальше 1,5 м; не нашлось — не ставить
   */
  const onWall = (room: Room, p: Pt, kind: ElectricKind, why: string, extra?: { feeds?: Feed; height?: number }, label?: string): Furniture | null => {
    const s0 = wallSpot(room, p)
    if (!s0 || s0.d > 80) return null
    const height = extra?.height ?? (extra?.feeds ? FEED_HEIGHT[extra.feeds] : MOUNT_HEIGHT[kind])
    // сначала ближайшая стена, потом соседние — в пределах 1,5 м от нужного места
    const edges = room.inner
      .map((a, i) => ({ i, d: pointSegDist(p, a, room.inner[(i + 1) % room.inner.length]) }))
      .filter((e) => e.i === s0.edge || e.d < 150)
      .sort((x, y) => (x.i === s0.edge ? -1 : y.i === s0.edge ? 1 : x.d - y.d))
    let s: Spot | null = null
    for (const { i } of edges) {
      const a = room.inner[i]
      const b = room.inner[(i + 1) % room.inner.length]
      const L = dist(a, b)
      const dir = norm(sub(b, a))
      const t0 = Math.min(L, Math.max(0, (p.x - a.x) * dir.x + (p.y - a.y) * dir.y))
      const blocks = blockedOn(plan, room, i)
      for (const dt of [0, ...Array.from({ length: 30 }, (_, k) => (k % 2 ? -1 : 1) * 5 * (Math.floor(k / 2) + 1))]) {
        const t = t0 + dt
        if (t < 10 || t > L - 10 || blocks.some(([x0, x1]) => t > x0 && t < x1)) continue
        const c = spotAt(room, i, t)
        if (dist(c.p, p) > 150) continue
        if (isOutletKind(kind) && outletForbidden(plan, settings, c.p, height)) continue
        s = c
        break
      }
      if (s) break
    }
    if (!s) return null
    // одна точка на одно место: вторую поверх не ставим (пара в блоке — через 12 см)
    if (out.some((x) => x.electric?.kind === kind && dist(x, s.p) < 8 && (x.electric.feeds ?? 'general') === (extra?.feeds ?? 'general'))) return null
    const f = place(kind, s.p.x, s.p.y, s.rot, why, label, extra)
    out.push(f)
    return f
  }

  for (const room of rooms) {
    const name = room.meta.name
    const wet = isWet(name)
    const kitchen = isKitchen(name)
    const hall = isHall(name)
    const outdoor = isOutdoor(name)
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

    // выключатели у дверей со стороны ручки; у санузла — снаружи
    if (o.switches) {
      for (const { op, wall } of openingsOf(plan, room, ['door', 'doorway'])) {
        const spot = switchSpot(op, wall, room, wet)
        if (!spot) continue
        out.push(place(o.smart ? 'smart-switch' : 'switch', spot.p.x, spot.p.y, spot.rot, wet ? 'у входа в санузел, снаружи' : 'у двери со стороны ручки'))
      }
      // в спальне — проходной у кровати: свет гасят, не вставая
      const bed = furniture.find((f) => CATALOG_MAP[f.type]?.glyph === 'bed')
      if (bed && !o.smart) {
        const p = add({ x: bed.x, y: bed.y }, rotate({ x: bed.w / 2 + 40, y: -bed.d / 2 - 6 }, bed.rot))
        onWall(room, p, 'switch', 'проходной у кровати: пара — у двери', { height: 80 })
      }
    }

    if (o.outlets && !outdoor) {
      // у мебели и техники; в санузле — только у стиральной машины и раковины, мимо зон 0–2
      for (const f of furniture) {
        for (const w of wantsFor(f, room, settings)) onWall(room, w.p, 'outlet', w.why, { feeds: w.feeds, height: w.height })
      }
      // кондиционер: у окна, под потолком
      if (o.ac && !wet && !kitchen && !hall) {
        const win = openingsOf(plan, room, ['window'])[0]
        if (win) {
          const g = openingGeom(win.op, win.wall)
          onWall(room, add(g.center, mul(g.dir, g.hw + 40)), 'outlet', 'кондиционер: у окна, под потолком', { feeds: 'ac' })
        }
      }
      // водонагреватель — в первом санузле
      if (o.boiler && wet && !out.some((x) => x.electric?.feeds === 'boiler')) {
        const free = room.inner.map((a, i) => ({ i, L: dist(a, room.inner[(i + 1) % room.inner.length]) })).sort((a, b) => b.L - a.L)[0]
        if (free) onWall(room, spotAt(room, free.i, free.L / 2).p, 'outlet', 'водонагреватель: отдельная линия, УЗО', { feeds: 'boiler' })
      }
      // добрать до нормы: жилая — 1 на 4 м периметра, кухня — 4, коридор — 1 на 10 м²; кладовой норма не нужна
      if (!wet && !isStorage(name)) {
        const perimeter = room.inner.reduce((s, a, i) => s + dist(a, room.inner[(i + 1) % room.inner.length]), 0) / 100
        const need = kitchen ? 4 : hall ? Math.max(1, Math.ceil(room.area / 10)) : room.area > 4 ? Math.ceil(perimeter / 4) : 0
        const why = kitchen ? 'по норме: на кухне не меньше 4 розеток' : hall ? 'коридор: пылесос, зарядка — 1 на 10 м²' : 'по норме: 1 розетка на каждые 4 м периметра'
        fillOutlets(plan, settings, room, out, need, why, kitchen && furniture.some((f) => CATALOG_MAP[f.type]?.glyph === 'counter') ? 'counter' : 'general')
      }
    }

    // умный дом по комнатам
    if (o.motion && (hall || wet)) out.push(place('motion-sensor', room.meta.anchor.x, room.meta.anchor.y, 0, `свет по движению: ${name}`))
    if (o.leak && (wet || kitchen)) {
      const sink = furniture.find((f) => ['washer', 'sink', 'basin', 'basin-cabinet', 'dishwasher'].includes(f.type))
      const p = sink ? { x: sink.x, y: sink.y + sink.d / 2 + 10 } : room.meta.anchor
      out.push(place('leak-sensor', p.x, p.y, 0, `протечка: ${name}`))
    }
    if (o.smart && (wet || kitchen)) {
      const s = wallSpot(room, add(room.meta.anchor, { x: 0, y: -40 }))
      const at = s ? freeSpot(plan, room, s) : null
      out.push(at ? place('thermostat', at.p.x, at.p.y, at.rot, `тёплый пол: ${name}`) : place('thermostat', room.meta.anchor.x, room.meta.anchor.y - 40, 0, `тёплый пол: ${name}`))
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
      const spot = switchSpot(doors[0].op, doors[0].wall, entry, false)
      if (spot) out.push(place('switch-master', spot.p.x, spot.p.y, spot.rot, 'сценарий «ухожу»: гасит весь свет', undefined, { height: 110 }))
    }
    for (const room of rooms) {
      const bed = plan.furniture.find((f) => CATALOG_MAP[f.type]?.glyph === 'bed' && inRoom(f, room))
      if (!bed) continue
      const p = add({ x: bed.x, y: bed.y }, rotate({ x: bed.w / 2 + 25, y: -bed.d / 2 + 30 }, bed.rot))
      const s = wallSpot(room, p)
      out.push(place('switch-master', s && s.d < 80 ? s.p.x : p.x, s && s.d < 80 ? s.p.y : p.y, s?.rot ?? 0, 'сценарий «ночь» у кровати', undefined, { height: 80 }))
    }
  }

  // щит — у стены прихожей, на высоте 170
  if (o.panel && entry) {
    const s = wallSpot(entry, entry.meta.anchor)
    const at = s ? freeSpot(plan, entry, s) : null
    const p = at?.p ?? { x: entry.meta.anchor.x, y: entry.meta.anchor.y - 60 }
    out.push(place('panel', p.x, p.y, at?.rot ?? 0, 'щит: ввод, реле напряжения, автоматы и УЗО групп', undefined, { height: 170 }))
  }
  return out
}

/**
 * Добрать розеток до нормы: свободные места вдоль стен комнаты — не в
 * проёмах, не за высокой мебелью, не ближе 20 см к углу; каждая следующая —
 * как можно дальше от уже стоящих, чтобы розетки были по всей комнате
 */
function fillOutlets(plan: Plan, settings: ElectricSettings, room: Room, out: Furniture[], need: number, why: string, feeds: Feed) {
  const have = out.filter((f) => isOutletKind(f.electric?.kind) && inRoom(f, room)).map((f) => ({ x: f.x, y: f.y }))
  if (have.length >= need) return
  const cand: Spot[] = []
  room.inner.forEach((a, i) => {
    const L = dist(a, room.inner[(i + 1) % room.inner.length])
    if (L < 60) return
    const blocks = blockedOn(plan, room, i)
    for (let t = 20; t <= L - 20; t += 20) {
      if (blocks.some(([t0, t1]) => t > t0 && t < t1)) continue
      const s = spotAt(room, i, t)
      if (!behindTall(plan, s.p) && !outletForbidden(plan, settings, s.p, FEED_HEIGHT[feeds])) cand.push(s)
    }
  })
  const pts = have.slice()
  let n = have.length
  while (n < need && cand.length) {
    let bi = -1
    let bd = -1
    cand.forEach((s, i) => {
      const d = pts.length ? Math.min(...pts.map((p) => dist(p, s.p))) : Infinity
      if (d > bd) {
        bd = d
        bi = i
      }
    })
    if (bi < 0 || bd < 40) break
    const s = cand.splice(bi, 1)[0]
    out.push(place('outlet', s.p.x, s.p.y, s.rot, why, undefined, { feeds }))
    pts.push(s.p)
    n++
  }
}

const isOutletKind = (k?: ElectricKind) => k === 'outlet' || k === 'smart-outlet'

/** Точка у двери со стороны ручки — место для выключателя; outside — с другой стороны стены */
function switchSpot(op: Opening, wall: Wall, room: Room, outside: boolean): { p: Pt; rot: number } | null {
  const g = openingGeom(op, wall)
  const dir = g.dir
  const n = g.n
  // сторона комнаты у двери; снаружи — противоположная
  let side = pointInPoly(add(g.center, mul(n, wall.thickness / 2 + 20)), room.polygon) ? 1 : -1
  if (outside) side = -side
  // выключатель — со стороны, противоположной петлям, в 10–15 см от наличника
  const along = op.hinge === 'a' ? g.hw + 20 : -(g.hw + 20)
  const p = add(add(g.center, mul(dir, along)), mul(n, side * (wall.thickness / 2)))
  const into = add(p, mul(n, side * 10))
  if (outside ? pointInPoly(into, room.polygon) : !pointInPoly(into, room.polygon)) return null
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
