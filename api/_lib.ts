import { extractJson } from '../src/planner/aicontract'

// Общее для серверных функций: маршрутизация задач по моделям, вызов ИИ-роутера,
// защита ключа, лимиты и разбор ответа.
//
// Ключ живёт только здесь. В браузер он не уходит ни при каких условиях.
//
// Деньги. Правило простое: сначала бесплатная локальная эвристика, и только если
// она не справилась — модель, причём самая дешёвая из подходящих под задачу.
// Дорогая модель вызывается лишь тогда, когда дешёвая вернула мусор.

/** роутер совместим с OpenAI API: POST {base}/chat/completions */
const DEFAULT_BASE = 'https://routerai.ru/api/v1'

/** что мы просим у модели */
export type AiTask = 'plan' | 'product' | 'layout' | 'layout_pro' | 'classify' | 'critique'

export interface TaskSpec {
  /** нужна ли модель, читающая картинки */
  vision: boolean
  /** потолок ответа в токенах: держит цену предсказуемой */
  maxTokens: number
  /** сколько ждать ответа */
  timeoutMs: number
  /** цепочка моделей от дешёвой к дорогой: следующая берётся, только если предыдущая не справилась */
  chain: string[]
  /** человеческое описание для страницы состояния */
  about: string
  /**
   * Сколько думать рассуждающей модели. Без ограничения gpt-5 и Claude тратят
   * на рассуждения весь запас токенов и возвращают пустой ответ — у человека это
   * выглядело как «ответила не по формату». Нет — модель решает сама
   */
  reasoning?: 'low' | 'medium' | 'high'
  /**
   * Страховка от медленной модели: если она молчит дольше, параллельно
   * спрашиваем следующую и берём первый годный ответ. Нет — строго по очереди
   */
  hedgeMs?: number
}

// Умолчания подобраны по реальному прайсу роутера (₽ за 1 млн токенов, вход/выход)
// и по принципу «дешёвая модель на простую задачу».
// Любую цепочку можно переопределить переменной окружения AI_MODEL_<ЗАДАЧА>,
// перечислив модели через запятую. Актуальные цены — `npm run models`.
const TASKS: Record<AiTask, TaskSpec> = {
  // Чтение плана БТИ с картинки — единственная по-настоящему сложная задача.
  // 10,9/43,8 → 21,9/96,3 → 218,9/1094,6. Вторая в цепочке заточена под OCR
  // и разбор документов, третья включается, только если и она не справилась.
  plan: {
    vision: true,
    maxTokens: 8000,
    timeoutMs: 120_000,
    chain: ['google/gemini-2.5-flash-lite', 'qwen/qwen3-vl-235b-a22b-instruct', 'anthropic/claude-sonnet-5'],
    about: 'Читает план с картинки: стены, двери, окна, подписи комнат и размеры',
  },
  // Вытащить название, цену и габариты из текста страницы. 4,5/9,0 → 5,5/43,8 → 10,9/43,8.
  product: {
    vision: false,
    maxTokens: 700,
    timeoutMs: 45_000,
    chain: ['deepseek/deepseek-v4-flash', 'openai/gpt-5-nano', 'google/gemini-2.5-flash-lite'],
    about: 'Достаёт из страницы магазина название, цену и габариты',
  },
  // Расстановка мебели. Первая — Gemini Flash: самая быстрая из сильных
  // (около 300 токенов в секунду) и в пространственных задачах почти как
  // дорогие модели, при цене $0,75/$3,75 за миллион. Вторая — DeepSeek другого
  // поставщика: если у Google сбой, ответит она. «Быстро» — та же модель,
  // но думает меньше; «Тщательно» — думает дольше, а в запасе Claude Sonnet.
  // Место под ответ с запасом: рассуждения считаются в тот же лимит.
  layout: {
    vision: false,
    maxTokens: 12_000,
    timeoutMs: 60_000,
    chain: ['google/gemini-3.8-flash', 'deepseek/deepseek-v4-flash', 'openai/gpt-5-mini'],
    about: 'Быстро расставляет мебель в комнате по правилам эргономики',
    reasoning: 'low',
    hedgeMs: 25_000,
  },
  // около 1–2 ₽ за комнату у первой; Sonnet (218,9/1094,6) — только если обе до неё не справились
  layout_pro: {
    vision: false,
    maxTokens: 20_000,
    timeoutMs: 120_000,
    chain: ['google/gemini-3.8-flash', 'deepseek/deepseek-v4-flash', 'anthropic/claude-sonnet-5'],
    about: 'Тщательно расставляет мебель: модель продумывает зоны, проходы и свет',
    reasoning: 'medium',
    hedgeMs: 45_000,
  },
  // Отнести товар к типу каталога — самая дешёвая модель из возможных. 2,2/4,4 → 5,5/8,8.
  classify: {
    vision: false,
    maxTokens: 120,
    timeoutMs: 30_000,
    chain: ['meta-llama/llama-3.1-8b-instruct', 'mistralai/mistral-small-24b-instruct-2501'],
    about: 'Подбирает предмету тип из каталога',
  },
  // Замечания дизайнера по готовой расстановке. 9,0/30,1 → 27,4/218,9.
  critique: {
    vision: false,
    maxTokens: 1500,
    timeoutMs: 60_000,
    chain: ['z-ai/glm-5.3-flash', 'openai/gpt-5-mini'],
    about: 'Разбирает готовую расстановку и предлагает улучшения',
  },
}

