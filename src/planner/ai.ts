// Связь с серверными функциями ИИ.
//
// Ключа здесь нет и быть не может: браузер ходит на свой же /api, а роутер
// зовёт сервер. Если ИИ не подключён, каждая функция честно говорит об этом,
// и приложение продолжает работать на прежних локальных алгоритмах.
import type { AiNumberRead, AiPlacement, AiPlan, AiRoomLabel, AiSpot, AiZone } from './aicontract'
import type { ProductInfo } from './products'
import type { Pt } from './types'

export interface AiTaskInfo {
  task: string
  about: string
  vision: boolean
  maxTokens: number
  models: string[]
}

export interface AiStatus {
  enabled: boolean
  /** почему ИИ выключен: подсказка про .env от локального сервера */
  hint?: string
  tasks: AiTaskInfo[]
  spentToday: { rub: number; calls: number; limitRub: number } | null
}

/** что стоил вызов: показываем пользователю, чтобы расходы не были сюрпризом */
export interface AiCost {
  model: string
  costRub: number
  tried?: string[]
}

const base = (): string => {
  // на GitHub Pages приложение лежит в подпапке, а серверных функций там нет вовсе
  const path = import.meta.env.BASE_URL || '/'
  return path.endsWith('/') ? path : `${path}/`
}

async function post<T>(endpoint: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${base()}api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const text = await res.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    // сюда попадаем, когда приложение открыто без серверной части: вместо JSON приходит страница
    throw new Error(res.ok ? 'сервер вернул не JSON' : `серверная часть недоступна (${res.status})`)
  }
  const err = (data as { error?: string }).error
  if (!res.ok || err) throw new Error(err || `ошибка ${res.status}`)
  return data as T
}

let statusCache: Promise<AiStatus> | null = null

/** Подключён ли ИИ и какие модели на какие задачи */
export function aiStatus(force = false): Promise<AiStatus> {
  if (force || !statusCache) {
    statusCache = fetch(`${base()}api/ai`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status))
        return (await r.json()) as AiStatus
      })
      .catch(() => ({ enabled: false, tasks: [], spentToday: null }) as AiStatus)
  }
  return statusCache
}

// ---------- план с картинки ----------
/**
 * Уменьшить картинку перед отправкой.
 * Стоимость запроса со зрением растёт с числом пикселей, а плану БТИ хватает
 * полутора тысяч по длинной стороне: цифры размеров всё ещё читаются.
 */
export async function shrinkForVision(src: string, maxSide = 1600, quality = 0.85): Promise<string> {
  const img = await loadImage(src)
  const side = Math.max(img.width, img.height)
  const k = side > maxSide ? maxSide / side : 1
  const w = Math.max(1, Math.round(img.width * k))
  const h = Math.max(1, Math.round(img.height * k))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return src
  // белая подложка: у прозрачных PNG иначе чернеет фон и план не читается
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', quality)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('картинка не открылась'))
    img.src = src
  })
}

export interface RecognizeResult {
  plan: AiPlan
  ai: AiCost
}

/** Прочитать план с картинки; escalate — с какой модели цепочки начать (вторая попытка — с более сильной) */
export async function recognizePlan(src: string, hint?: string, signal?: AbortSignal, escalate = 0): Promise<RecognizeResult> {
  const image = await shrinkForVision(src)
  return post<RecognizeResult>('plan', { image, hint, escalate }, signal)
}

// ---------- подписи одной комнаты по её фрагменту ----------
export interface RoomLabelResult {
  room: AiRoomLabel
  ai: AiCost
}

/** Прочитать подписи комнаты по её увеличенному куску плана */
export const askRoomLabel = (image: string, hint?: string, signal?: AbortSignal, escalate = 0): Promise<RoomLabelResult> =>
  post<RoomLabelResult>('plan', { image, room: true, hint, escalate }, signal)

// ---------- размеры по одному: лист вырезок ----------
export interface NumbersResult {
  numbers: AiNumberRead[]
  ai: AiCost
}

/** рамка подписи на картинке шириной refW: стоит ли строка боком */
export interface SheetBox {
  x1: number
  y1: number
  x2: number
  y2: number
  vertical: boolean
}

