import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addSpent, askJson, chainFor, chainFrom, familyOf, rateLimit, resetModelCache, resolveChain, spentToday, type AiConfig } from '../api/_lib'

const cfg: AiConfig = { base: 'https://router.test/v1', key: 'sk-secret-do-not-leak', dailyLimitRub: 0 }

/** ответ роутера в формате OpenAI */
const reply = (content: string, costRub = 0.05): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], cost_rub: costRub }), { status: 200 })

describe('цепочка моделей', () => {
  const calls: { model: string; auth: string }[] = []

  beforeEach(() => {
    // цепочка для проверок: дешёвая модель, за ней та, что посильнее
    process.env.AI_MODEL_PRODUCT = 'a/cheap,b/better'
    calls.length = 0
    spentToday().rub = 0
    spentToday().calls = 0
  })
  afterEach(() => {
    delete process.env.AI_MODEL_PRODUCT
    vi.unstubAllGlobals()
  })

  /** подменяем сеть: каждая модель отвечает по сценарию */
  function stub(script: Record<string, () => Response | Promise<Response>>) {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { model: string }
      calls.push({ model: body.model, auth: String((init.headers as Record<string, string>).authorization) })
      const step = script[body.model]
      if (!step) throw new Error(`нет сценария для ${body.model}`)
      return step()
    })
  }

  it('останавливается на первой модели, если она справилась', async () => {
    stub({ 'a/cheap': () => reply('{"ok":true}') })
    const r = await askJson<{ ok: boolean }>({ ...cfg }, {
      task: 'product',
      messages: [{ role: 'user', content: 'x' }],
      check: (d) => d as { ok: boolean },
    })
    expect(r.value.ok).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('переходит к следующей модели, когда дешёвая вернула не JSON', async () => {
    stub({
      'a/cheap': () => reply('Извините, я не смог.'),
      'b/better': () => reply('{"ok":true}'),
    })
    const r = await askJson({ ...cfg }, {
      task: 'product',
      messages: [{ role: 'user', content: 'x' }],
      check: (d) => d,
    })
    expect(calls.map((c) => c.model)).toEqual(['a/cheap', 'b/better'])
    expect(r.model).toBe('b/better')
    expect(r.tried[0]).toMatch(/a\/cheap/)
  })

  it('переходит к следующей и когда ответ не прошёл проверку', async () => {
    stub({
      'a/cheap': () => reply('{"walls":[]}'),
      'b/better': () => reply('{"walls":[1]}'),
    })
    const r = await askJson({ ...cfg }, {
      task: 'product',
      messages: [{ role: 'user', content: 'x' }],
      check: (d) => {
        const w = (d as { walls: unknown[] }).walls
        if (!w.length) throw new Error('пусто')
        return w
      },
    })
    expect(r.model).toBe('b/better')
  })

  it('переживает ошибку сети на первой модели', async () => {
    stub({
      'a/cheap': () => new Response('упс', { status: 500 }),
      'b/better': () => reply('{"ok":1}'),
    })
    const r = await askJson({ ...cfg }, { task: 'product', messages: [{ role: 'user', content: 'x' }], check: (d) => d })
    expect(r.model).toBe('b/better')
    expect(r.tried[0]).toMatch(/500/)
  })

  it('если не справился никто — говорит, кто и почему', async () => {
    stub({ 'a/cheap': () => reply('мусор'), 'b/better': () => reply('тоже мусор') })
    await expect(
      askJson({ ...cfg }, { task: 'product', messages: [{ role: 'user', content: 'x' }], check: (d) => d }),
    ).rejects.toThrow(/ни одна модель не справилась.*a\/cheap.*b\/better/s)
  })

  it('ключ уходит только в заголовок роутера', async () => {
    stub({ 'a/cheap': () => reply('{"ok":1}') })
    const r = await askJson({ ...cfg }, { task: 'product', messages: [{ role: 'user', content: 'x' }], check: (d) => d })
    expect(calls[0].auth).toBe('Bearer sk-secret-do-not-leak')
    // наружу отдаётся только имя модели и цена
    expect(JSON.stringify(r)).not.toContain('sk-secret')
  })

  it('считает расходы и держит дневной потолок', async () => {
    stub({ 'a/cheap': () => reply('{"ok":1}', 0.4) })
    const limited = { ...cfg, dailyLimitRub: 1 }
    const ask = () => askJson(limited, { task: 'product', messages: [{ role: 'user', content: 'x' }], check: (d) => d })
    await ask()
    await ask()
    expect(spentToday().rub).toBeCloseTo(0.8, 5)
    await ask()
    expect(spentToday().rub).toBeCloseTo(1.2, 5)
    await expect(ask()).rejects.toThrow(/лимит расходов исчерпан/)
  })

  it('счётчик расходов обнуляется на новые сутки', () => {
    addSpent(5, new Date('2026-09-20T10:00:00Z'))
    expect(spentToday(new Date('2026-09-20T23:00:00Z')).rub).toBe(5)
    expect(spentToday(new Date('2026-09-21T00:01:00Z')).rub).toBe(0)
  })
})

