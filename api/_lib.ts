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
  // Расстановка мебели требует рассуждения, но текста мало. 4,5/9,0 → 9,0/30,1 → 27,4/218,9.
  layout: {
    vision: false,
    maxTokens: 4000,
    timeoutMs: 90_000,
    chain: ['deepseek/deepseek-v4-flash', 'z-ai/glm-5.3-flash', 'openai/gpt-5-mini'],
    about: 'Расставляет мебель в комнате по правилам эргономики',
  },
  // Тщательная расстановка: сильная модель продумывает зоны, проходы и свет.
  // 218,9/1094,6 → 27,4/218,9 → 4,5/9,0: около 3–4 ₽ за комнату у первой
  layout_pro: {
    vision: false,
    maxTokens: 6000,
    timeoutMs: 150_000,
    chain: ['anthropic/claude-sonnet-5', 'openai/gpt-5-mini', 'deepseek/deepseek-v4-flash'],
    about: 'Тщательно расставляет мебель: сильная модель продумывает зоны, проходы и свет',
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
export async function askJson<T>(cfg: AiConfig, o: AskOptions<T>): Promise<AiAnswer<T>> {
  const spec = specFor(o.task)
  const chain = chainFrom(o.task, o.startAt ?? 0).slice(0, o.maxTries ?? 99)
  if (!chain.length) throw new Error(`для задачи «${o.task}» не задано ни одной модели`)
  const budget = spentToday()
  if (cfg.dailyLimitRub > 0 && budget.rub >= cfg.dailyLimitRub) {
    throw new Error(`дневной лимит расходов исчерпан (${budget.rub.toFixed(2)} ₽)`)
  }
  const tried: string[] = []
  let last = ''
  for (const model of chain) {
    try {
      const { text, costRub } = await callModel(cfg, model, spec, o.messages)
      addSpent(costRub)
      const value = o.check(extractJson(text))
      return { value, model, costRub, tried }
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
      tried.push(`${model}: ${last}`)
    }
  }
  throw new Error(`ни одна модель не справилась. ${tried.join('; ')}`)
}

interface ModelReply {
  text: string
  costRub: number
}

async function callModel(cfg: AiConfig, model: string, spec: TaskSpec, messages: AiMessage[]): Promise<ModelReply> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), spec.timeoutMs)
  try {
    const res = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: spec.maxTokens,
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    })
    if (!res.ok) {
      // текст ошибки роутера наружу не отдаём: в нём может оказаться ключ
      throw new Error(`ответ ${res.status}`)
    }
    const payload = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      cost_rub?: number
      usage?: { cost_rub?: number; total_cost?: number }
    }
    const text = payload.choices?.[0]?.message?.content
    if (!text) throw new Error('пустой ответ')
    const costRub = Number(payload.cost_rub ?? payload.usage?.cost_rub ?? payload.usage?.total_cost ?? 0) || 0
    return { text, costRub }
  } finally {
    clearTimeout(timer)
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
