// Набор для проверки распознавания планов: bench/plans/<имя>/{plan.*, reference.json}.
//
// Прогон поднимает dev-сервер, грузит каждое фото в приложение и прогоняет тот
// же код, что и кнопка «Распознать с ИИ», только подписи берутся из эталона,
// проверенного вручную. Так измеряется геометрия — сегментация, решатель,
// формы, — а не то, как модель прочитала цифры в этот раз.
//
// Запуск: npm run bench [имя-плана] [--json] [--keep]
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLANS = join(ROOT, 'bench', 'plans')
const PORT = 5188

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const only = args.filter((a) => !a.startsWith('--'))

function plansToRun() {
  const all = readdirSync(PLANS).filter((n) => statSync(join(PLANS, n)).isDirectory())
  const names = only.length ? all.filter((n) => only.includes(n)) : all
  if (!names.length) throw new Error(`планов не нашлось: ${only.join(', ') || PLANS}`)
  return names.map((name) => {
    const dir = join(PLANS, name)
    const image = readdirSync(dir).find((f) => /\.(png|jpe?g|webp)$/i.test(f))
    if (!image) throw new Error(`${name}: нет картинки плана`)
    return { name, dir, image: join(dir, image), ref: JSON.parse(readFileSync(join(dir, 'reference.json'), 'utf8')) }
  })
}

/** дождаться, пока сервер ответит */
async function waitFor(url, ms = 40000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {
      /* ещё не поднялся */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`сервер не поднялся: ${url}`)
}

/** один план: прогнать в браузере и посчитать метрики */
async function runPlan(page, plan) {
  const t0 = Date.now()
  await page.goto(`http://localhost:${PORT}/`)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('.pl-start')
  const chooser = page.waitForEvent('filechooser')
  await page.click('.pl-start button:has-text("Выбрать файл")')
  ;(await chooser).setFiles(plan.image)
  await page.waitForSelector('.pl-stepper', { timeout: 20000 })
  await page.waitForTimeout(300)
  // подготовка фото: те же кнопки, что жмёт пользователь («Выровнять», «Очистить»)
  for (const step of plan.ref.prepare ?? []) {
    await page.click(`.pl-stepper button:has-text("${step}")`)
    await page.waitForTimeout(1200)
  }
  const out = await page.evaluate((labels) => window.__plannerDebug.runWithLabels(labels), plan.ref.labels)
  if (!out) throw new Error(`${plan.name}: подложка не загрузилась`)
  return { ...score(plan.ref, out), ms: Date.now() - t0, raw: out }
}

