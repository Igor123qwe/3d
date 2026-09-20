// Плагин разработки: отдаёт папку api/ как serverless-функции.
//
// На Vercel этим занимается платформа, а локально без него `npm run dev`
// показывал бы приложение без серверной части. Плагин переводит запрос Node
// в стандартный Request, зовёт обработчик и пишет обратно его Response —
// ровно так же, как это делает Vercel.
import type { Connect, Plugin, ViteDevServer } from 'vite'
import type { ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { envHint, readDotenv } from './dotenv'

type Handler = (req: Request) => Promise<Response> | Response

const API_DIR = 'api'

/** путь /api/plan -> api/plan.ts, если такой файл есть */
function fileFor(pathname: string, root: string): string | null {
  const name = pathname.replace(/^\/api\//, '').replace(/\/+$/, '')
  if (!name || !/^[a-z0-9_-]+$/i.test(name)) return null
  const file = resolve(root, API_DIR, `${name}.ts`)
  return existsSync(file) ? file : null
}

async function toRequest(req: Connect.IncomingMessage, host: string): Promise<Request> {
  const url = new URL(req.url || '/', `http://${host}`)
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v)
    else if (Array.isArray(v)) headers.set(k, v.join(', '))
  }
  const method = req.method || 'GET'
  let body: string | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    body = Buffer.concat(chunks).toString('utf8')
  }
  return new Request(url, { method, headers, body })
}

async function send(res: ServerResponse, out: Response): Promise<void> {
  res.statusCode = out.status
  out.headers.forEach((v, k) => res.setHeader(k, v))
  res.end(Buffer.from(await out.arrayBuffer()))
}

/**
 * Переменные из .env → process.env. Vite сам туда ничего не кладёт, а серверные
 * функции читают ключ именно оттуда. Читается заново на каждый запрос к /api:
 * ключ, вписанный в .env при работающем сервере, подхватывается без перезапуска.
 * То, что задано в окружении самой оболочки при старте, файл не перебивает.
 */
function applyEnv(root: string, shell: Record<string, string | undefined>): void {
  const env = readDotenv(root)
  for (const [key, value] of Object.entries(env)) {
    if (shell[key] === undefined) process.env[key] = value
  }
  // ключ убрали из файла — убираем и из процесса
  for (const key of Object.keys(process.env)) {
    if (shell[key] === undefined && env[key] === undefined && /^(ROUTERAI_|AI_)/.test(key) && key !== 'AI_ENV_HINT') delete process.env[key]
  }
  process.env.AI_ENV_HINT = process.env.ROUTERAI_API_KEY || process.env.AI_API_KEY ? '' : envHint(root, env)
}

function middleware(server: ViteDevServer, root: string, shell: Record<string, string | undefined>): Connect.NextHandleFunction {
  return (req, res, next) => {
    const pathname = (req.url || '').split('?')[0]
    if (!pathname.startsWith('/api/')) return next()
    const file = fileFor(pathname, root)
    if (!file) return next()
    void (async () => {
      applyEnv(root, shell)
      try {
        const mod = (await server.ssrLoadModule(file)) as { default?: Handler }
        if (typeof mod.default !== 'function') throw new Error(`${file}: нет обработчика по умолчанию`)
        await send(res, await mod.default(await toRequest(req, req.headers.host || 'localhost')))
      } catch (e) {
        res.statusCode = 500
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: (e as Error).message }))
      }
    })()
  }
}

export function apiDev(): Plugin {
  let root = process.cwd()
  // снимок окружения оболочки до чтения .env: его файл перебивать не должен
  const shell: Record<string, string | undefined> = { ...process.env }
  return {
    name: 'planner-api-dev',
    apply: 'serve',
    configResolved(cfg) {
      root = cfg.envDir || cfg.root
      applyEnv(root, shell)
      const hint = process.env.AI_ENV_HINT
      cfg.logger.info(hint ? `  ИИ выключен: ${hint}` : '  ИИ включён: ключ ROUTERAI_API_KEY найден')
    },
    configureServer(server) {
      server.middlewares.use(middleware(server, root, shell))
    },
  }
}
