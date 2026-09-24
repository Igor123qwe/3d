import { describe, expect, it } from 'vitest'
import { applyH, binarize, boxBlur, cleanRaster, components, despeckle, distanceToInk, dominantAngle, flattenBackground, floodRoom, groundRoomBox, homography, keepWallStrokes, orderCorners, removeBlobs, segmentRooms, strokeWidth, hatchedStrips, type RoomRegion } from '../src/planner/raster'

/** серый лист w × h с рисовалкой прямоугольников */
function sheet(w: number, h: number, bg = 255) {
  const g = new Uint8Array(w * h).fill(bg)
  const rect = (x0: number, y0: number, x1: number, y1: number, v = 0) => {
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) g[y * w + x] = v
  }
  return { g, rect }
}

describe('фильтры', () => {
  it('размытие ровного листа его не меняет, края считаются по фактическому окну', () => {
    const { g } = sheet(50, 40, 200)
    const b = boxBlur(g, 50, 40, 5)
    expect(b[0]).toBeCloseTo(200, 5)
    expect(b[20 * 50 + 25]).toBeCloseTo(200, 5)
  })

  it('выравнивание фона убирает тень: бумага белая и слева, и справа, линия остаётся тёмной', () => {
    const w = 300
    const h = 200
    const g = new Uint8Array(w * h)
    // тень: яркость бумаги плавно падает от 250 слева до 120 справа
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = Math.round(250 - (130 * x) / (w - 1))
    // тёмная линия стены поперёк всего листа
    for (let y = 95; y <= 104; y++) for (let x = 0; x < w; x++) g[y * w + x] = Math.round(20 - (10 * x) / (w - 1))
    const flat = flattenBackground(g, w, h)
    expect(flat[50 * w + 20]).toBeGreaterThan(225)
    expect(flat[50 * w + 280]).toBeGreaterThan(225)
    expect(flat[100 * w + 20]).toBeLessThan(60)
    expect(flat[100 * w + 280]).toBeLessThan(60)
  })

  it('бинаризация отделяет линии от бумаги', () => {
    const { g, rect } = sheet(100, 100)
    rect(10, 40, 90, 44)
    const bin = binarize(g, 100, 100)
    expect(bin.ink[42 * 100 + 50]).toBe(1)
    expect(bin.ink[10 * 100 + 50]).toBe(0)
  })

  it('мелкие компоненты (цифры, засечки) убираются, длинная стена остаётся', () => {
    const { g, rect } = sheet(200, 200)
    rect(10, 100, 190, 104) // стена
    rect(50, 20, 58, 30) // «цифра»
    rect(120, 20, 121, 22) // крап
    const bin = binarize(g, 200, 200)
    expect(components(bin).list).toHaveLength(3)
    const clean = despeckle(bin, { maxSide: 20 })
    expect(components(clean).list).toHaveLength(1)
    expect(clean.ink[102 * 200 + 100]).toBe(1)
    expect(clean.ink[25 * 200 + 54]).toBe(0)
  })

  it('полная очистка даёт белую бумагу и чёрные линии', () => {
    const { g, rect } = sheet(200, 200, 180)
    rect(10, 100, 190, 104, 30)
    const { gray } = cleanRaster(g, 200, 200)
    expect(gray[50 * 200 + 50]).toBe(255)
    expect(gray[102 * 200 + 100]).toBe(0)
  })
})

describe('выравнивание по линиям', () => {
  /** лист с сеткой линий, повёрнутой на deg градусов; края сглажены, как на фото */
  function rotatedGrid(deg: number, w = 400, h = 400): Uint8Array {
    const g = new Uint8Array(w * h).fill(255)
    const rad = (deg * Math.PI) / 180
    const c = Math.cos(rad)
    const s = Math.sin(rad)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // расстояние до ближайшей линии в повёрнутой системе координат
        const u = (x - w / 2) * c + (y - h / 2) * s
        const v = -(x - w / 2) * s + (y - h / 2) * c
        const du = Math.abs((((u % 80) + 80) % 80) - 40)
        const dv = Math.abs((((v % 80) + 80) % 80) - 40)
        const d = Math.min(du, dv)
        // линия шириной 6 px с плавным краем в 1,5 px
        const cover = Math.min(1, Math.max(0, (3.75 - d) / 1.5))
        g[y * w + x] = Math.round(255 * (1 - cover))
      }
    }
    return g
  }

  it('ровный план — угол около нуля', () => {
    expect(Math.abs(dominantAngle(rotatedGrid(0), 400, 400))).toBeLessThan(0.5)
  })

  it('план, повёрнутый на 3°, даёт около 3°; на −7° — около −7°', () => {
    expect(dominantAngle(rotatedGrid(3), 400, 400)).toBeCloseTo(3, 0)
    expect(dominantAngle(rotatedGrid(-7), 400, 400)).toBeCloseTo(-7, 0)
  })
})

