#!/usr/bin/env node
// Обновить и запустить планировщик.
//
// Вся работа здесь, а не в start.cmd и start.sh: bat-файл с кириллицей и
// ветвлениями слишком легко ломается о кодировку и переводы строк, а Node
// одинаково ведёт себя во всех системах.
import { existsSync, statSync, copyFileSync, writeFileSync, readFileSync, renameSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const win = process.platform === 'win32'
const npm = win ? 'npm.cmd' : 'npm'
const wantPort = Number(process.env.PORT) || Number(process.argv[2]) || 5173

const say = (s) => console.log(s)
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: win })

function die(reason, hint) {
  console.error(`\nНе получилось: ${reason}`)
  if (hint) console.error(hint)
  process.exit(1)
}

// ---------- 1. свежая версия ----------
if (spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, shell: win }).status === 0) {
  say('[1/4] Обновляю из git...')
  if (run('git', ['pull', '--ff-only']).status !== 0) {
    say('[!] Обновиться не вышло — похоже, есть свои несохранённые правки.')
    say('    Продолжаю на том, что лежит на диске.')
  }
} else {
  say('[1/4] Это не git-папка, обновление пропускаю.')
}

// ---------- 2. зависимости ----------
// ставим, только если их нет или список пакетов поменялся
const stamp = join(root, '.npm-stamp')
const lock = join(root, 'package-lock.json')
const mtime = (f) => (existsSync(f) ? statSync(f).mtimeMs : 0)
if (!existsSync(join(root, 'node_modules')) || !existsSync(stamp) || mtime(lock) > mtime(stamp)) {
  say('[2/4] Ставлю зависимости, это займёт пару минут...')
  if (run(npm, ['install']).status !== 0) die('npm install не отработал')
  writeFileSync(stamp, '')
} else {
  say('[2/4] Зависимости на месте.')
}

// ---------- 3. настройки ----------
const env = join(root, '.env')
// Блокнот в Windows любит дописать .txt — чиним молча, но говорим об этом
const envTxt = join(root, '.env.txt')
if (!existsSync(env) && existsSync(envTxt)) {
  renameSync(envTxt, env)
  say('[3/4] Файл .env.txt переименован в .env (Блокнот дописал расширение).')
}
if (!existsSync(env)) {
  const sample = join(root, '.env.example')
  if (existsSync(sample)) copyFileSync(sample, env)
  say('[3/4] Создан файл .env. Чтобы включить ИИ, уберите в нём решётку перед')
  say('      ROUTERAI_API_KEY и вставьте свой ключ — перезапускать не нужно,')
  say('      сервер перечитает .env сам. Без ключа всё работает, но без ИИ.')
} else {
  const text = readFileSync(env, 'utf8').replace(/^\uFEFF/, '')
  const m = /^\s*ROUTERAI_API_KEY\s*=\s*(\S+)/m.exec(text)
  if (m && m[1] !== 'sk-...') say('[3/4] Настройки на месте, ключ ИИ найден.')
  else if (/^\s*#.*ROUTERAI_API_KEY/m.test(text)) say('[3/4] ИИ выключен: в .env строка ROUTERAI_API_KEY закомментирована — уберите решётку.')
  else say('[3/4] ИИ выключен: в .env нет ROUTERAI_API_KEY=ваш_ключ.')
}

// ---------- 4. запуск ----------
// Порт занят — значит, работает прежняя копия: у неё старый код. Раньше
// сервер молча уходил на соседний порт, а браузер открывался по старому
// адресу, на прежней копии, — и обновление было не видно
const answers = async (p) => {
  try {
    await fetch(`http://localhost:${p}`, { signal: AbortSignal.timeout(1500) })
    return true
  } catch {
    return false
  }
}
let port = wantPort
if (await answers(port)) {
  say(`[!] На порту ${port} уже работает прежняя копия планировщика — со старым кодом.`)
  say('    Закройте её окно (или нажмите в нём Ctrl+C): по старому адресу откроется она.')
  while (port < wantPort + 20 && (await answers(port))) port++
}
const url = `http://localhost:${port}`
say(`[4/4] Запускаю. Адрес: ${url}`)
say('')
say('    Браузер откроется сам, как только сервер поднимется.')
say('    Чтобы остановить — Ctrl+C.')
say('')

// --strictPort: занято — ошибка, а не тихий уход на другой порт мимо браузера
const dev = spawn(npm, ['run', 'dev', '--', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'inherit', shell: win })
dev.on('exit', (code) => process.exit(code ?? 0))

/** открыть браузер, когда сервер начал отвечать */
async function openWhenReady() {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500))
    try {
      await fetch(url)
      break
    } catch {
      // сервер ещё поднимается
    }
  }
  const [cmd, args] = win ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  try {
    const opener = spawn(cmd, args, { detached: true, stdio: 'ignore' })
    // на машине может не оказаться ни xdg-open, ни open: ошибка прилетает
    // событием, и без обработчика она роняет весь запуск
    opener.on('error', () => say(`    Браузер открыть не вышло — откройте ${url} руками.`))
    opener.unref()
  } catch {
    say(`    Браузер открыть не вышло — откройте ${url} руками.`)
  }
}
void openWhenReady()