export const TASK_NAMES = Object.keys(TASKS) as AiTask[]

export interface AiConfig {
  base: string
  key: string
  /** дневной потолок расходов, ₽; 0 — без ограничения */
  dailyLimitRub: number
}

/** настройки из окружения; без ключа ИИ выключен и приложение работает как раньше */
export function aiConfig(): AiConfig | null {
  const key = process.env.ROUTERAI_API_KEY || process.env.AI_API_KEY || ''
  if (!key) return null
  return {
    key,
    base: (process.env.ROUTERAI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, ''),
    dailyLimitRub: Number(process.env.AI_DAILY_LIMIT_RUB || 0) || 0,
  }
}

/** цепочка моделей для задачи с учётом переменных окружения */
export function chainFor(task: AiTask): string[] {
  const raw = process.env[`AI_MODEL_${task.toUpperCase()}`]
  const custom = (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return custom.length ? custom : TASKS[task].chain
}

export const specFor = (task: AiTask): TaskSpec => TASKS[task]

export const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

export const fail = (message: string, status = 400): Response => json({ error: message }, status)

// ---------- ограничение частоты ----------
// Память живёт в пределах одного экземпляра функции, поэтому защита грубая:
// от случайного перебора спасает, от распределённой нагрузки — нет.
const hits = new Map<string, number[]>()

export interface LimitOptions {
  limit: number
  windowMs: number
  /** назначение вызова: у каждого свой счётчик, чтобы задачи не мешали друг другу */
  bucket?: string
}

/**
 * Счётчик ведётся по паре «адрес и назначение»: чтение плана по фрагментам
 * делает десяток мелких вызовов, и они не должны съедать квоту расстановки
 * мебели или чтения товара — у каждой задачи свой запас.
 */
export function rateLimit(ip: string, o: LimitOptions, now = Date.now()): boolean {
  const key = o.bucket ? `${ip}|${o.bucket}` : ip
  const from = now - o.windowMs
  const list = (hits.get(key) || []).filter((t) => t > from)
  if (list.length >= o.limit) {
    hits.set(key, list)
    return false
  }
  list.push(now)
  hits.set(key, list)
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => t > from)) hits.delete(k)
  return true
}