describe('перспектива', () => {
  it('гомография переводит углы точно, середина — приближённо между ними', () => {
    const src = [
      { x: 10, y: 20 },
      { x: 300, y: 5 },
      { x: 320, y: 250 },
      { x: 0, y: 230 },
    ]
    const dst = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 200 },
      { x: 0, y: 200 },
    ]
    const H = homography(src, dst)
    src.forEach((p, i) => {
      const q = applyH(H, p)
      expect(q.x).toBeCloseTo(dst[i].x, 6)
      expect(q.y).toBeCloseTo(dst[i].y, 6)
    })
  })

  it('углы упорядочиваются: верхний-левый, верхний-правый, нижний-правый, нижний-левый', () => {
    const o = orderCorners([
      { x: 300, y: 250 },
      { x: 10, y: 20 },
      { x: 0, y: 230 },
      { x: 300, y: 5 },
    ])
    expect(o.map((p) => `${p.x},${p.y}`)).toEqual(['10,20', '300,5', '300,250', '0,230'])
  })

  it('три точки на одной прямой — гомографии нет', () => {
    expect(() =>
      homography(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 2, y: 2 },
          { x: 3, y: 3 },
        ],
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
      ),
    ).toThrow()
  })
})

describe('комната по клику', () => {
  const W = 300
  const H = 200
  /** две комнаты: левая 10..140 × 10..190, правая 150..290; дверь в перегородке 80..110 */
  function twoRooms(doorGap = 30) {
    const { g, rect } = sheet(W, H)
    rect(6, 6, 293, 9) // верх
    rect(6, 190, 293, 193) // низ
    rect(6, 6, 9, 193) // левая
    rect(290, 6, 293, 193) // правая
    rect(141, 6, 149, 193) // перегородка
    rect(141, 80, 149, 80 + doorGap, 255) // дверной проём
    return g
  }

  it('расстояние до чернил: на линии ноль, рядом растёт', () => {
    const { g, rect } = sheet(50, 50)
    rect(20, 20, 20, 20)
    const d2 = distanceToInk(binarize(g, 50, 50))
    expect(d2[20 * 50 + 20]).toBe(0)
    expect(d2[20 * 50 + 23]).toBe(9)
    expect(d2[24 * 50 + 23]).toBe(25)
  })

  it('клик внутри левой комнаты даёт её рамку, дверь не пускает заливку в соседнюю', () => {
    const bin = binarize(twoRooms(), W, H)
    const d2 = distanceToInk(bin)
    const r = floodRoom(d2, W, H, { x: 70, y: 100 }, 20)!
    expect(r).not.toBeNull()
    expect(r.x1).toBeCloseTo(10, -1)
    expect(r.x2).toBeCloseTo(140, -1)
    expect(r.y1).toBeCloseTo(10, -1)
    expect(r.y2).toBeCloseTo(189, -1)
    expect(r.fill).toBeGreaterThan(0.9)
    const right = floodRoom(d2, W, H, { x: 220, y: 100 }, 20)!
    expect(right.x1).toBeCloseTo(150, -1)
    expect(right.x2).toBeCloseTo(289, -1)
  })

  it('клик по самой стене ищет ближайший свободный пиксель', () => {
    const d2 = distanceToInk(binarize(twoRooms(), W, H))
    const r = floodRoom(d2, W, H, { x: 145, y: 30 }, 20)
    expect(r).not.toBeNull()
  })

  it('незамкнутый контур — заливка утекает, ответа нет', () => {
    const { g, rect } = sheet(W, H)
    rect(6, 6, 293, 9)
    rect(6, 6, 9, 193)
    rect(290, 6, 293, 193)
    // низа нет — комната открыта на весь лист
    const d2 = distanceToInk(binarize(g, W, H))
    expect(floodRoom(d2, W, H, { x: 150, y: 100 }, 12)).toBeNull()
  })

  it('проём шире двойного радиуса не закрывается — обе комнаты сливаются', () => {
    // лист побольше, чтобы слившиеся комнаты не сошли за утечку на весь лист
    const w2 = 600
    const h2 = 400
    const { g, rect } = sheet(w2, h2)
    rect(6, 6, 293, 9)
    rect(6, 190, 293, 193)
    rect(6, 6, 9, 193)
    rect(290, 6, 293, 193)
    rect(141, 6, 149, 193)
    rect(141, 80, 149, 140, 255) // проём 60 px при радиусе 12
    const d2 = distanceToInk(binarize(g, w2, h2))
    const r = floodRoom(d2, w2, h2, { x: 70, y: 100 }, 12)!
    expect(r).not.toBeNull()
    expect(r.x2).toBeGreaterThan(200)
  })
})

