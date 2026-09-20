import { describe, expect, it } from 'vitest'
import { openingGeom, runChecks, zonesOf } from '../src/planner/checks'
import { buildRooms } from '../src/planner/rooms'
import { CATALOG_MAP } from '../src/planner/catalog'
import { TEMPLATES } from '../src/planner/templates'
import { emptyPlan, type Furniture, type Opening, type Plan, type Wall } from '../src/planner/types'

const W = (id: string, ax: number, ay: number, bx: number, by: number, th = 20): Wall => ({
  id,
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  thickness: th,
})
const F = (id: string, type: string, x: number, y: number, rot = 0, extra: Partial<Furniture> = {}): Furniture => {
  const c = CATALOG_MAP[type]
  return { id, type, x, y, w: c.w, d: c.d, rot, ...extra }
}
const room = (w = 600, h = 500, th = 20): Wall[] => [
  W('t', 0, 0, w, 0, th),
  W('r', w, 0, w, h, th),
  W('b', w, h, 0, h, th),
  W('l', 0, h, 0, 0, th),
]
const check = (plan: Plan) => runChecks(plan, buildRooms(plan).rooms)
const texts = (plan: Plan) => check(plan).issues.map((i) => i.text)
const blocking = (plan: Plan) => check(plan).issues.filter((i) => i.level !== 'info')

describe('пересечения', () => {
  it('мебель внутри стены — ошибка', () => {
    const plan: Plan = { ...emptyPlan(), walls: room(), furniture: [F('f1', 'wardrobe', 300, 5)] }
    expect(texts(plan).some((t) => t.includes('заходит в стену'))).toBe(true)
  })

  it('два предмета друг в друге — ошибка', () => {
    const plan: Plan = { ...emptyPlan(), walls: room(), furniture: [F('a', 'dresser', 300, 300), F('b', 'dresser', 310, 300)] }
    expect(check(plan).issues.some((i) => i.level === 'error' && i.text.includes('пересекается'))).toBe(true)
  })

  it('предметы рядом, но не впритык — ошибки нет', () => {
    const plan: Plan = { ...emptyPlan(), walls: room(), furniture: [F('a', 'nightstand', 200, 300), F('b', 'nightstand', 260, 300)] }
    expect(check(plan).issues.some((i) => i.level === 'error')).toBe(false)
  })

  it('ковёр под диваном не считается пересечением', () => {
    const plan: Plan = { ...emptyPlan(), walls: room(), furniture: [F('r', 'rug', 300, 300), F('s', 'sofa-2', 300, 300)] }
    expect(check(plan).issues.some((i) => i.level === 'error')).toBe(false)
  })
})

describe('зоны эргономики', () => {
  it('шкаф вплотную к кровати перекрывает проход', () => {
    const plan: Plan = {
      ...emptyPlan(),
      walls: room(600, 500),
      furniture: [F('bed', 'bed-160', 200, 115), F('wd', 'wardrobe', 370, 40, 0, { w: 100 })],
    }
    const zone = check(plan)
    expect([...zone.badZones].some((k) => k.startsWith('bed:'))).toBe(true)
    expect(texts(plan).some((t) => t.includes('70 см свободно'))).toBe(true)
  })

  it('стулья разрешены в зоне вокруг стола', () => {
    const plan: Plan = {
      ...emptyPlan(),
      walls: room(800, 800),
      furniture: [F('t', 'dining-table', 400, 400), F('c1', 'chair', 400, 320, 0), F('c2', 'chair', 400, 480, 180)],
    }
    expect(check(plan).badZones.size).toBe(0)
  })

  it('зона строится по фронту объекта и поворачивается вместе с ним', () => {
    const f = F('w', 'wardrobe', 100, 100, 90)
    const zones = zonesOf(f, CATALOG_MAP.wardrobe)
    const front = zones.find((z) => z.side === 'front')!
    expect(front.size).toBe(90)
    // при повороте на 90° фронт смотрит в -x
    const cx = front.poly.reduce((s, p) => s + p.x, 0) / front.poly.length
    expect(cx).toBeLessThan(100)
  })
})

