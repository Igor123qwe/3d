// Чертёж с нуля по числам с плана.
//
// Обводка линий и даже стены от модели со зрением дают кривой чертёж: координаты
// с картинки модель называет приблизительно, а растр видит выноски и штриховку.
// Зато числа на плане БТИ модель читает надёжно: размеры у стен («3.72»),
// площади в комнатах («13.9»). Здесь чертёж строится заново именно из чисел:
//
// 1. Каждая комната — прямоугольник с размерами из подписей; площадь сверяет
//    и при нужде поправляет. Положение — примерно по картинке.
// 2. Грани соседних комнат сводятся в общие оси стен: где у одной комнаты
//    правая стена, там у соседки левая.
// 3. Оси подгоняются методом наименьших квадратов так, чтобы расстояния между
//    ними равнялись подписанным размерам. Картинка только удерживает чертёж
//    на месте, числа решают.
// 4. Из осей собираются стены: между двумя комнатами — перегородка, с одной
//    комнатой — наружная стена. Комнаты находятся обычным способом по контуру,
//    и их площади сверяются с подписанными — это и есть отчёт о точности.
import type { AiBox, AiRoom, AiSide } from './aicontract'
import type { Pt, Underlay, Wall } from './types'
import { uid } from './types'
import { buildRooms } from './rooms'
import { WALL_THICKNESSES } from './ops'
import { pointInPoly } from './geometry'

export interface ReconstructOptions {
  /** толщина перегородок между комнатами, см */
  interiorCm?: number
  /** толщина наружных стен, см */
  exteriorCm?: number
  /** ближе скольких сантиметров грани комнат считаются одной осью стены */
  snapCm?: number
  /**
   * Геометрия — строго по картинке: комнаты сняты с неё по внутренним граням
   * стен, и стены встают туда, где они на фото. Подписи тогда только
   * проверяют результат и не двигают ни одной стены
   */
  fixed?: boolean
}

export const DEFAULT_RECONSTRUCT: Required<ReconstructOptions> = { interiorCm: 10, exteriorCm: 40, snapCm: 25, fixed: false }

/** размеры двух комнат, делящих ось, различаются больше — значит, осей две (уступ стены) */
const JOG_CM = 15
/** вес размерной цепочки против подписи комнаты: цепочки на плане меряют то по осям, то по граням стен, подпись комнаты честнее */
const CHAIN_WEIGHT = 0.5

/** комната, которую удалось поставить на чертёж */
export interface PlacedRoom {
  name: string
  kind?: string
  /** точка внутри — по ней комната узнаётся после перестройки стен */
  anchor: Pt
  /** оси стен вокруг комнаты, см */
  rect: { x1: number; y1: number; x2: number; y2: number }
  wantM2?: number
  /** площадь получившейся комнаты; нет — контур не замкнулся */
  haveM2?: number
}

export interface AreaFit {
  /** средняя точность по подписанным площадям, 0..1 */
  accuracy: number
  /** комнаты, где расхождение заметно, от худшей */
  off: { name: string; wantM2: number; haveM2: number }[]
  samples: number
}

export interface ReconstructResult {
  walls: Wall[]
  rooms: PlacedRoom[]
  /** комнаты, что не удалось поставить: без размеров, слишком узкие */
  skipped: string[]
  /** комнаты, выброшенные как лишние: без них площади остальных сошлись заметно лучше, а на картинке их нет */
  dropped: string[]
  /** комнаты, без которых площади сошлись бы лучше, но выбросить их нельзя: картинка их подтверждает */
  doubtful: string[]
  areaFit: AreaFit | null
}

/** ближайшая типовая толщина стены */
export function wallThickness(cm: number): number {
  let best = WALL_THICKNESSES[0]
  for (const t of WALL_THICKNESSES) if (Math.abs(t - cm) < Math.abs(best - cm)) best = t
  return best
}

/** Комната, по которой можно строить: есть прямоугольник на картинке */
export const canRebuildFrom = (r: AiRoom): r is AiRoom & { box: AiBox } => !!r.box

/**
 * Сантиметры в пикселе по размерам комнат: подписанная ширина делится на
 * ширину прямоугольника в пикселях. Каждая подпись — отдельная оценка.
 */
export function scaleSamplesFromRooms(rooms: AiRoom[], px: { w: number; h: number }): number[] {
  const out: number[] = []
  for (const r of rooms) {
    if (!r.box) continue
    const bw = (r.box.x2 - r.box.x1) * px.w
    const bh = (r.box.y2 - r.box.y1) * px.h
    if (r.widthCm && bw >= 12) out.push(r.widthCm / bw)
    if (r.depthCm && bh >= 12) out.push(r.depthCm / bh)
    // без размеров выручает площадь: корень из отношения площадей
    if (!r.widthCm && !r.depthCm && r.areaM2 && bw >= 12 && bh >= 12) out.push(Math.sqrt((r.areaM2 * 1e4) / (bw * bh)))
  }
  return out
}

interface Rect {
  spec: AiRoom & { box: AiBox }
  cx: number
  cy: number
  /** внутренние размеры, см, и откуда они: из подписи или с картинки */
  w: number
  h: number
  wLabelled: boolean
  hLabelled: boolean
  /** размер взят прямо с подписи и согласован с площадью — его не подгоняем */
  fixedW: boolean
  fixedH: boolean
  /** площадь рамки по подписи, см² (0 — нет): подписанная площадь плюс углы, отданные соседям */
  areaCm2: number
  /** размеры рамки с картинки, см: по ним грани встают на оси, подписи же — только уравнения */
  bw: number
  bh: number
  /** индексы осей после сведения */
  xi: number
  xj: number
  yi: number
  yj: number
}

const toPlan = (u: Underlay, px: Pt): Pt => ({ x: u.x + px.x * u.scale, y: u.y + px.y * u.scale })

/**
 * Внутренние размеры комнаты. Площадь на плане БТИ — самое надёжное число:
 * её пишут для комнаты целиком. Размеры у стен надёжны, когда сходятся с
 * площадью; если нет — одна из подписей относится к стене с выступом, а не
 * к комнате, и какая именно, подсказывает форма прямоугольника на картинке.
 * Чего не подписано — выводится из площади и того, что подписано.
 */