/**
 * Лист для чтения размеров: каждая подпись вырезана из фото, увеличена до
 * строки в полсотни точек и стоит в своей клетке с красным номером слева.
 * Мелкое повёрнутое «0,26» на целом плане дешёвая модель пропускает, а
 * крупное и прямое прочитает любая. Подпись боком кладётся в двух поворотах:
 * на плане её пишут и снизу вверх, и сверху вниз, — одна из двух будет прямой.
 * textPx — высота мелких цифр в тех же точках, что и рамки
 */
export async function numberSheet(src: string, boxes: SheetBox[], refW: number, textPx: number, sheetW = 1100): Promise<string> {
  const img = await loadImage(src)
  const s = img.width / refW
  const lineH = 60
  const tagW = 44
  const gap = 8
  const cells = boxes.map((b) => {
    // вдоль строки поле шире: знак, прилипший к стене, в рамку не попадает, а на листе нужен
    const across = Math.max(2, 0.45 * textPx) * s
    const along = Math.max(3, 0.8 * textPx) * s
    const [padX, padY] = b.vertical ? [across, along] : [along, across]
    const x1 = Math.max(0, b.x1 * s - padX)
    const y1 = Math.max(0, b.y1 * s - padY)
    const x2 = Math.min(img.width, (b.x2 + 1) * s + padX)
    const y2 = Math.min(img.height, (b.y2 + 1) * s + padY)
    const w = Math.max(1, x2 - x1)
    const h = Math.max(1, y2 - y1)
    // поперёк строки — lineH точек на листе
    const k = Math.min(8, Math.max(0.5, lineH / (b.vertical ? w : h)))
    const long = (b.vertical ? h : w) * k
    const short = (b.vertical ? w : h) * k
    const contentW = b.vertical ? 2 * long + gap : long
    return { b, x1, y1, w, h, k, along: long, across: short, width: tagW + gap + contentW + 2 * gap, height: short + 2 * gap }
  })
  // раскладка по строкам листа
  const at: { x: number; y: number }[] = []
  let x = gap
  let y = gap
  let rowH = 0
  for (const c of cells) {
    if (x + c.width > sheetW && x > gap) {
      x = gap
      y += rowH + gap
      rowH = 0
    }
    at.push({ x, y })
    x += c.width + gap
    rowH = Math.max(rowH, c.height)
  }
  const canvas = document.createElement('canvas')
  canvas.width = sheetW
  canvas.height = Math.max(1, Math.round(y + rowH + gap))
  const ctx = canvas.getContext('2d')
  if (!ctx) return src
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingQuality = 'high'
  cells.forEach((c, i) => {
    const p = at[i]
    ctx.strokeStyle = '#bbbbbb'
    ctx.lineWidth = 1
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, c.width - 1, c.height - 1)
    ctx.fillStyle = '#d00000'
    ctx.fillRect(p.x + 1, p.y + 1, tagW, c.height - 2)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 22px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(i + 1), p.x + 1 + tagW / 2, p.y + c.height / 2)
    const left = p.x + tagW + 2 * gap
    const top = p.y + gap
    if (!c.b.vertical) {
      ctx.drawImage(img, c.x1, c.y1, c.w, c.h, left, top, c.along, c.across)
      return
    }
    // боком: повернуть на четверть оборота в обе стороны
    for (const [n, turn] of [[0, Math.PI / 2], [1, -Math.PI / 2]] as const) {
      const cx = left + n * (c.along + gap) + c.along / 2
      const cy = top + c.across / 2
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(turn)
      ctx.drawImage(img, c.x1, c.y1, c.w, c.h, -c.across / 2, -c.along / 2, c.across, c.along)
      ctx.restore()
    }
  })
  return canvas.toDataURL('image/png')
}

/** Прочитать лист вырезок: что написано в каждой клетке по номеру */
export const askNumbers = (image: string, count: number, signal?: AbortSignal, escalate = 0): Promise<NumbersResult> =>
  post<NumbersResult>('plan', { image, numbers: true, count, escalate }, signal)

// ---------- вопрос про одно место на плане ----------
export interface SpotResult {
  spot: AiSpot
  ai: AiCost
}

/**
 * Вырезать кусок картинки вокруг участка и увеличить его: модель читает мелкую
 * деталь куда надёжнее, когда та занимает весь кадр, а не сотню пикселей.
 * hide — контуры соседних комнат: их внутренность закрашивается белым.
 */
