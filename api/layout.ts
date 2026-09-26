// Расстановка мебели в комнате и зонирование квартиры.
//
// Модель получает контур комнаты в сантиметрах, двери, окна и список доступных
// типов мебели с габаритами, а ещё — назначение комнаты, пожелания жильцов,
// остальные комнаты квартиры и то, что в комнате уже стоит. Возвращает
// расстановку с объяснением каждого места. Всё, что она предложила, потом
// проверяется геометрией на клиенте: предмет вне комнаты, наложение или
// перекрытая дверь отбрасываются. Поэтому здесь дешёвая модель с рассуждением,
// а не самая сильная.
//
// Зонирование ({ zones: true }) — отдельный короткий вопрос перед расстановкой
// всей квартиры: какой комнате какое назначение, с учётом пожеланий («двое
// взрослых и ребёнок, нужен кабинет»).
import { askJson, aiConfig, clientIp, fail, json, rateLimit, readJsonBody } from './_lib'
import { checkAiLayout, checkAiZones, ROOM_PURPOSES } from '../src/planner/aicontract'

export const config = { runtime: 'edge' }

export interface LayoutRequest {
  /** контур комнаты по внутренним граням стен, см; начало — угол комнаты */
  polygon: { x: number; y: number }[]
  /** проёмы: где нельзя ставить и куда смотрит вход */
  openings: { kind: string; x: number; y: number; width: number }[]
  room: string
  areaM2: number
  /** какие типы можно ставить: ключ, название и габариты */
  catalog: { type: string; name: string; w: number; d: number }[]
  style?: string
  /** назначение комнаты: детская, кабинет… — по нему и обставлять */
  purpose?: string
  /** пожелания жильцов своими словами */
  wishes?: string
  /** остальные комнаты квартиры: чтобы не ставить обеденный стол в каждую */
  apartment?: { room: string; purpose?: string; areaM2: number }[]
  /** что уже стоит в комнате: не двигать, не ставить поверх, не дублировать */
  existing?: { type: string; name: string; x: number; y: number; w: number; d: number; rot: number }[]
  /** ширина и глубина комнаты по чистовым граням, см */
  size?: [number, number]
}

export interface ZonesRequest {
  zones: true
  wishes?: string
  rooms: { id: string; name: string; areaM2: number; size: [number, number]; windows: number; doors: number }[]
}

const PROMPT_ZONES = `Ты архитектор-планировщик. Тебе дают комнаты квартиры (id, текущее имя, площадь, габариты в см, число окон и дверей) и пожелания жильцов. Назначь каждой комнате назначение.

Верни ТОЛЬКО JSON: {"rooms":[{"id":"r1","purpose":"Спальня","why":"коротко: почему так"}]}

Правила:
- purpose — одно из: ${ROOM_PURPOSES.join(', ')}.
- Кухню, санузел, ванную, туалет, прихожую, коридор, балкон и лоджию не переназначай: там разводка и нормы — оставь их назначение.
- Спальни и детские — в тихих комнатах, не проходных и подальше от входа; гостиная — самая большая или проходная жилая комната.
- Детская — с окном и не меньше 8 м²; кабинет может быть и в маленькой комнате 6–9 м².
- Жилых комнат меньше, чем нужно по пожеланиям, — совмещай (Спальня-кабинет, гостиная с диваном для гостей) и скажи об этом в why.
- Пожелания пишет хозяин квартиры: следуй им, если они не противоречат правилам выше.
- Ответь про каждую комнату из списка, id — как в запросе.`

const PROMPT = `Ты расставляешь мебель как практикующий дизайнер интерьера. Координаты — сантиметры. Контур — чистовые (внутренние) грани стен, начало координат (0,0) — левый верхний угол комнаты, x вправо, y вниз; size — ширина и глубина комнаты по этим граням.

Как читать и давать место предмета:
- x, y — ЦЕНТР предмета, не угол.
- rot — куда смотрит спинка (изголовье): 0 — спинкой к верхней стене (к y = 0), лицом вниз; 90 — спинкой к правой стене; 180 — к нижней; 270 — к левой. Только 0, 90, 180 или 270.
- Предмет шириной w и глубиной d при rot 0 и 180 занимает w по x и d по y, при rot 90 и 270 — d по x и w по y.
- Прижать спинкой к стене комнаты W×H: к верхней — rot 0, y = d/2; к нижней — rot 180, y = H − d/2; к левой — rot 270, x = d/2; к правой — rot 90, x = W − d/2.
- Пример: кровать 160×210 изголовьем к верхней стене, посередине комнаты шириной 340 — {"x":170,"y":105,"rot":0}.

Верни ТОЛЬКО JSON: {"items":[{"type":"ключ из каталога","x":320,"y":180,"rot":90,"why":"зачем именно тут"}]}

Во входных данных, кроме контура, проёмов и каталога, могут быть:
- purpose — назначение комнаты: обставляй под него (детская — кровать по возрасту, стол для занятий, хранение игрушек; кабинет — стол, кресло, стеллаж; гостевая — диван-кровать или кровать и шкаф);
- wishes — пожелания хозяина своими словами: следуй им, если они не противоречат правилам ремесла ниже — проходы, двери и окна важнее;
- apartment — остальные комнаты квартиры с назначением: не дублируй то, что логично в другой комнате (обеденный стол — один на квартиру, если не просили иначе);
- existing — предметы, что уже стоят в комнате: их не двигай, не ставь ничего поверх и не дублируй без причины.

Правила ремесла:
- Проходы: основной маршрут 90–120 см, между кроватью и стеной 70 см, перед шкафом 90 см, перед комодом 75 см, вокруг обеденного стола 90 см.
- Сначала реши, где главный предмет (кровать, диван, стол), потом шкаф, потом остальное.
- Двуспальная кровать — изголовьем к глухой стене, по центру этой стены или так, чтобы с каждой стороны осталось не меньше 60–70 см; не под окном и не напротив двери в упор; по обе стороны изголовья — прикроватные тумбы, если они есть в каталоге.
- Туалетный столик и письменный стол — у окна боком к нему, чтобы свет падал сбоку; зеркалом и спинкой к окну не ставь.
- Диван спинкой к стене или к чёткой границе зоны; телевизор напротив дивана на 2–3 м, не напротив окна.
- Обеденный стол ближе к кухне и к окну; стулья задвигаются и не мешают проходу.
- Кухонный треугольник: мойка, плита, холодильник рядом, но плита не вплотную к холодильнику и не у самого окна.
- Шкафы и стеллажи у глухих стен подальше от окна, не перекрывают окна и не мешают открыванию дверей; перед распашным шкафом 90 см свободно.
- От двери к кровати, шкафу и окну — свободный проход не уже 70 см.
- Ничего не ставь в створ двери и на её дугу открывания.
- Предмет целиком внутри контура комнаты, прижат к стене там, где это логично: край предмета на линии контура, не за ней — контур уже и есть поверхность стены.
- Ставь только то, что уместно в этой комнате, и не больше, чем помещается свободно. Пустое место лучше тесноты.
- Используй только ключи type из присланного каталога.`

