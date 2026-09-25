// Договор с моделью: что мы просим и что считаем годным ответом.
//
// Модель может вернуть что угодно — текст с пояснениями, числа строками,
// координаты за пределами картинки, выдуманные типы мебели. Поэтому ответ
// никогда не попадает в план напрямую: сначала он проходит проверку отсюда.
// Всё, что не прошло, отбрасывается, а не чинится догадками.
//
// Модуль общий для серверных функций (api/) и браузера, поэтому здесь нет ни
// DOM, ни узловых API — только разбор значений.

// ---------- план с картинки ----------
export type AiOpeningKind = 'door' | 'window' | 'doorway'

/** координаты — доли размера картинки: x слева направо, y сверху вниз, 0..1 */
export interface AiWall {
  x1: number
  y1: number
  x2: number
  y2: number
  thicknessCm: number
}

export type AiSide = 'top' | 'right' | 'bottom' | 'left'

export interface AiOpening {
  kind: AiOpeningKind
  x: number
  y: number
  widthCm: number
  /** в какой стене какой комнаты: точнее, чем точка на картинке */
  room?: string
  side?: AiSide
  /** положение вдоль этой стены, 0..1 слева направо или сверху вниз */
  at?: number
}

/** прямоугольник внутренней части комнаты, доли картинки */
export interface AiBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface AiRoom {
  name: string
  /** тип помещения, если по подписи не понять («5ж» — жилая) */
  kind?: string
  areaM2?: number
  x: number
  y: number
  box?: AiBox
  /** размеры комнаты, подписанные на плане: по горизонтали и по вертикали */
  widthCm?: number
  depthCm?: number
  /** все размеры, подписанные вдоль стен комнаты (у ниш, выступов, коридора): у какой стены, где вдоль неё, сколько */
  walls?: AiWallLabel[]
  /** кто за какой стеной: имена соседних комнат по сторонам — общая стена одна на двоих */
  neighbors?: Partial<Record<AiSide, string[]>>
  /** стороны, выходящие на наружный контур квартиры */
  outer?: AiSide[]
  /** комната Г-образная: названные соседи заходят в её рамку углом, и там стены — их, не её */
  yieldsTo?: string[]
  /** рамка снята с картинки по внутренним граням стен (сегментация), а не нарисована моделью «по подписи» */
  exact?: boolean
}

/** размер вдоль стены комнаты: side — у какой стены, at — середина числа вдоль неё (0..1) */
export interface AiWallLabel {
  side: AiSide
  at: number
  cm: number
}

/** размерная цепочка с плана: по ней чертёж встаёт в масштаб */
export interface AiDimension {
  x1: number
  y1: number
  x2: number
  y2: number
  cm: number
}

/** число, прочитанное с картинки по месту: середина подписи (доли картинки), стоит ли строка боком, сколько */
export interface AiMark {
  x: number
  y: number
  vertical: boolean
  cm: number
}

export interface AiPlan {
  walls: AiWall[]
  openings: AiOpening[]
  rooms: AiRoom[]
  dimensions: AiDimension[]
  /** размеры, прочитанные по одному с вырезок: место знаем сами, модель только читает цифры */
  marks?: AiMark[]
  note?: string
}

const unit = (v: unknown): number | null => {
  const n = Number(v)
  // небольшой вылет за край картинки прощаем: модель часто округляет
  return Number.isFinite(n) && n >= -0.05 && n <= 1.05 ? Math.min(1, Math.max(0, n)) : null
}

/** размер с плана в сантиметрах: «3.72» — метры, «3720» — миллиметры, «372» — уже сантиметры */
const size = (v: unknown): number | undefined => {
  const n = inRange(v, 0.5, 5000)
  if (n === null) return undefined
  const cm = n < 30 ? n * 100 : n > 1500 ? n / 10 : n
  return cm >= 50 && cm <= 3000 ? Math.round(cm) : undefined
}

/** размер у стены: «0.26» — 26 см, короткие у ниш и выступов тоже в счёт */
const wallSize = (v: unknown): number | undefined => {
  const n = inRange(v, 0.05, 5000)
  if (n === null) return undefined
  // «0.26» и «4.08» — метры; целые 10..29 — сантиметры (стена в 26 м в квартире не бывает)
  const cm = n < 10 || (n < 30 && !Number.isInteger(n)) ? n * 100 : n > 1500 ? n / 10 : n
  return cm >= 10 && cm <= 3000 ? Math.round(cm) : undefined
}

