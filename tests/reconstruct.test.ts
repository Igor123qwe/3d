import { describe, expect, it } from 'vitest'
import type { AiRoom } from '../src/planner/aicontract'
import type { Underlay } from '../src/planner/types'
import { fitAxis, pointOnSide, reconstructFromRooms, scaleSamplesFromRooms, type DimSpan } from '../src/planner/reconstruct'
import { buildRooms } from '../src/planner/rooms'

// картинка 900 × 1000 px, 1 см в пикселе: доли картинки считать просто
const px = { w: 900, h: 1000 }
const u: Underlay = { src: '', px, x: 0, y: 0, scale: 1, opacity: 0.6, visible: true, locked: false }

/** внутренний прямоугольник комнаты в сантиметрах (он же пиксели) */
interface R {
  name: string
  x: number
  y: number
  w: number
  h: number
  kind?: string
}

// Квартира с плана БТИ: две жилые слева с уступом стены (3.72 и 4.01),
// санузел и коридор в середине, комната справа. Между комнатами перегородки 10 см.
const FLAT: R[] = [
  { name: '5ж', x: 40, y: 40, w: 372, h: 408, kind: 'жилая' },
  { name: '6', x: 422, y: 40, w: 180, h: 258, kind: 'санузел' },
  { name: 'коридор', x: 422, y: 308, w: 180, h: 140, kind: 'коридор' },
  { name: '1', x: 612, y: 40, w: 234, h: 408, kind: 'кухня' },
  { name: '4ж', x: 40, y: 458, w: 401, h: 426, kind: 'жилая' },
  { name: '2', x: 451, y: 458, w: 395, h: 426, kind: 'жилая' },
]

/** детерминированный «шум» модели: прямоугольники гуляют на ±12 px */
const jitter = [7, -9, 11, -4, -12, 6, 3, -8, 10, -6, 5, -11, 8, -3, 12, -7, 4, -10, 9, -5, 2, -1, 6, -12]
let j = 0
const noise = () => jitter[j++ % jitter.length]

function aiRooms(rooms: R[], what: 'sizes' | 'areas' | 'both' | 'none' = 'both', shake = true): AiRoom[] {
  j = 0
  return rooms.map((r) => {
    const n = shake ? noise : () => 0
    const box = { x1: (r.x + n()) / px.w, y1: (r.y + n()) / px.h, x2: (r.x + r.w + n()) / px.w, y2: (r.y + r.h + n()) / px.h }
    const room: AiRoom = { name: r.name, kind: r.kind, x: (r.x + r.w / 2) / px.w, y: (r.y + r.h / 2) / px.h, box }
    if (what === 'sizes' || what === 'both') {
      room.widthCm = r.w
      room.depthCm = r.h
    }
    if (what === 'areas' || what === 'both') room.areaM2 = Math.round(r.w * r.h) / 1e4
    return room
  })
}

const areaOf = (res: ReturnType<typeof reconstructFromRooms>, name: string) => res.rooms.find((r) => r.name === name)?.haveM2

describe('подгонка осей под размеры', () => {
  it('три оси цепочкой встают по подписанным расстояниям', () => {
    const pos = fitAxis([0, 90, 320], [
      { i: 0, j: 1, d: 100, w: 1 },
      { i: 1, j: 2, d: 200, w: 1 },
    ])
    expect(pos[1] - pos[0]).toBeCloseTo(100, 0)
    expect(pos[2] - pos[1]).toBeCloseTo(200, 0)
    // чертёж остаётся примерно там же, где был на картинке
    expect((pos[0] + pos[1] + pos[2]) / 3).toBeCloseTo((0 + 90 + 320) / 3, 0)
  })

  it('противоречивые подписи усредняются, а не ломают решение', () => {
    const pos = fitAxis([0, 100], [
      { i: 0, j: 1, d: 100, w: 1 },
      { i: 0, j: 1, d: 120, w: 1 },
    ])
    expect(pos[1] - pos[0]).toBeCloseTo(110, 0)
  })
})

