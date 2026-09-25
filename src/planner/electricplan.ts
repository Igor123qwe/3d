// Проект электрики как у инженера: из точек на плане — группы щита, автоматы
// и УЗО, сечения кабеля, нагрузки и токи, трассы по стенам, щит на DIN-рейке,
// ведомость материалов и проверка норм. Всё считается заново на каждую правку:
// точку сдвинули — трассы, длины и нагрузки пересчитались.
//
// Нормы, на которые опираются правила (формулировки — в текстах замечаний):
// ПУЭ 7-е изд., гл. 7.1 (жилые здания: выключатели на высоте 0,8–1,7 м, УЗО
// на розеточных группах); ГОСТ Р 50571.7.701 (ванные: зоны 0–2 — 60 см от
// ванны и душа, УЗО не больше 30 мА); СП 31-110-2003 п. 14.29 (розеток — не
// меньше одной на каждые 4 м периметра жилой комнаты, на кухне — не меньше
// четырёх, в коридоре — одна на каждые 10 м²). Это проект-эскиз для
// разговора с электриком и расчёта материалов, а не рабочая документация.
import type { ElectricKind, ElectricSettings, Feed, Furniture, Plan, Pt, Room, Wall } from './types'
import { CATALOG_MAP } from './catalog'
import { DEFAULT_ELECTRIC, ELECTRIC_NAMES, FEED_NAMES, FEED_POWER, distToItem } from './electrics'

export { DEFAULT_ELECTRIC, FEED_HEIGHT, FEED_NAMES, FEED_POWER } from './electrics'
import { openingGeom } from './checks'
import { dist, lerp, obbCorners, pointInPoly, pointSegDist } from './geometry'


/** техника на своей линии: один автомат — один прибор */
const DEDICATED: Feed[] = ['cooktop', 'oven', 'dishwasher', 'washer', 'boiler', 'fridge', 'ac', 'floor-heating']

const OUTLETS: ElectricKind[] = ['outlet', 'smart-outlet']
const SWITCHES: ElectricKind[] = ['switch', 'smart-switch', 'switch-master', 'dimmer']
const LIGHTS: ElectricKind[] = ['light', 'spot', 'wall-lamp']
/** на стене: подрозетник, трасса спускается к нему */
const ON_WALL: ElectricKind[] = [...OUTLETS, ...SWITCHES, 'wall-lamp', 'thermostat']

const WET = /санузел|ванн|туалет|душ|уборн/i
const KITCHEN = /кухн/i
const HALL = /прихож|коридор|холл|тамбур/i
const OUTDOOR = /балкон|лоджи/i

export const isOutlet = (f: Furniture) => !!f.electric && OUTLETS.includes(f.electric.kind)

/** что питает точка: у розетки — назначение, у термостата — тёплый пол */
export function feedOf(f: Furniture): Feed | null {
  const e = f.electric
  if (!e) return null
  if (OUTLETS.includes(e.kind)) return e.feeds ?? 'general'
  if (e.kind === 'thermostat') return 'floor-heating'
  return null
}

/** мощность точки, Вт */
export function powerOf(f: Furniture): number {
  const e = f.electric
  if (!e) return 0
  if (e.power !== undefined) return e.power
  const feed = feedOf(f)
  if (feed) return FEED_POWER[feed]
  switch (e.kind) {
    case 'light':
      return 60
    case 'spot':
      return 10
    case 'wall-lamp':
      return 20
    case 'curtain-motor':
      return 50
    case 'motion-sensor':
      return 1
    default:
      return 0
  }
}

export interface Circuit {
  /** QF — автомат, QFD — дифавтомат */
  id: string
  n: number
  name: string
  kind: 'light' | 'sockets' | 'kitchen' | 'wet' | 'dedicated'
  feeds?: Feed
  device: 'автомат' | 'дифавтомат'
  /** характеристика и номинал: B10, C16, C32 */
  breaker: string
  ratingA: number
  /** ток утечки УЗО, мА */
  rcdMa?: number
  cable: '3×1,5' | '3×2,5' | '3×6'
  points: Furniture[]
  rooms: string[]
  installedW: number
  demandW: number
  currentA: number
  lengthM: number
  /** трасса от щита через точки: по полу плана с изломами под прямым углом */
  route: Pt[]
  color: string
}