/** размеры вдоль стен из ответа модели */
function wallLabels(v: unknown): AiWallLabel[] | undefined {
  const out: AiWallLabel[] = []
  for (const raw of list(v, 24)) {
    const o = raw as Record<string, unknown>
    const side = String(o.side ?? '').toLowerCase()
    if (side !== 'top' && side !== 'right' && side !== 'bottom' && side !== 'left') continue
    const cm = wallSize(o.cm ?? o.size_cm ?? o.length_cm ?? o.value)
    if (cm === undefined) continue
    out.push({ side, at: unit(o.at) ?? 0.5, cm })
  }
  return out.length ? out : undefined
}

const inRange = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(/\s+/g, '').replace(',', '.')) : Number(v)
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null
}

const list = (v: unknown, cap: number): unknown[] => (Array.isArray(v) ? v.slice(0, cap) : [])

/** что написано в вырезке номер n листа (null — не число или не прочиталось) */
export interface AiNumberRead {
  n: number
  text: string | null
}

/** Проверить ответ по листу вырезок: по строке на вырезку */
export function checkAiNumbers(data: unknown): AiNumberRead[] {
  if (!data || typeof data !== 'object') throw new Error('не объект')
  const d = data as Record<string, unknown>
  const items = d.items ?? d.numbers
  if (!Array.isArray(items)) throw new Error('items: ожидается список')
  const out: AiNumberRead[] = []
  for (const raw of list(items, 200)) {
    const o = (raw ?? {}) as Record<string, unknown>
    const n = Number(o.n ?? o.id ?? o.index)
    if (!Number.isInteger(n) || n < 1) continue
    const t = o.text ?? o.value
    out.push({ n, text: typeof t === 'string' || typeof t === 'number' ? String(t).trim().slice(0, 24) || null : null })
  }
  return out
}

/**
 * Размер из надписи на плане, в сантиметрах. «3,72» и «0,26» — метры с двумя
 * знаками (так пишут БТИ), «3720» — миллиметры, «372» — сантиметры. Площадь
 * «13,9», номер «5ж» и прочее — не размер: null
 */
export function sizeFromText(text: string | null | undefined): number | null {
  if (!text) return null
  const t = text.replace(/\s+/g, '').replace(/(мм|см|м)\.?$/i, '')
  let cm: number | null = null
  if (/^\d{1,2}[.,]\d{2}$/.test(t)) cm = Math.round(Number(t.replace(',', '.')) * 100)
  else if (/^\d{4,5}$/.test(t)) cm = Math.round(Number(t) / 10)
  else if (/^\d{3}$/.test(t)) cm = Number(t)
  return cm !== null && cm >= 5 && cm <= 3000 ? cm : null
}

/** Что модель увидела на обведённом участке плана */
export interface AiSpot {
  what: 'wall' | 'door' | 'window' | 'doorway' | 'none'
  /** пояснение своими словами: показывается пользователю как есть */
  note?: string
}

/** Подписи одной комнаты, прочитанные по её увеличенному фрагменту */
export interface AiRoomLabel {
  name?: string
  kind?: string
  areaM2?: number
  widthCm?: number
  depthCm?: number
  /** проёмы, видимые в стенах этого фрагмента: сторона и место вдоль неё */
  openings?: { kind: AiOpeningKind; side: AiSide; at: number; widthCm: number }[]
  /** размеры, подписанные вдоль стен комнаты */
  walls?: AiWallLabel[]
  /** на фрагменте не помещение, а штриховка стены, вентшахта или колонна */
  notRoom?: boolean
  note?: string
}