export const clientIp = (req: Request): string =>
  (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown'

// ---------- учёт расходов ----------
// Роутер возвращает стоимость запроса в рублях; складываем её за сутки,
// чтобы можно было поставить потолок и не проснуться с пустым балансом.
const spent = { day: '', rub: 0, calls: 0 }

export function spentToday(now = new Date()): { day: string; rub: number; calls: number } {
  const day = now.toISOString().slice(0, 10)
  if (spent.day !== day) {
    spent.day = day
    spent.rub = 0
    spent.calls = 0
  }
  return spent
}

export function addSpent(rub: number, now = new Date()): void {
  const s = spentToday(now)
  s.rub += rub
  s.calls += 1
}

// ---------- вызов модели ----------
export type AiPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

export interface AiMessage {
  role: 'system' | 'user'
  content: string | AiPart[]
}

export interface AskOptions<T> {
  task: AiTask
  messages: AiMessage[]
  /** проверка ответа: вернуть разобранное значение или бросить ошибку — тогда берётся следующая модель */
  check: (data: unknown) => T
  /** сколько моделей из цепочки пробовать; по умолчанию вся цепочка */
  maxTries?: number
  /** с какой модели цепочки начать: 1 — пропустить самую дешёвую (вторая попытка после слабого ответа) */
  startAt?: number
}

/** цепочка, начиная с startAt-й модели; за концом цепочки остаётся последняя, самая сильная */
export function chainFrom(task: AiTask, startAt: number): string[] {
  const chain = chainFor(task)
  const from = Math.max(0, Math.min(Math.floor(startAt), chain.length - 1))
  return chain.slice(from)
}

export interface AiAnswer<T> {
  value: T
  model: string
  costRub: number
  /** какие модели не справились до удачной */
  tried: string[]
}

/**
 * Спросить модель и получить проверенный ответ.
 * Цепочка идёт от дешёвой модели к дорогой: следующая берётся, только если
 * предыдущая упала или вернула то, что не прошло проверку.
 */
// ---------- какие модели есть у роутера ----------
// Имя модели в цепочке может не совпасть с тем, что знает роутер (переименовали,
// убрали, у другого шлюза свои имена). Тогда запрос уходит в пустоту, а человек
// видит «ничего не встало». Список моделей спрашиваем раз в полчаса и цепочку
// сверяем с ним: чего нет — заменяем ближайшей из того же семейства или пропускаем.

let modelCache: { base: string; at: number; ids: Set<string> } | null = null
const MODEL_TTL = 30 * 60_000

/** для проверок: забыть список моделей */
export function resetModelCache(): void {
  modelCache = null
}

/** модели роутера; null — список не получили, тогда цепочку не трогаем */
export async function availableModels(cfg: AiConfig): Promise<Set<string> | null> {
  if (modelCache && modelCache.base === cfg.base && Date.now() - modelCache.at < MODEL_TTL) return modelCache.ids
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10_000)
    const res = await fetch(`${cfg.base}/models`, { headers: { authorization: `Bearer ${cfg.key}` }, signal: ctrl.signal }).finally(() => clearTimeout(timer))
    if (!res.ok) return null
    const data = (await res.json()) as { data?: { id?: unknown }[] }
    const ids = new Set((data.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string'))
    if (!ids.size) return null
    modelCache = { base: cfg.base, at: Date.now(), ids }
    return ids
  } catch {
    return null
  }
}

/** семейство модели: чем заменить, если именно этой у роутера нет */
export function familyOf(model: string): RegExp | null {
  const m = /^([^/]+)\/(claude-(?:sonnet|opus|haiku)|gpt-5(?:\.\d+)?-(?:mini|nano)|gpt-5(?:\.\d+)?|gemini-[\d.]+-flash-lite|gemini-[\d.]+-flash|gemini-[\d.]+-pro|deepseek-v[\d.]+-flash|glm-[\d.]+-flash|qwen\d*-vl)/.exec(model)
  if (!m) return null
  const head = m[2].replace(/[\d.]+/g, '[\\d.]+')
  // после имени — только номер версии, «-preview» и дата: gemini-3.8-flash не
  // подменяется на gemini-3.8-flash-lite или -image, gpt-5 — на gpt-5-mini
  // у qwen в имени ещё и размер: qwen3-vl-235b-a22b-instruct — там хватает начала
  if (m[2].startsWith('qwen')) return new RegExp(`^${m[1]}/${head}`)
  return new RegExp(`^${m[1]}/${head}(?:[-.]?[\\d.]+)*(?:-preview|-latest|-exp)?(?:-[\\d-]{4,})?$`)
}

/** версия модели для сравнения «новее»: claude-sonnet-5 новее 4.5, gemini-3.10 новее 3.9; даты не в счёт */
function versionOf(id: string): number[] {
  return (id.replace(/-\d{4}-\d{2}-\d{2}$|-\d{8}$|-\d{2}-\d{4}$/, '').match(/\d+/g) ?? []).map(Number)
}

function newer(a: string, b: string): number {
  const va = versionOf(a)
  const vb = versionOf(b)
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (va[i] ?? -1) - (vb[i] ?? -1)
    if (d) return d
  }
  // при равной версии — выпуск, а не предварительная
  return (/preview|exp/.test(b) ? 1 : 0) - (/preview|exp/.test(a) ? 1 : 0)
}

