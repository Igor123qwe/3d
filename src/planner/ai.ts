// Связь с серверными функциями ИИ.
//
// Ключа здесь нет и быть не может: браузер ходит на свой же /api, а роутер
// зовёт сервер. Если ИИ не подключён, каждая функция честно говорит об этом,
// и приложение продолжает работать на прежних локальных алгоритмах.
import type { AiPlacement, AiPlan, AiRoomLabel, AiSpot } from './aicontract'
import type { ProductInfo } from './products'

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
export const askRoomLabel = (image: string, hint?: string, signal?: AbortSignal): Promise<RoomLabelResult> =>
  post<RoomLabelResult>('plan', { image, room: true, hint }, signal)

// ---------- вопрос про одно место на плане ----------
export interface SpotResult {
  spot: AiSpot
  ai: AiCost
}

/**
 * Вырезать кусок картинки вокруг участка и увеличить его: модель читает мелкую
 * деталь куда надёжнее, когда та занимает весь кадр, а не сотню пикселей.
 */
export async function cropForVision(src: string, box: { x1: number; y1: number; x2: number; y2: number }, padPx = 24, minSide = 512): Promise<string> {
  const img = await loadImage(src)
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
}

export const askLayout = (ask: LayoutAsk, signal?: AbortSignal): Promise<LayoutResult> =>
  post<LayoutResult>('layout', ask, signal)
