import { describe, expect, it } from 'vitest'
import {
  applyH,
  binarize,
  boxBlur,
  cleanRaster,
  components,
  despeckle,
  distanceToInk,
  dominantAngle,
  flattenBackground,
  floodRoom,
  homography,
  orderCorners,
} from '../src/planner/raster'

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