/** цепочка задачи, сверенная с роутером */
export async function resolveChain(cfg: AiConfig, task: AiTask): Promise<string[]> {
  const chain = chainFor(task)
  const ids = await availableModels(cfg)
  if (!ids) return chain
  const out: string[] = []
  for (const model of chain) {
    if (ids.has(model)) {
      if (!out.includes(model)) out.push(model)
      continue
    }
    const fam = familyOf(model)
    const alt = fam ? [...ids].filter((id) => fam.test(id) && !out.includes(id)).sort(newer).pop() : undefined
    if (alt) out.push(alt)
  }
  return out.length ? out : chain
}

export async function askJson<T>(cfg: AiConfig, o: AskOptions<T>): Promise<AiAnswer<T>> {
  const spec = specFor(o.task)
  const chain = (await resolveChain(cfg, o.task)).slice(o.startAt ?? 0).slice(0, o.maxTries ?? 99)
  if (!chain.length) throw new Error(`для задачи «${o.task}» не задано ни одной модели`)
  const budget = spentToday()
  if (cfg.dailyLimitRub > 0 && budget.rub >= cfg.dailyLimitRub) {
    throw new Error(`дневной лимит расходов исчерпан (${budget.rub.toFixed(2)} ₽)`)
  }
  /** одна модель: ответ, разбор и проверка; любая беда — исключение с понятной причиной */
  const attempt = async (model: string, signal: AbortSignal): Promise<{ value: T; costRub: number }> => {
    const reply = await callModel(cfg, model, spec, o.messages, signal)
    addSpent(reply.costRub)
    let data: unknown
    try {
      data = extractJson(reply.text)
    } catch {
      throw new Error(reply.cut ? `ответ оборвался: не хватило ${spec.maxTokens} токенов` : 'ответила текстом, а не JSON', { cause: reply.text })
    }
    try {
      return { value: o.check(data), costRub: reply.costRub }
    } catch (e) {
      // из оборванного ответа не набралось годного — причина в обрыве, а не в формате
      const msg = reply.cut ? `ответ оборвался: не хватило ${spec.maxTokens} токенов` : e instanceof Error ? e.message : String(e)
      throw new Error(msg, { cause: reply.text })
    }
  }

  // По очереди, но с подстраховкой: если модель молчит дольше hedgeMs,
  // параллельно спрашиваем следующую — берётся первый годный ответ.
  // Одновременно думают не больше двух: платить за всю цепочку разом незачем
  return new Promise<AiAnswer<T>>((resolve, reject) => {
    const tried: string[] = []
    const running = new Map<string, { ctrl: AbortController; hedge?: ReturnType<typeof setTimeout> }>()
    let next = 0
    let finished = false
    const stopAll = () => {
      for (const r of running.values()) {
        clearTimeout(r.hedge)
        r.ctrl.abort()
      }
      running.clear()
    }
    const launch = () => {
      if (finished || next >= chain.length || running.size >= 2) return
      const model = chain[next++]
      const ctrl = new AbortController()
      const slot: { ctrl: AbortController; hedge?: ReturnType<typeof setTimeout> } = { ctrl }
      if (spec.hedgeMs && next < chain.length) slot.hedge = setTimeout(launch, spec.hedgeMs)
      running.set(model, slot)
      attempt(model, ctrl.signal).then(
        ({ value, costRub }) => {
          if (finished) return
          finished = true
          running.delete(model)
          stopAll()
          resolve({ value, model, costRub, tried })
        },
        (e: unknown) => {
          clearTimeout(slot.hedge)
          running.delete(model)
          if (finished) return
          const msg = e instanceof Error ? e.message : String(e)
          tried.push(`${model}: ${msg}`)
          // в консоль сервера — с началом ответа: по нему видно, что модель прислала на самом деле
          const sample = e instanceof Error && typeof e.cause === 'string' ? ` — «${e.cause.replace(/\s+/g, ' ').slice(0, 160)}»` : ''
          console.warn(`[ИИ] ${o.task}: ${model} не справилась: ${msg}${sample}`)
          if (next < chain.length) launch()
          else if (!running.size) {
            finished = true
            reject(new Error(`ни одна модель не справилась. ${tried.join('; ')}`))
          }
        },
      )
    }
    launch()
  })
}

interface ModelReply {
  text: string
  costRub: number
  /** модель упёрлась в лимит токенов: ответ может быть оборван */
  cut: boolean
}