describe('двери и окна', () => {
  it('дверь, упирающаяся в шкаф, помечается', () => {
    const walls = room(600, 500)
    const openings: Opening[] = [{ id: 'd', kind: 'door', wallId: 'l', t: 0.5, width: 90, hinge: 'a', side: 1 }]
    const plan: Plan = { ...emptyPlan(), walls, openings, furniture: [F('wd', 'wardrobe', 90, 250, 90, { w: 120 })] }
    const r = check(plan)
    expect(r.badDoors.has('d')).toBe(true)
    expect(r.issues.some((i) => i.text.includes('задевает'))).toBe(true)
  })

  it('комната без двери вызывает предупреждение', () => {
    const plan: Plan = { ...emptyPlan(), walls: room() }
    expect(texts(plan).some((t) => t.includes('нет двери'))).toBe(true)
  })

  it('сектор открывания двери начинается у петли', () => {
    const wall = W('w', 0, 0, 400, 0, 20)
    const g = openingGeom({ id: 'o', kind: 'door', wallId: 'w', t: 0.5, width: 80, hinge: 'a', side: 1 }, wall)
    expect(g.hinge.x).toBeCloseTo(160)
    expect(g.far.x).toBeCloseTo(240)
    expect(Math.hypot(g.leafEnd.x - g.hinge.x, g.leafEnd.y - g.hinge.y)).toBeCloseTo(80)
  })
})

describe('кухня и гостиная', () => {
  it('растянутый рабочий треугольник вызывает предупреждение', () => {
    const plan: Plan = {
      ...emptyPlan(),
      walls: room(1200, 800),
      furniture: [F('fr', 'fridge', 100, 400), F('sk', 'sink', 600, 400), F('st', 'stove', 1100, 400)],
    }
    const r = check(plan)
    expect(r.triangle?.ok).toBe(false)
    expect(r.issues.some((i) => i.text.includes('Рабочий треугольник'))).toBe(true)
  })

  it('нормальный треугольник отмечается как корректный', () => {
    const plan: Plan = {
      ...emptyPlan(),
      walls: room(800, 800),
      furniture: [F('fr', 'fridge', 200, 300), F('sk', 'sink', 400, 300), F('st', 'stove', 330, 480)],
    }
    expect(check(plan).triangle?.ok).toBe(true)
  })

  it('плита вплотную к холодильнику — предупреждение', () => {
    const plan: Plan = {
      ...emptyPlan(),
      walls: room(800, 800),
      furniture: [F('fr', 'fridge', 200, 300), F('st', 'stove', 250, 300), F('sk', 'sink', 400, 450)],
    }
    expect(texts(plan).some((t) => t.includes('вплотную к холодильнику'))).toBe(true)
  })

  it('телевизор слишком близко к дивану', () => {
    const plan: Plan = { ...emptyPlan(), walls: room(600, 500), furniture: [F('s', 'sofa-2', 300, 300), F('tv', 'tv', 300, 400)] }
    expect(texts(plan).some((t) => t.includes('до телевизора'))).toBe(true)
  })
})

describe('правила для кровати', () => {
  it('кровать посреди комнаты: изголовье не у стены', () => {
    const plan: Plan = { ...emptyPlan(), walls: room(700, 700), furniture: [F('b', 'bed-160', 350, 350)] }
    expect(texts(plan).some((t) => t.includes('Изголовье'))).toBe(true)
  })

  it('изголовье под окном', () => {
    const walls = room(600, 500)
    const openings: Opening[] = [{ id: 'w1', kind: 'window', wallId: 't', t: 0.5, width: 160, hinge: 'a', side: 1 }]
    const plan: Plan = { ...emptyPlan(), walls, openings, furniture: [F('b', 'bed-160', 300, 115)] }
    expect(texts(plan).some((t) => t.includes('под окном'))).toBe(true)
  })
})

describe('стартовые шаблоны', () => {
  for (const t of TEMPLATES.filter((x) => x.key !== 'empty')) {
    it(`«${t.name}» не содержит ошибок и предупреждений`, () => {
      const plan = t.build()
      const bad = blocking(plan)
      expect(bad.map((i) => i.text)).toEqual([])
    })
  }

  it('пустой шаблон не даёт замечаний', () => {
    expect(check(TEMPLATES[0].build()).issues).toEqual([])
  })
})