/** сравнение с эталоном: каждая метрика считается отдельно, приговор — по худшей */
function score(ref, out) {
  const exp = ref.expect ?? {}
  const q = out.report.quality
  const byName = new Map(out.rooms.map((r) => [r.name, r]))
  const wanted = exp.rooms ?? []
  const missing = wanted.filter((w) => !byName.has(w.name)).map((w) => w.name)
  const extra = out.rooms.filter((r) => !wanted.some((w) => w.name === r.name)).map((r) => r.name)

  const areaOff = []
  const sizeOff = []
  const shapeOff = []
  // комната частично закрыта на снимке: её размеры по картинке не проверить, но
  // отчёт обязан сказать, что подпись с картинкой не сходится
  const disputed = new Set((q.disputes ?? []).map((d) => d.room))
  const unflagged = []
  for (const w of wanted) {
    const got = byName.get(w.name)
    if (!got) continue
    if (w.covered) {
      if (!disputed.has(w.name)) unflagged.push(w.name)
      continue
    }
    if (w.areaM2 !== undefined) {
      const d = Math.abs(got.areaM2 - w.areaM2)
      areaOff.push({ name: w.name, deltaM2: +d.toFixed(2), tol: w.areaTolM2 ?? 1, bad: d > (w.areaTolM2 ?? 1) })
    }
    const tol = w.sizeTolCm ?? 20
    for (const [key, label] of [['widthCm', 'ширина'], ['depthCm', 'глубина']]) {
      if (w[key] === undefined) continue
      const d = Math.abs(got[key] - w[key])
      sizeOff.push({ name: `${w.name} ${label}`, deltaCm: Math.round(d), tol, bad: d > tol })
    }
    // Форма: доля рамки, занятая комнатой. Число углов для этого не годится —
    // на одной прямой стены разной толщины дают лишнюю ступеньку в пару
    // сантиметров, а настоящий вырез виден по площади
    if (w.shape) {
      const fill = (got.areaM2 * 1e4) / Math.max(1, got.widthCm * got.depthCm)
      const bad = w.shape === 'rect' ? fill < (w.shapeFill ?? 0.97) : fill > (w.shapeFill ?? 0.95)
      if (bad) shapeOff.push({ name: w.name, fill: +fill.toFixed(2), want: w.shape === 'rect' ? 'прямоугольная' : 'с вырезом' })
    }
    // мелкие уступы площадь почти не меняют (выступ 0,64 × 0,13 — 0,08 м²): их видно по числу углов
    if (w.minCorners && (got.corners ?? 0) < w.minCorners) shapeOff.push({ name: w.name, fill: got.corners ?? 0, want: `не меньше ${w.minCorners} углов — пропал уступ` })
  }

  const skip = new Set(exp.shapeIou?.skip ?? [])
  const iouMin = exp.shapeIou?.min ?? 0.8
  const iouBad = (q.shapes ?? []).filter((s) => !skip.has(s.name) && s.iou < iouMin)
  const worstIou = (q.shapes ?? []).filter((s) => !skip.has(s.name)).reduce((m, s) => Math.min(m, s.iou), 1)

  // Проёмы по списку эталона: дверь — между какими комнатами, окно — в какой.
  // Так видно не только сколько встало, но и куда
  const cls = (k) => (k === 'window' ? 'window' : 'door')
  const got = (out.openings ?? []).map((o) => ({ kind: cls(o.kind), key: [...o.rooms].sort().join('|') }))
  const want = (exp.openingList ?? []).map((o) => ({ kind: cls(o.kind), key: [...o.rooms].sort().join('|') }))
  const used = new Set()
  const openingMissing = []
  for (const w of want) {
    const i = got.findIndex((g, k) => !used.has(k) && g.kind === w.kind && g.key === w.key)
    if (i >= 0) used.add(i)
    else openingMissing.push(`${w.kind === 'window' ? 'окно' : 'дверь'} ${w.key.replace('|', '–')}`)
  }
  const openingExtra = exp.openingList ? got.filter((_, k) => !used.has(k)).map((g) => `${g.kind === 'window' ? 'окно' : 'дверь'} ${g.key.replace('|', '–') || 'вне комнат'}`) : []

  const onInk = q.walls?.onInk ?? null
  const scaleOk = !exp.scaleCmPerPx || (out.report.scale.cmPerPx >= exp.scaleCmPerPx.min && out.report.scale.cmPerPx <= exp.scaleCmPerPx.max)
  const openingsPlaced = exp.openingList ? want.length - openingMissing.length : q.openings.placed
  const openingsWant = exp.openingList ? want.length : (exp.openings ?? q.openings.expected)

  const fixes =
    unflagged.length +
    missing.length +
    extra.length +
    iouBad.length +
    shapeOff.length +
    areaOff.filter((a) => a.bad).length +
    sizeOff.filter((s) => s.bad).length +
    Math.max(0, openingsWant - openingsPlaced) +
    openingExtra.length +
    (scaleOk ? 0 : 1) +
    (exp.regions !== undefined && out.regions !== exp.regions ? 1 : 0)

  return {
    missing,
    extra,
    regions: out.regions,
    regionsWant: exp.regions ?? null,
    scale: +out.report.scale.cmPerPx.toFixed(2),
    scaleOk,
    onInk: onInk === null ? null : +onInk.toFixed(2),
    onInkWant: exp.wallsOnInk ?? null,
    worstIou: +worstIou.toFixed(2),
    iouBad,
    areaMax: areaOff.length ? Math.max(...areaOff.map((a) => a.deltaM2)) : null,
    areaBad: areaOff.filter((a) => a.bad),
    sizeMax: sizeOff.length ? Math.max(...sizeOff.map((s) => s.deltaCm)) : null,
    sizeBad: sizeOff.filter((s) => s.bad),
    shapeOff,
    unflagged,
    openings: `${openingsPlaced}/${openingsWant}${openingExtra.length ? ` +${openingExtra.length}` : ''}`,
    openingMissing,
    openingExtra,
    fixes,
  }
}