describe('цепочка задаётся окружением', () => {
  afterEach(() => {
    delete process.env.AI_MODEL_PLAN
  })

  it('без переменной берётся умолчание', () => {
    expect(chainFor('plan').length).toBeGreaterThan(0)
  })

  it('переменная перечисляет модели через запятую', () => {
    process.env.AI_MODEL_PLAN = ' свой/дешёвый , свой/сильный '
    expect(chainFor('plan')).toEqual(['свой/дешёвый', 'свой/сильный'])
  })
})

describe('ограничение частоты', () => {
  it('пропускает до лимита и отсекает дальше', () => {
    const now = Date.now()
    const opt = { limit: 3, windowMs: 60_000 }
    expect([0, 1, 2].map((i) => rateLimit('1.2.3.4', opt, now + i))).toEqual([true, true, true])
    expect(rateLimit('1.2.3.4', opt, now + 3)).toBe(false)
  })

  it('через окно снова пускает', () => {
    const now = Date.now()
    const opt = { limit: 1, windowMs: 1000 }
    expect(rateLimit('5.6.7.8', opt, now)).toBe(true)
    expect(rateLimit('5.6.7.8', opt, now + 500)).toBe(false)
    expect(rateLimit('5.6.7.8', opt, now + 1500)).toBe(true)
  })

  it('соседей не задевает', () => {
    const now = Date.now()
    const opt = { limit: 1, windowMs: 60_000 }
    expect(rateLimit('9.9.9.9', opt, now)).toBe(true)
    expect(rateLimit('8.8.8.8', opt, now)).toBe(true)
  })
})

describe('вторая попытка — с модели посильнее', () => {
  it('startAt пропускает дешёвые модели, но за концом цепочки остаётся последняя', () => {
    process.env.AI_MODEL_PLAN = 'a/cheap,b/mid,c/strong'
    expect(chainFrom('plan', 0)).toEqual(['a/cheap', 'b/mid', 'c/strong'])
    expect(chainFrom('plan', 1)).toEqual(['b/mid', 'c/strong'])
    expect(chainFrom('plan', 7)).toEqual(['c/strong'])
    delete process.env.AI_MODEL_PLAN
  })
})

describe('счётчик запросов по назначению', () => {
  it('мелкие вызовы плана не съедают квоту расстановки', () => {
    const ip = '10.0.0.7'
    // десять фрагментов плана
    for (let i = 0; i < 10; i++) expect(rateLimit(ip, { limit: 200, windowMs: 60_000, bucket: 'plan-part' })).toBe(true)
    // расстановка мебели с тем же адресом всё ещё доступна
    expect(rateLimit(ip, { limit: 2, windowMs: 60_000, bucket: 'layout' })).toBe(true)
    expect(rateLimit(ip, { limit: 2, windowMs: 60_000, bucket: 'layout' })).toBe(true)
    // но свой запас у неё кончается
    expect(rateLimit(ip, { limit: 2, windowMs: 60_000, bucket: 'layout' })).toBe(false)
    // а у фрагментов плана — нет
    expect(rateLimit(ip, { limit: 200, windowMs: 60_000, bucket: 'plan-part' })).toBe(true)
  })
})

