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

  it('битые записи отбрасываются', () => {
    const p = normalizePlan({
      walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, thickness: 10 }, { id: 'bad', a: null, b: { x: 1, y: 1 } }] as never,
      furniture: [{ id: 'f1', type: 'chair', x: 1, y: 2, w: 45, d: 50, rot: 0 }, { id: 'f2', type: 'chair', x: 'нет', y: 2 }] as never,
      openings: [{ id: 'o1', kind: 'door', wallId: 'w1', t: 0.5, width: 80 }, { id: 'o2', kind: 'door', wallId: 'нет-такой', t: 0.5, width: 80 }] as never,
    })
    expect(p.walls.map((w) => w.id)).toEqual(['w1'])
    expect(p.furniture.map((f) => f.id)).toEqual(['f1'])
    expect(p.openings.map((o) => o.id)).toEqual(['o1'])
  })

  it('нулевые и нечисловые габариты предмета заменяются разумными', () => {
    const p = normalizePlan({ furniture: [{ id: 'f', type: 'box', x: 0, y: 0, w: 0, d: Number.NaN, rot: 'нет' }] as never })
    expect(p.furniture[0].w).toBeGreaterThan(0)
    expect(p.furniture[0].d).toBeGreaterThan(0)
    expect(p.furniture[0].rot).toBe(0)
  })

  it('план из ссылки проходит ту же проверку', async () => {
    const broken = await encodePlan({ ...emptyPlan(), furniture: [{ id: 'f', type: 'box', x: 0, y: 0, w: 0, d: 0, rot: 0 }] })
    const decoded = await decodePlan(broken)
    expect(decoded!.furniture[0].w).toBeGreaterThan(0)
  })
})