/** Проверить ответ по фрагменту комнаты: подписи внутри неё */
export function checkAiRoomLabel(data: unknown): AiRoomLabel {
  if (!data || typeof data !== 'object') throw new Error('не объект')
  const d = data as Record<string, unknown>
  const out: AiRoomLabel = {}
  const name = typeof d.name === 'string' ? d.name.trim().slice(0, 40) : ''
  if (name && name.toLowerCase() !== 'null') out.name = name
  const kind = typeof d.kind === 'string' ? d.kind.trim().slice(0, 40) : ''
  if (kind) out.kind = kind
  const area = inRange(d.area_m2 ?? d.areaM2, 0.5, 200)
  if (area !== null) out.areaM2 = area
  const w = size(d.width_cm ?? d.widthCm)
  if (w !== undefined) out.widthCm = w
  const h = size(d.depth_cm ?? d.depthCm ?? d.height_cm)
  if (h !== undefined) out.depthCm = h
  const ops: NonNullable<AiRoomLabel['openings']> = []
  for (const raw of list(d.openings, 12)) {
    const o = raw as Record<string, unknown>
    const kindO = String(o.kind ?? '').toLowerCase()
    const side = String(o.side ?? '').toLowerCase()
    const at = unit(o.at)
    if (kindO !== 'door' && kindO !== 'window' && kindO !== 'doorway') continue
    if (side !== 'top' && side !== 'right' && side !== 'bottom' && side !== 'left') continue
    if (at === null) continue
    ops.push({ kind: kindO, side: side as AiSide, at, widthCm: inRange(o.width_cm ?? o.widthCm, 30, 400) ?? (kindO === 'window' ? 150 : 80) })
  }
  if (ops.length) out.openings = ops
  const walls = wallLabels(d.walls ?? d.wall_sizes ?? d.dims)
  if (walls) out.walls = walls
  const note = typeof d.note === 'string' ? d.note.slice(0, 200) : ''
  if (note) out.note = note
  if (d.not_room === true || d.notRoom === true) out.notRoom = true
  // совсем пустой ответ — это не ответ: пусть попробует следующая модель
  if (!out.notRoom && !out.name && out.areaM2 === undefined && out.widthCm === undefined && out.depthCm === undefined && !out.openings) throw new Error('в ответе нет ни подписи, ни размеров')
  return out
}

/** Проверить ответ про участок: что там — стена, проём или ничего */
export function checkAiSpot(data: unknown): AiSpot {
  if (!data || typeof data !== 'object') throw new Error('не объект')
  const d = data as Record<string, unknown>
  const what = String(d.what ?? d.kind ?? '').toLowerCase()
  if (what !== 'wall' && what !== 'door' && what !== 'window' && what !== 'doorway' && what !== 'none') throw new Error('what: ожидается wall, door, window, doorway или none')
  const note = typeof d.note === 'string' ? d.note.slice(0, 300) : undefined
  return note ? { what, note } : { what }
}

