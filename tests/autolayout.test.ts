import { describe, expect, it } from 'vitest'
import type { Plan, Room } from '../src/planner/types'
import { CATALOG } from '../src/planner/catalog'
import { buildRooms } from '../src/planner/rooms'
import { addOpening, addRect } from '../src/planner/ops'
import { applyLayout, catalogForRoom, layoutSummary, snapToWall, vetLayout, type PlacementCheck } from '../src/planner/autolayout'
import { furnitureBody, runChecks, wallBody } from '../src/planner/checks'
import { convexOverlap, pointInPoly } from '../src/planner/geometry'

const empty: Plan = {
  version: 1,
  name: 'тест',
  walls: [],
  openings: [],
  furniture: [],
  rooms: [],
  dims: [],
  settings: { grid: 10 },
}

/** комната 5 × 4 м по осям стен */
function room(): { plan: Plan; room: Room } {
  const plan = addRect(empty, { x: 0, y: 0 }, { x: 500, y: 400 }, 20)
  const { rooms } = buildRooms(plan)
  return { plan, room: rooms[0] }
}

/** предмет встал честно: внутри чистового контура, мимо стен и других предметов */
function honest(c: PlacementCheck, r: Room, plan: Plan, others: PlacementCheck[] = []) {
  expect(c.ok).toBe(true)
  const body = furnitureBody(c.furniture!)
  for (const p of body) {
    const inside = pointInPoly(p, r.inner) || r.inner.some((q, i) => {
      const n = r.inner[(i + 1) % r.inner.length]
      const L2 = (n.x - q.x) ** 2 + (n.y - q.y) ** 2
      const t = Math.max(0, Math.min(1, ((p.x - q.x) * (n.x - q.x) + (p.y - q.y) * (n.y - q.y)) / L2))
      return Math.hypot(p.x - (q.x + t * (n.x - q.x)), p.y - (q.y + t * (n.y - q.y))) <= 2
    })
    expect(inside, `угол ${Math.round(p.x)},${Math.round(p.y)} внутри комнаты`).toBe(true)
  }
  for (const w of plan.walls) expect(convexOverlap(body, wallBody(w), 1.5), 'не заходит в стену').toBe(false)
  for (const o of others) if (o !== c && o.ok) expect(convexOverlap(body, furnitureBody(o.furniture!), 1.5), 'не наезжает на соседа').toBe(false)
}

