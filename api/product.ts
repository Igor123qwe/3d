// Товар по ссылке из магазина.
//
// Порядок ровно такой, чтобы не платить зря:
//   1. страницу забирает сервер (браузеру мешает CORS, серверу — нет);
//   2. бесплатный разбор разметки schema.org и Open Graph;
//   3. если разметки нет — дешёвая модель по тексту страницы.
// Шаг 3 включается, только если после шага 2 чего-то не хватает.
import { askJson, aiConfig, clientIp, fail, json, rateLimit, readJsonBody } from './_lib'
import { parseProductPage, stripTags, type ProductInfo } from '../src/planner/products'
import { checkAiProduct, type AiProductFields } from '../src/planner/aicontract'

export const config = { runtime: 'edge' }

/** сколько текста страницы отдаём модели: больше — дороже, а толку нет */
const TEXT_LIMIT = 12_000
const PAGE_LIMIT = 3_000_000

/** Запрещаем адреса, по которым функция могла бы постучаться во внутреннюю сеть */
export function checkShopUrl(raw: string): URL {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new Error('Нужна ссылка вида https://…')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Поддерживаются только http и https')
  const host = u.hostname.toLowerCase()
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.internal') || host === 'localhost') {
    throw new Error('Такой адрес недоступен')
  }
  // литеральные адреса внутренних сетей
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || a >= 224) {
      throw new Error('Такой адрес недоступен')
    }
  }
  if (host.startsWith('[') || host.includes(':')) throw new Error('Такой адрес недоступен')
  return u
}

const PROMPT = `Ты разбираешь страницу интернет-магазина. Верни ТОЛЬКО JSON:
{"name":"краткое название товара","price":число или null,"currency":"RUB","width_cm":число или null,"depth_cm":число или null,"height_cm":число или null}
Правила:
- размеры переведи в сантиметры (мм дели на 10, м умножай на 100);
- width — ширина по фасаду, depth — глубина, height — высота;
- если в тексте порядок подписан как ВхШхГ или ШхГхВ, следуй подписи;
- чего нет — null, не выдумывай;
- цена — только число без пробелов и символа валюты.`

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return fail('нужен POST', 405)
  const ip = clientIp(req)
  if (!rateLimit(ip, { limit: 30, windowMs: 60_000 })) return fail('слишком часто, подождите минуту', 429)

  let url: URL
  let body: { url?: string }
  try {
    body = await readJsonBody<{ url?: string }>(req, 10_000)
    url = checkShopUrl(body.url || '')
  } catch (e) {
    return fail((e as Error).message, 400)
  }

  // 1. страницу забирает сервер
  let html = ''
  try {
    const res = await fetch(url.toString(), {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'ru,en;q=0.8',
        'user-agent': 'Mozilla/5.0 (compatible; ApartmentPlanner/1.0; +https://github.com/Igor123qwe/3d)',
      },
      redirect: 'follow',
    })
    if (!res.ok) return fail(`магазин ответил ${res.status}`, 502)
    html = (await res.text()).slice(0, PAGE_LIMIT)
  } catch (e) {
    return fail(`не удалось открыть страницу: ${(e as Error).message}`, 502)
  }

  // 2. бесплатный разбор разметки
  const parsed = parseProductPage(html, url.toString())
  const complete = !!(parsed.name && parsed.name !== 'Товар' && parsed.dims && parsed.price)
  const cfg = aiConfig()
  if (complete || !cfg) return json({ product: parsed, ai: null })

  // 3. дешёвая модель добирает недостающее
  try {
    const text = stripTags(html).slice(0, TEXT_LIMIT)
    const answer = await askJson(cfg, {
      task: 'product',
      check: checkAiProduct,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: `Адрес: ${url.toString()}\n\nТекст страницы:\n${text}` },
      ],
    })
    return json({ product: mergeProduct(parsed, answer.value), ai: { model: answer.model, costRub: answer.costRub, tried: answer.tried } })
  } catch (e) {
    // модель не помогла — отдаём то, что нашлось разметкой
    return json({ product: parsed, ai: { error: (e as Error).message } })
  }
}

/** Разметке верим больше, чем модели: модель только добирает пустые поля */
export function mergeProduct(parsed: ProductInfo, ai: AiProductFields): ProductInfo {
  const dims = parsed.dims ?? (ai.width && ai.depth && ai.height ? { w: ai.width, d: ai.depth, h: ai.height } : undefined)
  const name = parsed.name && parsed.name !== 'Товар' ? parsed.name : (ai.name ?? parsed.name)
  const price = parsed.price ?? ai.price
  const from: string[] = []
  if (parsed.source !== 'ничего не найдено') from.push(parsed.source)
  if (name === ai.name || (!parsed.dims && dims) || (!parsed.price && price)) from.push('ИИ по тексту страницы')
  return {
    ...parsed,
    name,
    price,
    currency: parsed.currency ?? ai.currency,
    photo: parsed.photo ?? (ai.photo && /^https?:/.test(ai.photo) ? ai.photo : undefined),
    dims,
    source: from.join(' + ') || 'ничего не найдено',
  }
}
