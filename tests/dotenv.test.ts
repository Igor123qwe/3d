import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { envHint, parseDotenv, readDotenv } from '../tools/dotenv'

describe('чтение .env', () => {
  it('BOM, CRLF, кавычки, export и хвостовые комментарии не мешают', () => {
    const text = '﻿# комментарий\r\nROUTERAI_API_KEY="sk-abc"\r\nexport AI_DAILY_LIMIT_RUB=100 # рублей\r\nAI_MODEL_PLAN=a/b,c/d\r\n\r\nмусор без знака равно\r\n'
    expect(parseDotenv(text)).toEqual({ ROUTERAI_API_KEY: 'sk-abc', AI_DAILY_LIMIT_RUB: '100', AI_MODEL_PLAN: 'a/b,c/d' })
  })

  it('.env.local перекрывает .env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'env-'))
    try {
      writeFileSync(join(dir, '.env'), 'ROUTERAI_API_KEY=sk-one\nX=1\n')
      writeFileSync(join(dir, '.env.local'), 'ROUTERAI_API_KEY=sk-two\n')
      expect(readDotenv(dir)).toEqual({ ROUTERAI_API_KEY: 'sk-two', X: '1' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('подсказка, почему ключа нет', () => {
  const withFiles = (files: Record<string, string>, fn: (dir: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), 'env-'))
    try {
      for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
      fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('ключ есть — подсказки нет', () => {
    withFiles({ '.env': 'ROUTERAI_API_KEY=sk-real\n' }, (dir) => expect(envHint(dir)).toBe(''))
  })

  it('файла нет', () => {
    withFiles({}, (dir) => expect(envHint(dir)).toMatch(/Файла \.env нет/))
  })

  it('Блокнот дописал .txt', () => {
    withFiles({ '.env.txt': 'ROUTERAI_API_KEY=sk-real\n' }, (dir) => expect(envHint(dir)).toMatch(/\.env\.txt/))
  })

  it('решётка не убрана', () => {
    withFiles({ '.env': '# ROUTERAI_API_KEY=sk-real\n' }, (dir) => expect(envHint(dir)).toMatch(/закомментирована/))
  })

  it('ключ не вставлен: пусто или образец sk-…', () => {
    withFiles({ '.env': 'ROUTERAI_API_KEY=\n' }, (dir) => expect(envHint(dir)).toMatch(/не вставлен/))
    withFiles({ '.env': 'ROUTERAI_API_KEY=sk-...\n' }, (dir) => expect(envHint(dir)).toMatch(/не вставлен/))
  })

  it('строки вовсе нет', () => {
    withFiles({ '.env': 'AI_DAILY_LIMIT_RUB=100\n' }, (dir) => expect(envHint(dir)).toMatch(/нет строки/))
  })
})