describe('проверка расстановки от ИИ', () => {
  it('принимает предмет в середине комнаты', () => {
    const { plan, room: r } = room()
    const checks = vetLayout([{ type: 'bed-160', x: 250, y: 200, rot: 0, why: 'по центру' }], r, plan)
    expect(checks[0].ok).toBe(true)
    expect(checks[0].furniture?.type).toBe('bed-160')
  })

  it('отказывает предмету с типом не из каталога', () => {
    const { plan, room: r } = room()
    const checks = vetLayout([{ type: 'вертолёт', x: 250, y: 200, rot: 0, why: '' }], r, plan)
    expect(checks[0].ok).toBe(false)
    expect(checks[0].reason).toMatch(/нет типа/)
  })

  it('предмет, предложенный за пределами комнаты, ставится в комнату и помечается', () => {
    const { plan, room: r } = room()
    const checks = vetLayout([{ type: 'bed-160', x: 2000, y: 2000, rot: 0, why: '' }], r, plan)
    honest(checks[0], r, plan)
    expect(checks[0].furniture!.note).toMatch(/место поправлено/)
    expect(layoutSummary(checks)).toMatch(/место поправлено у 1/)
  })

  it('кровать, торчащая сквозь стену, сдвигается внутрь, а не выбрасывается', () => {
    const { plan, room: r } = room()
    // кровать 160 × 200 у самого края: половина оказалась бы снаружи
    const checks = vetLayout([{ type: 'bed-160', x: 490, y: 200, rot: 0, why: '' }], r, plan)
    honest(checks[0], r, plan)
    expect(checks[0].furniture!.type).toBe('bed-160')
  })

  it('стены БТИ по 40 см: «вплотную к стене» по оси — не в стене, «Проверка» без красного', () => {
    // модель раньше получала контур по осям и ставила шкаф на ось: полшкафа в стене
    const plan = addRect(empty, { x: 1000, y: 2000 }, { x: 1400, y: 2340 }, 40)
    const r = buildRooms(plan).rooms[0]
    const checks = vetLayout(
      [
        { type: 'bed-160', x: 1200, y: 2000 + 100, rot: 0, why: 'изголовьем к стене по оси' },
        { type: 'wardrobe', x: 1000 + 30, y: 2200, rot: 90, why: 'к левой стене по оси' },
      ],
      r,
      plan,
    )
    for (const c of checks) honest(c, r, plan, checks)
    const next = applyLayout(plan, checks)
    const red = runChecks(next, buildRooms(next).rooms).issues.filter((i) => i.level === 'error')
    expect(red.map((i) => i.text)).toEqual([])
  })

  it('большой не помещается нигде — ставится тот же предмет поменьше', () => {
    // чистовые 150 × 230: кровать 160 не встаёт ни вдоль, ни поперёк, 140 — встаёт
    const plan = addRect(empty, { x: 0, y: 0 }, { x: 160, y: 240 }, 10)
    // маленькая комната сама называется «Санузел»; назначение — спальня
    const r = buildRooms(plan).rooms[0]
    const checks = vetLayout([{ type: 'bed-160', x: 80, y: 120, rot: 0, why: '' }], r, plan, { purpose: 'Спальня' })
    honest(checks[0], r, plan)
    expect(checks[0].furniture!.type).toBe('bed-140')
    expect(checks[0].replaced).toMatch(/160/)
    expect(checks[0].furniture!.note).toMatch(/вместо/)
  })

  it('нигде нет места — отказ с понятной причиной', () => {
    const plan = addRect(empty, { x: 0, y: 0 }, { x: 110, y: 110 }, 10)
    const r = buildRooms(plan).rooms[0]
    const checks = vetLayout([{ type: 'wardrobe', x: 55, y: 55, rot: 0, why: '' }], r, plan, { purpose: 'Спальня' })
    expect(checks[0].ok).toBe(false)
    expect(checks[0].reason).toMatch(/Шкаф.*не помещается/)
  })

  it('модель дала левые верхние углы вместо центров — ответ читается как углы, ничего не «поправлено»', () => {
    const { plan, room: r } = room()
    // чистовые грани: 10…490 × 10…390
    const checks = vetLayout(
      [
        { type: 'bed-160', x: 170, y: 10, rot: 0, why: 'изголовьем к верхней стене' },
        // шкаф 180 × 60 спинкой к левой стене: рамка 60 по x, 180 по y — от y 200 до 380
        { type: 'wardrobe', x: 10, y: 200, rot: 270, why: 'к левой стене' },
      ],
      r,
      plan,
      { purpose: 'Спальня' },
    )
    for (const c of checks) honest(c, r, plan, checks)
    const bed = checks[0].furniture!
    // угол (170; 10) → центр (250; 115)
    expect(Math.abs(bed.x - 250)).toBeLessThan(2)
    expect(Math.abs(bed.y - 115)).toBeLessThan(2)
    expect(checks.filter((c) => !c.added).every((c) => (c.moved ?? 0) <= 20)).toBe(true)
  })

  it('спальня как у пользователя: кровать по центру, тумбы по бокам, столик не спиной к окну, без красного', () => {
    // чистовые грани 371 × 409, внизу справа выступ коридора 83 × 151, окно на левой стене, дверь в выступе
    const W = (id: string, ax: number, ay: number, bx: number, by: number, t: number) => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: t })
    let plan: Plan = {
      ...empty,
      walls: [W('top', -20, -20, 377, -20, 40), W('right', 377, -20, 377, 264, 12), W('notchH', 294, 264, 377, 264, 12), W('notchV', 294, 264, 294, 415, 12), W('bottom', -20, 415, 294, 415, 12), W('left', -20, -20, -20, 415, 40)],
    }
    const rooms0 = buildRooms(plan).rooms
    plan = addOpening(plan, 'window', 'left', (231 + 20) / 435, 150, rooms0).plan
    plan = addOpening(plan, 'door', 'notchV', 0.55, 80, rooms0).plan
    const r = buildRooms(plan).rooms.find((x) => x.area > 12)!
    // как ответила модель у пользователя: углы вместо центров, кровать не по центру, столик спиной к окну
    const checks = vetLayout(
      [
        { type: 'bed-160', x: 75, y: 0, rot: 0, why: 'изголовьем к глухой стене' },
        { type: 'vanity', x: 0, y: 200, rot: 270, why: 'у окна' },
        { type: 'wardrobe', x: 0, y: 349, rot: 180, why: 'у стены' },
      ],
      r,
      plan,
      { purpose: 'Спальня' },
    )
    for (const c of checks) honest(c, r, plan, checks)
    const bed = checks.find((c) => c.furniture?.type === 'bed-160')!.furniture!
    // по центру своей стены: слева и справа поровну (±20 см)
    const left = bed.x - bed.w / 2
    const right = 371 - (bed.x + bed.w / 2)
    expect(Math.abs(left - right), `слева ${left}, справа ${right}`).toBeLessThanOrEqual(20)
    // тумбы добавлены с двух сторон изголовья
    const stands = checks.filter((c) => c.added && c.furniture?.type === 'nightstand').map((c) => c.furniture!)
    expect(stands).toHaveLength(2)
    for (const n of stands) expect(Math.abs(n.y - n.d / 2)).toBeLessThan(3)
    // столик не спиной к окну (окно на левой стене, y 156…306)
    const vanity = checks.find((c) => c.furniture?.type === 'vanity')!.furniture!
    const backToWindow = vanity.rot === 270 && vanity.x < 40 && vanity.y + vanity.w / 2 > 156 && vanity.y - vanity.w / 2 < 306
    expect(backToWindow, `столик в (${Math.round(vanity.x)}; ${Math.round(vanity.y)}), поворот ${vanity.rot}`).toBe(false)
    const next = applyLayout(plan, checks)
    const red = runChecks(next, buildRooms(next).rooms).issues.filter((i) => i.level === 'error')
    expect(red.map((i) => i.text)).toEqual([])
  })

  it('второй предмет на том же месте встаёт рядом, а не поверх', () => {
    const { plan, room: r } = room()
    const checks = vetLayout(
      [
        { type: 'bed-160', x: 250, y: 200, rot: 0, why: 'первая' },
        { type: 'wardrobe', x: 250, y: 200, rot: 0, why: 'вторая на том же месте' },
      ],
      r,
      plan,
    )
    honest(checks[0], r, plan, checks)
    honest(checks[1], r, plan, checks)
  })

  it('предмет в створе двери уходит с дуги открывания', () => {
    const { plan, room: r } = room()
    const wall = plan.walls.find((w) => Math.abs(w.a.y - w.b.y) < 1 && w.a.y < 10)!
    const { rooms } = buildRooms(plan)
    const withDoor = addOpening(plan, 'door', wall.id, 0.5, 90, rooms).plan
    const checks = vetLayout([{ type: 'wardrobe', x: 250, y: 40, rot: 0, why: 'прямо в дверь' }], r, withDoor)
    honest(checks[0], r, withDoor)
    const red = runChecks(applyLayout(withDoor, checks), buildRooms(withDoor).rooms).issues.filter((i) => i.level === 'error')
    expect(red.map((i) => i.text)).toEqual([])
    // дверь по-прежнему открывается: шкаф не стоит на её дуге
    expect(Math.abs(checks[0].furniture!.x - 250) > 60 || checks[0].furniture!.y > 150).toBe(true)
  })

  it('не наезжает на мебель, которая уже стоит', () => {
    const { plan, room: r } = room()
    const busy: Plan = {
      ...plan,
      furniture: [{ id: 'f1', type: 'sofa-3', x: 250, y: 200, w: 220, d: 95, rot: 0 }],
    }
    const checks = vetLayout([{ type: 'dining-table', x: 250, y: 200, rot: 0, why: '' }], r, busy)
    honest(checks[0], r, busy)
    expect(convexOverlap(furnitureBody(checks[0].furniture!), furnitureBody(busy.furniture[0]), 1.5)).toBe(false)
  })

  it('притягивает предмет к близкой стене вплотную', () => {
    const { plan } = room()
    const f = { id: 'x', type: 'wardrobe', x: 250, y: 45, w: 120, d: 60, rot: 0 }
    const snapped = snapToWall(f, plan.walls, 25)
    // верхняя стена толщиной 20 на y = 0: предмет должен встать на y = 30 + 10
    expect(snapped.y).toBeCloseTo(40, 1)
  })

  it('далёкий предмет не притягивается', () => {
    const { plan } = room()
    const f = { id: 'x', type: 'wardrobe', x: 250, y: 200, w: 120, d: 60, rot: 0 }
    expect(snapToWall(f, plan.walls, 25).y).toBe(200)
  })

  it('в план попадает только принятое', () => {
    const { plan, room: r } = room()
    const checks = vetLayout(
      [
        { type: 'bed-160', x: 250, y: 200, rot: 0, why: 'ок' },
        { type: 'вертолёт', x: 250, y: 100, rot: 0, why: 'нет' },
      ],
      r,
      plan,
    )
    const next = applyLayout(plan, checks)
    // кровать и тумбы, что встали к ней; мусора нет
    expect(next.furniture.map((f) => f.type).sort()).toEqual(['bed-160', 'nightstand', 'nightstand'])
    expect(layoutSummary(checks)).toMatch(/Поставлено предметов: 3 — Кровать 160×200, Тумба прикроватная, Тумба прикроватная\. Отклонено 1/)
  })

  it('объяснение модели попадает в пояснение, а не в подпись', () => {
    const { plan, room: r } = room()
    const checks = vetLayout([{ type: 'bed-160', x: 250, y: 200, rot: 0, why: 'изголовьем к глухой стене' }], r, plan)
    expect(checks[0].furniture?.note).toBe('изголовьем к глухой стене')
    expect(checks[0].furniture?.label, 'подпись на чертеже остаётся короткой').toBeUndefined()
  })
})

