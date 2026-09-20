import { describe, expect, it } from 'vitest'
import { decodePlan, encodePlan, parseHash } from '../src/planner/share'
import { normalizePlan } from '../src/planner/exporters'
import { TEMPLATES } from '../src/planner/templates'
import { emptyPlan } from '../src/planner/types'

describe('передача плана по ссылке', () => {
  it('план переживает кодирование и раскодирование', async () => {
    const plan = TEMPLATES[2].build()
    const decoded = await decodePlan(await encodePlan(plan))
    expect(decoded).not.toBeNull()
    expect(decoded!.name).toBe(plan.name)
    expect(decoded!.walls.length).toBe(plan.walls.length)
    expect(decoded!.furniture.length).toBe(plan.furniture.length)
    expect(decoded!.openings).toEqual(plan.openings)
    expect(decoded!.rooms).toEqual(plan.rooms)
  })

  it('кодировка сжимает план и не содержит небезопасных для URL символов', async () => {
    const encoded = await encodePlan(TEMPLATES[3].build())
    expect(encoded).toMatch(/^[zj]\.[A-Za-z0-9_-]+$/)
    expect(encoded.length).toBeLessThan(JSON.stringify(TEMPLATES[3].build()).length)
  })

  it('пустой план кодируется', async () => {
    const decoded = await decodePlan(await encodePlan(emptyPlan()))
    expect(decoded!.walls).toEqual([])
  })

  it('мусор вместо плана возвращает null', async () => {
    expect(await decodePlan('z.не-настоящие-данные')).toBeNull()
    expect(await decodePlan('')).toBeNull()
    const b64url = (t: string) => btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(await decodePlan(`j.${b64url('{"nope":1}')}`)).toBeNull()
  })

  it('разбор хэша ссылки', () => {
    expect(parseHash('#mode=ar&plan=z.AAA')).toEqual({ mode: 'ar', plan: 'z.AAA' })
    expect(parseHash('mode=3d')).toEqual({ mode: '3d' })
    expect(parseHash('#mode=чужое')).toEqual({})
    expect(parseHash('')).toEqual({})
  })
})

describe('нормализация плана из файла', () => {
  it('недостающие поля заполняются', () => {
    const p = normalizePlan({ walls: [] })
    expect(p.name).toBe('План')
    expect(p.settings.grid).toBe(10)
    expect(p.furniture).toEqual([])
  })

  it('мусорные поля заменяются пустыми списками', () => {
    const p = normalizePlan({ walls: [], furniture: 'нет' as never })
    expect(p.furniture).toEqual([])
  })
})