/**
 * Сколько думать — только тем, кто думает и без просьбы (gpt-5, Gemini 3) или
 * думает лучше всех (Claude). DeepSeek и прочим рассуждения не включаем:
 * запасная модель должна отвечать быстро, как отвечала раньше
 */
const reasoningFor = (model: string, spec: TaskSpec) =>
  spec.reasoning && /^(openai\/(gpt-5|o\d)|google\/gemini-(?:[3-9]|\d{2})|anthropic\/)/.test(model) ? spec.reasoning : undefined

/** рассуждающим моделям нужна температура по умолчанию: gpt-5 иначе отказывает, Gemini 3 зацикливается, Claude с рассуждением не принимает */
const defaultTemperature = (model: string, spec: TaskSpec) =>
  /^openai\/(gpt-5|o\d)/.test(model) || /^google\/gemini-(?:[3-9]|\d{2})/.test(model) || !!reasoningFor(model, spec)

async function callModel(cfg: AiConfig, model: string, spec: TaskSpec, messages: AiMessage[], outer?: AbortSignal): Promise<ModelReply> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), spec.timeoutMs)
  const onOuter = () => ctrl.abort()
  outer?.addEventListener('abort', onOuter)
  const effort = reasoningFor(model, spec)
  const send = (withReasoning: boolean) =>
    fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: spec.maxTokens,
        ...(defaultTemperature(model, spec) ? {} : { temperature: 0 }),
        // рассуждения — сколько задано, и без их текста в ответе: нам нужен только JSON
        ...(withReasoning && effort ? { reasoning: { effort, exclude: true } } : {}),
        response_format: { type: 'json_object' },
      }),
    })
  try {
    let res = await send(true)
    // шлюз не знает про настройку рассуждений — спрашиваем ту же модель без неё
    if (res.status === 400 && effort) res = await send(false)
    if (!res.ok) {
      // текст ошибки роутера наружу не отдаём: в нём может оказаться ключ
      throw new Error(res.status === 404 ? 'нет у роутера (404)' : res.status === 429 ? 'роутер просит подождать (429)' : `роутер отказал (${res.status})`)
    }
    const payload = (await res.json()) as {
      choices?: { message?: { content?: unknown; refusal?: unknown; reasoning?: unknown }; finish_reason?: string }[]
      error?: { code?: unknown }
      cost_rub?: number
      usage?: { cost_rub?: number; total_cost?: number }
    }
    // шлюз может вернуть ошибку поставщика с кодом 200
    if (payload.error && !payload.choices?.length) throw new Error(`сбой у поставщика${payload.error.code ? ` (${String(payload.error.code).slice(0, 20)})` : ''}`)
    const choice = payload.choices?.[0]
    const content = choice?.message?.content
    // текст может прийти строкой или списком частей, как у Claude через некоторые шлюзы
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((p) => (typeof p === 'string' ? p : p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : '')).join('')
          : ''
    const cut = choice?.finish_reason === 'length'
    const costRub = Number(payload.cost_rub ?? payload.usage?.cost_rub ?? payload.usage?.total_cost ?? 0) || 0
    if (!text.trim()) {
      addSpent(costRub)
      if (cut) throw new Error(`всё ушло в рассуждения: не хватило ${spec.maxTokens} токенов на ответ`)
      if (typeof choice?.message?.refusal === 'string' && choice.message.refusal) throw new Error('отказалась отвечать')
      throw new Error('пустой ответ')
    }
    return { text, costRub, cut }
  } catch (e) {
    // обрыв по нашему таймеру — не «отменено», а «не уложилась»; по чужому — другая модель уже ответила
    if (ctrl.signal.aborted && !outer?.aborted) throw new Error(`не ответила за ${Math.round(spec.timeoutMs / 1000)} с`)
    throw e
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onOuter)
  }
}

/** тело запроса с ограничением размера */
export async function readJsonBody<T>(req: Request, maxBytes: number): Promise<T> {
  const len = Number(req.headers.get('content-length') || 0)
  if (len > maxBytes) throw new Error(`запрос больше ${Math.round(maxBytes / 1024 / 1024)} МБ`)
  const text = await req.text()
  if (text.length > maxBytes) throw new Error(`запрос больше ${Math.round(maxBytes / 1024 / 1024)} МБ`)
  return JSON.parse(text) as T
}