/** Проверить ответ на распознавание плана */
export function checkAiPlan(data: unknown): AiPlan {
  if (!data || typeof data !== 'object') throw new Error('не объект')
  const d = data as Record<string, unknown>

  const walls: AiWall[] = []
  for (const raw of list(d.walls, 400)) {
    const w = raw as Record<string, unknown>
    const x1 = unit(w.x1), y1 = unit(w.y1), x2 = unit(w.x2), y2 = unit(w.y2)
    if (x1 === null || y1 === null || x2 === null || y2 === null) continue
    // отрезок короче процента картинки — это не стена, а штрих
    if (Math.hypot(x2 - x1, y2 - y1) < 0.01) continue
    walls.push({ x1, y1, x2, y2, thicknessCm: inRange(w.thickness_cm ?? w.thicknessCm ?? w.thickness, 3, 120) ?? 10 })
  }

  const openings: AiOpening[] = []
  for (const raw of list(d.openings, 200)) {
    const o = raw as Record<string, unknown>
    const x = unit(o.x), y = unit(o.y)
    const kind = String(o.kind ?? '').toLowerCase()
    if (x === null || y === null) continue
    if (kind !== 'door' && kind !== 'window' && kind !== 'doorway') continue
    const op: AiOpening = { kind, x, y, widthCm: inRange(o.width_cm ?? o.widthCm ?? o.width, 30, 400) ?? (kind === 'window' ? 140 : 90) }
    const side = String(o.side ?? '').toLowerCase()
    const room = typeof o.room === 'string' ? o.room.trim().slice(0, 40) : ''
    const at = inRange(o.at, 0, 1)
    if (room && (side === 'top' || side === 'right' || side === 'bottom' || side === 'left') && at !== null) {
      op.room = room
      op.side = side
      op.at = at
    }
    openings.push(op)
  }

  const rooms: AiRoom[] = []
  for (const raw of list(d.rooms, 60)) {
    const r = raw as Record<string, unknown>
    const x = unit(r.x), y = unit(r.y)
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, 40) : ''
    if (x === null || y === null || !name) continue
    const room: AiRoom = { name, areaM2: inRange(r.area_m2 ?? r.areaM2 ?? r.area, 0.5, 500) ?? undefined, x, y }
    if (typeof r.kind === 'string' && r.kind.trim()) room.kind = r.kind.trim().slice(0, 30)
    const b = (r.box ?? r.bbox ?? r.rect) as Record<string, unknown> | undefined
    if (b && typeof b === 'object') {
      const x1 = unit(b.x1), y1 = unit(b.y1), x2 = unit(b.x2), y2 = unit(b.y2)
      // прямоугольник уже процента картинки — это не комната, а ошибка
      if (x1 !== null && y1 !== null && x2 !== null && y2 !== null && x2 - x1 >= 0.01 && y2 - y1 >= 0.01) {
        room.box = { x1, y1, x2, y2 }
      }
    }
    const sides: AiSide[] = ['top', 'right', 'bottom', 'left']
    const nb = (r.neighbors ?? r.adjacent ?? r.neighbours) as Record<string, unknown> | undefined
    if (nb && typeof nb === 'object') {
      const out: Partial<Record<AiSide, string[]>> = {}
      for (const side of sides) {
        const v = nb[side]
        const names = (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []).map((n) => String(n).trim().slice(0, 40)).filter(Boolean)
        if (names.length) out[side] = names
      }
      if (Object.keys(out).length) room.neighbors = out
    }
    if (Array.isArray(r.outer)) {
      const outer = r.outer.map((v) => String(v).toLowerCase()).filter((v): v is AiSide => (sides as string[]).includes(v))
      if (outer.length) room.outer = outer
    }
    room.widthCm = size(r.width_cm ?? r.widthCm ?? r.width ?? r.width_m ?? r.widthM)
    room.depthCm = size(r.depth_cm ?? r.depthCm ?? r.depth ?? r.height_cm ?? r.depth_m ?? r.height ?? r.length_cm ?? r.length)
    // модель может сложить оба размера в одну строку: «4.01x4.26», «401 × 426 см»
    const pair = /^\s*([\d.,]+)\s*[x×хX*]\s*([\d.,]+)/.exec(String(r.size ?? r.dimensions ?? r.sizes ?? ''))
    if (pair) {
      room.widthCm ??= size(pair[1].replace(',', '.'))
      room.depthCm ??= size(pair[2].replace(',', '.'))
    }
    const walls = wallLabels(r.walls ?? r.wall_sizes)
    if (walls) room.walls = walls
    rooms.push(room)
  }

  const dimensions: AiDimension[] = []
  for (const raw of list(d.dimensions, 200)) {
    const s = raw as Record<string, unknown>
    const x1 = unit(s.x1), y1 = unit(s.y1), x2 = unit(s.x2), y2 = unit(s.y2)
    const cm = inRange(s.cm ?? s.length_cm ?? s.lengthCm, 20, 5000)
    if (x1 === null || y1 === null || x2 === null || y2 === null || cm === null) continue
    if (Math.hypot(x2 - x1, y2 - y1) < 0.01) continue
    dimensions.push({ x1, y1, x2, y2, cm })
  }

  // без стен годится только ответ, по которому чертёж строится из комнат
  if (!walls.length && !rooms.some((r) => r.box)) throw new Error('стен не найдено')
  return { walls, openings, rooms, dimensions, note: typeof d.note === 'string' ? d.note.slice(0, 500) : undefined }
}

// ---------- расстановка мебели ----------
export interface AiPlacement {
  /** ключ каталога */
  type: string
  /** сантиметры в системе координат плана */
  x: number
  y: number
  /** градусы, кратно 15 */
  rot: number
  why: string
}