describe('масштаб по размерам комнат', () => {
  it('каждая подпись даёт оценку сантиметров в пикселе', () => {
    const samples = scaleSamplesFromRooms(aiRooms(FLAT, 'sizes', false), px)
    expect(samples).toHaveLength(FLAT.length * 2)
    for (const s of samples) expect(s).toBeCloseTo(1, 2)
  })

  it('без размеров выручает площадь', () => {
    const samples = scaleSamplesFromRooms(aiRooms(FLAT, 'areas', false), px)
    expect(samples).toHaveLength(FLAT.length)
    for (const s of samples) expect(s).toBeCloseTo(1, 1)
  })
})

describe('чертёж по числам с плана', () => {
  it('квартира собирается целиком: все комнаты замкнуты, площади сходятся', () => {
    const res = reconstructFromRooms(aiRooms(FLAT), u)
    expect(res.skipped).toEqual([])
    expect(res.rooms).toHaveLength(FLAT.length)
    for (const r of FLAT) {
      const have = areaOf(res, r.name)
      expect(have, r.name).toBeDefined()
      // площадь по внутренним граням стен: расхождение с подписью не больше 4 %
      expect(Math.abs((have as number) - (r.w * r.h) / 1e4) / ((r.w * r.h) / 1e4), r.name).toBeLessThan(0.04)
    }
    expect(res.areaFit?.accuracy ?? 0).toBeGreaterThan(0.96)
    expect(res.areaFit?.off).toEqual([])
  })

  it('уступ стены (3.72 и 4.01) не слипается в одну ось', () => {
    const res = reconstructFromRooms(aiRooms(FLAT), u)
    const a = res.rooms.find((r) => r.name === '5ж')!.rect
    const b = res.rooms.find((r) => r.name === '4ж')!.rect
    expect(b.x2 - a.x2).toBeCloseTo(401 - 372, 0)
  })

  it('наружные стены толстые, перегородки тонкие', () => {
    const res = reconstructFromRooms(aiRooms(FLAT), u)
    const thick = res.walls.filter((w) => w.thickness === 40)
    const thin = res.walls.filter((w) => w.thickness === 10)
    expect(thick.length).toBeGreaterThanOrEqual(4)
    expect(thin.length).toBeGreaterThanOrEqual(4)
    // наружный контур: самая левая и самая правая стены — толстые
    const xs = res.walls.map((w) => Math.min(w.a.x, w.b.x))
    const leftmost = res.walls[xs.indexOf(Math.min(...xs))]
    expect(leftmost.thickness).toBe(40)
  })

  it('стены складываются в те же комнаты и обычным поиском по контуру', () => {
    const res = reconstructFromRooms(aiRooms(FLAT), u)
    const { rooms } = buildRooms({ version: 1, name: '', walls: res.walls, openings: [], furniture: [], rooms: [], dims: [], settings: { grid: 10 } })
    expect(rooms).toHaveLength(FLAT.length)
  })

  it('только площади, без размеров: комнаты всё равно замыкаются, точность ниже', () => {
    const res = reconstructFromRooms(aiRooms(FLAT, 'areas'), u)
    expect(res.rooms.filter((r) => r.haveM2 !== undefined)).toHaveLength(FLAT.length)
    expect(res.areaFit?.accuracy ?? 0).toBeGreaterThan(0.9)
  })

  it('без подписей вовсе — по картинке, как есть', () => {
    const res = reconstructFromRooms(aiRooms(FLAT, 'none'), u)
    expect(res.rooms.filter((r) => r.haveM2 !== undefined).length).toBeGreaterThanOrEqual(FLAT.length - 1)
    expect(res.areaFit).toBeNull()
  })

  it('шум побольше (±20 px) — комнаты всё ещё замыкаются, площади в пределах 6 %', () => {
    const rooms = aiRooms(FLAT)
    j = 0
    for (const r of rooms) {
      const b = r.box!
      b.x1 += (noise() * 0.8) / px.w
      b.y1 += (noise() * 0.8) / px.h
      b.x2 += (noise() * 0.8) / px.w
      b.y2 += (noise() * 0.8) / px.h
    }
    const res = reconstructFromRooms(rooms, u)
    expect(res.rooms.filter((r) => r.haveM2 !== undefined)).toHaveLength(FLAT.length)
    for (const r of FLAT) {
      const want = (r.w * r.h) / 1e4
      expect(Math.abs((areaOf(res, r.name) as number) - want) / want, r.name).toBeLessThan(0.06)
    }
  })

  it('Г-образная квартира: без комнаты в углу наружный контур всё равно замкнут', () => {
    const res = reconstructFromRooms(aiRooms(FLAT.filter((r) => r.name !== '1')), u)
    expect(res.rooms.filter((r) => r.haveM2 !== undefined)).toHaveLength(FLAT.length - 1)
    // правая стена санузла и коридора стала наружной — толстой
    const right = res.walls.filter((w) => w.a.x === w.b.x && Math.abs(w.a.x - 607) < 30)
    expect(right.length).toBeGreaterThan(0)
    expect(right.every((w) => w.thickness === 40)).toBe(true)
  })

  it('ниша уже полуметра пропускается и называется в отчёте', () => {
    const res = reconstructFromRooms([...aiRooms(FLAT), { name: 'ниша', x: 0.5, y: 0.5, box: { x1: 0.5, y1: 0.5, x2: 0.53, y2: 0.6 }, widthCm: 30, depthCm: 100 }], u)
    expect(res.skipped).toEqual(['ниша'])
    expect(res.rooms).toHaveLength(FLAT.length)
  })

  it('комнаты без прямоугольника строить не из чего', () => {
    const res = reconstructFromRooms([{ name: 'Кухня', x: 0.5, y: 0.5, areaM2: 10 }], u)
    expect(res.walls).toEqual([])
    expect(res.rooms).toEqual([])
  })

  it('точка на стене комнаты по стороне и доле', () => {
    const rect = { x1: 100, y1: 200, x2: 500, y2: 600 }
    expect(pointOnSide(rect, 'top', 0.25)).toEqual({ x: 200, y: 200 })
    expect(pointOnSide(rect, 'right', 0.5)).toEqual({ x: 500, y: 400 })
    expect(pointOnSide(rect, 'bottom', 1)).toEqual({ x: 500, y: 600 })
    expect(pointOnSide(rect, 'left', 2)).toEqual({ x: 100, y: 600 })
  })
})

