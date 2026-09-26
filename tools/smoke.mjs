// Дымовая проверка собранного приложения в настоящем браузере: страница
// открывается без ошибок, шаблон даёт чертёж, каталог и электрика работают.
// Запуск после `npm run build`: `npm run smoke`. Браузер — из playwright-core
// (`npx playwright-core install chromium`) или по пути в PW_CHROMIUM.
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'

const port = 4173
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32' })

const waitServer = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/`)
      if (r.ok) return
    } catch {
      /* ещё не поднялся */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('vite preview не поднялся за 30 с')
}

let code = 0
try {
  await waitServer()
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://localhost:${port}/`)
  await page.locator('.pl-start button:has-text("2-комнатная")').click()
  await page.waitForTimeout(800)
  const text = () => page.evaluate(() => document.body.innerText)
  const rooms = Number((await text()).match(/(\d+) комнат/)?.[1] ?? 0)
  const checks = [
    [rooms >= 4, `комнат по шаблону: ${rooms}`],
    [(await page.locator('svg').count()) > 0, 'чертёж нарисован'],
  ]
  await page.locator('.pl-mode-switch button:has-text("Мебель")').click()
  await page.waitForTimeout(200)
  checks.push([(await page.locator('.pl-cat-item').count()) > 20, 'каталог открылся'])
  await page.locator('.pl-mode-switch button:has-text("Электрика")').click()
  await page.locator('.pl-panel button:has-text("Спроектировать по нормам")').click()
  await page.waitForTimeout(400)
  const replace = page.locator('.pl-ask-option:has-text("Заменить")')
  if (await replace.count()) await replace.click()
  await page.waitForTimeout(800)
  checks.push([/Расставлено точек: \d+/.test(await text()), 'электрика спроектирована'])
  checks.push([errors.length === 0, `ошибок страницы: ${errors.length}${errors.length ? ' — ' + errors.join(' | ') : ''}`])
  for (const [ok, msg] of checks) {
    console.log((ok ? 'ok   ' : 'FAIL ') + msg)
    if (!ok) code = 1
  }
  await browser.close()
} catch (e) {
  console.error('FAIL', e)
  code = 1
} finally {
  server.kill()
  process.exit(code)
}
