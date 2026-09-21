// Состояние ИИ: включён ли, какие модели на какую задачу и сколько потрачено.
// Ключ наружу не отдаётся никогда — только факт его наличия.
import { aiConfig, chainFor, clientIp, fail, json, rateLimit, specFor, spentToday, TASK_NAMES } from './_lib'

export const config = { runtime: 'edge' }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return fail('нужен GET', 405)
  const cfg = aiConfig()
  const url = new URL(req.url)

  // список моделей роутера: чтобы подобрать дешёвые под свои задачи
  if (url.searchParams.get('models')) {
    if (!cfg) return fail('ИИ не подключён', 503)
    if (!rateLimit(clientIp(req), { limit: 5, windowMs: 60_000, bucket: 'status' })) return fail('слишком часто', 429)
    try {
      const res = await fetch(`${cfg.base}/models`, { headers: { authorization: `Bearer ${cfg.key}` } })
      if (!res.ok) return fail(`роутер ответил ${res.status}`, 502)
      return json(await res.json())
    } catch (e) {
      return fail((e as Error).message, 502)
    }
  }

  const spent = spentToday()
  // подсказка, почему ключа нет: её кладёт плагин разработки, прочитав .env
  const hint = !cfg && process.env.AI_ENV_HINT ? process.env.AI_ENV_HINT : undefined
  return json({
    enabled: !!cfg,
    hint,
    tasks: TASK_NAMES.map((t) => {
      const spec = specFor(t)
      return { task: t, about: spec.about, vision: spec.vision, maxTokens: spec.maxTokens, models: chainFor(t) }
    }),
    spentToday: cfg ? { rub: Number(spent.rub.toFixed(4)), calls: spent.calls, limitRub: cfg.dailyLimitRub } : null,
  })
}