describe('рамка комнаты от модели — к стенам на картинке', () => {
  const W = 300
  const H = 200
  function twoRooms() {
    const { g, rect } = sheet(W, H)
    rect(6, 6, 293, 9)
    rect(6, 190, 293, 193)
    rect(6, 6, 9, 193)
    rect(290, 6, 293, 193)
    rect(141, 6, 149, 193)
    rect(141, 80, 149, 110, 255)
    return g
  }

  it('рамка «по подписи», меньше комнаты и сдвинутая, встаёт по внутренним граням стен', () => {
    const d2 = distanceToInk(binarize(twoRooms(), W, H))
    // модель обвела примерно середину левой комнаты: 40..110 × 60..150
    const g = groundRoomBox(d2, W, H, { x1: 40 / W, y1: 60 / H, x2: 110 / W, y2: 150 / H }, 20)!
    expect(g).not.toBeNull()
    expect(g.x1 * W).toBeCloseTo(10, -1)
    expect(g.x2 * W).toBeCloseTo(140, -1)
    expect(g.y1 * H).toBeCloseTo(10, -1)
    expect(g.y2 * H).toBeCloseTo(189, -1)
  })

  it('рамка, не пересекающаяся с найденной комнатой, не принимается', () => {
    const d2 = distanceToInk(binarize(twoRooms(), W, H))
    // рамка на правую комнату, а центр попал… тоже в правую: примем; но рамка в углу левой при центре в правой — нет
    const off = groundRoomBox(d2, W, H, { x1: 20 / W, y1: 20 / H, x2: 60 / W, y2: 60 / H }, 20)
    // центр (40,40) — в левой комнате, IoU с её рамкой мал (рамка крошечная): отклоняется
    expect(off).toBeNull()
  })

  it('открытый контур — привязки нет', () => {
    const { g, rect } = sheet(W, H)
    rect(6, 6, 293, 9)
    rect(6, 6, 9, 193)
    const d2 = distanceToInk(binarize(g, W, H))
    expect(groundRoomBox(d2, W, H, { x1: 0.2, y1: 0.2, x2: 0.5, y2: 0.6 }, 12)).toBeNull()
  })
})

