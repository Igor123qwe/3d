import { describe, expect, it } from 'vitest'
import {
  angleDiff,
  convexOverlap,
  fmtArea,
  fmtLen,
  interiorPoint,
  obbCorners,
  offsetPolygon,
  pointInPoly,
  polyArea,
  polyPerimeter,
  projectT,
  removeSpikes,
  roundTo,
  rotate,
  segIntersect,
} from '../src/planner/geometry'
import type { Pt } from '../src/planner/types'

const P = (x: number, y: number): Pt => ({ x, y })
const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe('базовая математика', () => {
  it('округление к шагу сетки', () => {
    expect(roundTo(123, 10)).toBe(120)
    expect(roundTo(125, 10)).toBe(130)
    expect(roundTo(42, 0)).toBe(42) // нулевой шаг не ломает значение
  })

  it('разница углов не превышает 180°', () => {
    expect(angleDiff(10, 350)).toBe(20)
    expect(angleDiff(-90, 90)).toBe(180)
    expect(angleDiff(370, 10)).toBe(0)
  })

  it('поворот точки на 90° против осей экрана', () => {
    const r = rotate(P(10, 0), 90)
    near(r.x, 0)
    near(r.y, 10)
  })

  it('проекция точки на прямую', () => {
    near(projectT(P(5, 3), P(0, 0), P(10, 0)), 0.5)
    expect(projectT(P(5, 3), P(2, 2), P(2, 2))).toBe(0) // вырожденный отрезок
  })

  it('пересечение отрезков', () => {
    const x = segIntersect(P(0, 0), P(10, 0), P(5, -5), P(5, 5))
    expect(x).not.toBeNull()
    near(x!.t, 0.5)
    near(x!.p.x, 5)
    expect(segIntersect(P(0, 0), P(10, 0), P(0, 1), P(10, 1))).toBeNull() // параллельные
  })
})

describe('многоугольники', () => {
  const square = [P(0, 0), P(100, 0), P(100, 100), P(0, 100)]

  it('площадь и периметр', () => {
    expect(Math.abs(polyArea(square))).toBe(10000)
    expect(polyPerimeter(square)).toBe(400)
  })

  it('точка внутри и снаружи', () => {
    expect(pointInPoly(P(50, 50), square)).toBe(true)
    expect(pointInPoly(P(150, 50), square)).toBe(false)
  })

  it('внутренний отступ уменьшает контур на заданную величину', () => {
    const inner = offsetPolygon(square, [10, 10, 10, 10])
    expect(Math.abs(polyArea(inner))).toBe(80 * 80)
  })

  it('разные отступы на разных сторонах', () => {
    const inner = offsetPolygon(square, [20, 10, 20, 10])
    expect(Math.abs(polyArea(inner))).toBe(80 * 60)
  })

  it('удаление шипов контура', () => {
    const spiky = [P(0, 0), P(100, 0), P(150, 0), P(100, 0), P(100, 100), P(0, 100)]
    expect(removeSpikes(spiky).length).toBe(4)
  })

  it('внутренняя точка лежит внутри', () => {
    const l = [P(0, 0), P(100, 0), P(100, 50), P(50, 50), P(50, 100), P(0, 100)]
    expect(pointInPoly(interiorPoint(l), l)).toBe(true)
  })
})

describe('пересечение прямоугольников (SAT)', () => {
  it('накладывающиеся прямоугольники пересекаются', () => {
    const a = obbCorners(0, 0, 100, 100, 0)
    const b = obbCorners(50, 50, 100, 100, 0)
    expect(convexOverlap(a, b)).toBe(true)
  })

  it('соседние прямоугольники впритык не считаются пересечением', () => {
    const a = obbCorners(0, 0, 100, 100, 0)
    const b = obbCorners(100, 0, 100, 100, 0)
    expect(convexOverlap(a, b, 1.5)).toBe(false)
  })

  it('повёрнутый прямоугольник задевает соседа', () => {
    const a = obbCorners(0, 0, 100, 20, 0)
    const b = obbCorners(60, 0, 100, 20, 45)
    expect(convexOverlap(a, b)).toBe(true)
  })

  it('далёкие прямоугольники не пересекаются', () => {
    expect(convexOverlap(obbCorners(0, 0, 50, 50, 0), obbCorners(500, 500, 50, 50, 30))).toBe(false)
  })
})

describe('форматирование', () => {
  it('единицы длины', () => {
    expect(fmtLen(150, 'cm')).toContain('150')
    expect(fmtLen(150, 'mm')).toBe('1500')
    expect(fmtLen(150, 'm')).toContain('1,5')
  })

  it('площадь в м²', () => {
    expect(fmtArea(20.15)).toContain('м²')
  })
})