describe('каталог под комнату', () => {
  it('в санузел не предлагается кровать, а в спальню — унитаз', () => {
    const bath = catalogForRoom('Санузел', CATALOG).map((c) => c.type)
    const bed = catalogForRoom('Спальня', CATALOG).map((c) => c.type)
    expect(bath).toContain('toilet')
    expect(bath).not.toContain('bed-160')
    expect(bed).toContain('bed-160')
    expect(bed).not.toContain('toilet')
  })

  it('электрика в расстановку мебели не попадает', () => {
    for (const name of ['Кухня', 'Спальня', 'Санузел', 'Прихожая']) {
      const types = catalogForRoom(name, CATALOG)
      expect(types.every((t) => CATALOG.find((c) => c.type === t.type)?.category !== 'electric')).toBe(true)
    }
  })

  it('детской — и обычная кровать со столом; радиатор, колонна и заготовка не расставляются', () => {
    const kids = catalogForRoom('Детская', CATALOG).map((c) => c.type)
    expect(kids).toEqual(expect.arrayContaining(['kid-bed', 'bed-90', 'desk', 'wardrobe']))
    for (const name of ['Детская', 'Спальня', 'Гостиная', 'Кабинет']) {
      const types = catalogForRoom(name, CATALOG).map((c) => c.type)
      expect(types).not.toContain('radiator')
      expect(types).not.toContain('column')
      expect(types).not.toContain('box')
    }
    expect(catalogForRoom('Спальня', CATALOG).map((c) => c.type)).not.toContain('piano')
  })

  it('незнакомой комнате даётся жилой набор', () => {
    const types = catalogForRoom('Помещение №5', CATALOG).map((c) => c.type)
    expect(types).toContain('sofa-3')
  })
})