function printTable(rows) {
  const head = ['план', 'пропуски', 'лишние', 'области', 'масштаб', 'стены', 'форма', 'площади', 'размеры', 'проёмы', 'правок']
  const body = rows.map((r) => [
    r.name,
    r.missing.length ? r.missing.join(',') : '—',
    r.extra.length ? r.extra.join(',') : '—',
    r.regionsWant === null ? String(r.regions) : `${r.regions}/${r.regionsWant}`,
    `${r.scale}${r.scaleOk ? '' : ' !'}`,
    r.onInk === null ? '—' : `${Math.round(r.onInk * 100)} %${r.onInkWant !== null && r.onInk < r.onInkWant ? ' !' : ''}`,
    `${Math.round(r.worstIou * 100)} %${r.iouBad.length ? ' !' : ''}`,
    r.areaMax === null ? '—' : `${r.areaMax} м²${r.areaBad.length ? ' !' : ''}`,
    r.sizeMax === null ? '—' : `${r.sizeMax} см${r.sizeBad.length ? ' !' : ''}`,
    r.openings,
    String(r.fixes),
  ])
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)))
  const line = (cells) => cells.map((c, i) => c.padEnd(w[i])).join('  ')
  console.log(line(head))
  console.log(w.map((n) => '─'.repeat(n)).join('  '))
  for (const b of body) console.log(line(b))
}

async function main() {
  const plans = plansToRun()
  const dev = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' })
  const stop = () => {
    try {
      dev.kill('SIGTERM')
    } catch {
      /* уже мёртв */
    }
  }
  process.on('exit', stop)
  let browser
  try {
    await waitFor(`http://localhost:${PORT}/`)
    const { chromium } = await import('playwright-core')
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    const rows = []
    for (const plan of plans) {
      const r = await runPlan(page, plan)
      rows.push({ name: plan.name, ...r })
    }
    if (asJson) {
      console.log(JSON.stringify(rows.map(({ raw, ...r }) => (process.argv.includes('--rooms') ? { ...r, rooms: raw.rooms, walls: raw.walls, regionBoxes: raw.regionBoxes, openingsRaw: raw.openings } : r)), null, 2))
    } else {
      printTable(rows)
      console.log('')
      for (const r of rows) {
        const notes = [
          ...r.missing.map((n) => `нет комнаты ${n}`),
          ...r.extra.map((n) => `лишняя комната ${n}`),
          ...r.iouBad.map((s) => `форма ${s.name}: ${Math.round(s.iou * 100)} %`),
          ...r.shapeOff.map((s) => (s.want.includes('углов') ? `${s.name}: углов ${s.fill}, ждали ${s.want}` : `${s.name}: заполнение рамки ${s.fill}, ждали ${s.want}`)),
          ...r.areaBad.map((a) => `площадь ${a.name}: ${a.deltaM2} м² мимо`),
          ...r.sizeBad.map((s) => `${s.name}: ${s.deltaCm} см мимо`),
          ...r.unflagged.map((n) => `${n} закрыта на снимке, но отчёт не пометил её подпись спорной`),
          ...r.openingMissing.map((o) => `нет: ${o}`),
          ...r.openingExtra.map((o) => `лишняя ${o}`),
        ]
        console.log(`${r.name}: ${notes.length ? notes.join('; ') : 'всё в допуске'} (${(r.ms / 1000).toFixed(1)} с)`)
      }
      const total = rows.reduce((a, r) => a + r.fixes, 0)
      console.log(`\nвсего правок: ${total} по ${rows.length} ${rows.length === 1 ? 'плану' : 'планам'}`)
    }
    const failed = rows.some((r) => r.missing.length || r.fixes > 0)
    process.exitCode = failed ? 1 : 0
  } finally {
    if (browser) await browser.close()
    stop()
  }
}

main().catch((e) => {
  console.error('bench:', e.message)
  process.exit(2)
})