export interface BomRow {
  group: string
  name: string
  unit: 'шт' | 'м'
  qty: number
  note?: string
}

export interface ElectricIssue {
  level: 'error' | 'warn' | 'info'
  text: string
  pointId?: string
  roomId?: string
}

export interface ElectricDesign {
  settings: ElectricSettings
  /** щит: поставлен на план или предложено место — в прихожей у стены */
  panel: { p: Pt; height: number; placed: boolean; room?: string }
  circuits: Circuit[]
  input: { ratingA: number; relayA: number }
  installedKw: number
  demandKw: number
  cable: { type: Circuit['cable']; meters: number }[]
  modules: { used: number; box: number }
  bom: BomRow[]
  issues: ElectricIssue[]
}

const PALETTE = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#9333ea']

const roomOf = (rooms: Room[], p: Pt) => rooms.find((r) => pointInPoly(p, r.polygon))

/** вводной автомат по выделенной мощности — как принято в квартирах */
export function inputRating(kw: number): number {
  if (kw <= 5) return 25
  if (kw <= 7) return 32
  if (kw <= 9) return 40
  if (kw <= 11) return 50
  return 63
}

/** трасса от a к b: сначала вдоль x, потом вдоль y */
const elbow = (a: Pt, b: Pt): Pt[] => (Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1 ? [b] : [{ x: b.x, y: a.y }, b])

/**
 * Трасса группы: от щита к ближайшей точке, от неё к следующей ближайшей.
 * Длина: по плану — с изломами под прямым углом, по высоте — от щита вверх до
 * трассы под потолком, к каждой точке вниз и обратно (к последней — только
 * вниз); запас 10 %, по 30 см на разделку в каждой точке и 1,5 м в щите
 */
function routeOf(points: Furniture[], panel: { p: Pt; height: number }, trace: number): { route: Pt[]; lengthM: number } {
  const left = points.slice()
  const route: Pt[] = [panel.p]
  let cur = panel.p
  let flat = 0
  let vertical = Math.max(0, trace - panel.height)
  while (left.length) {
    let bi = 0
    let bd = Infinity
    left.forEach((f, i) => {
      const d = Math.abs(f.x - cur.x) + Math.abs(f.y - cur.y)
      if (d < bd) {
        bd = d
        bi = i
      }
    })
    const f = left.splice(bi, 1)[0]
    const p = { x: f.x, y: f.y }
    route.push(...elbow(cur, p))
    flat += bd
    const drop = Math.max(0, trace - (f.electric?.height ?? 30))
    vertical += left.length ? drop * 2 : drop
    cur = p
  }
  const lengthM = points.length ? Math.ceil(((flat + vertical) * 1.1) / 100 / 0.5) * 0.5 + 0.3 * points.length + 1.5 : 0
  return { route, lengthM: Math.round(lengthM * 10) / 10 }
}

/** место щита, если его не поставили: у стены прихожей, на высоте 170 */
function panelSpot(plan: Plan, rooms: Room[]): ElectricDesign['panel'] {
  const placed = plan.furniture.find((f) => f.electric?.kind === 'panel')
  if (placed) return { p: { x: placed.x, y: placed.y }, height: placed.electric!.height, placed: true, room: roomOf(rooms, placed)?.meta.name }
  const hall = rooms.find((r) => HALL.test(r.meta.name)) ?? rooms[0]
  if (!hall) return { p: { x: 0, y: 0 }, height: 170, placed: false }
  // ближайшая к подписи комнаты точка её внутреннего контура
  let best = hall.meta.anchor
  let bd = Infinity
  hall.inner.forEach((a, i) => {
    const b = hall.inner[(i + 1) % hall.inner.length]
    for (let k = 1; k < 10; k++) {
      const q = lerp(a, b, k / 10)
      const d = dist(q, hall.meta.anchor)
      if (d < bd) {
        bd = d
        best = q
      }
    }
  })
  return { p: best, height: 170, placed: false, room: hall.meta.name }
}

