import { describe, expect, it } from 'vitest'
import { buildRooms, detectFaces } from '../src/planner/rooms'
import { pointInPoly } from '../src/planner/geometry'
import { emptyPlan, type Plan, type Wall } from '../src/planner/types'

const W = (id: string, ax: number, ay: number, bx: number, by: number, th = 20): Wall => ({
  id,
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  thickness: th,
})

const planOf = (walls: Wall[]): Plan => ({ ...emptyPlan(), walls })
const areas = (walls: Wall[]) =>
  buildRooms(planOf(walls))
    .rooms.map((r) => Number(r.area.toFixed(2)))
    .sort((a, b) => a - b)

const box = (w: number, h: number, th: number): Wall[] => [
  W('t', 0, 0, w, 0, th),
  W('r', w, 0, w, h, th),
  W('b', w, h, 0, h, th),
  W('l', 0, h, 0, 0, th),
]

describe('поиск комнат по контурам стен', () => {
  it('прямоугольник даёт одну комнату с площадью по внутренним граням', () => {
    // оси 600×400, стены 40 → внутри 560×360 = 20,16 м²
    expect(areas(box(600, 400, 40))).toEqual([20.16])
  })

  it('незамкнутый контур комнатой не становится', () => {
    expect(areas(box(600, 400, 40).slice(0, 3))).toEqual([])
  })

  it('перегородка делит комнату на две', () => {
    const walls = [...box(600, 400, 40), W('p', 250, 0, 250, 400, 10)]
    // слева (250-20-5)=225×360, справа (350-20-5)=325×360
    expect(areas(walls)).toEqual([8.1, 11.7])
  })

  it('висячая перегородка не создаёт лишнюю комнату', () => {
    const walls = [...box(600, 400, 40), W('p', 250, 0, 250, 400, 10), W('free', 400, 400, 400, 250, 10)]
    expect(areas(walls)).toEqual([8.1, 11.7])
  })

  it('L-образная комната распознаётся как одна', () => {
    const l = [
      W('a', 0, 0, 500, 0),
      W('b', 500, 0, 500, 200),
      W('c', 500, 200, 300, 200),
      W('d', 300, 200, 300, 400),
      W('e', 300, 400, 0, 400),
      W('f', 0, 400, 0, 0),
    ]
    const rooms = buildRooms(planOf(l)).rooms
    expect(rooms.length).toBe(1)
    expect(rooms[0].inner.length).toBe(6)
  })

  it('пересекающиеся стены делят план на четыре комнаты', () => {
    const walls = [...box(600, 400, 40), W('h', 0, 200, 600, 200, 10), W('v', 300, 0, 300, 400, 10)]
    expect(areas(walls)).toEqual([4.81, 4.81, 4.81, 4.81])
  })

  it('два отдельных контура дают две комнаты', () => {
    const walls = [...box(600, 400, 40), ...box(300, 300, 20).map((w, i) => ({ ...w, id: `x${i}`, a: { x: w.a.x + 800, y: w.a.y }, b: { x: w.b.x + 800, y: w.b.y } }))]
    expect(buildRooms(planOf(walls)).rooms.length).toBe(2)
  })

  it('пустой план не падает', () => {
    expect(buildRooms(emptyPlan()).rooms).toEqual([])
  })
})

describe('устойчивость метаданных', () => {
  // Г-образный коридор: центроид контура лежит снаружи, и раньше якорь комнаты
  // оказывался вне её границ — тогда комната не «узнавалась» и метаданные
  // плодились на каждом пересчёте, подвешивая интерфейс.
  const corridor = (width: number, size: number): Wall[] => [
    W('a', 0, 0, size, 0),
    W('b', size, 0, size, width),
    W('c', size, width, width, width),
    W('d', width, width, width, size),
    W('e', width, size, 0, size),
    W('f', 0, size, 0, 0),
  ]

  it('повторные пересчёты не плодят метаданные', () => {
    let plan = planOf(corridor(50, 700))
    for (let i = 0; i < 6; i++) {
      const r = buildRooms(plan)
      plan = { ...plan, rooms: r.metas }
      expect(r.rooms.length).toBe(1)
      expect(r.metas.length).toBe(1)
    }
  })

  it('второй пересчёт не меняет метаданные', () => {
    const plan = planOf(corridor(60, 500))
    const first = buildRooms(plan)
    const second = buildRooms({ ...plan, rooms: first.metas })
    expect(second.metas).toEqual(first.metas)
  })

  it('якорь комнаты лежит внутри её контура', () => {
    for (const width of [40, 50, 80, 150]) {
      for (const size of [300, 600, 700, 1000]) {
        const { rooms } = buildRooms(planOf(corridor(width, size)))
        expect(rooms.length, `${width}×${size}`).toBe(1)
        expect(pointInPoly(rooms[0].meta.anchor, rooms[0].polygon), `${width}×${size}`).toBe(true)
      }
    }
  })

  it('якорь лежит внутри и для обычных комнат', () => {
    const { rooms } = buildRooms(planOf(box(600, 400, 40)))
    expect(pointInPoly(rooms[0].meta.anchor, rooms[0].polygon)).toBe(true)
  })
})

describe('имена и метаданные комнат', () => {
  it('маленькой комнате достаётся имя санузла и плитка', () => {
    const { rooms } = buildRooms(planOf(box(200, 200, 10)))
    expect(rooms[0].meta.name).toBe('Санузел')
    expect(rooms[0].meta.floor).toBe('tile')
  })

  it('имя и пол сохраняются при изменении стен', () => {
    const plan = planOf(box(600, 400, 40))
    const first = buildRooms(plan)
    const named = { ...plan, rooms: first.metas.map((m) => ({ ...m, name: 'Моя комната', floor: 'parquet' as const })) }
    // двигаем стену — комната должна остаться той же
    const moved: Plan = {
      ...named,
      walls: named.walls.map((w) => ({ ...w, a: { ...w.a, x: w.a.x === 600 ? 700 : w.a.x }, b: { ...w.b, x: w.b.x === 600 ? 700 : w.b.x } })),
    }
    const after = buildRooms(moved)
    expect(after.rooms[0].meta.name).toBe('Моя комната')
    expect(after.rooms[0].meta.floor).toBe('parquet')
  })

  it('исчезнувшая комната не занимает своё имя навсегда', () => {
    const first = buildRooms(planOf(box(600, 400, 40)))
    // стены стёрли, но метаданные остались в плане; рисуем комнату в другом месте
    const elsewhere = box(500, 500, 20).map((w, i) => ({
      ...w,
      id: `n${i}`,
      a: { x: w.a.x + 2000, y: w.a.y },
      b: { x: w.b.x + 2000, y: w.b.y },
    }))
    const { rooms } = buildRooms({ ...planOf(elsewhere), rooms: first.metas })
    expect(rooms[0].meta.name).toBe('Гостиная')
  })

  it('имена комнат не повторяются', () => {
    const walls = [...box(600, 400, 40), W('p', 250, 0, 250, 400, 10)]
    const { rooms } = buildRooms(planOf(walls))
    expect(new Set(rooms.map((r) => r.meta.name)).size).toBe(rooms.length)
  })
})