/** строка от пользователя: без управляющих символов и не длиннее limit */
const clean = (v: unknown, limit: number): string =>
  typeof v === 'string'
    ? v
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, limit)
    : ''

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return fail('нужен POST', 405)
  const cfg = aiConfig()
  if (!cfg) return fail('ИИ не подключён: на сервере нет ключа ROUTERAI_API_KEY', 503)
  // вся квартира — это зонирование и по вопросу на комнату: запас на два-три прогона
  if (!rateLimit(clientIp(req), { limit: 40, windowMs: 10 * 60_000, bucket: 'layout' })) return fail('слишком часто, подождите', 429)

  let body: LayoutRequest & Partial<ZonesRequest>
  try {
    body = await readJsonBody<LayoutRequest & Partial<ZonesRequest>>(req, 200_000)
  } catch (e) {
    return fail((e as Error).message, 413)
  }

  if (body.zones) {
    if (!Array.isArray(body.rooms) || !body.rooms.length) return fail('нужен список комнат', 400)
    const rooms = body.rooms.slice(0, 30).map((r) => ({
      id: clean(r.id, 20),
      name: clean(r.name, 40),
      area_m2: Math.round(Number(r.areaM2) * 10) / 10 || 0,
      size_cm: Array.isArray(r.size) ? r.size.slice(0, 2).map((x) => Math.round(Number(x)) || 0) : [],
      windows: Math.max(0, Math.round(Number(r.windows)) || 0),
      doors: Math.max(0, Math.round(Number(r.doors)) || 0),
    }))
    const ids = rooms.map((r) => r.id)
    try {
      const answer = await askJson(cfg, {
        task: 'layout',
        check: (d) => checkAiZones(d, ids),
        messages: [
          { role: 'system', content: PROMPT_ZONES },
          { role: 'user', content: JSON.stringify({ wishes: clean(body.wishes, 1000), rooms }) },
        ],
      })
      return json({ rooms: answer.value, ai: { model: answer.model, costRub: answer.costRub, tried: answer.tried } })
    } catch (e) {
      return fail((e as Error).message, 502)
    }
  }

  if (!Array.isArray(body.polygon) || body.polygon.length < 3) return fail('нужен контур комнаты', 400)
  if (!Array.isArray(body.catalog) || !body.catalog.length) return fail('нужен список доступной мебели', 400)

  const task = {
    room: clean(body.room, 40) || 'комната',
    purpose: clean(body.purpose, 40) || undefined,
    area_m2: body.areaM2,
    style: clean(body.style, 60) || 'спокойный современный',
    wishes: clean(body.wishes, 1000) || undefined,
    size: Array.isArray(body.size) ? body.size.slice(0, 2).map((x) => Math.round(Number(x)) || 0) : undefined,
    polygon: body.polygon.slice(0, 40).map((p) => [Math.round(p.x), Math.round(p.y)]),
    openings: (body.openings || []).slice(0, 40).map((o) => ({ kind: o.kind, x: Math.round(o.x), y: Math.round(o.y), width: Math.round(o.width) })),
    catalog: body.catalog.slice(0, 80).map((c) => ({ type: c.type, name: c.name, w: c.w, d: c.d })),
    apartment: Array.isArray(body.apartment) ? body.apartment.slice(0, 30).map((r) => ({ room: clean(r.room, 40), purpose: clean(r.purpose, 40) || undefined, area_m2: Math.round(Number(r.areaM2) * 10) / 10 || 0 })) : undefined,
    existing: Array.isArray(body.existing)
      ? body.existing.slice(0, 40).map((f) => ({ type: clean(f.type, 40), name: clean(f.name, 60), x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.w), d: Math.round(f.d), rot: Math.round(f.rot) }))
      : undefined,
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