function sizeRoom(r: AiRoom & { box: AiBox }, u: Underlay, all: (AiRoom & { box: AiBox })[]): Omit<Rect, 'xi' | 'xj' | 'yi' | 'yj'> {
  const bw = (r.box.x2 - r.box.x1) * u.px.w * u.scale
  const bh = (r.box.y2 - r.box.y1) * u.px.h * u.scale
  // Г-образная комната: подписанная площадь — без угла, отданного соседу, а размеры
  // у стен — по всей рамке. Чтобы они сошлись, к площади добавляется этот угол
  let notchCm2 = 0
  for (const name of r.yieldsTo ?? []) {
    const s = all.find((x) => x.name === name)
    if (!s) continue
    const ox = Math.max(0, Math.min(r.box.x2, s.box.x2) - Math.max(r.box.x1, s.box.x1)) * u.px.w * u.scale
    const oy = Math.max(0, Math.min(r.box.y2, s.box.y2) - Math.max(r.box.y1, s.box.y1)) * u.px.h * u.scale
    notchCm2 += ox * oy
  }
  const A = r.areaM2 ? r.areaM2 * 1e4 + notchCm2 : 0
  let w = r.widthCm ?? bw
  let h = r.depthCm ?? bh
  let wLabelled = !!r.widthCm
  let hLabelled = !!r.depthCm
  let fixedW = wLabelled
  let fixedH = hLabelled
  if (A) {
    const k = A / (w * h)
    if (wLabelled && hLabelled) {
      if (Math.abs(k - 1) > 0.06) {
        // Подписи не сходятся с площадью: либо одна подпись — длина стены с
        // простенком, либо комната не прямоугольная (ниша, шахта). Рассудить может
        // точная рамка с картинки: подпись, совпавшая с ней, — верная. Совпали обе —
        // комната с вырезом: размеры остаются, площадь пойдёт только в проверку
        const near = (label: number, pic: number) => pic > 0 && Math.abs(label - pic) <= 0.08 * pic
        const wOk = !!r.exact && near(w, bw)
        const hOk = !!r.exact && near(h, bh)
        if (wOk && hOk) {
          // обе подписи по картинке — оставляем как есть
        } else if (wOk && !hOk) {
          h = A / w
          fixedH = false
        } else if (hOk && !wOk) {
          w = A / h
          fixedW = false
        } else {
          const byW = { w, h: A / w }
          const byH = { w: A / h, h }
          const aspect = bw > 0 && bh > 0 ? bw / bh : 1
          if (Math.abs(byW.w / byW.h - aspect) <= Math.abs(byH.w / byH.h - aspect)) {
            h = byW.h
            fixedH = false
          } else {
            w = byH.w
            fixedW = false
          }
        }
      }
    } else if (wLabelled) {
      h = A / w
      hLabelled = true
    } else if (hLabelled) {
      w = A / h
      wLabelled = true
    } else {
      // форма с картинки, величина — из площади
      const q = Math.sqrt(k)
      w *= q
      h *= q
      wLabelled = hLabelled = true
    }
  }
  const c = toPlan(u, { x: ((r.box.x1 + r.box.x2) / 2) * u.px.w, y: ((r.box.y1 + r.box.y2) / 2) * u.px.h })
  return { spec: r, cx: c.x, cy: c.y, w, h, wLabelled, hLabelled, fixedW, fixedH, areaCm2: A, bw, bh }
}

/**
 * Модель со зрением рисует рамку комнаты «по подписи», внутри настоящих стен:
 * между гранями соседних комнат остаётся щель шире перегородки. Грани, что
 * смотрят друг на друга через такую щель, — одна стена: сводим их к середине.
 * Грани с одной стороны (правая над правой) так не трогаем — там бывает уступ.
 */