interface Draft {
  name: string
  kind: Circuit['kind']
  feeds?: Feed
  points: Furniture[]
}

/** разложить точки по группам щита */
function groupPoints(plan: Plan, rooms: Room[], panel: Pt): Draft[] {
  const pts = plan.furniture.filter((f) => f.electric && f.electric.kind !== 'panel' && f.electric.kind !== 'leak-sensor')
  const drafts: Draft[] = []
  const roomName = (f: Furniture) => roomOf(rooms, f)?.meta.name ?? 'вне комнат'

  // 1. техника на своих линиях
  for (const f of pts) {
    const feed = feedOf(f)
    if (feed && DEDICATED.includes(feed)) drafts.push({ name: `${FEED_NAMES[feed][0].toUpperCase()}${FEED_NAMES[feed].slice(1)} (${roomName(f)})`, kind: 'dedicated', feeds: feed, points: [f] })
  }
  const used = new Set(drafts.flatMap((d) => d.points.map((f) => f.id)))

  // 2. кухня: розетки над столешницей и вытяжка — по три розетки на группу
  const kitchen = pts.filter((f) => !used.has(f.id) && (feedOf(f) === 'counter' || feedOf(f) === 'hood'))
  const counters = kitchen.filter((f) => feedOf(f) === 'counter').sort((a, b) => a.x - b.x || a.y - b.y)
  const hood = kitchen.filter((f) => feedOf(f) === 'hood')
  const chunks: Furniture[][] = []
  for (let i = 0; i < counters.length; i += 3) chunks.push(counters.slice(i, i + 3))
  if (!chunks.length && hood.length) chunks.push([])
  chunks.forEach((c, i) => drafts.push({ name: `Розетки кухни, рабочая зона${chunks.length > 1 ? ` ${i + 1}` : ''}`, kind: 'kitchen', points: i === 0 ? [...c, ...hood] : c }))
  for (const f of kitchen) used.add(f.id)

  // 3. розетки санузлов — своя группа с УЗО 10 мА
  const wet = pts.filter((f) => !used.has(f.id) && isOutlet(f) && WET.test(roomName(f)))
  if (wet.length) drafts.push({ name: `Розетки: ${[...new Set(wet.map(roomName))].join(', ')}`, kind: 'wet', points: wet })
  for (const f of wet) used.add(f.id)

  // 4. остальные розетки — по комнатам, от ближних к щиту; до 8 розеток и двух комнат в группе
  const sockets = pts.filter((f) => !used.has(f.id) && isOutlet(f))
  const byRoom = new Map<string, Furniture[]>()
  for (const f of sockets) byRoom.set(roomName(f), [...(byRoom.get(roomName(f)) ?? []), f])
  const order = [...byRoom.entries()].sort((a, b) => Math.min(...a[1].map((f) => dist(f, panel))) - Math.min(...b[1].map((f) => dist(f, panel))))
  let cur: { rooms: string[]; points: Furniture[] } | null = null
  const flush = () => {
    if (cur?.points.length) drafts.push({ name: `Розетки: ${cur.rooms.join(', ')}`, kind: 'sockets', points: cur.points })
    cur = null
  }
  for (const [name, list] of order) {
    // в большой комнате розеток много — делим по 8
    for (let i = 0; i < list.length; i += 8) {
      const part = list.slice(i, i + 8)
      if (cur && (cur.rooms.length >= 2 || cur.points.length + part.length > 8)) flush()
      if (!cur) cur = { rooms: [], points: [] }
      if (!cur.rooms.includes(name)) cur.rooms.push(name)
      cur.points.push(...part)
    }
  }
  flush()
  for (const f of sockets) used.add(f.id)

  // 5. свет с выключателями и датчиками: жилые комнаты отдельно от кухни, санузла и коридора
  const light = pts.filter((f) => !used.has(f.id))
  const living = light.filter((f) => !/кухн|санузел|ванн|туалет|душ|прихож|коридор|холл/i.test(roomName(f)))
  const service = light.filter((f) => !living.includes(f))
  if (light.length > 10 && living.length && service.length) {
    drafts.push({ name: 'Освещение: жилые комнаты', kind: 'light', points: living })
    drafts.push({ name: 'Освещение: кухня, санузел, коридор', kind: 'light', points: service })
  } else if (light.length) drafts.push({ name: 'Освещение', kind: 'light', points: light })
  return drafts
}