describe('модели, которых нет у роутера', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetModelCache()
    delete process.env.AI_MODEL_LAYOUT_PRO
  })

  /** роутер: список моделей и ответ на запрос */
  function router(ids: string[], answer: (model: string) => Response | Promise<Response>) {
    const asked: string[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 })
      const body = JSON.parse(String(init?.body)) as { model: string; temperature?: number }
      asked.push(`${body.model}${body.temperature === undefined ? ' без температуры' : ''}`)
      return answer(body.model)
    })
    return asked
  }

  it('нет нужной — берётся ближайшая того же семейства, а неизвестные пропускаются', async () => {
    resetModelCache()
    process.env.AI_MODEL_LAYOUT_PRO = 'anthropic/claude-sonnet-5,vendor/unknown-model,deepseek/deepseek-v4-flash'
    router(['anthropic/claude-sonnet-4.5', 'anthropic/claude-sonnet-4', 'deepseek/deepseek-v4-flash'], () => reply('{}'))
    expect(await resolveChain(cfg, 'layout_pro')).toEqual(['anthropic/claude-sonnet-4.5', 'deepseek/deepseek-v4-flash'])
  })

  it('список не получили — цепочка как есть', async () => {
    resetModelCache()
    process.env.AI_MODEL_LAYOUT_PRO = 'anthropic/claude-sonnet-5,deepseek/deepseek-v4-flash'
    vi.stubGlobal('fetch', async () => new Response('нет', { status: 500 }))
    expect(await resolveChain(cfg, 'layout_pro')).toEqual(['anthropic/claude-sonnet-5', 'deepseek/deepseek-v4-flash'])
  })

  it('модель не уложилась во время — так и сказано, а не «отменено»; gpt-5 — без температуры', async () => {
    resetModelCache()
    process.env.AI_MODEL_LAYOUT_PRO = 'openai/gpt-5-mini,deepseek/deepseek-v4-flash'
    const asked = router(['openai/gpt-5-mini', 'deepseek/deepseek-v4-flash'], (model) => {
      if (model === 'openai/gpt-5-mini') return new Response('{}', { status: 400 })
      return reply('{"ok":true}')
    })
    const r = await askJson<{ ok: boolean }>({ ...cfg }, { task: 'layout_pro', messages: [{ role: 'user', content: 'x' }], check: (d) => d as { ok: boolean } })
    expect(r.model).toBe('deepseek/deepseek-v4-flash')
    expect(r.tried[0]).toMatch(/gpt-5-mini: роутер отказал \(400\)/)
    expect(asked[0]).toBe('openai/gpt-5-mini без температуры')
  })

  it('Gemini Flash подменяется ближайшим Flash, а не Lite и не генератором картинок; новее — по номеру версии', async () => {
    resetModelCache()
    process.env.AI_MODEL_LAYOUT_PRO = 'google/gemini-3.8-flash,anthropic/claude-sonnet-5'
    router(
      ['google/gemini-3.7-flash', 'google/gemini-3.9-flash-lite', 'google/gemini-3.9-flash-image', 'google/gemini-3-flash-preview', 'anthropic/claude-sonnet-4.5', 'anthropic/claude-sonnet-10'],
      () => reply('{}'),
    )
    expect(await resolveChain(cfg, 'layout_pro')).toEqual(['google/gemini-3.7-flash', 'anthropic/claude-sonnet-10'])
    expect(familyOf('openai/gpt-5')!.test('openai/gpt-5-mini')).toBe(false)
    expect(familyOf('openai/gpt-5-mini')!.test('openai/gpt-5.4-mini')).toBe(true)
    expect(familyOf('qwen/qwen3-vl-235b-a22b-instruct')!.test('qwen/qwen3-vl-32b-instruct')).toBe(true)
  })

  it('рассуждения ограничены, места под ответ с запасом; Gemini — без температуры, DeepSeek — с нулевой', async () => {
    resetModelCache()
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/models')) return new Response('нет', { status: 500 })
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      bodies.push(body)
      return body.model === 'google/gemini-3.8-flash' ? reply('мусор') : reply('{"ok":1}')
    })
    process.env.AI_MODEL_LAYOUT_PRO = 'google/gemini-3.8-flash,deepseek/deepseek-v4-flash'
    await askJson({ ...cfg }, { task: 'layout_pro', messages: [{ role: 'user', content: 'x' }], check: (d) => d })
    expect(bodies[0].reasoning).toEqual({ effort: 'medium', exclude: true })
    expect(bodies[0].max_tokens).toBeGreaterThanOrEqual(16000)
    expect(bodies[0].temperature).toBeUndefined()
    expect(bodies[1].temperature).toBe(0)
    // запасной DeepSeek рассуждения не включаются: он должен ответить быстро
    expect(bodies[1].reasoning).toBeUndefined()
  })

  it('шлюз не принял настройку рассуждений — та же модель спрашивается без неё', async () => {
    resetModelCache()
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/models')) return new Response('нет', { status: 500 })
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      bodies.push(body)
      return body.reasoning ? new Response('{}', { status: 400 }) : reply('{"ok":1}')
    })
    process.env.AI_MODEL_LAYOUT_PRO = 'google/gemini-3.8-flash'
    const r = await askJson({ ...cfg }, { task: 'layout_pro', messages: [{ role: 'user', content: 'x' }], check: (d) => d })
    expect(r.model).toBe('google/gemini-3.8-flash')
    expect(bodies.map((b) => !!b.reasoning)).toEqual([true, false])
  })

  it('ответ списком частей, как у Claude через шлюз, читается', async () => {
    resetModelCache()
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).endsWith('/models')) return new Response('нет', { status: 500 })
      return new Response(JSON.stringify({ choices: [{ message: { content: [{ type: 'text', text: '{"items":' }, { type: 'text', text: '[1]}' }] } }] }), { status: 200 })
    })
    process.env.AI_MODEL_LAYOUT_PRO = 'anthropic/claude-sonnet-5'
    const r = await askJson({ ...cfg }, { task: 'layout_pro', messages: [{ role: 'user', content: 'x' }], check: (d) => d })
    expect(r.value).toEqual({ items: [1] })
  })

  it('пустой ответ после рассуждений назван так, а не «не по формату»', async () => {
    resetModelCache()
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/models')) return new Response('нет', { status: 500 })
      const body = JSON.parse(String(init?.body)) as { model: string }
      if (body.model === 'openai/gpt-5-mini') return new Response(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }), { status: 200 })
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"a":1},{"b"' }, finish_reason: 'length' }] }), { status: 200 })
    })
    process.env.AI_MODEL_LAYOUT_PRO = 'openai/gpt-5-mini,deepseek/deepseek-v4-flash'
    const r = await askJson({ ...cfg }, { task: 'layout_pro', messages: [{ role: 'user', content: 'x' }], check: (d) => d })
    expect(r.tried[0]).toMatch(/всё ушло в рассуждения/)
    // оборванный ответ второй модели спасён: целые предметы взяты
    expect(r.value).toEqual({ items: [{ a: 1 }] })
  })

  it('медленная модель подстрахована: следом спрашивается следующая, берётся первый годный ответ', async () => {
    resetModelCache()
    vi.useFakeTimers()
    try {
      let slowAborted = false
      vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/models')) return Promise.resolve(new Response('нет', { status: 500 }))
        const body = JSON.parse(String(init?.body)) as { model: string }
        if (body.model === 'google/gemini-3.8-flash')
          return new Promise<Response>((_, rej) =>
            init?.signal?.addEventListener('abort', () => {
              slowAborted = true
              rej(new Error('This operation was aborted'))
            }),
          )
        return Promise.resolve(reply('{"ok":1}'))
      })
      process.env.AI_MODEL_LAYOUT_PRO = 'google/gemini-3.8-flash,deepseek/deepseek-v4-flash'
      const pending = askJson({ ...cfg }, { task: 'layout_pro', messages: [{ role: 'user', content: 'x' }], check: (d) => d })
      await vi.advanceTimersByTimeAsync(46_000)
      const r = await pending
      expect(r.model).toBe('deepseek/deepseek-v4-flash')
      // проигравшая не числится «не ответившей» и остановлена, чтобы не платить за неё дальше
      expect(r.tried).toEqual([])
      expect(slowAborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