function closeFacingGaps(rects: Rect[], rawX: number[], rawY: number[], minGap: number, t: number, fixed = false): number[] {
  const overlap1 = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1))
  // толщина стены между точными рамками с картинки — сама щель между гранями:
  // по ней стена и рисуется (шахта между санузлом и коридором бывает и в полметра)
  // по ячейке на каждую сторону: left, right, top, bottom — толщины по X и по Y не должны затирать друг друга
  const edgeGap = new Array<number>(rects.length * 4).fill(0)
  // кто кому уступает угол: вернёт уступающую комнату из пары или null
  const yielder = (a: Rect, b: Rect): Rect | null => (a.spec.yieldsTo?.includes(b.spec.name) ? a : b.spec.yieldsTo?.includes(a.spec.name) ? b : null)
  // щель от сжатия рамок растёт с размером комнаты: у двух комнат по 4 м она
  // доходит до 60–90 см, а коридор между комнатами уже 90 см — редкость.
  // Рамки могут и налезть друг на друга (шум картинки): комнаты не пересекаются,
  // так что небольшое наложение — тоже общая стена
  // По картинке: пустая полоса между двумя комнатами, где нет третьей, — это
  // стена (толстая — значит, с шахтой), а не щель. Сводим её в одну стену
  // шириной с полосу, лишь бы не шире метра с небольшим
  const maxGap = (a: number, b: number) => (fixed ? Math.max(minGap, 110) : Math.max(minGap, 0.22 * Math.min(a, b)))
  // между гранями a и b лежит другая комната — тогда это не их общая стена
  const between = (i: number, j: number, vertical: boolean): boolean =>
    rects.some((c, m) => {
      if (m === i || m === j) return false
      if (vertical) {
        const lo = rawX[i * 2 + 1]
        const hi = rawX[j * 2]
        const cx1 = rawX[m * 2]
        const cx2 = rawX[m * 2 + 1]
        const oy = overlap1(rawY[m * 2], rawY[m * 2 + 1], Math.max(rawY[i * 2], rawY[j * 2]), Math.min(rawY[i * 2 + 1], rawY[j * 2 + 1]))
        return oy > 0 && cx1 < hi && cx2 > lo
      }
      const lo = rawY[i * 2 + 1]
      const hi = rawY[j * 2]
      const cy1 = rawY[m * 2]
      const cy2 = rawY[m * 2 + 1]
      const ox = overlap1(rawX[m * 2], rawX[m * 2 + 1], Math.max(rawX[i * 2], rawX[j * 2]), Math.min(rawX[i * 2 + 1], rawX[j * 2 + 1]))
      return ox > 0 && cy1 < hi && cy2 > lo
    })
  // наложение растёт с шумом так же, как щель — с размером комнаты
  const minOverlap = (a: number, b: number) => -Math.max(minGap, 0.3 * Math.min(a, b))
  for (let i = 0; i < rects.length; i++) {
    for (let j = 0; j < rects.length; j++) {
      if (i === j) continue
      const a = rects[i]
      const b = rects[j]
      const exact = !!a.spec.exact && !!b.spec.exact
      // Сосед, заходящий в угол Г-образной комнаты, касается её грани лишь
      // частью: такие грани не сводим — иначе вырез схлопнется. Но если грани
      // перекрываются почти целиком, это общая стена во всю сторону, и свести
      // её нужно, иначе между комнатами останется щель шириной в стену
      // Сосед заходит в угол Г-образной комнаты, если касается её стороны лишь
      // частью. Доля считается от стороны той комнаты, что уступает угол: узкий
      // коридор перекрывает свою сторону целиком, а сторону комнаты — на четверть
      const gives = yielder(a, b)
      // a слева от b: правая грань a и левая грань b
      const gapX = rawX[j * 2] - rawX[i * 2 + 1]
      const spanY = overlap1(a.cy - a.bh / 2, a.cy + a.bh / 2, b.cy - b.bh / 2, b.cy + b.bh / 2)
      if (gives && spanY <= gives.bh * 0.7) {
        // грань уходит в вырез — пропускаем только её
      } else if (gapX > minOverlap(a.bw, b.bw) && gapX <= maxGap(a.bw, b.bw) && spanY > Math.min(a.bh, b.bh) * 0.3 && !(fixed && gapX > minGap && between(i, j, true))) {
        const mid = (rawX[j * 2] + rawX[i * 2 + 1]) / 2
        // между внутренними гранями — щель плюс те t/2, что уже заложены в грани
        // между внутренними гранями — щель плюс те t/2 с каждой стороны, что уже заложены в грани
        if (exact && gapX > -t) edgeGap[i * 4 + 1] = edgeGap[j * 4 + 0] = gapX + t
        rawX[j * 2] = mid
        rawX[i * 2 + 1] = mid
      }
      // a над b: нижняя грань a и верхняя грань b
      const gapY = rawY[j * 2] - rawY[i * 2 + 1]
      const spanX = overlap1(a.cx - a.bw / 2, a.cx + a.bw / 2, b.cx - b.bw / 2, b.cx + b.bw / 2)
      if (gives && spanX <= gives.bw * 0.7) {
        // грань уходит в вырез — пропускаем только её
      } else if (gapY > minOverlap(a.bh, b.bh) && gapY <= maxGap(a.bh, b.bh) && spanX > Math.min(a.bw, b.bw) * 0.3 && !(fixed && gapY > minGap && between(i, j, false))) {
        const mid = (rawY[j * 2] + rawY[i * 2 + 1]) / 2
        if (exact && gapY > -t) edgeGap[i * 4 + 3] = edgeGap[j * 4 + 2] = gapY + t
        rawY[j * 2] = mid
        rawY[i * 2 + 1] = mid
      }
    }
  }
  return edgeGap
}

/**
 * Соседство, названное моделью: «за правой стеной 5ж — 6 и коридор». Общая
 * стена одна на двоих, как бы ни разошлись рамки на картинке: правая грань
 * одной и левая грань другой сводятся к общему положению. Связи объединяются
 * через систему непересекающихся множеств, чтобы цепочка A–B–C дала одну ось.
 */
function linkDeclaredNeighbors(rects: Rect[], rawX: number[], rawY: number[]): void {
  const byName = new Map(rects.map((r, k) => [r.spec.name, k]))
  const n = rects.length * 2
  const parentX = Array.from({ length: n }, (_, i) => i)
  const parentY = Array.from({ length: n }, (_, i) => i)
  const find = (par: number[], i: number): number => (par[i] === i ? i : (par[i] = find(par, par[i])))
  const union = (par: number[], a: number, b: number) => {
    const ra = find(par, a)
    const rb = find(par, b)
    if (ra !== rb) par[rb] = ra
  }
  rects.forEach((r, k) => {
    const nb = r.spec.neighbors
    if (!nb) return
    // сосед, заходящий в угол Г-образной комнаты, делит с ней не сторону, а угол:
    // сводить их грани в одну ось — значит стереть вырез
    const corner = (m: number) => !!r.spec.yieldsTo?.includes(rects[m].spec.name) || !!rects[m].spec.yieldsTo?.includes(r.spec.name)
    for (const name of nb.right ?? []) {
      const m = byName.get(name)
      if (m !== undefined && m !== k && !corner(m)) union(parentX, k * 2 + 1, m * 2)
    }
    for (const name of nb.left ?? []) {
      const m = byName.get(name)
      if (m !== undefined && m !== k && !corner(m)) union(parentX, k * 2, m * 2 + 1)
    }
    for (const name of nb.bottom ?? []) {
      const m = byName.get(name)
      if (m !== undefined && m !== k && !corner(m)) union(parentY, k * 2 + 1, m * 2)
    }
    for (const name of nb.top ?? []) {
      const m = byName.get(name)
      if (m !== undefined && m !== k && !corner(m)) union(parentY, k * 2, m * 2 + 1)
    }
  })
  for (const [par, raw] of [
    [parentX, rawX],
    [parentY, rawY],
  ] as const) {
    const groups = new Map<number, number[]>()
    for (let e = 0; e < n; e++) {
      const root = find(par, e)
      const g = groups.get(root) ?? []
      g.push(e)
      groups.set(root, g)
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue
      // общая стена не может быть у двух граней одной комнаты
      const rooms = new Set(g.map((e) => Math.floor(e / 2)))
      if (rooms.size < g.length) continue
      const mean = g.reduce((a, e) => a + raw[e], 0) / g.length
      for (const e of g) raw[e] = mean
    }
  }
}

interface Axis {
  /** положение оси, см */
  pos: number[]
  /** исходное положение по картинке — держит чертёж на месте */
  seed: number[]
}

/**
 * Свести близкие грани в общие оси; вернуть индекс оси для каждой грани.
 * Грани, чьё положение известно по подписи, сводятся с жёстким допуском:
 * подпись точнее картинки, и уступ стены в 30 см для них — две разные оси.
 */