describe('все комнаты с картинки разом', () => {
  /** квартира с плана БТИ, нарисованная чернилами: шесть комнат, дверные проёмы, наружная рамка */
  function flatSheet() {
    const W = 900
    const H = 1000
    const { g, rect } = sheet(W, H)
    const rooms = [
      [40, 40, 412, 448],
      [422, 40, 602, 298],
      [422, 308, 602, 448],
      [612, 40, 846, 448],
      [40, 458, 441, 884],
      [451, 458, 846, 884],
    ]
    // стены: наружная рамка 20 px, перегородки 10 px — как промежутки между комнатами
    rect(20, 20, 866, 904)
    for (const [x1, y1, x2, y2] of rooms) rect(x1, y1, x2, y2, 255)
    // дверные проёмы 80 px в перегородках и «цифры» внутри комнат
    rect(412, 200, 422, 280, 255)
    rect(441, 600, 451, 680, 255)
    rect(200, 448, 280, 458, 255)
    rect(150, 200, 190, 215)
    rect(700, 600, 740, 615)
    // размерная линия снаружи — тонкая, не стена
    rect(40, 930, 846, 931)
    return { g, W, H, rooms }
  }

  it('находит все шесть комнат и не считает комнатой ни лист, ни цифры', () => {
    const { g, W, H, rooms } = flatSheet()
    const d2 = distanceToInk(despeckle(binarize(g, W, H)))
    const found = segmentRooms(d2, W, H, 45)
    expect(found).toHaveLength(rooms.length)
    for (const [x1, y1, x2, y2] of rooms) {
      const hit = found.find((r) => Math.abs(r.x1 - x1) < 8 && Math.abs(r.y1 - y1) < 8 && Math.abs(r.x2 - x2) < 8 && Math.abs(r.y2 - y2) < 8)
      expect(hit, `комната ${x1},${y1}`).toBeDefined()
      expect(hit!.fill).toBeGreaterThan(0.85)
    }
  })

  it('слишком узкое закрытие проёмов сливает комнаты — их становится меньше', () => {
    const { g, W, H } = flatSheet()
    const d2 = distanceToInk(despeckle(binarize(g, W, H)))
    expect(segmentRooms(d2, W, H, 20).length).toBeLessThan(6)
  })
})

describe('план, обрезанный краем фото', () => {
  it('комната без правой стены остаётся комнатой; поле листа вокруг — нет', () => {
    const W = 400
    const H = 300
    const { g, rect } = sheet(W, H)
    rect(60, 40, 399, 46) // верхняя стена уходит за край
    rect(60, 240, 399, 246)
    rect(60, 40, 66, 246)
    rect(200, 40, 206, 246)
    // правой стены нет — фото обрезано; вокруг плана белое поле
    const d2 = distanceToInk(binarize(g, W, H))
    const found = segmentRooms(d2, W, H, 12)
    expect(found).toHaveLength(2)
    const right = found.find((r) => r.x1 > 200)!
    expect(right.x2).toBeGreaterThan(380)
  })

  it('комната, подтекающая в поле через обрезанный угол, сохраняет свою рамку и площадь', () => {
    const W = 400
    const H = 300
    const { g, rect } = sheet(W, H)
    rect(60, 40, 340, 46)
    rect(60, 240, 340, 246)
    rect(60, 40, 66, 246)
    rect(200, 40, 206, 246)
    rect(334, 40, 340, 246)
    rect(334, 40, 340, 70, 255) // дырка в правой стене у верхнего угла — утечка в поле справа
    const d2 = distanceToInk(binarize(g, W, H))
    const found = segmentRooms(d2, W, H, 8)
    const right = found.find((r) => r.x1 > 190 && r.x1 < 220)!
    expect(right).toBeDefined()
    // контур — по стенам, а не по краю листа: в дырку у угла он заходит лишь
    // на толщину стены, площадь — почти как у обнесённой стенами части
    expect(right.x2).toBeLessThan(360)
    const walled = (334 - 207) * (240 - 47)
    expect(Math.abs(right.areaPx - walled) / walled).toBeLessThan(0.05)
  })
})

describe('Г-образная комната рядом с коридором', () => {
  it('Г-образная комната обводится шестью углами, коридор в её углу — отдельная прямоугольная комната', () => {
    const W = 600
    const H = 500
    const { g, rect } = sheet(W, H)
    // комната 40..340 × 40..340, коридор 240..560 × 240..340 заходит в её правый нижний угол;
    // стены 8 px, между комнатой и коридором — уступ
    rect(30, 30, 570, 350) // сплошная плита
    rect(40, 40, 340, 340, 255) // комната
    rect(240, 240, 560, 340, 255) // коридор (угол общий)
    rect(340, 40, 560, 232, 255) // кухня над коридором
    // стены между коридором и комнатой: вертикальная 232..240 по x от y 232 до 340, горизонтальная 232..240 по y от x 232 до 340
    rect(232, 232, 240, 340)
    rect(232, 232, 340, 240)
    rect(340, 40, 348, 240) // стена комната|кухня
    const d2 = distanceToInk(despeckle(binarize(g, W, H)))
    const found = segmentRooms(d2, W, H, 14)
    expect(found).toHaveLength(3)
    const room = found.find((r) => r.x1 < 50 && r.y1 < 50)!
    const hall = found.find((r) => r.x2 > 540 && r.y1 > 200)!
    expect(room).toBeDefined()
    expect(hall).toBeDefined()
    // контур по пикселям: у комнаты вырез под коридор, коридор — прямоугольник
    expect(room.poly).toHaveLength(6)
    expect(hall.poly).toHaveLength(4)
    // грани — по стенам, с точностью до пикселя
    expect(room.x1).toBeCloseTo(40, -0.5)
    expect(room.y2).toBeCloseTo(341, -0.5)
    expect(hall.x1).toBeCloseTo(241, -0.5)
    // площадь — по контуру: без угла коридора
    const want = 301 * 301 - 109 * 109
    expect(Math.abs(room.areaPx - want) / want).toBeLessThan(0.03)
  })
})