/** автомат, УЗО и кабель группы */
function protection(d: Draft): Pick<Circuit, 'device' | 'breaker' | 'ratingA' | 'rcdMa' | 'cable'> {
  if (d.kind === 'light') return { device: 'автомат', breaker: 'B10', ratingA: 10, cable: '3×1,5' }
  if (d.feeds === 'cooktop') return { device: 'дифавтомат', breaker: 'C32', ratingA: 32, rcdMa: 30, cable: '3×6' }
  if (d.feeds === 'ac') return { device: 'дифавтомат', breaker: 'C10', ratingA: 10, rcdMa: 30, cable: '3×1,5' }
  if (d.kind === 'wet' || d.feeds === 'washer' || d.feeds === 'boiler') return { device: 'дифавтомат', breaker: 'C16', ratingA: 16, rcdMa: 10, cable: '3×2,5' }
  return { device: 'дифавтомат', breaker: 'C16', ratingA: 16, rcdMa: 30, cable: '3×2,5' }
}

/** расчётная нагрузка группы: розетки общего назначения не работают все разом */
function demandOf(d: Draft, installed: number): number {
  if (d.kind === 'sockets' || d.kind === 'wet') return Math.max(Math.min(installed, 300), installed * 0.4)
  if (d.kind === 'kitchen') return Math.max(Math.min(installed, 1000), installed * 0.7)
  return installed
}

const cosPhi = 0.95
const amps = (w: number) => w / (230 * cosPhi)

export function designElectrics(plan: Plan, rooms: Room[], settings: ElectricSettings = plan.electric ?? DEFAULT_ELECTRIC): ElectricDesign {
  const panel = panelSpot(plan, rooms)
  const trace = settings.ceiling - 15
  // как в схемах щитов: сначала свет, потом розетки, кухня, санузел, техника на своих линиях
  const ORDER: Circuit['kind'][] = ['light', 'sockets', 'kitchen', 'wet', 'dedicated']
  const drafts = groupPoints(plan, rooms, panel.p).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
  const circuits: Circuit[] = drafts.map((d, i) => {
    const prot = protection(d)
    const installedW = d.points.reduce((s, f) => s + powerOf(f), 0)
    const demandW = Math.round(demandOf(d, installedW))
    const { route, lengthM } = routeOf(d.points, panel, trace)
    const n = i + 1
    return {
      id: `${prot.device === 'автомат' ? 'QF' : 'QFD'}${n}`,
      n,
      name: d.name,
      kind: d.kind,
      feeds: d.feeds,
      ...prot,
      points: d.points,
      rooms: [...new Set(d.points.map((f) => roomOf(rooms, f)?.meta.name ?? 'вне комнат'))],
      installedW,
      demandW,
      currentA: Math.round(amps(demandW) * 10) / 10,
      lengthM,
      route,
      color: PALETTE[i % PALETTE.length],
    }
  })

  const installedKw = circuits.reduce((s, c) => s + c.installedW, 0) / 1000
  // группы тоже не включаются все разом: коэффициент одновременности 0,7
  const demandKw = Math.round((circuits.reduce((s, c) => s + c.demandW, 0) / 1000) * 0.7 * 10) / 10
  const ratingA = inputRating(settings.allottedKw)
  const cable = (['3×1,5', '3×2,5', '3×6'] as const)
    .map((type) => ({ type, meters: Math.ceil(circuits.filter((c) => c.cable === type).reduce((s, c) => s + c.lengthM, 0) / 5) * 5 }))
    .filter((c) => c.meters > 0)
  // модули на DIN-рейке: ввод 2P, реле напряжения, противопожарное УЗО, автоматы 1P, дифавтоматы 1P+N
  const used = 2 + 2 + 2 + circuits.reduce((s, c) => s + (c.device === 'автомат' ? 1 : 2), 0)
  const box = [12, 18, 24, 36, 48, 54, 72].find((b) => b >= used * 1.2) ?? 72
  const design: ElectricDesign = {
    settings,
    panel,
    circuits,
    input: { ratingA, relayA: Math.max(ratingA, 63) },
    installedKw: Math.round(installedKw * 10) / 10,
    demandKw,
    cable,
    modules: { used, box },
    bom: [],
    issues: [],
  }
  design.bom = billOfMaterials(plan, rooms, design)
  design.issues = electricIssues(plan, rooms, design)
  return design
}