function cluster(values: number[], snap: number, exact?: boolean[], tight = JOG_CM): { index: number[]; seed: number[] } {
  const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b])
  const index = new Array<number>(values.length)
  const seed: number[] = []
  let start = -Infinity
  let last = -Infinity
  let lastExact = false
  let sum = 0
  let n = 0
  const flush = () => {
    if (n) seed.push(sum / n)
    sum = 0
    n = 0
  }
  for (const i of order) {
    const v = values[i]
    const isExact = !!exact?.[i]
    const tol = isExact && lastExact ? tight : snap
    // новая ось: далеко от предыдущей грани или кластер стал шире полутора допусков
    if (v - last > tol || v - start > snap * 1.5) {
      flush()
      start = v
    }
    index[i] = seed.length
    last = v
    lastExact = isExact
    sum += v
    n++
  }
  flush()
  return { index, seed }
}

interface Constraint {
  i: number
  j: number
  d: number
  w: number
}

/**
 * Подогнать оси под размеры: минимизируем сумму w·(pos[j] − pos[i] − d)²,
 * слабо удерживая оси у положений с картинки. Гаусс–Зейдель сходится быстро:
 * осей на плане квартиры десятки, не тысячи.
 */
export function fitAxis(seed: number[], constraints: Constraint[], hold = 0.02, iterations = 400): number[] {
  const pos = seed.slice()
  const n = pos.length
  const byAxis: Constraint[][] = Array.from({ length: n }, () => [])
  for (const c of constraints) {
    if (c.i === c.j || c.i < 0 || c.j < 0 || c.i >= n || c.j >= n) continue
    byAxis[c.i].push(c)
    byAxis[c.j].push(c)
  }
  for (let it = 0; it < iterations; it++) {
    let moved = 0
    for (let k = 0; k < n; k++) {
      let num = hold * seed[k]
      let den = hold
      for (const c of byAxis[k]) {
        if (c.j === k) num += c.w * (pos[c.i] + c.d)
        else num += c.w * (pos[c.j] - c.d)
        den += c.w
      }
      const next = num / den
      moved = Math.max(moved, Math.abs(next - pos[k]))
      pos[k] = next
    }
    if (moved < 0.01) break
  }
  return pos
}

interface AxisSpec {
  dw: number
  dh: number
  ww: number
  wh: number
  wExact: boolean
  hExact: boolean
}

/** одна комната вдоль одной оси: расстояние между её гранями и вес этой подписи */
interface Span {
  d: number
  w: number
  exact: boolean
}

/**
 * Оси по одному направлению: сначала подгонка, потом починка сведения.
 *
 * Картинка шумит на ±10–15 см, а уступ стены бывает 30: грань легко прилипает
 * не к той оси. Числа это выдают — у такой комнаты размер не сходится. Поэтому
 * для комнат с большим расхождением пробуем перевесить грань на соседнюю ось
 * или на новую и оставляем, если сумма расхождений заметно упала. Потом оси,
 * оказавшиеся почти в одном месте, сливаются, если числа не против.
 *
 * index — ось каждой грани (грань 2m — низ комнаты m, 2m+1 — верх); меняется на месте.
 */
export function optimizeAxes(index: number[], seed: number[], raw: number[], spans: Span[], o: Required<ReconstructOptions>, extras: Constraint[] = []): number[] {
  const cons = (): Constraint[] => [...spans.map((s, m) => ({ i: index[m * 2], j: index[m * 2 + 1], d: s.d, w: s.w })), ...extras]
  const fit = () => fitAxis(seed, cons())
  const residual = (pos: number[], m: number) => (index[m * 2] === index[m * 2 + 1] ? 1e4 : pos[index[m * 2 + 1]] - pos[index[m * 2]] - spans[m].d)
  // Мерило для решений «перевесить грань» и «завести ось» — только подписи и
  // цепочки. Оценки с картинки (вес 0.2) в подгонке участвуют, но решать не
  // должны: рамка комнаты без подписи бывает мала на треть, и по ней легко
  // разорвать общую стену, которую подписи держат верно.
  const total = (pos: number[]) =>
    spans.reduce((sum, s, m) => sum + (s.w >= 0.5 ? s.w * residual(pos, m) ** 2 : 0), 0) +
    extras.reduce((sum, c) => sum + c.w * (pos[c.j] - pos[c.i] - c.d) ** 2, 0)
  const NEW_AXIS_GAIN = JOG_CM * JOG_CM

  let pos = fit()
  let best = total(pos)
  /** один проход по комнатам с расхождением; новая ось — только когда разрешена */
  const pass = (allowNew: boolean): boolean => {
    const order = spans.map((_, m) => m).sort((a, b) => Math.abs(residual(pos, b)) - Math.abs(residual(pos, a)))
    for (const m of order) {
      if (spans[m].w < 0.5 || Math.abs(residual(pos, m)) < 3) continue
      for (const e of [m * 2, m * 2 + 1]) {
        const other = e === m * 2 ? m * 2 + 1 : m * 2
        // где грань должна быть по подписи, если противоположная ось стоит верно
        const want = spans[m].exact ? pos[index[other]] + (e === m * 2 ? -spans[m].d : spans[m].d) : raw[e]
        const cur = index[e]
        const candidates = seed
          .map((_, k) => k)
          .filter((k) => k !== cur && k !== index[other] && Math.abs(pos[k] - want) <= o.snapCm * 1.5)
          .sort((a, b) => Math.abs(pos[a] - want) - Math.abs(pos[b] - want))
        if (allowNew && spans[m].exact) candidates.push(-1)
        for (const k of candidates) {
          const fresh = k === -1
          if (fresh) seed.push(want)
          index[e] = fresh ? seed.length - 1 : k
          const next = fit()
          const score = total(next)
          if (best - score > (fresh ? NEW_AXIS_GAIN : 1)) {
            pos = next
            best = score
            return true
          }
          index[e] = cur
          if (fresh) seed.pop()
        }
      }
    }
    return false
  }
  // сначала перевешиваем грани на уже известные оси, и только когда это
  // не помогает — заводим новую: два нулевых решения, выбираем без лишней стены
  for (let round = 0; round < 12; round++) {
    if (pass(false)) continue
    if (!pass(true)) break
  }

  // слить оси, оказавшиеся почти в одном месте: две стены в пяти сантиметрах — не чертёж
  for (let k1 = 0; k1 < seed.length; k1++) {
    for (let k2 = k1 + 1; k2 < seed.length; k2++) {
      if (Math.abs(pos[k1] - pos[k2]) > JOG_CM) continue
      const moved = index.map((k, e) => (k === k2 ? e : -1)).filter((e) => e >= 0)
      if (!moved.length) continue
      for (const e of moved) index[e] = k1
      const clash = spans.some((_, m) => index[m * 2] === index[m * 2 + 1])
      const next = clash ? null : fit()
      if (next && total(next) - best <= NEW_AXIS_GAIN) {
        pos = next
        best = total(next)
      } else {
        for (const e of moved) index[e] = k2
      }
    }
  }
  return pos
}

