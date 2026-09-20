// Чтение .env без сюрпризов Windows: BOM от Блокнота, CRLF, кавычки, «export»,
// файл, сохранённый как .env.txt. И подсказка, почему ключа ИИ всё ещё нет —
// чтобы пользователь увидел причину в приложении, а не гадал.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const KEY = 'ROUTERAI_API_KEY'

/** Разобрать текст .env: KEY=value, комментарии с #, кавычки снимаются */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    else {
      // хвостовой комментарий после значения без кавычек
      const hash = value.indexOf(' #')
      if (hash >= 0) value = value.slice(0, hash).trim()
    }
    out[m[1]] = value
  }
  return out
}

/** Переменные из .env и .env.local (второй важнее), как их читает Vite */
export function readDotenv(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of ['.env', '.env.local']) {
    const file = join(root, name)
    if (!existsSync(file)) continue
    Object.assign(out, parseDotenv(readFileSync(file, 'utf8')))
  }
  return out
}

/**
 * Почему ключа нет — одной фразой для пользователя. Пусто, если ключ есть.
 * Проверяются самые частые промахи: файл не создан, Блокнот дописал .txt,
 * решётка перед строкой не убрана, ключ не вставлен, лишние кавычки-пробелы.
 */
export function envHint(root: string, env: Record<string, string> = readDotenv(root)): string {
  const value = (env[KEY] || '').trim()
  if (value && !/^sk-\.\.\.$/.test(value)) return ''
  const file = join(root, '.env')
  if (!existsSync(file)) {
    if (existsSync(join(root, '.env.txt'))) return 'Файл называется .env.txt — Блокнот дописал расширение. Переименуйте его в .env'
    return 'Файла .env нет. Создайте его рядом с package.json (запуск через start.cmd делает это сам) и впишите ROUTERAI_API_KEY=ваш_ключ'
  }
  const text = readFileSync(file, 'utf8')
  if (new RegExp(`^\\s*#.*${KEY}\\s*=`, 'm').test(text)) return `В .env строка с ${KEY} закомментирована — уберите решётку (#) в начале строки`
  if (new RegExp(`^\\s*${KEY}\\s*=\\s*(sk-\\.\\.\\.)?\\s*$`, 'm').test(text)) return `В .env после ${KEY}= ключ не вставлен. Должно быть ${KEY}=sk-… без кавычек и пробелов`
  if (!new RegExp(`${KEY}`).test(text)) return `В .env нет строки ${KEY}=… — добавьте её`
  return `${KEY} в .env не прочитался: проверьте, что строка вида ${KEY}=sk-… без лишних символов`
}