// ---------- ведомость материалов ----------

function billOfMaterials(plan: Plan, rooms: Room[], d: ElectricDesign): BomRow[] {
  const pts = plan.furniture.filter((f) => f.electric)
  const count = (pred: (f: Furniture) => boolean) => pts.filter(pred).length
  const rows: BomRow[] = []
  const add = (group: string, name: string, qty: number, unit: BomRow['unit'] = 'шт', note?: string) => {
    if (qty > 0) rows.push({ group, name, unit, qty, note })
  }
  const inWet = (f: Furniture) => WET.test(roomOf(rooms, f)?.meta.name ?? '')
  add('Розетки', 'Розетка с заземлением 16 А', count((f) => isOutlet(f) && feedOf(f) !== 'cooktop' && !inWet(f) && f.electric!.kind === 'outlet'))
  add('Розетки', 'Розетка с заземлением IP44, с крышкой', count((f) => isOutlet(f) && inWet(f)), 'шт', 'санузел и ванная — вне зон 0–2')
  add('Розетки', 'Умная розетка', count((f) => f.electric!.kind === 'smart-outlet'))
  add('Розетки', 'Силовая розетка 32 А (или вывод кабеля)', count((f) => feedOf(f) === 'cooktop'), 'шт', 'варочная панель')
  add('Выключатели', 'Выключатель', count((f) => f.electric!.kind === 'switch'))
  add('Выключатели', 'Умный выключатель', count((f) => f.electric!.kind === 'smart-switch'))
  add('Выключатели', 'Мастер-выключатель', count((f) => f.electric!.kind === 'switch-master'))
  add('Выключатели', 'Диммер', count((f) => f.electric!.kind === 'dimmer'))
  for (const k of ['light', 'spot', 'wall-lamp', 'motion-sensor', 'leak-sensor', 'thermostat', 'curtain-motor'] as ElectricKind[]) add('Свет и датчики', ELECTRIC_NAMES[k], count((f) => f.electric!.kind === k))
  add('Монтаж', 'Подрозетник', count((f) => ON_WALL.includes(f.electric!.kind)), 'шт', 'по одному на каждую точку на стене')
  add('Монтаж', 'Коробка распаечная', new Set(pts.map((f) => roomOf(rooms, f)?.meta.id).filter(Boolean)).size, 'шт', 'по одной на комнату')
  for (const c of d.cable) add('Кабель', `ВВГнг(А)-LS ${c.type}`, c.meters, 'м', c.type === '3×1,5' ? 'свет' : c.type === '3×6' ? 'варочная панель' : 'розетки и техника')
  add('Щит', `Вводной автомат 2P C${d.input.ratingA}`, 1, 'шт', `выделено ${d.settings.allottedKw} кВт`)
  add('Щит', `Реле напряжения ${d.input.relayA} А`, 1, 'шт', 'от скачков в сети')
  add('Щит', 'УЗО противопожарное 2P 63 А 100 мА', 1, 'шт', 'рекомендуется')
  const byDevice = new Map<string, number>()
  for (const c of d.circuits) {
    const name = c.device === 'автомат' ? `Автомат 1P ${c.breaker}` : `Дифавтомат 1P+N ${c.breaker} ${c.rcdMa} мА тип A`
    byDevice.set(name, (byDevice.get(name) ?? 0) + 1)
  }
  for (const [name, n] of byDevice) add('Щит', name, n)
  add('Щит', `Щит встраиваемый на ${d.modules.box} модулей`, 1, 'шт', `занято ${d.modules.used}, остальное — запас`)
  add('Щит', 'Шина N и PE', 2)
  return rows
}