describe('очистка до одних стен', () => {
  /** лист: план из линий слева, залитая панель с текстом справа, подпись снизу */
  function screen() {
    const W = 600
    const H = 500
    const { g, rect } = sheet(W, H)
    // план 40..300 × 40..300, стены 6 px, перегородка посередине
    rect(40, 40, 300, 300)
    rect(46, 46, 294, 294, 255)
    rect(166, 46, 172, 294)
    // панель приложения справа: сплошная заливка с «текстом» белым
    rect(400, 0, 599, 499)
    for (let r = 0; r < 8; r++) for (let c = 0; c < 10; c++) rect(420 + c * 16, 40 + r * 40, 428 + c * 16, 56 + r * 40, 255)
    // подпись под планом: мелкие штрихи
    for (let c = 0; c < 12; c++) rect(50 + c * 14, 330, 56 + c * 14, 342)
    return { g, W, H }
  }

  it('толстая заливка панели уходит, линии плана остаются', () => {
    const { g, W, H } = screen()
    const bin = binarize(g, W, H)
    const walls = keepWallStrokes(bin)
    const inside = (x: number, y: number) => walls.ink[y * W + x] === 1
    // стены плана на месте
    expect(inside(42, 150)).toBe(true)
    expect(inside(169, 150)).toBe(true)
    // середина панели — нет
    expect(inside(500, 250)).toBe(false)
    // пикселей стало заметно меньше: панель была больше самого плана
    const before = bin.ink.reduce((a, b) => a + b, 0)
    const after = walls.ink.reduce((a, b) => a + b, 0)
    expect(after).toBeLessThan(before * 0.5)
  })

})

describe('заштрихованная полоса — не комната', () => {
  const W = 400
  const H = 120
  const room = (x1: number, y1: number, x2: number, y2: number): RoomRegion => ({
    x1,
    y1,
    x2,
    y2,
    areaPx: (x2 - x1) * (y2 - y1),
    points: (x2 - x1) * (y2 - y1),
    fill: 1,
    fillBox: 1,
    edges: 0,
    cx: (x1 + x2) / 2,
    cy: (y1 + y2) / 2,
    poly: [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 },
    ],
  })
  it('узкая полоса в мелких квадратиках (вентшахта) отсеивается; комната с подписью и пёстрая комната с мебелью — нет', () => {
    const ink = new Uint8Array(W * H)
    const dot = (x: number, y: number, s: number) => {
      for (let yy = y; yy < y + s; yy++) for (let xx = x; xx < x + s; xx++) ink[yy * W + xx] = 1
    }
    // комната с подписью: пара цифр
    dot(40, 50, 6)
    dot(50, 50, 6)
    // комната, где нарисована мебель: плотно, но она не полоса
    for (let y = 10; y < 110; y += 8) for (let x = 120; x < 210; x += 8) dot(x, y, 3)
    // полоса вентшахты: ряды квадратиков
    for (let y = 5; y < 115; y += 6) for (let x = 322; x < 345; x += 6) dot(x, y, 3)
    const regions = [room(10, 10, 110, 110), room(115, 10, 215, 110), room(220, 10, 315, 110), room(320, 5, 348, 115)]
    expect(hatchedStrips(regions, { ink, w: W, h: H })).toEqual([3])
  })
})
