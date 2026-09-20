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

export interface AiOpening {
  kind: AiOpeningKind
  x: number
  y: number
  widthCm: number
}

export interface AiRoom {
  name: string
  areaM2?: number
  x: number
  y: number
}

/** размерная цепочка с плана: по ней чертёж встаёт в масштаб */
export interface AiDimension {
  x1: number
  y1: number
  x2: number
  y2: number
  cm: number
}

export interface AiPlan {
  walls: AiWall[]
  openings: AiOpening[]
  rooms: AiRoom[]
  dimensions: AiDimension[]
  note?: string
}

const unit = (v: unknown): number | null => {
  const n = Number(v)
  // небольшой вылет за край картинки прощаем: модель часто округляет
  return Number.isFinite(n) && n >= -0.05 && n <= 1.05 ? Math.min(1, Math.max(0, n)) : null
}

const inRange = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(/\s+/g, '').replace(',', '.')) : Number(v)
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null
}

const list = (v: unknown, cap: number): unknown[] => (Array.isArray(v) ? v.slice(0, cap) : [])

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
    openings.push({ kind, x, y, widthCm: inRange(o.width_cm ?? o.widthCm ?? o.width, 30, 400) ?? (kind === 'window' ? 140 : 90) })
  }

  const rooms: AiRoom[] = []
  for (const raw of list(d.rooms, 60)) {
    const r = raw as Record<string, unknown>
    const x = unit(r.x), y = unit(r.y)
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, 40) : ''
    if (x === null || y === null || !name) continue
    rooms.push({ name, areaM2: inRange(r.area_m2 ?? r.areaM2 ?? r.area, 0.5, 500) ?? undefined, x, y })
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

  if (!walls.length) throw new Error('стен не найдено')
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
