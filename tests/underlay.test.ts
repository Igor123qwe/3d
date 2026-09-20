import { describe, expect, it } from 'vitest'
import { calibrate, detectWalls, joinCorners, mergeCollinear, nameFromFile, planFromImage, toPixel, toPlan, tracePlan } from '../src/planner/underlay'
import { buildRooms } from '../src/planner/rooms'
import { emptyPlan, type Underlay } from '../src/planner/types'
import { dist } from '../src/planner/geometry'

const W = 420
const H = 320

/** рисуем синтетический план: белый лист, чёрные стены, тонкие размерные линии и «текст» */
function makePlan(): Uint8Array {
  const g = new Uint8Array(W * H).fill(255)
  const rect = (x0: number, y0: number, x1: number, y1: number, v = 0) => {
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) g[y * W + x] = v
    }
  }
  const T = 6 // толщина стены
  // наружный контур 20..400 × 20..300
  rect(20, 20, 400, 20 + T)
  rect(20, 300 - T, 400, 300)
  rect(20, 20, 20 + T, 300)
  rect(400 - T, 20, 400, 300)
  // перегородка
  rect(240, 20, 240 + T, 300)
  // размерные линии (тонкие) — распознаваться не должны
  rect(20, 8, 400, 9)
  rect(8, 20, 9, 300)
  // «текст»: короткие толстые мазки внутри комнаты
  rect(90, 150, 130, 160)
  rect(300, 150, 330, 162)
  return g
}

const OPTS = { threshold: 128, minLength: 60, minThickness: 3, maxThickness: 20 }

describe('распознавание стен на растре плана', () => {
  const segs = mergeCollinear(joinCorners(detectWalls(makePlan(), W, H, OPTS), 14), 14)

  it('находит все пять стен и не находит лишнего', () => {
    expect(segs.length).toBe(5)
    expect(segs.filter((s) => s.dir === 'h').length).toBe(2)
    expect(segs.filter((s) => s.dir === 'v').length).toBe(3)
  })

  it('тонкие размерные линии и текст отброшены', () => {
    // ни один отрезок не проходит по строке 8 (размерная линия) и не короче 60 px
    expect(segs.every((s) => Math.abs(s.a.y - 8) > 5 || s.dir !== 'h')).toBe(true)
    expect(segs.every((s) => dist(s.a, s.b) >= 60)).toBe(true)
  })

  it('толщина стены определена верно', () => {
    for (const s of segs) expect(s.thickness, `${s.dir}`).toBeGreaterThanOrEqual(5)
    for (const s of segs) expect(s.thickness).toBeLessThanOrEqual(9)
  })

  it('углы сведены: контур замыкается и комнаты находятся', () => {
    const u: Underlay = { src: '', px: { w: W, h: H }, x: 0, y: 0, scale: 2, opacity: 1, visible: true, locked: false }
    const { walls } = tracePlan(makePlan(), u, { sensitivity: 50, minLengthCm: 100, maxThicknessCm: 60, maxGapCm: 0 })
    const { rooms } = buildRooms({ ...emptyPlan(), walls })
    expect(rooms.length).toBe(2)
    // масштаб 2 см/px: комнаты примерно (440×548) и (320×548) см
    const areas = rooms.map((r) => r.area).sort((a, b) => a - b)
    expect(areas[0]).toBeGreaterThan(14)
    expect(areas[0]).toBeLessThan(20)
    expect(areas[1]).toBeGreaterThan(21)
    expect(areas[1]).toBeLessThan(27)
  })

  it('пустая картинка не даёт стен', () => {
    expect(detectWalls(new Uint8Array(W * H).fill(255), W, H, OPTS)).toEqual([])
    expect(detectWalls(new Uint8Array(4), 2, 2, OPTS)).toEqual([])
  })
})

describe('калибровка масштаба', () => {
  const base: Underlay = { src: '', px: { w: 400, h: 300 }, x: 100, y: 50, scale: 2, opacity: 1, visible: true, locked: false }

  it('перевод координат туда и обратно', () => {
    const p = { x: 300, y: 200 }
    const back = toPlan(base, toPixel(base, p))
    expect(back.x).toBeCloseTo(p.x)
    expect(back.y).toBeCloseTo(p.y)
  })

  it('после калибровки отрезок имеет заданную длину', () => {
    const a = { x: 100, y: 50 } // левый верхний угол картинки
    const b = { x: 300, y: 50 } // 100 px вправо при масштабе 2
    const u = calibrate(base, a, b, 372) // на плане это 3,72 м
    expect(u.scale).toBeCloseTo(3.72)
    // первая точка осталась на месте
    expect(toPlan(u, toPixel(base, a)).x).toBeCloseTo(a.x)
    // и отрезок теперь действительно 372 см
    const pa = toPixel(u, a)
    const pb = { x: pa.x + 100, y: pa.y }
    expect(dist(toPlan(u, pa), toPlan(u, pb))).toBeCloseTo(372)
  })

  it('вырожденная калибровка игнорируется', () => {
    expect(calibrate(base, { x: 0, y: 0 }, { x: 0, y: 0 }, 100)).toBe(base)
    expect(calibrate(base, { x: 0, y: 0 }, { x: 100, y: 0 }, 0)).toBe(base)
  })
})

describe('новый проект по картинке', () => {
  it('имя проекта берётся из имени файла, служебные имена — нет', () => {
    expect(nameFromFile('квартира-87.png', 'Новая квартира')).toBe('квартира-87')
    expect(nameFromFile('Plan 2k.JPEG', 'Новая квартира')).toBe('Plan 2k')
    expect(nameFromFile('буфер.png', 'Новая квартира')).toBe('Новая квартира')
    expect(nameFromFile('image.png', 'Новая квартира')).toBe('Новая квартира')
    expect(nameFromFile('Снимок экрана 2026-09-20 в 12.00.png', 'Новая квартира')).toBe('Новая квартира')
    expect(nameFromFile('Screenshot_20260920.png', 'Новая квартира')).toBe('Новая квартира')
    expect(nameFromFile(undefined, 'Новая квартира')).toBe('Новая квартира')
    expect(nameFromFile('x'.repeat(80) + '.png', 'Н')).toHaveLength(60)
  })

  it('чистый лист с подложкой по центру, настройки прежнего проекта сохраняются', () => {
    const p = planFromImage({ src: 'data:,', w: 1000, h: 500 }, 'Схема', { grid: 5 })
    expect(p.name).toBe('Схема')
    expect(p.walls).toHaveLength(0)
    expect(p.furniture).toHaveLength(0)
    expect(p.settings.grid).toBe(5)
    const u = p.underlay!
    expect(u.px).toEqual({ w: 1000, h: 500 })
    // ширина картинки считается 10 м, картинка лежит вокруг начала координат
    expect(u.x + (u.px.w * u.scale) / 2).toBeCloseTo(0)
    expect(u.y + (u.px.h * u.scale) / 2).toBeCloseTo(0)
    expect(u.px.w * u.scale).toBeCloseTo(1000)
    // без настроек — значения по умолчанию
    expect(planFromImage({ src: 'data:,', w: 10, h: 10 }, 'Схема').settings.grid).toBe(10)
  })
})
