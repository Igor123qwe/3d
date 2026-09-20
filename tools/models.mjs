#!/usr/bin/env node
// Список моделей роутера с ценами: чтобы подобрать дешёвую под каждую задачу.
//
// Запуск:
//   node tools/models.mjs                  # все модели, от дешёвых к дорогим
//   node tools/models.mjs --vision         # только те, что читают картинки
//   node tools/models.mjs --find gemini    # поиск по названию
//   node tools/models.mjs --json           # сырой ответ роутера
//
// Ключ берётся из ROUTERAI_API_KEY или из файла .env рядом с проектом.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function env(name) {
  if (process.env[name]) return process.env[name]
  try {
    const line = readFileSync(resolve(root, '.env'), 'utf8')
      .split('\n')
      .find((l) => l.trim().startsWith(`${name}=`))
    return line ? line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') : ''
  } catch {
    return ''
  }
}

const args = process.argv.slice(2)
const has = (flag) => args.includes(flag)
const valueOf = (flag) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : ''
}

const key = env('ROUTERAI_API_KEY') || env('AI_API_KEY')
if (!key) {
  console.error('Нет ключа. Положите его в .env как ROUTERAI_API_KEY=sk-… или передайте переменной окружения.')
  process.exit(1)
}
const base = (env('ROUTERAI_BASE_URL') || 'https://routerai.ru/api/v1').replace(/\/+$/, '')

const res = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` } })
if (!res.ok) {
  console.error(`Роутер ответил ${res.status}: ${(await res.text()).slice(0, 300)}`)
  process.exit(1)
}
const payload = await res.json()
if (has('--json')) {
  console.log(JSON.stringify(payload, null, 2))
  process.exit(0)
}

const rows = Array.isArray(payload) ? payload : (payload.data ?? payload.models ?? [])
if (!rows.length) {
  console.error('Роутер вернул пустой список. Посмотрите сырой ответ: node tools/models.mjs --json')
  process.exit(1)
}

/** цена за миллион токенов: у роутеров она бывает за токен, в рублях или в долларах */
function price(m, which) {
  const p = m.pricing ?? m.price ?? {}
  const raw = which === 'in' ? (p.prompt ?? p.input ?? p.prompt_rub ?? p.input_rub) : (p.completion ?? p.output ?? p.completion_rub ?? p.output_rub)
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  // за токен цена всегда микроскопическая — переводим к миллиону
  return n < 0.001 ? n * 1_000_000 : n
}

const currency = JSON.stringify(rows[0]?.pricing ?? {}).includes('rub') ? '₽' : '$'

/** читает ли модель картинки */
function vision(m) {
  const blob = JSON.stringify(m).toLowerCase()
  const mods = m.architecture?.input_modalities ?? m.input_modalities ?? m.modalities
  if (Array.isArray(mods)) return mods.some((x) => String(x).includes('image'))
  return /"vision"|image_input|multimodal|"image"/.test(blob)
}

const ctx = (m) => m.context_length ?? m.context ?? m.max_context_tokens ?? m.top_provider?.context_length ?? null

let list = rows.map((m) => ({
  id: m.id ?? m.name ?? '?',
  in: price(m, 'in'),
  out: price(m, 'out'),
  vision: vision(m),
  ctx: ctx(m),
}))

const find = valueOf('--find')
if (find) list = list.filter((m) => m.id.toLowerCase().includes(find.toLowerCase()))
if (has('--vision')) list = list.filter((m) => m.vision)
// без цены — в конец: по ним всё равно не выбрать
list.sort((a, b) => (a.in ?? 1e9) - (b.in ?? 1e9))

const limit = Number(valueOf('--limit')) || 40
const shown = list.slice(0, limit)
const width = Math.max(20, ...shown.map((m) => m.id.length))
const fmt = (v) => (v === null ? '—' : v >= 100 ? v.toFixed(0) : v.toFixed(2))
const thousands = (v) => (v === null ? '—' : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))

console.log(`Роутер: ${base}. Моделей: ${rows.length}${list.length !== rows.length ? `, подходит ${list.length}` : ''}\n`)
console.log(`${'модель'.padEnd(width)}  ${`вход ${currency}/1М`.padStart(12)}  ${`выход ${currency}/1М`.padStart(13)}  зрение  контекст`)
console.log('─'.repeat(width + 48))
for (const m of shown) {
  console.log(`${m.id.padEnd(width)}  ${fmt(m.in).padStart(12)}  ${fmt(m.out).padStart(13)}  ${(m.vision ? 'да' : '—').padStart(6)}  ${thousands(m.ctx).padStart(8)}`)
}
if (list.length > shown.length) console.log(`\n…и ещё ${list.length - shown.length}. Покажите все: --limit ${list.length}`)

// готовые строки для .env: самые дешёвые под каждую задачу
const cheapVision = list.filter((m) => m.vision && m.in !== null).slice(0, 3)
const cheapText = list.filter((m) => m.in !== null).slice(0, 3)
if (cheapVision.length && cheapText.length && !find && !has('--vision')) {
  console.log('\nМожно взять так (от дешёвой к дорогой):\n')
  console.log(`AI_MODEL_PLAN=${cheapVision.map((m) => m.id).join(',')}`)
  console.log(`AI_MODEL_PRODUCT=${cheapText.map((m) => m.id).join(',')}`)
  console.log(`AI_MODEL_LAYOUT=${cheapText.map((m) => m.id).join(',')}`)
  console.log(`AI_MODEL_CLASSIFY=${cheapText.slice(0, 2).map((m) => m.id).join(',')}`)
  console.log('\nСильную модель в конец цепочки добавьте сами: она включится, только если дешёвые не справились.')
}
