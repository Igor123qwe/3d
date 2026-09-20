// Распознавание плана квартиры с картинки.
//
// Растровый разбор (underlay.ts) видит линии, но не понимает, где дверь, а где
// окно, и не читает подписи. Модель со зрением понимает и читает — в том числе
// площади комнат и размерные цепочки, по которым план сам встаёт в масштаб.
//
// Это единственная задача, где нужна модель подороже, поэтому цепочка идёт от
// дешёвой к сильной: сильная включается, только если дешёвая вернула ерунду.
import { askJson, aiConfig, clientIp, fail, json, rateLimit, readJsonBody } from './_lib'
import { checkAiPlan } from '../src/planner/aicontract'

export const config = { runtime: 'edge' }

/** картинка приходит уже уменьшенной клиентом; это потолок на всякий случай */
const IMAGE_LIMIT = 6_000_000

const PROMPT = `Ты читаешь план квартиры (обмерный план БТИ, план застройщика или от руки) и переводишь его в данные.

Система координат: доли размера картинки. x — слева направо (0..1), y — сверху вниз (0..1). Все размеры — в сантиметрах.

Верни ТОЛЬКО JSON такого вида:
{
  "walls": [{"x1":0.05,"y1":0.07,"x2":0.95,"y2":0.07,"thickness_cm":25}],
  "openings": [{"kind":"door","x":0.4,"y":0.07,"width_cm":90}],
  "rooms": [{"name":"Жилая комната","area_m2":17.3,"x":0.3,"y":0.4}],
  "dimensions": [{"x1":0.05,"y1":0.02,"x2":0.95,"y2":0.02,"cm":845}],
  "note": "что осталось непонятным"
}

Правила:
- walls — осевые линии стен, включая внутренние перегородки. Отрезок задавай по середине толщины стены. Почти горизонтальные и почти вертикальные стены выравнивай строго по осям.
- Несущие наружные стены обычно 25–51 см, межкомнатные перегородки 7–12 см, санузловые 7–10 см.
- openings: "door" — дверь (виден проём в стене, часто с дугой открывания), "window" — окно (в наружной стене, тонкая двойная или тройная линия), "doorway" — проём без двери. Точку ставь в середине проёма, прямо на стене.
- rooms: название с плана как есть (Жилая комната, Кухня, Коридор, Санузел, Ванная, Лоджия и т.д.), area_m2 — площадь, подписанную на плане, и точка (x,y) внутри этой комнаты.
- dimensions — размерные цепочки и выноски с числами: концы отрезка и подписанное число в сантиметрах. Если на плане размеры в миллиметрах (обычно 4 цифры, например 3400), переведи в сантиметры. Это важнее всего: по ним план встаёт в масштаб.
- Ничего не выдумывай: чего на картинке нет — не добавляй. Пустой список лучше вымысла.
- Линии выносок, штриховку, рамку чертежа и таблицы стенами не считай.`

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return fail('нужен POST', 405)
  const cfg = aiConfig()
  if (!cfg) return fail('ИИ не подключён: на сервере нет ключа ROUTERAI_API_KEY', 503)
  const ip = clientIp(req)
  // распознавание плана — самый дорогой вызов, поэтому лимит строгий
  if (!rateLimit(ip, { limit: 10, windowMs: 10 * 60_000 })) return fail('слишком часто: не больше 10 планов за 10 минут', 429)

  let body: { image?: string; hint?: string }
  try {
    body = await readJsonBody<{ image?: string; hint?: string }>(req, IMAGE_LIMIT)
  } catch (e) {
    return fail((e as Error).message, 413)
  }
  const image = body.image || ''
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(image)) return fail('нужна картинка в виде data:image/…;base64', 400)

  const hint = typeof body.hint === 'string' ? body.hint.slice(0, 500) : ''
  try {
    const answer = await askJson(cfg, {
      task: 'plan',
      check: checkAiPlan,
      messages: [
        { role: 'system', content: PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: hint ? `План квартиры. Подсказка от пользователя: ${hint}` : 'План квартиры. Прочитай его.' },
            { type: 'image_url', image_url: { url: image } },
          ],
        },
      ],
    })
    return json({ plan: answer.value, ai: { model: answer.model, costRub: answer.costRub, tried: answer.tried } })
  } catch (e) {
    return fail((e as Error).message, 502)
  }
}