// ---------- проверка норм ----------

/** периметр по внутренним граням, м */
const innerPerimeter = (r: Room) => r.inner.reduce((s, a, i) => s + dist(a, r.inner[(i + 1) % r.inner.length]), 0) / 100

/** стена, на грани которой стоит точка, и её положение вдоль стены */
function wallUnder(walls: Wall[], p: Pt): { wall: Wall; off: number } | null {
  let best: { wall: Wall; off: number } | null = null
  let bd = Infinity
  for (const w of walls) {
    const d = pointSegDist(p, w.a, w.b)
    const gap = Math.abs(d - w.thickness / 2)
    if (gap < bd && d <= w.thickness / 2 + 15) {
      bd = gap
      best = { wall: w, off: gap }
    }
  }
  return best
}

function electricIssues(plan: Plan, rooms: Room[], d: ElectricDesign): ElectricIssue[] {
  const out: ElectricIssue[] = []
  const pts = plan.furniture.filter((f) => f.electric)
  if (!pts.length) return out
  const name = (f: Furniture) => `${f.label || ELECTRIC_NAMES[f.electric!.kind]}${roomOf(rooms, f) ? ` (${roomOf(rooms, f)!.meta.name})` : ''}`
  const items = plan.furniture.filter((f) => !f.electric && !CATALOG_MAP[f.type]?.symbol)

  // розеток по норме
  if (pts.some(isOutlet)) {
    for (const r of rooms) {
      if (OUTDOOR.test(r.meta.name) || WET.test(r.meta.name) || /кладов|гардероб/i.test(r.meta.name)) continue
      const have = pts.filter((f) => isOutlet(f) && pointInPoly(f, r.polygon)).length
      const need = KITCHEN.test(r.meta.name) ? 4 : HALL.test(r.meta.name) ? Math.max(1, Math.ceil(r.area / 10)) : Math.ceil(innerPerimeter(r) / 4)
      const rule = KITCHEN.test(r.meta.name) ? 'на кухне — не меньше 4' : HALL.test(r.meta.name) ? 'в коридоре — одна на каждые 10 м²' : `одна на каждые 4 м периметра (${innerPerimeter(r).toFixed(1)} м)`
      if (have < need) out.push({ level: 'warn', roomId: r.meta.id, text: `${r.meta.name}: розеток ${have}, по норме не меньше ${need} — ${rule} (СП 31-110-2003, п. 14.29)` })
    }
  }

  const baths = items.filter((f) => /^bathtub|^shower/.test(f.type))
  const stoves = items.filter((f) => f.type === 'stove')
  const sinks = items.filter((f) => f.type === 'sink')
  for (const f of pts) {
    const e = f.electric!
    const p = { x: f.x, y: f.y }
    // розетка в зонах 0–2 ванной
    if (OUTLETS.includes(e.kind)) {
      const bath = baths.find((b) => distToItem(p, b) < 60)
      if (bath) out.push({ level: 'error', pointId: f.id, text: `${name(f)}: ближе 60 см к ${CATALOG_MAP[bath.type]?.name.toLowerCase() ?? 'ванне'} — это зоны 0–2, розетки там нельзя (ГОСТ Р 50571.7.701)` })
      if (d.settings.stove === 'gas' && e.height < 150 && stoves.some((s) => distToItem(p, s) < 50)) out.push({ level: 'warn', pointId: f.id, text: `${name(f)}: ближе 50 см к газовой плите — отодвиньте` })
      if (sinks.some((s) => distToItem(p, s) < 30) && e.height < 150) out.push({ level: 'warn', pointId: f.id, text: `${name(f)}: вплотную к мойке — брызги; отступите от её края 30–60 см` })
    }
    // выключатель: высота и дверь
    if (SWITCHES.includes(e.kind) && (e.height < 80 || e.height > 170)) out.push({ level: 'warn', pointId: f.id, text: `${name(f)}: высота ${e.height} см — выключатели ставят на 80–170 см (ПУЭ, гл. 7.1)` })
    if (ON_WALL.includes(e.kind)) {
      const under = wallUnder(plan.walls, p)
      if (!under) {
        out.push({ level: 'warn', pointId: f.id, text: `${name(f)}: не на стене — подвиньте к стене, иначе некуда вести кабель` })
        continue
      }
      for (const op of plan.openings) {
        if (op.wallId !== under.wall.id) continue
        const g = openingGeom(op, under.wall)
        const along = (p.x - g.center.x) * g.dir.x + (p.y - g.center.y) * g.dir.y
        if (Math.abs(along) < g.hw + 5) out.push({ level: 'error', pointId: f.id, text: `${name(f)}: в проёме ${op.kind === 'window' ? 'окна' : 'двери'}` })
        else if (op.kind === 'door' && SWITCHES.includes(e.kind) && pointInPoly(p, g.swing)) out.push({ level: 'warn', pointId: f.id, text: `${name(f)}: за открытой дверью — перенесите на сторону ручки` })
      }
    }
  }

  // техника без своей линии
  const need: [string, Feed][] = [
    ['washer', 'washer'],
    ['dishwasher', 'dishwasher'],
    ['fridge', 'fridge'],
    ['tall-cabinet', 'oven'],
  ]
  if (d.settings.stove === 'electric') need.push(['stove', 'cooktop'])
  for (const [type, feed] of need) {
    for (const it of items.filter((f) => f.type === type)) {
      const ok = pts.some((f) => feedOf(f) === feed && distToItem({ x: f.x, y: f.y }, it) < 150)
      if (!ok) out.push({ level: 'warn', text: `${CATALOG_MAP[type]?.name ?? type}: нет розетки на отдельной линии (${FEED_NAMES[feed]}, ${FEED_POWER[feed] / 1000} кВт) — «Спроектировать по нормам» поставит её` })
    }
  }

  // перегрузка групп и ввода
  for (const c of d.circuits) {
    if (c.currentA > c.ratingA) out.push({ level: 'error', text: `${c.id} «${c.name}»: ${c.currentA} А при автомате ${c.ratingA} А — разделите группу` })
    else if (c.kind === 'sockets' && c.points.length > 10) out.push({ level: 'info', text: `${c.id} «${c.name}»: ${c.points.length} розеток в одной группе — удобнее разделить` })
  }
  if (d.demandKw > d.settings.allottedKw) out.push({ level: 'warn', text: `Расчётная нагрузка ${d.demandKw} кВт больше выделенной ${d.settings.allottedKw} кВт — нужно больше мощности или меньше одновременной техники` })
  return out
}

