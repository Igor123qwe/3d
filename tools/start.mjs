#!/usr/bin/env node
// Обновить и запустить планировщик.
//
// Вся работа здесь, а не в start.cmd и start.sh: bat-файл с кириллицей и
// ветвлениями слишком легко ломается о кодировку и переводы строк, а Node
// одинаково ведёт себя во всех системах.
import { existsSync, statSync, copyFileSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const win = process.platform === 'win32'
const npm = win ? 'npm.cmd' : 'npm'
const port = Number(process.env.PORT) || Number(process.argv[2]) || 5173
const url = `http://localhost:${port}`

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
if (!existsSync(env)) {
  const sample = join(root, '.env.example')
  if (existsSync(sample)) copyFileSync(sample, env)
  say('[3/4] Создан файл .env. Чтобы включить ИИ, уберите в нём решётку перед')
  say('      ROUTERAI_API_KEY и вставьте свой ключ, потом запустите заново.')
  say('      Без ключа приложение работает, просто без кнопок с ИИ.')
} else {
  say('[3/4] Настройки на месте.')
}

// ---------- 4. запуск ----------
say(`[4/4] Запускаю. Адрес: ${url}`)
say('')
say('    Браузер откроется сам, как только сервер поднимется.')
say('    Чтобы остановить — Ctrl+C.')
say('')

const dev = spawn(npm, ['run', 'dev', '--', '--port', String(port)], { cwd: root, stdio: 'inherit', shell: win })
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
