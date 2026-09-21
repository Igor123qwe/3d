// Расстановка мебели в комнате.
//
// Модель получает контур комнаты в сантиметрах, двери, окна и список доступных
// типов мебели с габаритами. Возвращает расстановку с объяснением каждого места.
// Всё, что она предложила, потом проверяется геометрией на клиенте: предмет вне
// комнаты, наложение или перекрытая дверь отбрасываются. Поэтому здесь дешёвая
// модель с рассуждением, а не самая сильная.
import { askJson, aiConfig, clientIp, fail, json, rateLimit, readJsonBody } from './_lib'
import { checkAiLayout } from '../src/planner/aicontract'

export const config = { runtime: 'edge' }

export interface LayoutRequest {
  /** контур комнаты, см, по часовой стрелке */
  polygon: { x: number; y: number }[]
  /** проёмы: где нельзя ставить и куда смотрит вход */
  openings: { kind: string; x: number; y: number; width: number }[]
  room: string
  areaM2: number
  /** какие типы можно ставить: ключ, название и габариты */
  catalog: { type: string; name: string; w: number; d: number }[]
  style?: string
}

const PROMPT = `Ты расставляешь мебель как практикующий дизайнер интерьера. Координаты — сантиметры в той же системе, что и контур комнаты. rot — поворот в градусах по часовой стрелке, 0 значит «лицом вниз по оси Y», предмет шириной w вдоль X и глубиной d вдоль Y.

Верни ТОЛЬКО JSON: {"items":[{"type":"ключ из каталога","x":320,"y":180,"rot":90,"why":"зачем именно тут"}]}

Правила ремесла:
- Проходы: основной маршрут 90–120 см, между кроватью и стеной 70 см, перед шкафом 90 см, перед комодом 75 см, вокруг обеденного стола 90 см.
- Кровать изголовьем к глухой стене, не под окном и не напротив двери в упор; с двух сторон подходы, если она двуспальная.
- Диван спинкой к стене или к чёткой границе зоны; телевизор напротив дивана на 2–3 м, не напротив окна.
- Обеденный стол ближе к кухне и к окну; стулья задвигаются и не мешают проходу.
- Кухонный треугольник: мойка, плита, холодильник рядом, но плита не вплотную к холодильнику и не у самого окна.
- Шкафы и стеллажи у глухих стен, не перекрывают окна и не мешают открыванию дверей.
- Ничего не ставь в створ двери и на её дугу открывания.
- Предмет целиком внутри контура комнаты, прижат к стене там, где это логично.
- Ставь только то, что уместно в этой комнате, и не больше, чем помещается свободно. Пустое место лучше тесноты.
- Используй только ключи type из присланного каталога.`

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return fail('нужен POST', 405)
  const cfg = aiConfig()
  if (!cfg) return fail('ИИ не подключён: на сервере нет ключа ROUTERAI_API_KEY', 503)
  if (!rateLimit(clientIp(req), { limit: 20, windowMs: 10 * 60_000, bucket: 'layout' })) return fail('слишком часто, подождите', 429)

  let body: LayoutRequest
  try {
    body = await readJsonBody<LayoutRequest>(req, 200_000)
  } catch (e) {
    return fail((e as Error).message, 413)
  }
  if (!Array.isArray(body.polygon) || body.polygon.length < 3) return fail('нужен контур комнаты', 400)
  if (!Array.isArray(body.catalog) || !body.catalog.length) return fail('нужен список доступной мебели', 400)

  const task = {
    room: body.room || 'комната',
    area_m2: body.areaM2,
    style: body.style || 'спокойный современный',
    polygon: body.polygon.slice(0, 40).map((p) => [Math.round(p.x), Math.round(p.y)]),
    openings: (body.openings || []).slice(0, 40).map((o) => ({ kind: o.kind, x: Math.round(o.x), y: Math.round(o.y), width: Math.round(o.width) })),
    catalog: body.catalog.slice(0, 80).map((c) => ({ type: c.type, name: c.name, w: c.w, d: c.d })),
  }

  try {
    const answer = await askJson(cfg, {
      task: 'layout',
      check: checkAiLayout,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: JSON.stringify(task) },
      ],
    })
    return json({ items: answer.value, ai: { model: answer.model, costRub: answer.costRub, tried: answer.tried } })
  } catch (e) {
    return fail((e as Error).message, 502)
  }
}