describe('как на настоящем плане БТИ: подписи частичные, рамки с картинки малы', () => {
  /** модель со зрением рисует рамки «по подписи», а не по стенам: они на 15 % меньше и чуть сдвинуты */
  function shrunkRooms(labels: Record<string, { w?: number; h?: number; area?: boolean }>): AiRoom[] {
    j = 0
    return FLAT.map((r) => {
      const cx = r.x + r.w / 2 + noise() * 0.6
      const cy = r.y + r.h / 2 + noise() * 0.6
      const bw = r.w * 0.85
      const bh = r.h * 0.85
      const lab = labels[r.name] ?? {}
      const room: AiRoom = {
        name: r.name,
        x: cx / px.w,
        y: cy / px.h,
        box: { x1: (cx - bw / 2) / px.w, y1: (cy - bh / 2) / px.h, x2: (cx + bw / 2) / px.w, y2: (cy + bh / 2) / px.h },
      }
      if (lab.w) room.widthCm = lab.w
      if (lab.h) room.depthCm = lab.h
      if (lab.area !== false) room.areaM2 = Math.round(r.w * r.h) / 1e4
      return room
    })
  }

  it('у половины комнат подписан один размер, у остальных только площадь — площади сходятся в пределах 5 %', () => {
    const labels: Record<string, { w?: number; h?: number }> = {
      '5ж': { w: 372, h: 408 },
      '6': { w: 180 },
      '1': { w: 234 },
      '4ж': { w: 401, h: 426 },
      '2': { h: 426 },
      коридор: {},
    }
    const rooms = shrunkRooms(labels)
    const res = reconstructFromRooms(rooms, u)
    expect(res.rooms.filter((r) => r.haveM2 !== undefined)).toHaveLength(FLAT.length)
    for (const r of FLAT) {
      const want = (r.w * r.h) / 1e4
      const have = areaOf(res, r.name) as number
      // комнате с одной лишь площадью (коридор) размеры достаются от соседей — допуск чуть шире
      const tol = labels[r.name]?.w || labels[r.name]?.h ? 0.05 : 0.07
      expect(Math.abs(have - want) / want, `${r.name}: ${have.toFixed(2)} vs ${want.toFixed(2)}`).toBeLessThan(tol)
    }
    expect(res.areaFit?.accuracy ?? 0).toBeGreaterThan(0.96)
  })

  it('подпись у стены с выступом не сходится с площадью — побеждает площадь', () => {
    // комната на самом деле 372 × 374 = 13.9 м², а «4.08» — длина наружной стены с простенком
    const small: R[] = [
      { name: '5ж', x: 40, y: 40, w: 372, h: 374 },
      { name: '6', x: 422, y: 40, w: 180, h: 374 },
    ]
    j = 0
    const rooms = small.map((r) => {
      const bw = r.w * 0.85
      const bh = r.h * 0.85
      const cx = r.x + r.w / 2
      const cy = r.y + r.h / 2
      return { name: r.name, x: cx / px.w, y: cy / px.h, box: { x1: (cx - bw / 2) / px.w, y1: (cy - bh / 2) / px.h, x2: (cx + bw / 2) / px.w, y2: (cy + bh / 2) / px.h } } as AiRoom
    })
    Object.assign(rooms[0], { widthCm: 372, depthCm: 408, areaM2: 13.9 })
    Object.assign(rooms[1], { widthCm: 180, depthCm: 374, areaM2: 6.7 })
    const res = reconstructFromRooms(rooms, u)
    const have = areaOf(res, '5ж') as number
    expect(Math.abs(have - 13.9) / 13.9).toBeLessThan(0.05)
    const rect = res.rooms.find((r) => r.name === '5ж')!.rect
    // ширина осталась подписанной (372 + перегородка 10 + половина наружной 15), глубина стала 13.9 / 3.72 ≈ 3.74
    expect(rect.x2 - rect.x1).toBeCloseTo(397, -1)
    // сверху и снизу наружные стены: + перегородка 10 + две половины наружной по 15
    expect(rect.y2 - rect.y1).toBeCloseTo(374 + 40, -1)
  })

  it('размерная цепочка держит комнату без подписей', () => {
    // справа снизу ни у «2», ни у «1», ни у коридора подписей нет: правую границу
    // квартиры держит только цепочка по низу — 4.26 и 4.20 по осям стен
    const rooms = shrunkRooms({ '5ж': { w: 372, h: 408 }, '6': { w: 180, h: 258 }, '1': { area: false }, '4ж': { w: 401, h: 426 }, '2': { area: false }, коридор: { area: false } })
    const y = 884 + 10
    const dims: DimSpan[] = [
      { a: { x: 35, y }, b: { x: 461, y }, cm: 426 },
      { a: { x: 461, y }, b: { x: 881, y }, cm: 420 },
    ]
    const res = reconstructFromRooms(rooms, u, {}, dims)
    const rect = res.rooms.find((r) => r.name === '2')!.rect
    expect(rect.x2 - rect.x1).toBeCloseTo(420, -1)
    // без цепочки та же комната мала: рамка с картинки на 15 % меньше настоящей
    const bare = reconstructFromRooms(rooms, u)
    const bareRect = bare.rooms.find((r) => r.name === '2')!.rect
    expect(bareRect.x2 - bareRect.x1).toBeLessThan(390)
  })
})
