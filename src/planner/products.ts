// Импорт товара по ссылке из магазина: название, фото, цена и габариты.
// Страницу магазина браузер напрямую прочитать не может (запрет по домену),
// поэтому запрос идёт через публичные читалки, а любое поле можно ввести руками.

export interface ProductDims {
  /** ширина, глубина и высота в сантиметрах */
  w: number
  d: number
  h: number
}

export interface ProductInfo {
  url: string
  name: string
  photo?: string
  price?: number
  currency?: string
  dims?: ProductDims
  /** откуда взялись данные — показываем пользователю: разметка, текст, ИИ или их сочетание */
  source: string
}

const CM: Record<string, number> = { мм: 0.1, см: 1, м: 100, mm: 0.1, cm: 1, m: 100 }
const num = (s: string): number => Number(s.replace(',', '.').replace(/\s/g, ''))

/** «59,5x65,5x185,5 см» → числа; порядок берём из подписи, по умолчанию Ш×Г×В */
export function parseDimsTriple(text: string): ProductDims | null {
  const re = /(?:^|[^\d])(\d{1,4}(?:[.,]\d+)?)\s*[x×х*]\s*(\d{1,4}(?:[.,]\d+)?)\s*[x×х*]\s*(\d{1,4}(?:[.,]\d+)?)\s*(мм|см|м|mm|cm|m)?/i
  const m = re.exec(text)
  if (!m) return null
  const unit = CM[(m[4] || 'см').toLowerCase()] ?? 1
  const vals = [num(m[1]), num(m[2]), num(m[3])].map((v) => v * unit)
  if (vals.some((v) => !Number.isFinite(v) || v <= 0 || v > 1000)) return null
  // ищем подпись вида «ШхГхВ» или «ВхШхГ» перед числами
  const label = /([ШВГДшвгд])\s*[x×х*]\s*([ШВГДшвгд])\s*[x×х*]\s*([ШВГДшвгд])/.exec(text.slice(0, Math.max(0, m.index)))
  const order = label ? [label[1], label[2], label[3]].map((c) => c.toUpperCase()) : ['Ш', 'Г', 'В']
  const out: ProductDims = { w: 0, d: 0, h: 0 }
  order.forEach((letter, i) => {
    if (letter === 'Ш') out.w = vals[i]
    else if (letter === 'В') out.h = vals[i]
    else out.d = vals[i]
  })
  if (!out.w || !out.d || !out.h) return { w: vals[0], d: vals[1], h: vals[2] }
  return out
}

/** «Ширина: 60 см», «Глубина, см 65» — размеры, подписанные по отдельности */
export function parseDimsLabelled(text: string): ProductDims | null {
  const grab = (names: string[]): number | null => {
    for (const name of names) {
      const re = new RegExp(`${name}[^\\dA-Za-zА-Яа-я]{0,20}?(?:,\\s*(мм|см|м))?[^\\d]{0,10}(\\d{1,4}(?:[.,]\\d+)?)\\s*(мм|см|м)?`, 'i')
      const m = re.exec(text)
      if (!m) continue
      const unit = CM[(m[3] || m[1] || 'см').toLowerCase()] ?? 1
      const v = num(m[2]) * unit
      if (Number.isFinite(v) && v > 0 && v <= 1000) return v
    }
    return null
  }
  const w = grab(['ширина'])
  const d = grab(['глубина'])
  const h = grab(['высота'])
  if (w && d && h) return { w, d, h }
  return null
}

export const parseDims = (text: string): ProductDims | null => parseDimsLabelled(text) ?? parseDimsTriple(text)

const meta = (html: string, prop: string): string | undefined => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i')
  const alt = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i')
  return re.exec(html)?.[1] ?? alt.exec(html)?.[1]
}

const decode = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()

export const stripTags = (html: string): string =>
  decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  )

interface JsonLdProduct {
  '@type'?: string | string[]
  name?: string
  image?: string | string[]
  description?: string
  offers?: { price?: string | number; priceCurrency?: string } | { price?: string | number; priceCurrency?: string }[]
  width?: { value?: number; unitCode?: string }
  depth?: { value?: number; unitCode?: string }
  height?: { value?: number; unitCode?: string }
}

function fromJsonLd(html: string): Partial<ProductInfo> {
  const out: Partial<ProductInfo> = {}
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) ?? []
  for (const block of blocks) {
    const body = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '')
    let data: unknown
    try {
      data = JSON.parse(body)
    } catch {
      continue
    }
    const list: JsonLdProduct[] = Array.isArray(data) ? (data as JsonLdProduct[]) : [data as JsonLdProduct]
    for (const item of list) {
      const type = Array.isArray(item['@type']) ? item['@type'].join(' ') : (item['@type'] ?? '')
      if (!/product/i.test(String(type))) continue
      if (item.name) out.name = decode(String(item.name))
      const img = Array.isArray(item.image) ? item.image[0] : item.image
      if (img) out.photo = String(img)
      const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers
      if (offer?.price !== undefined) {
        const p = Number(String(offer.price).replace(/[^\d.,]/g, '').replace(',', '.'))
        if (Number.isFinite(p) && p > 0) out.price = p
      }
      if (offer?.priceCurrency) out.currency = String(offer.priceCurrency)
      const unit = (u?: string) => (u === 'MMT' ? 0.1 : u === 'MTR' ? 100 : 1)
      if (item.width?.value && item.depth?.value && item.height?.value) {
        out.dims = {
          w: item.width.value * unit(item.width.unitCode),
          d: item.depth.value * unit(item.depth.unitCode),
          h: item.height.value * unit(item.height.unitCode),
        }
      }
      if (out.name) return out
    }
  }
  return out
}