/** перекрытие отрезков [a1,a2] и [b1,b2] */
const overlap = (a1: number, a2: number, b1: number, b2: number): number => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1))

/**
 * Построить стены по комнатам. Подложка уже в нужном масштабе: scale — см в пикселе.
 */
/** размерная цепочка с плана в координатах чертежа, см */
export interface DimSpan {
  a: Pt
  b: Pt
  cm: number
}

/** ближайшая ось к положению, не дальше tol */
function nearestAxis(pos: number[], v: number, tol: number): number {
  let best = -1
  let bestD = tol
  pos.forEach((p, k) => {
    const d = Math.abs(p - v)
    if (d < bestD) {
      bestD = d
      best = k
    }
  })
  return best
}

/**
 * Чертёж по комнатам с проверкой площадей. Если площади сходятся хуже 90 %,
 * по одной пробуется убрать комнату: без выдуманной моделью комнаты соседям
 * хватает места, и сходимость растёт заметно. Но выбросить можно только то,
 * чего на картинке нет: canDrop говорит, подтверждает ли картинка комнату.
 * Подтверждённая остаётся, а в doubtful видно, что с ней площади не сходятся —
 * это место стоит уточнить, а не молча стереть.
 */
export function reconstructFromRooms(rooms: AiRoom[], u: Underlay, options: ReconstructOptions = {}, dims: DimSpan[] = [], canDrop: (room: AiRoom) => boolean = () => false): ReconstructResult {
  let current = rooms.filter(canRebuildFrom)
  let best = reconstructCore(current, u, options, dims)
  const dropped: string[] = []
  const doubtful = new Set<string>()
  // по картинке комнаты не выбрасываются и не перебираются: геометрия от подписей
  // не зависит, а несходящиеся подписи и так названы спорными
  for (let attempt = 0; attempt < (options.fixed ? 0 : 2); attempt++) {
    const acc = best.areaFit?.accuracy ?? 1
    if (acc >= 0.9 || current.length < 3 || (best.areaFit?.samples ?? 0) < 2) break
    let candidate: { res: ReconstructResult; room: AiRoom } | null = null
    for (const r of current) {
      const rest = current.filter((x) => x !== r)
      const res = reconstructCore(rest, u, options, dims)
      const gain = (res.areaFit?.accuracy ?? 0) - acc
      // без этой комнаты должно стать заметно лучше, и подписанных площадей — не меньше одной
      if (!(gain >= 0.1 && (res.areaFit?.samples ?? 0) >= 1)) continue
      if (!candidate || (res.areaFit?.accuracy ?? 0) > (candidate.res.areaFit?.accuracy ?? 0)) candidate = { res, room: r }
    }
    if (!candidate) break
    // лучший кандидат на выброс, но картинка его подтверждает: оставляем и помечаем
    if (!canDrop(candidate.room)) {
      doubtful.add(candidate.room.name)
      break
    }
    dropped.push(candidate.room.name)
    current = current.filter((x) => x !== candidate!.room)
    best = candidate.res
  }
  return { ...best, dropped, doubtful: [...doubtful] }
}

