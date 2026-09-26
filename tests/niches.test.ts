import { describe, expect, it } from 'vitest'
import { findNiches, nicheSpot } from '../src/planner/niches'

const P = (...xy: number[]) => Array.from({ length: xy.length / 2 }, (_, i) => ({ x: xy[i * 2], y: xy[i * 2 + 1] }))

describe('ниши комнаты', () => {
  it('спальня пользователя: углубление 83 × 258 справа от кровати — ниша, открытая влево', () => {
    const room = P(0, 0, 371, 0, 371, 258, 288, 258, 288, 409, 0, 409)
    const n = findNiches(room, { doors: [{ x: 288, y: 341 }] })
    expect(n).toHaveLength(1)
    expect(n[0]).toMatchObject({ x0: 288, x1: 371, y0: 0, y1: 258, open: 'left', depth: 83, width: 258, window: false })
    // шкаф глубиной 60 — спинкой к правой стене ниши, по её центру
    expect(nicheSpot(n[0], 200, 60)).toMatchObject({ x: 340.5, y: 129, rot: 90 })
  })

  it('в прямоугольной комнате ниш нет', () => {
    expect(findNiches(P(0, 0, 400, 0, 400, 300, 0, 300))).toEqual([])
  })

  it('вентшахта в углу — не ниша: полоса за ней мельче 45 см', () => {
    expect(findNiches(P(0, 0, 360, 0, 360, 40, 400, 40, 400, 400, 0, 400))).toEqual([])
  })

  it('карман с дверью — проход, а не ниша', () => {
    const room = P(0, 0, 371, 0, 371, 258, 288, 258, 288, 409, 0, 409)
    expect(findNiches(room, { doors: [{ x: 371, y: 120 }] })).toEqual([])
  })

  it('ниша с окном помечена', () => {
    const room = P(0, 0, 371, 0, 371, 258, 288, 258, 288, 409, 0, 409)
    expect(findNiches(room, { windows: [{ x: 371, y: 120 }] })[0].window).toBe(true)
  })

  it('косые стены — ниши не ищутся', () => {
    expect(findNiches(P(0, 0, 400, 30, 380, 300, 200, 320, 0, 300))).toEqual([])
  })
})
