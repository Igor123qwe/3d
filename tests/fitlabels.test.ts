import { describe, expect, it } from 'vitest'
import { fitAxis, fitToLabels } from '../src/planner/fitlabels'
import type { Wall } from '../src/planner/types'

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

  it('подпись, что расходится с картинкой сильнее 6 %, — ошибка чтения: стены не двигаются', () => {
    const res = fitToLabels(walls, [room('4ж', 0, 410, 310), room('2', 410, 762, 342)])
    expect(res.fixes).toEqual([])
    expect(res.walls).toBe(walls)
  })
})
