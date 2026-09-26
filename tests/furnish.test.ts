import { describe, expect, it } from 'vitest'
import { furnish, type FurnishDeps } from '../src/planner/furnish'
import { buildRooms } from '../src/planner/rooms'
import { emptyPlan, type Plan, type Wall } from '../src/planner/types'
import type { LayoutAsk, ZonesAsk } from '../src/planner/ai'

const w = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 10 })

/** две комнаты 400 × 400 с метаданными, как их держит страница */
function flat(): Plan {
  const p: Plan = { ...emptyPlan(), walls: [w('t', 0, 0, 800, 0), w('b', 0, 400, 800, 400), w('l', 0, 0, 0, 400), w('r', 800, 0, 800, 400), w('m', 400, 0, 400, 400)] }
  const metas = buildRooms(p).metas.map((m, i) => ({ ...m, name: i === 0 ? 'Комната' : 'Комната 2' }))
  return { ...p, rooms: metas }
}

/** модель: кровать (или первое из присланного каталога) в середине комнаты и мусорный тип, который должен отсеяться */
function fakeDeps(log: { zones: ZonesAsk[]; layout: LayoutAsk[] }, over: Partial<FurnishDeps> = {}): FurnishDeps {
  return {
    zones: async (ask) => {
      log.zones.push(ask)
      return { rooms: ask.rooms.map((r, i) => ({ id: r.id, purpose: i === 0 ? 'Спальня' : 'Детская', why: 'тест' })), ai: { model: 'fake', costRub: 0.1 } }
    },
    layout: async (ask) => {
      log.layout.push(ask)
      const xs = ask.polygon.map((q) => q.x)
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2
      // как настоящая модель: только из присланного каталога
      const pick = (ask.catalog.find((c) => /bed/.test(c.type)) ?? ask.catalog[0]).type
      return {
        items: [
          { type: pick, x: cx, y: 200, rot: 0, why: 'в середине' },
          { type: 'нет-такого', x: cx, y: 200, rot: 0, why: 'должен отсеяться' },
        ],
        ai: { model: 'fake', costRub: 0.2 },
      }
    },
    ...over,
  }
}

describe('расстановка с ИИ по пожеланиям', () => {
  it('вся квартира: зонирование, по вопросу на комнату с назначением и пожеланиями, проверка геометрией, переименование', async () => {
    const log = { zones: [] as ZonesAsk[], layout: [] as LayoutAsk[] }
    const plan = flat()
    const rooms = buildRooms(plan).rooms
    const rep = await furnish(plan, rooms, { scope: 'all', wishes: 'двое взрослых и ребёнок', replace: false, rename: true }, fakeDeps(log))
    expect(log.zones).toHaveLength(1)
    expect(log.zones[0].wishes).toBe('двое взрослых и ребёнок')
    expect(log.layout.map((a) => a.purpose).sort()).toEqual(['Детская', 'Спальня'])
    expect(log.layout.every((a) => a.wishes === 'двое взрослых и ребёнок' && a.apartment?.length === 2)).toBe(true)
    // в каждой комнате встала кровать, мусорный тип отсеян
    expect(rep.plan.furniture.filter((f) => /bed/.test(f.type))).toHaveLength(2)
    // кровать и то, что встало к ней (тумбы у изголовья), мусорный тип отклонён
    expect(rep.rooms.every((r) => r.placed >= 1 && r.rejected === 1)).toBe(true)
    // комнаты переименованы по назначению
    expect(rep.plan.rooms.map((m) => m.name).sort()).toEqual(['Детская', 'Спальня'])
    expect(rep.costs).toHaveLength(3)
  })

  it('одна комната с назначением руками — без зонирования; стоящая мебель уходит в existing', async () => {
    const log = { zones: [] as ZonesAsk[], layout: [] as LayoutAsk[] }
    const plan0 = flat()
    const rooms = buildRooms(plan0).rooms
    const room = rooms[0]
    const xs = room.polygon.map((q) => q.x)
    const plan: Plan = { ...plan0, furniture: [{ id: 'd', type: 'desk', x: (Math.min(...xs) + Math.max(...xs)) / 2, y: 60, w: 120, d: 60, rot: 0 }] }
    const rep = await furnish(plan, rooms, { scope: room.meta.id, wishes: '', replace: false, rename: false, purpose: 'Кабинет' }, fakeDeps(log))
    expect(log.zones).toHaveLength(0)
    expect(log.layout).toHaveLength(1)
    expect(log.layout[0].purpose).toBe('Кабинет')
    expect(log.layout[0].existing?.map((f) => f.type)).toEqual(['desk'])
    // в каталоге кабинета кровати нет: встаёт первое из каталога, стоящий стол на месте
    const types = rep.plan.furniture.map((f) => f.type)
    expect(types).toHaveLength(2)
    expect(types).toContain('desk')
    expect(types.filter((t) => /bed/.test(t))).toEqual([])
    const kept = rep.plan.furniture.find((f) => f.id === 'd')!
    expect(kept.x).toBe(plan.furniture[0].x)
  })

  it('«заменить»: старая мебель в комнате уходит, электрика остаётся', async () => {
    const log = { zones: [] as ZonesAsk[], layout: [] as LayoutAsk[] }
    const plan0 = flat()
    const rooms = buildRooms(plan0).rooms
    const room = rooms[0]
    const xs = room.polygon.map((q) => q.x)
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const plan: Plan = {
      ...plan0,
      furniture: [
        { id: 'old', type: 'sofa-3', x: cx, y: 320, w: 220, d: 95, rot: 0 },
        { id: 'sock', type: 'outlet', x: cx, y: 395, w: 8, d: 4, rot: 180, electric: { kind: 'outlet', why: '', height: 30 } },
      ],
    }
    const rep = await furnish(plan, rooms, { scope: room.meta.id, wishes: '', replace: true, rename: false }, fakeDeps(log))
    expect(log.layout[0].existing).toBeUndefined()
    expect(rep.plan.furniture.map((f) => f.id).includes('old')).toBe(false)
    expect(rep.plan.furniture.some((f) => f.id === 'sock')).toBe(true)
  })

  it('зонирование не удалось — назначения по именам, расстановка всё равно идёт; ошибка комнаты — в отчёте', async () => {
    const log = { zones: [] as ZonesAsk[], layout: [] as LayoutAsk[] }
    const plan = flat()
    const rooms = buildRooms(plan).rooms
    let n = 0
    const deps = fakeDeps(log, {
      zones: async () => {
        throw new Error('сеть')
      },
    })
    const inner = deps.layout
    deps.layout = async (ask) => {
      if (n++ === 0) throw new Error('модель молчит')
      return inner(ask)
    }
    const rep = await furnish(plan, rooms, { scope: 'all', wishes: 'кабинет', replace: false, rename: true }, deps)
    expect(rep.zoningFailed).toBe('сеть')
    expect(rep.rooms.filter((r) => r.error)).toHaveLength(1)
    expect(rep.rooms.filter((r) => r.placed >= 1)).toHaveLength(1)
    // без зонирования имена не трогаем
    expect(rep.plan.rooms.map((m) => m.name).sort()).toEqual(['Комната', 'Комната 2'])
  })
})