function reconstructCore(rooms: AiRoom[], u: Underlay, options: ReconstructOptions = {}, dims: DimSpan[] = []): ReconstructResult {
  const o = { ...DEFAULT_RECONSTRUCT, ...options }
  const skipped: string[] = []
  const boxed = rooms.filter(canRebuildFrom)
  const sized = boxed.map((r) => {
    const z = sizeRoom(r, u, boxed)
    // по картинке: размеры комнаты — её рамка на фото, подпись их не меняет
    return o.fixed ? { ...z, w: z.bw, h: z.bh, wLabelled: false, hLabelled: false, fixedW: false, fixedH: false } : z
  })
  // комната уже полуметра — ниша или шкаф, а не комната: осей ей не хватит
  const rects = sized.filter((r) => {
    const ok = r.w >= 60 && r.h >= 60
    if (!ok) skipped.push(r.spec.name)
    return ok
  }) as Rect[]
  if (!rects.length) return { walls: [], rooms: [], skipped, dropped: [], doubtful: [], areaFit: null }

  // 1. грани → оси по картинке. Положение граней берётся с рамок картинки у всех
  //    комнат одинаково (подписанные не «вырастают» относительно неподписанных —
  //    иначе их общие стены не сведутся); подписанные размеры входят уравнениями
  const t = o.interiorCm
  // Точная рамка с картинки, которая на 15 % и больше расходится с подписью, —
  // это обрезанное фото или закрытый чем-то край: положение граней тогда берётся
  // по подписи, от той стороны, где сосед или стена подтверждены
  const span = (r: Rect, axis: 'x' | 'y'): [number, number] => {
    const c = axis === 'x' ? r.cx : r.cy
    const b = axis === 'x' ? r.bw : r.bh
    if (o.fixed) {
      // Картинка — правда. Исключение одно: сторона упёрлась в край кадра, фото
      // там обрезано, и что за краем, знает только подпись. Растягиваем комнату
      // по подписи в эту сторону, и только если подпись больше картинки
      const lab = axis === 'x' ? r.spec.widthCm : r.spec.depthCm
      const lo = axis === 'x' ? 'left' : 'top'
      const hi = axis === 'x' ? 'right' : 'bottom'
      const cutLo = !!r.spec.cut?.includes(lo)
      const cutHi = !!r.spec.cut?.includes(hi)
      if (lab && lab > b * 1.1 && cutHi && !cutLo) return [c - b / 2 - t / 2, c - b / 2 + lab + t / 2]
      if (lab && lab > b * 1.1 && cutLo && !cutHi) return [c + b / 2 - lab - t / 2, c + b / 2 + t / 2]
      return [c - b / 2 - t / 2, c + b / 2 + t / 2]
    }
    const v = axis === 'x' ? r.w : r.h
    const labelled = axis === 'x' ? r.wLabelled : r.hLabelled
    if (!r.spec.exact || !labelled || Math.abs(v - b) <= 0.15 * b) return [c - b / 2 - t / 2, c + b / 2 + t / 2]
    const lo = axis === 'x' ? 'left' : 'top'
    const hi = axis === 'x' ? 'right' : 'bottom'
    const outer = (side: AiSide) => !!r.spec.outer?.includes(side)
    const nb = (side: AiSide) => !!r.spec.neighbors?.[side]?.length
    const anchorLo = (outer(hi) && !outer(lo)) || (nb(lo) && !nb(hi))
    const anchorHi = (outer(lo) && !outer(hi)) || (nb(hi) && !nb(lo))
    if (anchorLo && !anchorHi) return [c - b / 2 - t / 2, c - b / 2 + v + t / 2]
    if (anchorHi && !anchorLo) return [c + b / 2 - v - t / 2, c + b / 2 + t / 2]
    return [c - v / 2 - t / 2, c + v / 2 + t / 2]
  }
  const rawX = rects.flatMap((r) => span(r, 'x'))
  const rawY = rects.flatMap((r) => span(r, 'y'))
  const edgeGap = closeFacingGaps(rects, rawX, rawY, o.snapCm * 2.5, t, o.fixed)
  linkDeclaredNeighbors(rects, rawX, rawY)

  // 2. какие стороны наружные: рядом нет комнаты. Смотрим по граням после сведения
  //    щелей — у соседей они уже совпадают, — а не по осям: ошибка сведения граней
  //    не должна превращать перегородку в наружную стену
  const extra = (o.exteriorCm - o.interiorCm) / 2
  const near = (a: number, b: number) => Math.abs(a - b) <= o.snapCm
  const sideIsExterior = (r: Rect, side: AiSide): boolean => {
    // модель сказала прямо, что снаружи, а что за стеной — верим ей
    if (r.spec.outer?.includes(side)) return true
    if (r.spec.neighbors?.[side]?.length) return false
    const k = rects.indexOf(r)
    const along = side === 'left' || side === 'right' ? r.bh : r.bw
    const [l, rr, tp, bt] = [rawX[k * 2], rawX[k * 2 + 1], rawY[k * 2], rawY[k * 2 + 1]]
    // грань внутри рамки Г-образного соседа, что уступил этот угол, — перегородка
    const at: Pt = side === 'left' ? { x: l, y: (tp + bt) / 2 } : side === 'right' ? { x: rr, y: (tp + bt) / 2 } : side === 'top' ? { x: (l + rr) / 2, y: tp } : { x: (l + rr) / 2, y: bt }
    if (rects.some((s, m) => s !== r && s.spec.yieldsTo?.includes(r.spec.name) && at.x > rawX[m * 2] && at.x < rawX[m * 2 + 1] && at.y > rawY[m * 2] && at.y < rawY[m * 2 + 1])) return false
    let covered = 0
    rects.forEach((s, m) => {
      if (s === r) return
      const [sl, sr, st, sb] = [rawX[m * 2], rawX[m * 2 + 1], rawY[m * 2], rawY[m * 2 + 1]]
      if (side === 'left' && near(sr, l)) covered += overlap(tp, bt, st, sb)
      if (side === 'right' && near(sl, rr)) covered += overlap(tp, bt, st, sb)
      if (side === 'top' && near(sb, tp)) covered += overlap(l, rr, sl, sr)
      if (side === 'bottom' && near(st, bt)) covered += overlap(l, rr, sl, sr)
    })
    return covered < along / 2
  }

  // Наружная стена по картинке: её ось — за гранью комнаты на половину толщины,
  // а толщина измерена по фото. Без замера — типовая
  const sideIdx: Record<AiSide, number> = { left: 0, right: 1, top: 2, bottom: 3 }
  const extTh = new Array<number>(rects.length * 4).fill(o.exteriorCm)
  if (o.fixed) {
    rects.forEach((r, k) => {
      for (const side of ['left', 'right', 'top', 'bottom'] as AiSide[]) {
        if (!sideIsExterior(r, side)) continue
        // Замер годится только для залитой стены: на планах БТИ стены нарисованы
        // двойной тонкой линией, и замер до бумаги ловит одну линию в пару точек
        const px = r.spec.wallPx?.[side]
        const th = px && px >= 6 ? wallThickness(Math.min(80, Math.max(o.interiorCm, px * u.scale))) : o.exteriorCm
        extTh[k * 4 + sideIdx[side]] = th
        const shift = (th - t) / 2
        if (side === 'left') rawX[k * 2] -= shift
        if (side === 'right') rawX[k * 2 + 1] += shift
        if (side === 'top') rawY[k * 2] -= shift
        if (side === 'bottom') rawY[k * 2 + 1] += shift
      }
    })
  }
  // По картинке грани стоят точно — с разбросом в несколько точек: у каждой
  // комнаты грань снята медианой по её собственным строкам, и окно или цифра
  // у стены сдвигают её на пару пикселей. Такой разброс сводим в одну ось, а
  // уступ заметно больше — оставляем уступом
  const snap = o.fixed ? Math.max(8, 8 * u.scale) : o.snapCm
  const cx = cluster(rawX, snap)
  const cy = cluster(rawY, snap)

  // 3. оси под размеры. Подпись весит как пять оценок с картинки
  // половина толщины стены за каждой гранью: наружной, измеренной по картинке или типовой
  const half = (r: Rect, side: AiSide): number => {
    if (sideIsExterior(r, side)) return t / 2 + extra
    const k = rects.indexOf(r)
    const idx = k * 4 + (side === 'left' ? 0 : side === 'right' ? 1 : side === 'top' ? 2 : 3)
    const gap = edgeGap[idx]
    return gap > t ? wallThickness(gap) / 2 : t / 2
  }
  const specOf = (r: Rect): AxisSpec => ({
    dw: r.w + half(r, 'left') + half(r, 'right'),
    dh: r.h + half(r, 'top') + half(r, 'bottom'),
    ww: r.wLabelled ? 1 : 0.02,
    wh: r.hLabelled ? 1 : 0.02,
    wExact: r.wLabelled,
    hExact: r.hLabelled,
  })

  // Размерные цепочки с плана — тоже уравнения: между какими осями сколько
  // сантиметров. Именно они держат то, что не подписано у комнат: коридоры,
  // ниши, наружный контур. К осям цепочки привязываются после первой подгонки:
  // тогда оси уже стоят по подписям, а не по рамкам с картинки
  let extrasX: Constraint[] = []
  let extrasY: Constraint[] = []
  const bindDims = (X: number[], Y: number[]) => {
    for (const d of dims) {
      const dx = Math.abs(d.b.x - d.a.x)
      const dy = Math.abs(d.b.y - d.a.y)
      // концы цепочки на картинке названы примерно, а неподписанная ось стоит
      // по сжатой рамке: допуск растёт с длиной цепочки
      const tol = Math.max(o.snapCm * 2, d.cm * 0.2)
      if (dx >= dy * 4) {
        const i = nearestAxis(X, Math.min(d.a.x, d.b.x), tol)
        const j = nearestAxis(X, Math.max(d.a.x, d.b.x), tol)
        if (i >= 0 && j >= 0 && i !== j) extrasX.push({ i, j, d: d.cm, w: CHAIN_WEIGHT })
      } else if (dy >= dx * 4) {
        const i = nearestAxis(Y, Math.min(d.a.y, d.b.y), tol)
        const j = nearestAxis(Y, Math.max(d.a.y, d.b.y), tol)
        if (i >= 0 && j >= 0 && i !== j) extrasY.push({ i, j, d: d.cm, w: CHAIN_WEIGHT })
      }
    }
  }

  // Площадь — уравнение второго порядка: ширина × глубина. Решаем по очереди:
  // подгоняем оси, смотрим, какая площадь вышла, поправляем неподписанный размер
  // от подписанного и подгоняем снова. Две-три итерации сходятся.
  let X: number[] = cx.seed
  let Y: number[] = cy.seed
  // по картинке оси уже на местах: подгонять нечего
  for (let round = 0; round < (o.fixed ? 0 : 5); round++) {
    const specs = rects.map(specOf)
    X = optimizeAxes(cx.index, X, rawX, specs.map((c) => ({ d: c.dw, w: c.ww, exact: c.wExact })), o, extrasX)
    Y = optimizeAxes(cy.index, Y, rawY, specs.map((c) => ({ d: c.dh, w: c.wh, exact: c.hExact })), o, extrasY)
    let changed = false
    if (round === 0 && dims.length) {
      bindDims(X, Y)
      changed = extrasX.length + extrasY.length > 0
    }
    rects.forEach((r, k) => {
      if (!r.areaCm2) return
      const spec = specs[k]
      const solvedW = X[cx.index[k * 2 + 1]] - X[cx.index[k * 2]] - (spec.dw - r.w)
      const solvedH = Y[cy.index[k * 2 + 1]] - Y[cy.index[k * 2]] - (spec.dh - r.h)
      if (solvedW <= 30 || solvedH <= 30) return
      const ratio = r.areaCm2 / (solvedW * solvedH)
      if (Math.abs(ratio - 1) < 0.03) return
      if (!r.fixedW && !r.fixedH) {
        const q = Math.sqrt(ratio)
        r.w = solvedW * q
        r.h = solvedH * q
      } else if (!r.fixedH) r.h = r.areaCm2 / solvedW
      else if (!r.fixedW) r.w = r.areaCm2 / solvedH
      else return
      changed = true
    })
    if (!changed) break
  }
  rects.forEach((r, k) => {
    r.xi = cx.index[k * 2]
    r.xj = cx.index[k * 2 + 1]
    r.yi = cy.index[k * 2]
    r.yj = cy.index[k * 2 + 1]
  })

  // Две оси, разъехавшиеся при подгонке на меньше чем толщину стены, и пустой
  // промежуток между ними — это не помещение, а щель: на чертеже она стала бы
  // комнатой в четверть метра. Такие оси сводим в одну
  const closeGaps = (pos: number[], lo: (r: Rect) => number, hi: (r: Rect) => number, set: (r: Rect, i: number, j: number) => void) => {
    const map = pos.map((_, i) => i)
    for (let k = 0; k + 1 < pos.length; k++) {
      const gap = pos[k + 1] - pos[k]
      if (gap <= 0 || gap >= o.interiorCm * 1.5) continue
      // промежуток занят комнатой — это её часть, а не щель между стенами
      if (rects.some((r) => lo(r) <= k && hi(r) >= k + 1)) continue
      // с обеих сторон промежутка стоят грани комнат: между ними должна быть одна стена
      if (!rects.some((r) => hi(r) === k) || !rects.some((r) => lo(r) === k + 1)) continue
      const mid = (pos[k] + pos[k + 1]) / 2
      pos[k] = mid
      pos[k + 1] = mid
      map[k + 1] = map[k]
    }
    for (const r of rects) set(r, map[lo(r)], map[hi(r)])
  }
  closeGaps(X, (r) => r.xi, (r) => r.xj, (r, i, j) => ((r.xi = i), (r.xj = j)))
  closeGaps(Y, (r) => r.yi, (r) => r.yj, (r, i, j) => ((r.yi = i), (r.yj = j)))

  // узкая комната, у которой обе грани слиплись в одну ось, на чертёж не встанет
  const placed = rects.filter((r) => {
    const ok = r.xi !== r.xj && r.yi !== r.yj
    if (!ok) skipped.push(r.spec.name)
    return ok
  })
  if (!placed.length) return { walls: [], rooms: [], skipped, dropped: [], doubtful: [], areaFit: null }

  // 4. стены: по каждой оси — отрезки между соседними поперечными осями,
  //    толщина по тому, сколько комнат прилегает. Грань Г-образной комнаты
  //    внутри её выреза не рисуется: там стоят стены соседа, который в этот
  //    угол заходит; сама комната на чертеже выходит Г-образной
  const walls: Wall[] = []
  const margin = o.snapCm / 2
  const insideRoom = (s: Rect, p: Pt) => p.x > X[s.xi] + margin && p.x < X[s.xj] - margin && p.y > Y[s.yi] + margin && p.y < Y[s.yj] - margin
  // точка в углу, который комната r отдала соседу: внутри рамки этого соседа
  const inNotch = (r: Rect, p: Pt) => !!r.spec.yieldsTo?.length && placed.some((s) => s !== r && r.spec.yieldsTo!.includes(s.spec.name) && insideRoom(s, p))
  const line = (vertical: boolean, k: number) => {
    const at = vertical ? X[k] : Y[k]
    const near = placed.filter((r) => (vertical ? r.xi === k || r.xj === k : r.yi === k || r.yj === k))
    if (!near.length) return
    // поперечные оси всех комнат — чтобы грань могла оборваться там, где начинается чужой угол
    const marks = [...new Set(placed.flatMap((r) => (vertical ? [Y[r.yi], Y[r.yj]] : [X[r.xi], X[r.xj]])))].sort((a, b) => a - b)
    let run: { from: number; to: number; th: number } | null = null
    const flush = () => {
      if (run && run.to - run.from >= 5) {
        walls.push(
          vertical
            ? { id: uid('w'), a: { x: at, y: run.from }, b: { x: at, y: run.to }, thickness: run.th }
            : { id: uid('w'), a: { x: run.from, y: at }, b: { x: run.to, y: at }, thickness: run.th },
        )
      }
      run = null
    }
    for (let m = 0; m < marks.length - 1; m++) {
      const s0 = marks[m]
      const s1 = marks[m + 1]
      const mid: Pt = vertical ? { x: at, y: (s0 + s1) / 2 } : { x: (s0 + s1) / 2, y: at }
      const covers = (r: Rect) => (vertical ? Y[r.yi] <= s0 + 0.5 && Y[r.yj] >= s1 - 0.5 : X[r.xi] <= s0 + 0.5 && X[r.xj] >= s1 - 0.5) && !inNotch(r, mid)
      const edge = near.filter((r) => covers(r))
      const before = edge.some((r) => (vertical ? r.xj === k : r.yj === k))
      const after = edge.some((r) => (vertical ? r.xi === k : r.yi === k))
      // стена соседа по краю отданного ему угла — перегородка между двумя комнатами, не наружная
      const inner = (before || after) && !(before && after) && placed.some((s) => !near.includes(s) && insideRoom(s, mid) && near.some((n) => s.spec.yieldsTo?.includes(n.spec.name)))
      // перегородка между точными рамками — толщиной в измеренную щель
      const measured = Math.max(0, ...edge.map((r) => edgeGap[rects.indexOf(r) * 4 + (vertical ? (r.xj === k ? 1 : 0) : r.yj === k ? 3 : 2)]))
      // наружная — по замеру с картинки у прилегающей комнаты, иначе типовая
      const outerTh = () => {
        const vals = edge.map((r) => extTh[rects.indexOf(r) * 4 + (vertical ? (r.xj === k ? 1 : 0) : r.yj === k ? 3 : 2)])
        return vals.length ? Math.max(...vals) : o.exteriorCm
      }
      // по картинке толщина — ровно измеренная щель, иначе грани комнат уйдут с фото
      const shared = measured > o.interiorCm ? (o.fixed ? Math.round(measured) : wallThickness(measured)) : o.interiorCm
      const th = before && after ? shared : inner ? o.interiorCm : before || after ? outerTh() : 0
      if (!th) {
        flush()
        continue
      }
      if (run && run.th === th && Math.abs(run.to - s0) < 0.5) run.to = s1
      else {
        flush()
        run = { from: s0, to: s1, th }
      }
    }
    flush()
  }
  for (let k = 0; k < X.length; k++) line(true, k)
  for (let k = 0; k < Y.length; k++) line(false, k)

  // 5. комнаты по контуру и сверка площадей
  const { rooms: built } = buildRooms({ version: 1, name: '', walls, openings: [], furniture: [], rooms: [], dims: [], settings: { grid: 10 } })
  const out: PlacedRoom[] = []
  const taken = new Set<number>()
  for (const r of placed) {
    const rect = { x1: X[r.xi], y1: Y[r.yi], x2: X[r.xj], y2: Y[r.yj] }
    const anchor = { x: (rect.x1 + rect.x2) / 2, y: (rect.y1 + rect.y2) / 2 }
    const idx = built.findIndex((b, i) => !taken.has(i) && pointInPoly(anchor, b.polygon))
    if (idx >= 0) taken.add(idx)
    out.push({ name: r.spec.name, kind: r.spec.kind, anchor, rect, wantM2: r.spec.areaM2, haveM2: idx >= 0 ? built[idx].area : undefined })
  }
  const checked = out.filter((r) => r.wantM2 && r.haveM2 !== undefined) as (PlacedRoom & { wantM2: number; haveM2: number })[]
  let areaFit: AreaFit | null = null
  if (checked.length) {
    const errs = checked.map((r) => Math.abs(r.haveM2 - r.wantM2) / r.wantM2)
    const off = checked
      .map((r, i) => ({ name: r.name, wantM2: r.wantM2, haveM2: r.haveM2, err: errs[i] }))
      .filter((r) => r.err > 0.08)
      .sort((a, b) => b.err - a.err)
      .map(({ name, wantM2, haveM2 }) => ({ name, wantM2, haveM2 }))
    areaFit = { accuracy: Math.max(0, 1 - errs.reduce((a, b) => a + b, 0) / errs.length), off, samples: checked.length }
  }
  return { walls, rooms: out, skipped, dropped: [], doubtful: [], areaFit }
}

/** Точка на стене комнаты: side — какая стена, at — доля вдоль неё */
export function pointOnSide(rect: PlacedRoom['rect'], side: AiSide, at: number): Pt {
  const t = Math.min(1, Math.max(0, at))
  switch (side) {
    case 'top':
      return { x: rect.x1 + (rect.x2 - rect.x1) * t, y: rect.y1 }
    case 'bottom':
      return { x: rect.x1 + (rect.x2 - rect.x1) * t, y: rect.y2 }
    case 'left':
      return { x: rect.x1, y: rect.y1 + (rect.y2 - rect.y1) * t }
    case 'right':
      return { x: rect.x2, y: rect.y1 + (rect.y2 - rect.y1) * t }
  }
}
