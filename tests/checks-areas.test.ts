import { describe, expect, it } from 'vitest'
import { runChecks } from '../src/planner/checks'
import { buildRooms } from '../src/planner/rooms'
import { addRect } from '../src/planner/ops'
import { emptyPlan, type Plan } from '../src/planner/types'

/** одна комната заданных размеров в чистоте (стены 10 см) с именем */
function room(name: string, w: number, d: number): { plan: Plan; rooms: ReturnType<typeof buildRooms>['rooms'] } {
  const p0 = addRect(emptyPlan(), { x: 0, y: 0 }, { x: w + 10, y: d + 10 }, 10)
  const metas = buildRooms(p0).metas.map((m) => ({ ...m, name }))
  const plan = { ...p0, rooms: metas }
  return { plan, rooms: buildRooms(plan).rooms }
}
const texts = (name: string, w: number, d: number) => {
  const { plan, rooms } = room(name, w, d)
  return runChecks(plan, rooms).issues.map((i) => i.text)
}

describe('минимальные площади и ширины по СП 54.13330', () => {
  it('спальня 7 м² — замечание, 9 м² — нет', () => {
    expect(texts('Спальня 2', 250, 280).some((t) => /от 8 м²/.test(t))).toBe(true)
    expect(texts('Спальня', 300, 300).some((t) => /от 8 м²/.test(t))).toBe(false)
  })

  it('кухня 6 м² — «кухня-ниша от 5», коридор 70 см — уже 85, санузел 75 см — уже 80', () => {
    expect(texts('Кухня', 200, 300).some((t) => /кухня-ниша/.test(t))).toBe(true)
    expect(texts('Коридор', 70, 400).some((t) => /не уже 85/.test(t))).toBe(true)
    expect(texts('санузел', 75, 150).some((t) => /не уже 80/.test(t))).toBe(true)
    expect(texts('Прихожая', 150, 300).some((t) => /не уже/.test(t))).toBe(false)
  })

  it('кладовая и балкон без норм площади', () => {
    expect(texts('Кладовая', 100, 100).some((t) => /СП 54/.test(t))).toBe(false)
    expect(texts('Лоджия', 100, 300).some((t) => /СП 54/.test(t))).toBe(false)
  })
})