export async function cropForVision(src: string, boxIn: { x1: number; y1: number; x2: number; y2: number }, padIn = 24, minSide = 512, hideIn: Pt[][] = [], refW?: number): Promise<string> {
  const img = await loadImage(src)
  // рамка задана в пикселях растра шириной refW (рабочая копия бывает меньше фото)
  const s = refW ? img.width / refW : 1
  const box = { x1: boxIn.x1 * s, y1: boxIn.y1 * s, x2: boxIn.x2 * s, y2: boxIn.y2 * s }
  const padPx = padIn * s
  const hide = hideIn.map((poly) => poly.map((p) => ({ x: p.x * s, y: p.y * s })))
  const x1 = Math.max(0, Math.floor(box.x1 - padPx))
  const y1 = Math.max(0, Math.floor(box.y1 - padPx))
  const x2 = Math.min(img.width, Math.ceil(box.x2 + padPx))
  const y2 = Math.min(img.height, Math.ceil(box.y2 + padPx))
  const w = Math.max(1, x2 - x1)
  const h = Math.max(1, y2 - y1)
  const k = Math.min(4, Math.max(1, minSide / Math.max(w, h)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * k)
  canvas.height = Math.round(h * k)
  const ctx = canvas.getContext('2d')
  if (!ctx) return src
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, x1, y1, w, h, 0, 0, canvas.width, canvas.height)
  // Соседние комнаты закрашиваются по их внутренним граням: стены, двери и
  // окна остаются видны, а чужая подпись — нет. У Г-образной комнаты в рамку
  // попадает соседка, и модель читала её номер
  for (const poly of hide) {
    if (poly.length < 3) continue
    ctx.beginPath()
    poly.forEach((p, n) => (n ? ctx.lineTo((p.x - x1) * k, (p.y - y1) * k) : ctx.moveTo((p.x - x1) * k, (p.y - y1) * k)))
    ctx.closePath()
    ctx.fill()
  }
  return canvas.toDataURL('image/png')
}

/** Спросить модель, что на обведённом месте плана: стена, дверь, окно, проём или ничего */
export const askSpot = (image: string, question?: string, signal?: AbortSignal): Promise<SpotResult> =>
  post<SpotResult>('plan', { image, spot: true, hint: question }, signal)

// ---------- товар по ссылке ----------
export interface ProductResult {
  product: ProductInfo
  ai: (AiCost & { error?: string }) | null
}

/** Прочитать страницу товара силами сервера, при нужде — дешёвой моделью */
export const lookupProductViaServer = (url: string, signal?: AbortSignal): Promise<ProductResult> =>
  post<ProductResult>('product', { url }, signal)

// ---------- расстановка мебели ----------
export interface LayoutResult {
  items: AiPlacement[]
  ai: AiCost
}

export interface LayoutAsk {
  polygon: { x: number; y: number }[]
  openings: { kind: string; x: number; y: number; width: number }[]
  room: string
  areaM2: number
  catalog: { type: string; name: string; w: number; d: number }[]
  style?: string
  /** назначение комнаты: детская, кабинет… */
  purpose?: string
  /** пожелания жильцов своими словами */
  wishes?: string
  /** остальные комнаты квартиры */
  apartment?: { room: string; purpose?: string; areaM2: number }[]
  /** что уже стоит в комнате */
  existing?: { type: string; name: string; x: number; y: number; w: number; d: number; rot: number }[]
}

export const askLayout = (ask: LayoutAsk, signal?: AbortSignal): Promise<LayoutResult> =>
  post<LayoutResult>('layout', ask, signal)

// ---------- зонирование квартиры ----------
export interface ZonesAsk {
  wishes?: string
  rooms: { id: string; name: string; areaM2: number; size: [number, number]; windows: number; doors: number }[]
}

export interface ZonesResult {
  rooms: AiZone[]
  ai: AiCost
}

/** Какой комнате какое назначение — с учётом пожеланий, перед расстановкой всей квартиры */
export const askZones = (ask: ZonesAsk, signal?: AbortSignal): Promise<ZonesResult> =>
  post<ZonesResult>('layout', { zones: true, ...ask }, signal)