export function checkAiLayout(data: unknown): AiPlacement[] {
  const d = data as Record<string, unknown> | null
  const items = Array.isArray(d?.items) ? (d as { items: unknown[] }).items : Array.isArray(data) ? (data as unknown[]) : []
  const out: AiPlacement[] = []
  for (const raw of items.slice(0, 60)) {
    const it = raw as Record<string, unknown>
    const type = typeof it.type === 'string' ? it.type.trim() : ''
    const x = Number(it.x)
    const y = Number(it.y)
    const rot = Number(it.rot ?? 0)
    if (!type || !Number.isFinite(x) || !Number.isFinite(y)) continue
    out.push({
      type,
      x,
      y,
      rot: Number.isFinite(rot) ? (((Math.round(rot / 15) * 15) % 360) + 360) % 360 : 0,
      why: typeof it.why === 'string' ? it.why.trim().slice(0, 200) : '',
    })
  }
  if (!out.length) throw new Error('пустая расстановка')
  return out
}

/** назначения комнат, из которых выбирает зонирование */
export const ROOM_PURPOSES = [
  'Гостиная',
  'Спальня',
  'Детская',
  'Кабинет',
  'Спальня-кабинет',
  'Гостевая',
  'Столовая',
  'Кухня',
  'Кухня-гостиная',
  'Прихожая',
  'Коридор',
  'Санузел',
  'Ванная',
  'Туалет',
  'Гардеробная',
  'Кладовая',
  'Балкон',
  'Лоджия',
] as const

export interface AiZone {
  id: string
  purpose: string
  why: string
}

/** Зонирование квартиры: назначение каждой комнаты. Неизвестные id и пустые назначения отбрасываются */
export function checkAiZones(data: unknown, ids?: string[]): AiZone[] {
  const d = data as Record<string, unknown> | null
  const items = Array.isArray(d?.rooms) ? (d as { rooms: unknown[] }).rooms : Array.isArray(data) ? (data as unknown[]) : []
  const out: AiZone[] = []
  for (const raw of items.slice(0, 40)) {
    const it = raw as Record<string, unknown>
    const id = typeof it.id === 'string' ? it.id.trim() : String(it.id ?? '')
    const purpose = typeof it.purpose === 'string' ? it.purpose.trim().slice(0, 40) : ''
    if (!id || !purpose || (ids && !ids.includes(id)) || out.some((z) => z.id === id)) continue
    out.push({ id, purpose, why: typeof it.why === 'string' ? it.why.trim().slice(0, 200) : '' })
  }
  if (!out.length) throw new Error('пустое зонирование')
  return out
}

// ---------- товар со страницы магазина ----------
export interface AiProductFields {
  name?: string
  price?: number
  currency?: string
  width?: number
  depth?: number
  height?: number
  photo?: string
}

export function checkAiProduct(data: unknown): AiProductFields {
  if (!data || typeof data !== 'object') throw new Error('не объект')
  const d = data as Record<string, unknown>
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined)
  const out: AiProductFields = {
    name: str(d.name),
    price: inRange(d.price, 1, 100_000_000) ?? undefined,
    currency: str(d.currency),
    width: inRange(d.width_cm ?? d.width, 1, 600) ?? undefined,
    depth: inRange(d.depth_cm ?? d.depth, 1, 600) ?? undefined,
    height: inRange(d.height_cm ?? d.height, 1, 400) ?? undefined,
    photo: str(d.photo),
  }
  if (!out.name && !out.width && !out.price) throw new Error('пусто')
  return out
}

// ---------- разбор ответа ----------
/** достать JSON из ответа: модели любят обрамлять его ```json и пояснениями */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const body = fenced ? fenced[1] : text
  const direct = tryParse(body)
  if (direct !== undefined) return direct
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const start = body.indexOf(open)
    if (start < 0) continue
    let depth = 0
    let inStr = false
    let esc = false
    for (let i = start; i < body.length; i++) {
      const ch = body[i]
      if (esc) { esc = false; continue }
      if (ch === '\\') { esc = true; continue }
      if (ch === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (ch === open) depth++
      else if (ch === close && --depth === 0) {
        const got = tryParse(body.slice(start, i + 1))
        if (got !== undefined) return got
        break
      }
    }
  }
  throw new Error('модель вернула не JSON')
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s.trim())
  } catch {
    return undefined
  }
}