/** Разобрать страницу товара: сначала разметка, затем текст */
export function parseProductPage(html: string, url: string): ProductInfo {
  const ld = fromJsonLd(html)
  const name = ld.name ?? meta(html, 'og:title') ?? decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
  const photo = ld.photo ?? meta(html, 'og:image')
  const priceMeta = meta(html, 'product:price:amount') ?? meta(html, 'og:price:amount')
  const price = ld.price ?? (priceMeta ? Number(priceMeta.replace(',', '.')) : undefined)
  const currency = ld.currency ?? meta(html, 'product:price:currency') ?? meta(html, 'og:price:currency')
  const text = stripTags(html)
  const dims = ld.dims ?? parseDims(text) ?? undefined
  const found = !!(ld.name || photo || dims)
  return {
    url,
    name: name || 'Товар',
    photo: photo && /^https?:/.test(photo) ? photo : undefined,
    price: Number.isFinite(price) && (price ?? 0) > 0 ? price : undefined,
    currency: currency ?? (/[₽]|руб/i.test(text) ? 'RUB' : undefined),
    dims,
    source: ld.name || ld.dims ? 'разметка страницы' : found ? 'текст страницы' : 'ничего не найдено',
  }
}

/** Публичные читалки: прямой запрос к магазину браузер не пропустит */
export const READERS: ((url: string) => string)[] = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u) => `https://r.jina.ai/${u}`,
]

export async function fetchProduct(url: string, readers = READERS): Promise<ProductInfo> {
  const clean = url.trim()
  if (!/^https?:\/\/.+/i.test(clean)) throw new Error('Нужна ссылка вида https://…')
  let lastError = 'магазин не ответил'
  for (const make of readers) {
    try {
      const res = await fetch(make(clean), { headers: { accept: 'text/html,text/plain' } })
      if (!res.ok) {
        lastError = `ответ ${res.status}`
        continue
      }
      const body = await res.text()
      if (body.length < 200) {
        lastError = 'пустой ответ'
        continue
      }
      const info = parseProductPage(body, clean)
      if (info.source !== 'ничего не найдено') return info
      lastError = 'на странице не нашлось данных о товаре'
    } catch (e) {
      lastError = (e as Error).message
    }
  }
  throw new Error(`Не удалось прочитать страницу: ${lastError}. Заполните поля вручную.`)
}

/** Какому типу планировщика соответствует товар — по названию */
const TYPE_BY_NAME: [RegExp, string][] = [
  [/холодильник|refrigerator|fridge/i, 'fridge'],
  [/стиральн/i, 'washer'],
  [/посудомоечн/i, 'dishwasher'],
  [/духов|плита|варочн/i, 'stove'],
  [/вытяжк/i, 'counter-60'],
  [/мойка|раковина кухонн/i, 'sink'],
  [/унитаз/i, 'toilet'],
  [/ванна(?!я комната)/i, 'bathtub-170'],
  [/душев/i, 'shower-90'],
  [/раковин|умывальник/i, 'basin'],
  [/диван углов/i, 'sofa-corner'],
  [/диван/i, 'sofa-3'],
  [/кресло/i, 'armchair'],
  [/кровать|матрас/i, 'bed-160'],
  [/шкаф-купе/i, 'wardrobe-slide'],
  [/шкаф|гардероб/i, 'wardrobe'],
  [/комод/i, 'dresser'],
  [/тумб/i, 'nightstand'],
  [/стеллаж|полк/i, 'bookshelf'],
  [/письменный стол|компьютерный стол/i, 'desk'],
  [/журнальн/i, 'coffee-table'],
  [/обеденн|стол/i, 'dining-table'],
  [/стул/i, 'chair'],
  [/телевизор|tv/i, 'tv'],
  [/ковёр|ковер/i, 'rug'],
  [/светильник|люстра|лампа/i, 'light'],
]

export function typeForProduct(name: string): string {
  for (const [re, type] of TYPE_BY_NAME) if (re.test(name)) return type
  return 'box'
}

export const formatPrice = (price: number, currency?: string): string => {
  const cur = currency === 'RUB' || !currency ? '₽' : currency
  return `${Math.round(price).toLocaleString('ru-RU')} ${cur}`
}
