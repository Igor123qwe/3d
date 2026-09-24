import { describe, expect, it } from 'vitest'
import type { AiRoom } from '../src/planner/aicontract'
import type { RoomRegion } from '../src/planner/raster'
import { regionNeighbors, roomsFromRegions } from '../src/planner/segment'

const px = { w: 900, h: 1000 }
/** области, как их даёт сегментация квартиры с плана БТИ (1 px = 1 см) */
const region = (x1: number, y1: number, x2: number, y2: number): RoomRegion => ({ x1, y1, x2, y2, areaPx: (x2 - x1) * (y2 - y1), points: (x2 - x1) * (y2 - y1), fill: 0.97, fillBox: 0.97, edges: 0, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 })
const REGIONS: RoomRegion[] = [
  region(40, 40, 412, 448), // 5ж 15.2
  region(422, 40, 602, 298), // 6 4.6
  region(422, 308, 602, 448), // коридор 2.5
  region(612, 40, 846, 448), // 1 9.5
  region(40, 458, 441, 884), // 4ж 17.1
  region(451, 458, 846, 884), // 2 16.8
]
const label = (name: string, areaM2: number, x: number, y: number, extra: Partial<AiRoom> = {}): AiRoom => ({ name, areaM2, x: x / px.w, y: y / px.h, ...extra })

describe('соседство областей', () => {
  it('у 5ж справа 6 и коридор, снизу 4ж; наружные стороны — левая и верхняя', () => {
    const adj = regionNeighbors(REGIONS, 30)
    expect(adj[0].neighbors.right).toEqual([1, 2])
    expect(adj[0].neighbors.bottom).toEqual([4])
    expect(adj[0].outer.sort()).toEqual(['left', 'top'])
    expect(adj[5].neighbors.left).toEqual([4])
    expect(adj[5].neighbors.top?.sort()).toEqual([2, 3])
  })
})

describe('подписи модели к областям', () => {
  it('по точкам внутри областей; безымянные получают номер; соседи — по именам', () => {
    const ai = [label('5ж', 15.2, 200, 200), label('6', 4.6, 500, 150), label('1', 9.5, 700, 200), label('4ж', 17.1, 200, 650), label('2', 16.8, 650, 650)]
    const r = roomsFromRegions(REGIONS, px, ai, 30)
    expect(r.matched).toBe(5)
    expect(r.unmatched).toEqual([])
    expect(r.rooms.map((x) => x.name)).toEqual(['5ж', '6', 'Помещение 3', '1', '4ж', '2'])
    expect(r.rooms[0].neighbors?.right).toEqual(['6', 'Помещение 3'])
    expect(r.rooms[0].outer?.sort()).toEqual(['left', 'top'])
    expect(r.cmPerPx).toBeCloseTo(1, 1)
    // геометрия — с области, а не с рамки модели
    expect(r.rooms[0].box!).toEqual({ x1: 40 / px.w, y1: 40 / px.h, x2: 412 / px.w, y2: 448 / px.h })
  })

  it('точки промахнулись — подписи находят области по площадям, масштаб — из совпадений', () => {
    // все точки в одном месте (модель их не читает), площади при этом верные
    const ai = [label('5ж', 15.2, 5, 5), label('6', 4.6, 5, 5), label('1', 9.5, 5, 5), label('4ж', 17.1, 5, 5), label('2', 16.8, 5, 5)]
    const r = roomsFromRegions(REGIONS, px, ai, 30)
    expect(r.matched).toBe(5)
    expect(r.rooms.find((x) => x.name === '4ж')!.box!.x1).toBeCloseTo(40 / px.w, 5)
    expect(r.cmPerPx).toBeCloseTo(1, 1)
  })

  it('выдуманная комната без области остаётся непристроенной', () => {
    const ai = [label('5ж', 15.2, 200, 200), label('Санузел', 4.5, 445, 650), label('4ж', 17.1, 200, 650), label('2', 16.8, 650, 650)]
    const r = roomsFromRegions(REGIONS, px, ai, 30)
    // «санузел» попал точкой в 4ж, но 4ж уже занята своей подписью; по площади ему подходит только «6» (4.6),
    // однако 6 подписи не получила — так что санузел сядет на область 6 по площади
    expect(r.rooms).toHaveLength(6)
    expect(r.unmatched.length + r.matched).toBe(4)
  })
})

describe('Г-образные комнаты', () => {
  it('подпись в вырезе Г-образной комнаты достаётся соседу, чья она на самом деле', () => {
    // рамка гостиной накрывает начало коридора, но контур — нет
    const poly = [
      { x: 40, y: 40 },
      { x: 440, y: 40 },
      { x: 440, y: 300 },
      { x: 300, y: 300 },
      { x: 300, y: 440 },
      { x: 40, y: 440 },
    ]
    const regions = [{ ...region(40, 40, 440, 440), poly }, region(300, 300, 700, 440)]
    const r = roomsFromRegions(regions, px, [label('Коридор', 5.6, 400, 400)], 30)
    expect(r.rooms[0].name).toBe('Помещение 1')
    expect(r.rooms[1].name).toBe('Коридор')
  })
})

describe('одно имя на двух комнатах', () => {
  it('имя остаётся там, где сходится площадь; у второй подпись снимается, спорной она не считается', () => {
    const regions = [region(0, 0, 100, 100), region(200, 0, 400, 200), region(500, 0, 600, 100)]
    // «6» прочитан и на своём санузле, и на фрагменте соседки, куда он попал
    const r = roomsFromRegions(regions, px, [label('А', 1, 50, 50), label('6', 1, 550, 50), label('6', 1, 300, 100)], 30)
    expect(r.rooms.map((x) => x.name)).toEqual(['А', 'Помещение 2', '6'])
    expect(r.rooms[1].areaM2).toBeUndefined()
    expect(r.disputes.filter((d) => d.room === '6')).toEqual([])
  })
})
