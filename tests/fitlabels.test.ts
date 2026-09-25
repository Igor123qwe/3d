import { describe, expect, it } from 'vitest'
import { fitAxis, fitToLabels } from '../src/planner/fitlabels'
import { buildRooms } from '../src/planner/rooms'
import type { Plan, Wall } from '../src/planner/types'

describe('размеры по подписям', () => {
  it('поправка ложится на комнату, толщина стены между комнатами не меняется', () => {
    // оси стен: 0 | комната 400 | стена 10 | комната 330
    const f = fitAxis([0, 400, 410, 740], [{ lo: 0, hi: 400, want: 390 }])
    expect(f(400) - f(0)).toBeCloseTo(390, 0)
    expect(f(410) - f(400)).toBeCloseTo(10, 0)
    expect(f(740) - f(410)).toBeCloseTo(330, 0)
  })

  it('две комнаты подряд тянутся каждая к своей подписи', () => {
    const f = fitAxis([0, 400, 410, 740], [
      { lo: 0, hi: 400, want: 405 },
      { lo: 410, hi: 740, want: 318 },
    ])
    expect(f(400) - f(0)).toBeCloseTo(405, 0)
    expect(f(740) - f(410)).toBeCloseTo(318, 0)
  })

  it('ступенька, которой нет на плане, сходится в ноль, а не сжимает комнаты', () => {
    // верх комнаты A на 0, верх соседней B на 12 (ошибка снимка), низ общий на 400;
    // подписи: обе глубиной 400
    const f = fitAxis([0, 12, 400], [
      { lo: 0, hi: 400, want: 400 },
      { lo: 12, hi: 400, want: 400 },
    ])
    expect(f(12) - f(0)).toBeCloseTo(0, 0)
    expect(f(400) - f(12)).toBeCloseTo(400, 0)
  })

  it('стена не становится тоньше половины нарисованной, даже если подписи просят', () => {
    // комната 300 | стена 20 | комната 280; общая подпись требует стену в ноль
    const f = fitAxis(
      [0, 300, 320, 600],
      [
        { lo: 0, hi: 300, want: 300 },
        { lo: 320, hi: 600, want: 280 },
        { lo: 0, hi: 600, want: 580 },
      ],
      [{ lo: 300, hi: 320 }],
    )
    expect(f(320) - f(300)).toBeGreaterThanOrEqual(10 - 0.01)
    expect(f(300) - f(0)).toBeGreaterThan(290)
  })

  const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 10 })
  // две комнаты 400 и 342 в чистоте по горизонтали: оси стен 0, 410, 762
  const walls = [wall('l', 0, 0, 0, 300), wall('m', 410, 0, 410, 300), wall('r', 762, 0, 762, 300), wall('t', 0, 0, 762, 0), wall('b', 0, 300, 762, 300)]
  const rect = (x1: number, x2: number) => [
    { x: x1, y: 0 },
    { x: x2, y: 0 },
    { x: x2, y: 300 },
    { x: x1, y: 300 },
  ]
  const room = (name: string, x1: number, x2: number, widthCm?: number) => ({ name, axes: rect(x1, x2), inner: rect(x1 + 5, x2 - 5), widthCm })

  it('подписанная ширина становится шириной в чистоте, оси соседних стен едут', () => {
    const res = fitToLabels(walls, [room('4ж', 0, 410, 401), room('2', 410, 762, 330)])
    const x = (id: string) => res.walls.find((w) => w.id === id)!.a.x
    expect(x('m') - x('l') - 10).toBeCloseTo(401, 0)
    expect(x('r') - x('m') - 10).toBeCloseTo(330, 0)
    expect(res.fixes.map((f) => `${f.name} ${f.fromCm}→${f.toCm}`)).toEqual(['4ж 400→401', '2 342→330'])
  })

  it('стыки остаются общими: соосные стены разной толщины и Т-стык едут вместе', () => {
    const w = (id: string, ax: number, ay: number, bx: number, by: number, thickness: number): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness })
    // слева две комнаты одна над другой, справа одна; средняя стена сверху 20, снизу 10
    const plan = [
      w('L', 0, 0, 0, 400, 40),
      w('R', 800, 0, 800, 400, 40),
      w('T', 0, 0, 800, 0, 40),
      w('B', 0, 400, 800, 400, 40),
      w('Mu', 400, 0, 400, 200, 20),
      w('Md', 400, 200, 400, 400, 10),
      w('H', 0, 200, 400, 200, 10),
    ]
    const asPlan = (walls: Wall[]): Plan => ({ version: 1, name: '', walls, openings: [], furniture: [], rooms: [], dims: [], settings: { grid: 10 } })
    const box = (x1: number, y1: number, x2: number, y2: number) => [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 },
    ]
    const res = fitToLabels(plan, [
      { name: 'a', axes: [], inner: box(20, 20, 390, 195), widthCm: 360 },
      { name: 'b', axes: [], inner: box(20, 205, 395, 380), widthCm: 368 },
      { name: 'c', axes: box(400, 0, 800, 400), inner: [...box(410, 20, 780, 380)], widthCm: 380 },
    ])
    expect(res.fixes.length).toBeGreaterThan(0)
    const at = (id: string) => res.walls.find((x) => x.id === id)!
    expect(at('Mu').a.x).toBeCloseTo(at('Md').a.x, 6)
    expect(at('H').b.x).toBeCloseTo(at('Mu').a.x, 6)
    expect(buildRooms(asPlan(res.walls)).rooms).toHaveLength(3)
  })

  it('ступенька не на месте: подписи, что стоят точно у своих граней, сходятся, даже если длина разошлась на 15 %', () => {
    const w = (id: string, ax: number, ay: number, bx: number, by: number, thickness = 10): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness })
    // комната 300 × 400 с нишей справа сверху: ниша по картинке 110 в высоту, стена под ней 290;
    // на плане — 129 и 271 (низ ниши распознан на 19 см выше)
    const walls = [
      w('t', 0, 0, 370, 0),
      w('l', 0, 0, 0, 400),
      w('b', 0, 400, 300, 400),
      w('r', 300, 110, 300, 400),
      w('nb', 300, 110, 370, 110),
      w('nr', 370, 0, 370, 110),
    ]
    const inner = [
      { x: 5, y: 5 },
      { x: 365, y: 5 },
      { x: 365, y: 105 },
      { x: 295, y: 105 },
      { x: 295, y: 395 },
      { x: 5, y: 395 },
    ]
    const res = fitToLabels(walls, [
      {
        name: '1',
        axes: [],
        inner,
        walls: [
          { side: 'right', at: 0.13, cm: 119 },
          { side: 'right', at: 0.63, cm: 271 },
        ],
      },
    ])
    const at = (id: string) => res.walls.find((x) => x.id === id)!
    const face = (id: string, s: number) => at(id).a.y + (s * at(id).thickness) / 2
    // низ ниши опустился: ниша 119 в чистоте, стена под ней 271
    expect(face('nb', -1) - face('t', 1)).toBeCloseTo(119, 0)
    expect(face('b', -1) - face('nb', -1)).toBeCloseTo(271, 0)
  })

  it('глубина не прочитана — у прямоугольной комнаты она из площади: 17,1 / 4,01 = 4,26', () => {
    const w = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 10 })
    const walls = [w('t', 0, 0, 411, 0), w('b', 0, 428, 411, 428), w('l', 0, 0, 0, 428), w('r', 411, 0, 411, 428)]
    const inner = [
      { x: 5, y: 5 },
      { x: 406, y: 5 },
      { x: 406, y: 423 },
      { x: 5, y: 423 },
    ]
    const res = fitToLabels(walls, [{ name: '4ж', axes: [], inner, widthCm: 401, areaM2: 17.1 }])
    const at = (id: string) => res.walls.find((x) => x.id === id)!
    expect(at('b').a.y - at('t').a.y - 10).toBeCloseTo(426, 0)
    // у комнаты не прямоугольной (закуток) площадь меньше рамки — так не считаем
    const notched = [...inner.slice(0, 2), { x: 406, y: 350 }, { x: 330, y: 350 }, { x: 330, y: 423 }, { x: 5, y: 423 }]
    const none = fitToLabels(walls, [{ name: '2', axes: [], inner: notched, widthCm: 401, areaM2: 16.2 }])
    expect(none.fixes.some((f) => f.axis === 'depth')).toBe(false)
  })

  describe('числа, прочитанные с картинки по месту', () => {
    const w = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 10 })
    // комната 360 × 390 в чистоте с нишей справа сверху: ниша по картинке 105 × 65,
    // на плане 1,29 × 0,68 (как у входа в прихожую)
    const walls = [w('t', 0, 0, 370, 0), w('l', 0, 0, 0, 400), w('b', 0, 400, 300, 400), w('r', 300, 110, 300, 400), w('nb', 300, 110, 370, 110), w('nr', 370, 0, 370, 110)]
    const inner = [
      { x: 5, y: 5 },
      { x: 365, y: 5 },
      { x: 365, y: 105 },
      { x: 295, y: 105 },
      { x: 295, y: 395 },
      { x: 5, y: 395 },
    ]
    const at = (res: ReturnType<typeof fitToLabels>, id: string) => res.walls.find((x) => x.id === id)!

    it('встают на грань, у которой стоят, без стороны и места от модели', () => {
      const res = fitToLabels(
        walls,
        [{ name: '1', axes: [], inner }],
        [
          // «1,29» боком у правой стены ниши, «0,68» над низом ниши
          { at: { x: 350, y: 55 }, alongX: false, cm: 119 },
          { at: { x: 330, y: 95 }, alongX: true, cm: 68 },
        ],
      )
      expect(res.wallLabels.placed).toEqual({ read: 2, matched: 2 })
      const face = (id: string, s: number) => at(res, id).a.y + (s * at(res, id).thickness) / 2
      expect(face('nb', -1) - face('t', 1)).toBeCloseTo(119, 0)
      const fx = (id: string, s: number) => at(res, id).a.x + (s * at(res, id).thickness) / 2
      // ниша — от грани комнаты (продолжение правой стены) до стены ниши
      expect(fx('nr', -1) - fx('r', -1)).toBeCloseTo(68, 0)
    })

    it('число не той длины или за концом грани стены не двигает', () => {
      const res = fitToLabels(
        walls,
        [{ name: '1', axes: [], inner }],
        [
          // у низа ниши (65 в чистоте) — 1,50: ошибка чтения
          { at: { x: 330, y: 95 }, alongX: true, cm: 150 },
          // у левой стены, но выше комнаты — не её число
          { at: { x: 20, y: -80 }, alongX: false, cm: 390 },
        ],
      )
      expect(res.wallLabels.placed).toEqual({ read: 2, matched: 0 })
      expect(res.walls).toBe(walls)
    })

    it('короткое число, чья грань сужена цифрами у стены, тянет её, если она одна на стороне', () => {
      // ниша в чистоте 70 × 100; модель: «1,00» внизу без места — ниша на картинке уже на 30 %
      const res = fitToLabels(walls, [{ name: '1', axes: [], inner, walls: [{ side: 'bottom', at: 0.5, cm: 100 }] }])
      expect(res.wallLabels.unmatched).toEqual([])
      const fx = (id: string, s: number) => at(res, id).a.x + (s * at(res, id).thickness) / 2
      expect(fx('nr', -1) - fx('r', -1)).toBeCloseTo(100, 0)
      // расходится больше чем на 45 % — ошибка чтения, не тянется
      const far = fitToLabels(walls, [{ name: '1', axes: [], inner, walls: [{ side: 'bottom', at: 0.5, cm: 150 }] }])
      expect(far.wallLabels.unmatched).toEqual([{ name: '1', side: 'bottom', cm: 150 }])
    })

    it('число во всю сторону заменяет ширину от модели, а подпись модели на ту же грань не идёт', () => {
      const res = fitToLabels(
        walls,
        [{ name: '1', axes: [], inner, depthCm: 380, walls: [{ side: 'left', at: 0.5, cm: 380 }] }],
        [{ at: { x: 30, y: 200 }, alongX: false, cm: 392 }],
      )
      expect(at(res, 'b').a.y - at(res, 't').a.y - 10).toBeCloseTo(392, 0)
      // подпись модели 380 — то же место, но другое число: грань занята, в «не нашли» она попадает
      expect(res.wallLabels.unmatched).toEqual([{ name: '1', side: 'left', cm: 380 }])
    })
  })

  it('подпись, что расходится с картинкой сильнее 6 %, — ошибка чтения: стены не двигаются', () => {
    const res = fitToLabels(walls, [room('4ж', 0, 410, 310), room('2', 410, 762, 342)])
    expect(res.fixes).toEqual([])
    expect(res.walls).toBe(walls)
  })
})
