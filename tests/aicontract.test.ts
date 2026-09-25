import { describe, expect, it } from 'vitest'
import { checkAiLayout, checkAiNumbers, checkAiPlan, checkAiProduct, checkAiRoomLabel, extractJson, sizeFromText } from '../src/planner/aicontract'

const wall = { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.1, thickness_cm: 25 }

describe('разбор ответа модели', () => {
  it('читает чистый JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('читает JSON в ```-рамке', () => {
    expect(extractJson('Вот результат:\n```json\n{"a":[1,2]}\n```\nГотово')).toEqual({ a: [1, 2] })
  })

  it('находит объект среди пояснений', () => {
    expect(extractJson('Я посчитал так. {"walls": []} Надеюсь, подойдёт.')).toEqual({ walls: [] })
  })

  it('не путается со скобками внутри строк', () => {
    expect(extractJson('текст {"note":"тут } скобка"} хвост')).toEqual({ note: 'тут } скобка' })
  })

  it('читает массив верхнего уровня', () => {
    expect(extractJson('```\n[{"x":1}]\n```')).toEqual([{ x: 1 }])
  })

  it('бросает ошибку, если JSON нет вовсе', () => {
    expect(() => extractJson('Извините, я не смог прочитать этот план.')).toThrow(/не JSON/)
  })
})

describe('проверка распознанного плана', () => {
  it('принимает разумный ответ', () => {
    const p = checkAiPlan({
      walls: [wall],
      openings: [{ kind: 'door', x: 0.5, y: 0.1, width_cm: 90 }],
      rooms: [{ name: 'Кухня', area_m2: 8.7, x: 0.3, y: 0.4 }],
      dimensions: [{ x1: 0.1, y1: 0.02, x2: 0.9, y2: 0.02, cm: 845 }],
    })
    expect(p.walls).toHaveLength(1)
    expect(p.walls[0].thicknessCm).toBe(25)
    expect(p.openings[0].kind).toBe('door')
    expect(p.rooms[0].areaM2).toBe(8.7)
    expect(p.dimensions[0].cm).toBe(845)
  })

  it('отбрасывает координаты за пределами картинки', () => {
    const p = checkAiPlan({ walls: [wall, { x1: 2, y1: 0.1, x2: 3, y2: 0.1 }] })
    expect(p.walls).toHaveLength(1)
  })

  it('прощает небольшой вылет за край и прижимает к нему', () => {
    const p = checkAiPlan({ walls: [{ x1: -0.02, y1: 0.5, x2: 1.01, y2: 0.5 }] })
    expect(p.walls[0].x1).toBe(0)
    expect(p.walls[0].x2).toBe(1)
  })

  it('отбрасывает вырожденные отрезки', () => {
    expect(() => checkAiPlan({ walls: [{ x1: 0.5, y1: 0.5, x2: 0.502, y2: 0.5 }] })).toThrow(/стен не найдено/)
  })

  it('без стен считает ответ негодным', () => {
    expect(() => checkAiPlan({ rooms: [{ name: 'Кухня', x: 0.3, y: 0.4 }] })).toThrow(/стен не найдено/)
    expect(() => checkAiPlan('не объект')).toThrow(/не объект/)
  })

  it('выбрасывает выдуманные типы проёмов и дикие размеры', () => {
    const p = checkAiPlan({
      walls: [wall],
      openings: [
        { kind: 'портал', x: 0.5, y: 0.1, width_cm: 90 },
        { kind: 'window', x: 0.2, y: 0.1, width_cm: 99999 },
      ],
    })
    // портал отброшен, окну подставлена разумная ширина вместо дикой
    expect(p.openings).toHaveLength(1)
    expect(p.openings[0].widthCm).toBe(140)
  })

  it('терпит числа строками и запятую как разделитель', () => {
    const p = checkAiPlan({ walls: [{ ...wall, thickness_cm: '25,5' }] })
    expect(p.walls[0].thicknessCm).toBe(25.5)
  })

  it('ограничивает длину списков и подписей', () => {
    const many = Array.from({ length: 900 }, () => wall)
    const p = checkAiPlan({ walls: many, rooms: [{ name: 'я'.repeat(200), x: 0.5, y: 0.5 }] })
    expect(p.walls.length).toBeLessThanOrEqual(400)
    expect(p.rooms[0].name.length).toBeLessThanOrEqual(40)
  })
})

describe('проверка расстановки', () => {
  it('округляет поворот до 15° и приводит к 0..360', () => {
    const items = checkAiLayout({ items: [{ type: 'bed', x: 100, y: 200, rot: -7 }, { type: 'sofa', x: 0, y: 0, rot: 371 }] })
    expect(items[0].rot).toBe(0)
    expect(items[1].rot).toBe(15)
  })

  it('отбрасывает предметы без типа или координат', () => {
    const items = checkAiLayout({ items: [{ type: '', x: 1, y: 2 }, { type: 'bed', x: 'сюда' }, { type: 'sofa', x: 10, y: 20 }] })
    expect(items).toHaveLength(1)
    expect(items[0].type).toBe('sofa')
  })

  it('понимает и голый массив', () => {
    expect(checkAiLayout([{ type: 'bed', x: 1, y: 2 }])).toHaveLength(1)
  })

  it('пустую расстановку считает ошибкой', () => {
    expect(() => checkAiLayout({ items: [] })).toThrow(/пустая/)
  })
})

describe('проверка товара', () => {
  it('берёт размеры в сантиметрах', () => {
    const p = checkAiProduct({ name: 'Холодильник', price: '89990', currency: 'RUB', width_cm: 60, depth_cm: 66, height_cm: 203 })
    expect(p).toMatchObject({ name: 'Холодильник', price: 89990, width: 60, height: 203 })
  })

  it('выбрасывает размеры вне разумного', () => {
    const p = checkAiProduct({ name: 'Шкаф', width_cm: 6000, height_cm: 220 })
    expect(p.width).toBeUndefined()
    expect(p.height).toBe(220)
  })

  it('пустой ответ считает ошибкой', () => {
    expect(() => checkAiProduct({ currency: 'RUB' })).toThrow(/пусто/)
  })
})

describe('размеры комнат в разных обличьях', () => {
  it('width_m, height и строка «4.01x4.26» читаются как сантиметры', () => {
    const plan = checkAiPlan({
      rooms: [
        { name: 'a', x: 0.2, y: 0.2, box: { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.3 }, width_m: 4.01, height: 4.26 },
        { name: 'b', x: 0.6, y: 0.2, box: { x1: 0.5, y1: 0.1, x2: 0.7, y2: 0.3 }, size: '3,30 × 4,26' },
        { name: 'c', x: 0.6, y: 0.6, box: { x1: 0.5, y1: 0.5, x2: 0.7, y2: 0.7 }, dimensions: '180x258' },
      ],
    })
    expect(plan.rooms.map((r) => [r.widthCm, r.depthCm])).toEqual([
      [401, 426],
      [330, 426],
      [180, 258],
    ])
  })
})

describe('ответ по фрагменту комнаты', () => {
  it('«не помещение» — полноценный ответ, даже без подписей', () => {
    expect(checkAiRoomLabel({ not_room: true, note: 'вентшахта' })).toEqual({ notRoom: true, note: 'вентшахта' })
  })
  it('пустой ответ без пометки — не ответ', () => {
    expect(() => checkAiRoomLabel({ note: 'ничего' })).toThrow()
  })
  it('размеры вдоль стен: метры с дробью и целые сантиметры, короткие куски тоже', () => {
    const label = checkAiRoomLabel({
      name: '1',
      walls: [
        { side: 'top', at: 0.77, cm: 234 },
        { side: 'bottom', at: 0.84, cm: 26 },
        { side: 'right', cm: 0.38 },
        { side: 'left', at: 0.84, cm: '1.37' },
        { side: 'нигде', cm: 100 },
      ],
    })
    expect(label.walls).toEqual([
      { side: 'top', at: 0.77, cm: 234 },
      { side: 'bottom', at: 0.84, cm: 26 },
      { side: 'right', at: 0.5, cm: 38 },
      { side: 'left', at: 0.84, cm: 137 },
    ])
  })
})

describe('размеры с листа вырезок', () => {
  it('надпись → сантиметры: метры с двумя знаками, миллиметры, сантиметры; площадь и номер — не размер', () => {
    expect(sizeFromText('3,72')).toBe(372)
    expect(sizeFromText('0.26')).toBe(26)
    expect(sizeFromText(' 1, 29 ')).toBe(129)
    expect(sizeFromText('3720')).toBe(372)
    expect(sizeFromText('372')).toBe(372)
    expect(sizeFromText('0,13 м')).toBe(13)
    expect(sizeFromText('13,9')).toBeNull()
    expect(sizeFromText('5ж')).toBeNull()
    expect(sizeFromText('□□□')).toBeNull()
    expect(sizeFromText(null)).toBeNull()
  })

  it('ответ по листу: номер клетки и что в ней, пустое — null', () => {
    expect(checkAiNumbers({ items: [{ n: 1, text: '3,72' }, { n: 2, text: null }, { n: '3', text: 0.26 }, { text: 'без номера' }] })).toEqual([
      { n: 1, text: '3,72' },
      { n: 2, text: null },
      { n: 3, text: '0.26' },
    ])
    expect(() => checkAiNumbers({ note: 'не вижу' })).toThrow()
  })
})