// ---------- выгрузка ----------

const csvCell = (v: string | number) => (/[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))

/** Проект одной таблицей: группы щита и ведомость — открывается в Excel */
export function designCsv(d: ElectricDesign): string {
  const rows: (string | number)[][] = [
    ['Щит'],
    ['Ввод', `автомат 2P C${d.input.ratingA}`, `реле напряжения ${d.input.relayA} А`, `выделено ${d.settings.allottedKw} кВт`, `Pуст ${d.installedKw} кВт`, `Pр ${d.demandKw} кВт`],
    [],
    ['Группа', 'Название', 'Защита', 'Кабель', 'Точек', 'Pуст, Вт', 'Pр, Вт', 'Ток, А', 'Длина, м', 'Комнаты'],
    ...d.circuits.map((c) => [c.id, c.name, c.device === 'автомат' ? c.breaker : `${c.breaker} ${c.rcdMa} мА`, `ВВГнг(А)-LS ${c.cable}`, c.points.length, c.installedW, c.demandW, c.currentA, c.lengthM, c.rooms.join(', ')]),
    [],
    ['Раздел', 'Материал', 'Кол-во', 'Ед.', 'Примечание'],
    ...d.bom.map((b) => [b.group, b.name, b.qty, b.unit, b.note ?? '']),
  ]
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\n')
}
