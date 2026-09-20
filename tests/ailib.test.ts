import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addSpent, askJson, chainFor, rateLimit, spentToday, type AiConfig } from '../api/_lib'

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
