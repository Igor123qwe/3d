// Подготовка фото плана и работа с растром.
//
// Лидеры (Planner 5D, RoomSketcher, Coohom) просят снимать план «строго сверху»,
// без теней, и вырезать лишнее в графическом редакторе — иначе распознавание
// ломается. Здесь то же самое делается внутри: фон выравнивается (тени и блики
// уходят), мелкие метки и цифры убираются, картинка поворачивается по линиям
// стен, а перспективу фото исправляет гомография по четырём углам.
//
// Отдельно — «комната по клику»: заливка от точки внутри комнаты по очищенному
// растру. Дверные проёмы замыкаются расстоянием до чернил, а не морфологией:
// преобразование расстояния считается один раз, радиус можно менять бесплатно.
import type { Pt } from './types'
import type { LoadedImage } from './underlay'
import { otsuThreshold } from './underlay'
import { interiorPoint, pointInPoly } from './geometry'
import { outlineRegions } from './picture'

export interface Bin {
  /** 1 — чернила (линии), 0 — бумага */
  ink: Uint8Array
  w: number
  h: number
}

// ---------- фильтры ----------

/** Средняя яркость в окне (2r+1)² через интегральное изображение; края — по фактическому числу пикселей */
export function boxBlur(gray: ArrayLike<number>, w: number, h: number, r: number): Float32Array {
  const W = w + 1
  const sat = new Float64Array(W * (h + 1))
  for (let y = 1; y <= h; y++) {
    let row = 0
    for (let x = 1; x <= w; x++) {
      row += gray[(y - 1) * w + (x - 1)]
      sat[y * W + x] = sat[(y - 1) * W + x] + row
    }
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h - 1, y + r) + 1
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w - 1, x + r) + 1
      const sum = sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0]
      out[y * w + x] = sum / ((y1 - y0) * (x1 - x0))
    }
  }
  return out
}

/** Максимум в окне (2r+1)², раздельно по строкам и столбцам */
export function maxFilter(gray: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const off = y * w
    for (let x = 0; x < w; x++) {
      let m = 0
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) if (gray[off + k] > m) m = gray[off + k]
      tmp[off + x] = m
    }
  }
  const out = new Uint8Array(w * h)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) if (tmp[k * w + x] > m) m = tmp[k * w + x]
      out[y * w + x] = m
    }
  }
  return out
}

/**
 * Выровнять фон. Тени и блики на фото — плавная составляющая яркости; линии —
 * резкая. Фон оценивается максимумом в маленьком окне (линии исчезают) и
 * размытием в большом, затем каждый пиксель делится на свой фон: бумага
 * становится белой везде, линии остаются тёмными.
 */
export function flattenBackground(gray: Uint8Array, w: number, h: number, radius = Math.max(12, Math.round(Math.min(w, h) / 30))): Uint8Array {
  const lifted = maxFilter(gray, w, h, Math.max(2, Math.round(radius / 6)))
  const bg = boxBlur(lifted, w, h, radius)
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) {
    const b = Math.max(8, bg[i])
    out[i] = Math.min(255, Math.round((gray[i] / b) * 245))
  }
  return out
}

/** Чернила по порогу Оцу с запасом в сторону фона: края линий на фото размыты */
export function binarize(gray: Uint8Array, w: number, h: number, margin = 0.25): Bin {
  const otsu = otsuThreshold(gray)
  let bgSum = 0
  let bgN = 0
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] > otsu) {
      bgSum += gray[i]
      bgN++
    }
  }
  const bg = bgN ? bgSum / bgN : 255
  const t = Math.min(250, Math.max(10, otsu + (bg - otsu) * margin))
  const ink = new Uint8Array(w * h)
  for (let i = 0; i < ink.length; i++) ink[i] = gray[i] < t ? 1 : 0
  return { ink, w, h }
}

export interface Component {
  size: number
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Связные компоненты чернил (4-связность); labels — номер компоненты + 1, 0 — фон */
export function components(bin: Bin): { labels: Int32Array; list: Component[] } {
  const { ink, w, h } = bin
  const labels = new Int32Array(w * h)
  const stack = new Int32Array(w * h)
  const list: Component[] = []
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || labels[start]) continue
    const id = list.length + 1
    const c: Component = { size: 0, x1: w, y1: h, x2: 0, y2: 0 }
    let sp = 0
    stack[sp++] = start
    labels[start] = id
    while (sp) {
      const i = stack[--sp]
      const x = i % w
      const y = (i - x) / w
      c.size++
      if (x < c.x1) c.x1 = x
      if (x > c.x2) c.x2 = x
      if (y < c.y1) c.y1 = y
      if (y > c.y2) c.y2 = y
      const push = (j: number) => {
        if (ink[j] && !labels[j]) {
          labels[j] = id
          stack[sp++] = j
        }
      }
      if (x > 0) push(i - 1)
      if (x < w - 1) push(i + 1)
      if (y > 0) push(i - w)
      if (y < h - 1) push(i + w)
    }
    list.push(c)
  }
  return { labels, list }
}

/**
 * Убрать мелкое: цифры размеров, засечки выносок, крап скана. Стена — длинная,
 * поэтому остаётся всё, у чего хоть одна сторона рамки больше maxSide.
 */
export function despeckle(bin: Bin, opts: { minPixels?: number; maxSide?: number } = {}): Bin {
  const minPixels = opts.minPixels ?? 12
  // подписи площадей и размеров на снимке плана — до 8 % высоты листа; стены —
  // длиннее, а короткие стенки сидят на длинных и в отдельные компоненты не попадают
  const maxSide = opts.maxSide ?? Math.max(16, Math.round(Math.max(bin.w, bin.h) * 0.08))
  const { labels, list } = components(bin)
  const drop = new Uint8Array(list.length + 1)
  list.forEach((c, i) => {
    const side = Math.max(c.x2 - c.x1 + 1, c.y2 - c.y1 + 1)
    if (c.size < minPixels || side < maxSide) drop[i + 1] = 1
  })
  const ink = new Uint8Array(bin.ink.length)
  for (let i = 0; i < ink.length; i++) ink[i] = bin.ink[i] && !drop[labels[i]] ? 1 : 0
  return { ink, w: bin.w, h: bin.h }
}

// ---------- чистка до одних стен ----------
//
// На снимке плана, кроме стен, есть подписи, размерные цепочки с выносками,
// рамка листа, а на скриншоте — ещё и панели интерфейса. Всё это мешает:
// сегментация находит «комнаты» на полях, а масштаб считается по чужим линиям.
// Отличить одно от другого можно по толщине штриха: стена на плане — полоса в
// несколько пикселей, выноска и буква — волосок, панель или заливка — пятно.

/**
 * Толщина штриха в каждой точке чернил: удвоенное расстояние до ближайшей
 * бумаги. У стены это её толщина, у выноски — один-два пикселя, у залитого
 * прямоугольника — десятки.
 */
export function strokeWidth(bin: Bin): Float32Array {
  const inv: Bin = { ink: new Uint8Array(bin.ink.length), w: bin.w, h: bin.h }
  for (let i = 0; i < bin.ink.length; i++) inv.ink[i] = bin.ink[i] ? 0 : 1
  const d2 = distanceToInk(inv)
  const out = new Float32Array(d2.length)
  for (let i = 0; i < d2.length; i++) out[i] = bin.ink[i] ? 2 * Math.sqrt(d2[i]) : 0
  return out
}

/**
 * Типичная толщина линии на картинке. Не медиана по точкам: у залитой панели
 * точек больше, чем у всего чертежа, и медиана уехала бы на неё. Считаем, на
 * какую толщину приходится больше всего длины: точек этой толщины, делённых на
 * неё саму. У чертежа линии длинные, у панели — только кайма по краю.
 */
export function medianStroke(bin: Bin, sw = strokeWidth(bin)): number {
  const cap = Math.max(6, Math.round(0.05 * Math.min(bin.w, bin.h)))
  const hist = new Float64Array(cap + 1)
  for (let i = 0; i < sw.length; i++) {
    const t = Math.round(sw[i])
    if (t >= 2 && t <= cap) hist[t]++
  }
  let best = 0
  let bestLen = 0
  for (let t = 2; t <= cap; t++) {
    const len = hist[t] / t
    if (len > bestLen) {
      bestLen = len
      best = t
    }
  }
  return best
}

/**
 * Убрать сплошные пятна: тёмные панели приложения, залитые плашки, чёрные поля
 * снимка. У такой фигуры точки заполняют почти всю её рамку, у чертежа — нет:
 * он состоит из линий, и внутри рамки у него пусто.
 */
export function removeBlobs(bin: Bin, opts: { maxStroke?: number; minThickFrac?: number; sw?: Float32Array } = {}): Bin {
  const sw = opts.sw ?? strokeWidth(bin)
  const maxStroke = opts.maxStroke ?? Math.max(8, 0.025 * Math.min(bin.w, bin.h))
  const minThickFrac = opts.minThickFrac ?? 0.3
  const { labels, list } = components(bin)
  const thick = new Float64Array(list.length + 1)
  const total = new Float64Array(list.length + 1)
  for (let i = 0; i < bin.ink.length; i++) {
    const id = labels[i]
    if (!id) continue
    total[id]++
    if (sw[i] > maxStroke) thick[id]++
  }
  const drop = new Uint8Array(list.length + 1)
  // Фигура удаляется целиком, а не только её сердцевина: иначе от панели
  // остаётся кайма, и она выглядит как длинная стена. Но если толстого в
  // фигуре мало, это чертёж с парой жирных мест — его не трогаем
  for (let id = 1; id <= list.length; id++) if (total[id] > 0 && thick[id] / total[id] >= minThickFrac) drop[id] = 1
  const ink = new Uint8Array(bin.ink.length)
  for (let i = 0; i < ink.length; i++) ink[i] = bin.ink[i] && !drop[labels[i]] ? 1 : 0
  return { ink, w: bin.w, h: bin.h }
}

/**
 * Оставить только линии, похожие на стены: убрать волоски (выноски, размерные
 * линии, буквы) и пятна (залитые панели, штриховку, чёрные поля скриншота).
 * Пороги — доли от типичной толщины линии на этой картинке, поэтому работает и
 * на скане 600 dpi, и на снимке с телефона.
 */
export function keepWallStrokes(binIn: Bin, opts: { minPx?: number; maxFrac?: number } = {}): Bin {
  const maxStroke = Math.max(8, (opts.maxFrac ?? 0.025) * Math.min(binIn.w, binIn.h))
  // сначала целиком убираем залитые фигуры: от них не должно остаться каймы
  const bin = removeBlobs(binIn, { maxStroke })
  const sw = strokeWidth(bin)
  // Волосок в одну точку — это засечка или растровый шум. Пятно толще
  // сороковой части кадра — это панель, плашка или чёрное поле снимка: стена
  // на плане столько не занимает даже на крупном скане
  const lo = opts.minPx ?? 2
  const hi = maxStroke
  const ink = new Uint8Array(bin.ink.length)
  for (let i = 0; i < ink.length; i++) ink[i] = bin.ink[i] && sw[i] >= lo && sw[i] <= hi ? 1 : 0
  return { ink, w: bin.w, h: bin.h }
}

/**
 * Высота мелких цифр на плане, px: по отдельно стоящим знакам — компактным
 * фигурам из штрихов, что выше, чем шире. null — надписей на картинке почти
 * нет. Нужна, чтобы отличить цифру, прилипшую к стене, от куска самой стены.
 */
export function textHeight(bin: Bin): number | null {
  const { list } = components(bin)
  const maxH = 0.05 * Math.min(bin.w, bin.h)
  const hs: number[] = []
  for (const c of list) {
    const ch = c.y2 - c.y1 + 1
    const cw = c.x2 - c.x1 + 1
    if (ch < 5 || ch > maxH || cw > 0.85 * ch) continue
    const fill = c.size / (ch * cw)
    if (c.size < 6 || fill < 0.15 || fill > 0.8) continue
    hs.push(ch)
  }
  if (hs.length < 10) return null
  hs.sort((a, b) => a - b)
  // цифры двух размеров: мелкие у стен (размеры) и крупные в середине комнаты
  // (номер и площадь); к стене липнут мелкие — по ним и мерим
  return hs[Math.floor(hs.length * 0.3)]
}

/**
 * Чернила без отдельно стоящих подписей — для поиска закутков. Цифра размера
 * в узкой нише («0,73» в закутке у балкона) делит её на щели, и ниша не
 * достаётся комнате. Подпись — мелкий кусок, что стены разве что касается
 * одним боком: в узкой нише цифра почти всегда прилипает к стене. Сторона
 * квадратика в стене и его штриховка перекинуты между двумя стенами —
 * держатся за стену с противоположных сторон своей рамки — и остаются.
 */
export function withoutLooseText(bin: Bin, wallsIn: Bin, text: number | null, textPixels?: Uint8Array): Bin {
  if (!text) return bin
  const { w, h } = bin
  // штрих цифры, упёртый в стену, вместе с её толщиной тянет на длину стены
  // (на крупной картинке — почти всегда): такие отростки — часть подписи
  const walls = dropSpurs(wallsIn, Math.round(1.15 * text) + 2)
  const soft = new Uint8Array(w * h)
  for (let i = 0; i < soft.length; i++) soft[i] = bin.ink[i] && !walls.ink[i] ? 1 : 0
  const { labels, list } = components({ ink: soft, w, h })
  // бока рамки куска, которыми он касается стены: 1 — левый, 2 — правый, 4 — верхний, 8 — нижний
  const sides = new Uint8Array(list.length + 1)
  for (let i = 0; i < soft.length; i++) {
    const id = labels[i]
    if (!id) continue
    const c = list[id - 1]
    const x = i % w
    const y = (i - x) / w
    if (x !== c.x1 && x !== c.x2 && y !== c.y1 && y !== c.y2) continue
    // стена рядом — и с какой стороны (прямо за боком, через пиксель-два): у
    // цифры, упёртой в стену справа, угловая точка касается её наискось, но
    // это правый бок, а не верх и низ
    const wallAt = (dx: number, dy: number) => {
      const nx = x + dx
      const ny = y + dy
      return nx >= 0 && ny >= 0 && nx < w && ny < h && !!walls.ink[ny * w + nx]
    }
    const toward = (dx: number, dy: number) => wallAt(dx, dy) || wallAt(2 * dx, 2 * dy)
    // в тонком куске (засечка, единица) левый бок — он же правый: такие бока не в счёт
    if (c.x2 - c.x1 >= 2) sides[id] |= (x === c.x1 && toward(-1, 0) ? 1 : 0) | (x === c.x2 && toward(1, 0) ? 2 : 0)
    if (c.y2 - c.y1 >= 2) sides[id] |= (y === c.y1 && toward(0, -1) ? 4 : 0) | (y === c.y2 && toward(0, 1) ? 8 : 0)
  }
  // буква или цифра, повёрнутая как угодно: обе стороны рамки — не больше полутора строк
  const maxSide = 1.6 * text
  const ink = bin.ink.slice()
  for (let i = 0; i < ink.length; i++) {
    const id = labels[i]
    if (!id) continue
    const s = sides[id]
    if ((s & 3) === 3 || (s & 12) === 12) continue
    const c = list[id - 1]
    if (c.x2 - c.x1 + 1 <= maxSide && c.y2 - c.y1 + 1 <= maxSide) ink[i] = 0
  }
  // подписи, узнанные целиком, — тоже не преграда, даже зажатые между линиями
  if (textPixels) for (let i = 0; i < ink.length; i++) if (textPixels[i]) ink[i] = 0
  return { ink, w, h }
}

/** направления прогонов: вправо, вниз и две диагонали; поперёк каждого — соседнее по паре */
const RUN_DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [-1, 1],
]
const RUN_ACROSS = [1, 0, 3, 2]

/** обойти все прямые прогоны чернил в направлении dir: колбэк получает точки прогона */
function eachRun(ink: Uint8Array, w: number, h: number, dir: number, visit: (pts: number[]) => void): void {
  const [dx, dy] = RUN_DIRS[dir]
  const starts: [number, number][] = []
  if (dir === 0) for (let y = 0; y < h; y++) starts.push([0, y])
  else if (dir === 1) for (let x = 0; x < w; x++) starts.push([x, 0])
  else if (dir === 2) {
    for (let x = 0; x < w; x++) starts.push([x, 0])
    for (let y = 1; y < h; y++) starts.push([0, y])
  } else {
    for (let x = 0; x < w; x++) starts.push([x, 0])
    for (let y = 1; y < h; y++) starts.push([w - 1, y])
  }
  let run: number[] = []
  for (const [x0, y0] of starts) {
    for (let x = x0, y = y0; x >= 0 && y >= 0 && x < w && y < h; x += dx, y += dy) {
      const i = y * w + x
      if (ink[i]) run.push(i)
      else if (run.length) (visit(run), (run = []))
    }
    if (run.length) (visit(run), (run = []))
  }
}

/**
 * Стеновые линии без отростков. Прогон длиной в стену может набраться из
 * короткого штриха и толщины стены, в которую он упёрся: так черта цифры
 * у стены сходит за стену. Свою длину прогона считаем без концов, лежащих в
 * поперечной стене. Короче minRun остаётся только перемычка, что держится за
 * стены обоими концами (стенка закутка, сторона квадратика); отросток,
 * упёртый в стену одним концом, уходит. Опора — стена поперёк прогона.
 */
export function dropSpurs(bin: Bin, minRun: number): Bin {
  const { ink, w, h } = bin
  const len = RUN_DIRS.map((_, d) => {
    const m = new Uint16Array(w * h)
    eachRun(ink, w, h, d, (pts) => {
      for (const i of pts) m[i] = Math.min(65535, pts.length)
    })
    return m
  })
  const keep = new Uint8Array(ink.length)
  for (let d = 0; d < RUN_DIRS.length; d++) {
    const across = len[RUN_ACROSS[d]]
    const inWall = (i: number) => across[i] >= minRun
    eachRun(ink, w, h, d, (pts) => {
      if (pts.length < minRun) return
      let lead = 0
      while (lead < pts.length && inWall(pts[lead])) lead++
      let trail = 0
      while (trail < pts.length - lead && inWall(pts[pts.length - 1 - trail])) trail++
      const own = pts.length - lead - trail
      if (own >= minRun || (lead > 0 && trail > 0) || own === 0) for (const i of pts) keep[i] = 1
    })
  }
  return { ink: keep, w, h }
}

/**
 * Оставить только длинные штрихи: точку, через которую проходит отрезок
 * чернил не короче minRun по горизонтали, вертикали или диагонали. Стена —
 * длинная линия; цифра размера, прилипшая к стене, — короткие штрихи, и
 * иначе она выедает из комнаты полосу высотой в строку текста.
 */
export function keepLongRuns(bin: Bin, minRun: number): Bin {
  const { ink, w, h } = bin
  const keep = new Uint8Array(ink.length)
  // Косой прогон — стена, только если он тонкий: косая стена и штриховка —
  // линии с бумагой по бокам. Жирная цифра, прижатая к стене («1,29» в нише
  // прихожей), — сплошное пятно, и косых хорд длиной в стену в нём полно;
  // поперёк такой хорды — всё пятно
  const diag = [2, 3].map((d) => {
    const m = new Uint16Array(w * h)
    eachRun(ink, w, h, d, (pts) => {
      for (const i of pts) m[i] = Math.min(65535, pts.length)
    })
    return m
  })
  const thinMax = Math.max(3, 0.5 * minRun)
  for (let d = 0; d < RUN_DIRS.length; d++)
    eachRun(ink, w, h, d, (pts) => {
      if (pts.length < minRun) return
      if (d >= 2) {
        const across = diag[d === 2 ? 1 : 0]
        const t = pts.map((i) => across[i]).sort((a, b) => a - b)[pts.length >> 1]
        if (t > thinMax) return
      }
      for (const i of pts) keep[i] = 1
    })
  return { ink: keep, w, h }
}

/**
 * Подписи размеров — не стена. Цифры, прижатые к стене («1,29» в нише
 * прихожей), сливаются с ней, и их штрихи набирают длину стены: ниша
 * перегораживается. По длине, толщине и форме штриха цифру от короткой
 * стенки не отличить, зато подпись узнаётся целиком: несколько знаков
 * цифрового размера стоят рядом, или слитая строка в одну-две высоты знака.
 * Неприкосновенны прямые стеновые линии frame (после снятия отростков:
 * стенка закутка держится за стены обоими концами и остаётся); в остатке
 * ищем знаки и сводим соседние в подписи. Возвращает маску точек подписей.
 */
export function textMask(bin: Bin, frame: Bin, text: number): Uint8Array {
  const { w, h } = bin
  const minRun = Math.round(1.15 * text) + 2
  const strong = new Uint8Array(w * h)
  for (let d = 0; d < 2; d++)
    eachRun(frame.ink, w, h, d, (pts) => {
      if (pts.length >= minRun) for (const i of pts) strong[i] = 1
    })
  const rest = new Uint8Array(w * h)
  for (let i = 0; i < rest.length; i++) rest[i] = bin.ink[i] && !strong[i] ? 1 : 0
  const { labels, list } = components({ ink: rest, w, h })
  // знак: не тоньше трети строки и не больше двух (цифра стоит как угодно)
  const glyphs: number[] = []
  const inText = new Uint8Array(list.length + 1)
  list.forEach((c, k) => {
    const cw = c.x2 - c.x1 + 1
    const ch = c.y2 - c.y1 + 1
    const lo = Math.min(cw, ch)
    const hi = Math.max(cw, ch)
    if (c.size >= 6 && lo >= 0.3 * text && hi <= 1.8 * text) glyphs.push(k)
    // знаки слились в строку («1,29» жирным шрифтом): в высоту — строка, в
    // длину — до четырёх знаков, и не сплошь залита
    else if (lo >= 0.6 * text && lo <= 1.8 * text && hi <= 4 * text) {
      const fill = c.size / (cw * ch)
      if (fill >= 0.25 && fill <= 0.75) inText[k + 1] = 1
    }
  })
  // соседние знаки — одна подпись: зазор меньше половины строки
  const parent = glyphs.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const gap = 0.5 * text
  for (let i = 0; i < glyphs.length; i++) {
    const a = list[glyphs[i]]
    for (let j = i + 1; j < glyphs.length; j++) {
      const b = list[glyphs[j]]
      const dx = Math.max(0, Math.max(a.x1, b.x1) - Math.min(a.x2, b.x2))
      const dy = Math.max(0, Math.max(a.y1, b.y1) - Math.min(a.y2, b.y2))
      if (dx <= gap && dy <= gap) parent[find(i)] = find(j)
    }
  }
  const count = new Map<number, number>()
  for (let i = 0; i < glyphs.length; i++) count.set(find(i), (count.get(find(i)) ?? 0) + 1)
  // одиночный знак — номер комнаты или обрывок; подпись — от двух знаков
  for (let i = 0; i < glyphs.length; i++) if ((count.get(find(i)) ?? 0) >= 2) inText[glyphs[i] + 1] = 1
  const mask = new Uint8Array(w * h)
  for (let i = 0; i < mask.length; i++) if (labels[i] && inText[labels[i]]) mask[i] = 1
  return mask
}

export interface CleanResult {
  /** очищенная картинка: белая бумага, чёрные линии */
  gray: Uint8Array
  bin: Bin
  /** все метки до очистки, с мелочью: по ним видна штриховка (вентшахта, кладка), которую очистка стирает */
  marks: Bin
  /** только стеновые линии: без подписей, выносок и заливок */
  walls: Bin
  /** точки подписей размеров (знаки рядом или слитая строка): не стена и не преграда закутку */
  labels?: Uint8Array
}

/**
 * Полная очистка: выровнять фон, бинаризовать, убрать мелочь и отдельно
 * выделить стеновые линии. Картинка для показа остаётся прежней — пользователь
 * видит свой план, — а комнаты ищутся по линиям, похожим на стены.
 */
export function cleanRaster(gray: Uint8Array, w: number, h: number): CleanResult {
  const flat = flattenBackground(gray, w, h)
  const marks = binarize(flat, w, h)
  const bin = despeckle(marks)
  // цифры размеров, прилипшие к стене, из стеновых линий убираются: штрих
  // стены длиннее строки мелкого текста, у цифры — не длиннее её высоты
  const text = textHeight(marks)
  const strokes = keepWallStrokes(bin)
  const walls = text ? dropSpurs(keepLongRuns(strokes, Math.round(1.15 * text) + 2), Math.round(1.15 * text) + 2) : strokes
  // подписи у стен вынимаем из стеновых линий целиком
  const labels = text ? textMask(bin, walls, text) : undefined
  if (labels) for (let i = 0; i < labels.length; i++) if (labels[i]) walls.ink[i] = 0
  // Стена примыкает к стенам. Короткая тонкая черта, что стоит особняком
  // (размерная линия «1,29» в нише прихожей), — не стена
  if (text) {
    const { labels: comp, list } = components(walls)
    const lone = list.map((c) => {
      const cw = c.x2 - c.x1 + 1
      const ch = c.y2 - c.y1 + 1
      return Math.min(cw, ch) <= Math.max(3, 0.25 * text) && Math.max(cw, ch) <= 2.5 * text
    })
    for (let i = 0; i < comp.length; i++) if (comp[i] && lone[comp[i] - 1]) walls.ink[i] = 0
  }
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = bin.ink[i] ? 0 : 255
  return { gray: out, bin, marks, walls, labels }
}

// ---------- выравнивание ----------

/**
 * На сколько градусов линии плана отклонены от осей: по направлениям градиента.
 * У ровного плана градиенты смотрят строго вверх-вниз и влево-вправо; у
 * повёрнутого — на угол поворота. Возвращает угол в (−45, 45]: на столько
 * картинку нужно повернуть обратно.
 */
export function dominantAngle(gray: Uint8Array, w: number, h: number, step = 2): number {
  const BINS = 360 // по четверти градуса на 90°
  const hist = new Float64Array(BINS)
  // Два прохода коробочного размытия ≈ гауссово: край становится шире пикселя,
  // и направление градиента считается честно. Ядро Шарра, а не Собеля: у Собеля
  // направление врёт до полутора градусов на наклонных краях, у Шарра — на порядок меньше.
  const soft = boxBlur(boxBlur(gray, w, h, 1), w, h, 1)
  const angles: number[] = []
  const weights: number[] = []
  let maxMag = 0
  for (let y = 1; y < h - 1; y += step) {
    for (let x = 1; x < w - 1; x += step) {
      const i = y * w + x
      const gx = 3 * soft[i - w + 1] + 10 * soft[i + 1] + 3 * soft[i + w + 1] - 3 * soft[i - w - 1] - 10 * soft[i - 1] - 3 * soft[i + w - 1]
      const gy = 3 * soft[i + w - 1] + 10 * soft[i + w] + 3 * soft[i + w + 1] - 3 * soft[i - w - 1] - 10 * soft[i - w] - 3 * soft[i - w + 1]
      const mag = Math.hypot(gx, gy)
      if (mag < 120) continue
      if (mag > maxMag) maxMag = mag
      let a = (Math.atan2(gy, gx) * 180) / Math.PI
      a = ((a % 90) + 90) % 90
      hist[Math.min(BINS - 1, Math.floor((a / 90) * BINS))] += mag
      angles.push(a)
      weights.push(mag)
    }
  }
  // пик сглаженной гистограммы; она циклическая: 0° и 90° — одно и то же.
  // В гистограмму и в среднее идут только сильные края: середина перепада,
  // а не его хвосты, где направление шумит
  const strong = maxMag * 0.45
  hist.fill(0)
  for (let k = 0; k < angles.length; k++) {
    if (weights[k] < strong) continue
    hist[Math.min(BINS - 1, Math.floor((angles[k] / 90) * BINS))] += weights[k]
  }
  let best = 0
  let bestV = -1
  for (let b = 0; b < BINS; b++) {
    const v = hist[(b + BINS - 1) % BINS] + hist[b] + hist[(b + 1) % BINS]
    if (v > bestV) {
      bestV = v
      best = b
    }
  }
  const peak = ((best + 0.5) / BINS) * 90
  // Уточнить взвешенным средним в ±6° от пика. Окно широкое нарочно: на
  // наклонном крае оценка направления в каждом пикселе гуляет на ±2° в такт
  // «лесенке», и только среднее по целому периоду попадает в истинный угол.
  let sum = 0
  let wsum = 0
  for (let k = 0; k < angles.length; k++) {
    let d = angles[k] - peak
    if (d > 45) d -= 90
    if (d < -45) d += 90
    if (Math.abs(d) > 6 || weights[k] < strong) continue
    sum += d * weights[k]
    wsum += weights[k]
  }
  let deg = peak + (wsum ? sum / wsum : 0)
  deg = ((deg % 90) + 90) % 90
  if (deg > 45) deg -= 90
  return deg
}

const loadImg = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('Не удалось прочитать картинку'))
    el.src = src
  })

const exportCanvas = (canvas: HTMLCanvasElement): LoadedImage => ({ src: canvas.toDataURL('image/jpeg', 0.85), w: canvas.width, h: canvas.height })

/** Повернуть картинку на deg градусов (по часовой), поля белые */
export async function rotateImage(src: string, deg: number): Promise<LoadedImage> {
  const img = await loadImg(src)
  const rad = (deg * Math.PI) / 180
  const c = Math.abs(Math.cos(rad))
  const s = Math.abs(Math.sin(rad))
  const w = Math.round(img.naturalWidth * c + img.naturalHeight * s)
  const h = Math.round(img.naturalWidth * s + img.naturalHeight * c)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Браузер не дал холст')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.translate(w / 2, h / 2)
  ctx.rotate(rad)
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  return exportCanvas(canvas)
}

/** Серый растр → картинка (для показа очищенной подложки) */
export function grayToImage(gray: Uint8Array, w: number, h: number): LoadedImage {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Браузер не дал холст')
  const data = ctx.createImageData(w, h)
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    data.data[j] = data.data[j + 1] = data.data[j + 2] = gray[i]
    data.data[j + 3] = 255
  }
  ctx.putImageData(data, 0, 0)
  return exportCanvas(canvas)
}

// ---------- перспектива ----------

/** Гомография 3×3 (построчно, h33 = 1), переводящая src[i] в dst[i] */
export function homography(src: Pt[], dst: Pt[]): number[] {
  // восемь уравнений на восемь неизвестных, метод Гаусса с выбором ведущего
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const { x: u, y: v } = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  for (let col = 0; col < 8; col++) {
    let piv = col
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    ;[A[col], A[piv]] = [A[piv], A[col]]
    const d = A[col][col]
    if (Math.abs(d) < 1e-12) throw new Error('Углы лежат на одной прямой')
    for (let k = col; k <= 8; k++) A[col][k] /= d
    for (let r = 0; r < 8; r++) {
      if (r === col) continue
      const f = A[r][col]
      if (!f) continue
      for (let k = col; k <= 8; k++) A[r][k] -= f * A[col][k]
    }
  }
  return [A[0][8], A[1][8], A[2][8], A[3][8], A[4][8], A[5][8], A[6][8], A[7][8], 1]
}

export function applyH(H: number[], p: Pt): Pt {
  const z = H[6] * p.x + H[7] * p.y + H[8]
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / z, y: (H[3] * p.x + H[4] * p.y + H[5]) / z }
}

/** Четыре точки в любом порядке → верхний-левый, верхний-правый, нижний-правый, нижний-левый */
export function orderCorners(pts: Pt[]): Pt[] {
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  // по часовой (y вниз) от точки с наименьшей суммой координат
  let start = 0
  for (let i = 1; i < sorted.length; i++) if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i
  return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4])
}

/**
 * Выпрямить фото: четыре угла наружных стен (пиксели картинки) становятся
 * прямоугольником. Вокруг остаётся поле, чтобы не потерять размеры и подписи.
 */
export async function warpToRect(src: string, cornersPx: Pt[], padFrac = 0.12): Promise<LoadedImage> {
  const img = await loadImg(src)
  const [tl, tr, br, bl] = orderCorners(cornersPx)
  const W = Math.max(40, Math.round((Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2))
  const Hh = Math.max(40, Math.round((Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2))
  const pad = Math.round(Math.max(W, Hh) * padFrac)
  const outW = W + pad * 2
  const outH = Hh + pad * 2
  const dst = [
    { x: pad, y: pad },
    { x: pad + W, y: pad },
    { x: pad + W, y: pad + Hh },
    { x: pad, y: pad + Hh },
  ]
  const Hinv = homography(dst, [tl, tr, br, bl])
  const sw = img.naturalWidth
  const sh = img.naturalHeight
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = sw
  srcCanvas.height = sh
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true })
  if (!sctx) throw new Error('Браузер не дал холст')
  sctx.drawImage(img, 0, 0)
  const sdata = sctx.getImageData(0, 0, sw, sh).data
  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const octx = out.getContext('2d')
  if (!octx) throw new Error('Браузер не дал холст')
  const odata = octx.createImageData(outW, outH)
  const od = odata.data
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const p = applyH(Hinv, { x, y })
      const o = (y * outW + x) * 4
      if (p.x < 0 || p.y < 0 || p.x >= sw - 1 || p.y >= sh - 1) {
        od[o] = od[o + 1] = od[o + 2] = 255
        od[o + 3] = 255
        continue
      }
      // билинейная выборка
      const x0 = Math.floor(p.x)
      const y0 = Math.floor(p.y)
      const fx = p.x - x0
      const fy = p.y - y0
      const i00 = (y0 * sw + x0) * 4
      const i10 = i00 + 4
      const i01 = i00 + sw * 4
      const i11 = i01 + 4
      for (let c = 0; c < 3; c++) {
        od[o + c] = (sdata[i00 + c] * (1 - fx) + sdata[i10 + c] * fx) * (1 - fy) + (sdata[i01 + c] * (1 - fx) + sdata[i11 + c] * fx) * fy
      }
      od[o + 3] = 255
    }
  }
  octx.putImageData(odata, 0, 0)
  return exportCanvas(out)
}

// ---------- комната по клику ----------

/** Квадрат расстояния до ближайших чернил (Фельценшвальб–Хаттенлохер, O(n)) */
export function distanceToInk(bin: Bin): Float32Array {
  const { ink, w, h } = bin
  const INF = 1e12
  const f = new Float32Array(w * h)
  for (let i = 0; i < f.length; i++) f[i] = ink[i] ? 0 : INF
  const n = Math.max(w, h)
  const line = new Float32Array(n)
  const out = new Float32Array(n)
  const v = new Int32Array(n)
  const z = new Float32Array(n + 1)
  const edt1d = (len: number) => {
    let k = 0
    v[0] = 0
    z[0] = -INF
    z[1] = INF
    for (let q = 1; q < len; q++) {
      let s = (line[q] + q * q - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) {
        k--
        s = (line[q] + q * q - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      }
      k++
      v[k] = q
      z[k] = s
      z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++
      out[q] = (q - v[k]) * (q - v[k]) + line[v[k]]
    }
  }
  // сначала по столбцам, потом по строкам
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) line[y] = f[y * w + x]
    edt1d(h)
    for (let y = 0; y < h; y++) f[y * w + x] = out[y]
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) line[x] = f[y * w + x]
    edt1d(w)
    for (let x = 0; x < w; x++) f[y * w + x] = out[x]
  }
  return f
}

export interface RoomFill {
  /** рамка комнаты по внутренним граням стен, пиксели */
  x1: number
  y1: number
  x2: number
  y2: number
  /** доля рамки, залитая комнатой: меньше 0,75 — комната не прямоугольная */
  fill: number
}

/**
 * Комната вокруг точки: заливка по пикселям дальше closePx от чернил — так
 * дверные проёмы уже 2·closePx оказываются закрыты. Утечка на весь лист
 * (край картинки или больше половины площади) означает, что контур не замкнут.
 */
export function floodRoom(d2: Float32Array, w: number, h: number, seed: Pt, closePx: number): RoomFill | null {
  const r2 = closePx * closePx
  const open = (i: number) => d2[i] > r2
  let sx = Math.round(seed.x)
  let sy = Math.round(seed.y)
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null
  // клик пришёлся на стену или к ней вплотную — ищем ближайший свободный пиксель
  if (!open(sy * w + sx)) {
    let found = false
    for (let r = 1; r <= closePx * 3 && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
          const x = sx + dx
          const y = sy + dy
          if (x < 0 || y < 0 || x >= w || y >= h) continue
          if (open(y * w + x)) {
            sx = x
            sy = y
            found = true
            break
          }
        }
      }
    }
    if (!found) return null
  }
  const seen = new Uint8Array(w * h)
  const queue = new Int32Array(w * h)
  let head = 0
  let tail = 0
  const start = sy * w + sx
  queue[tail++] = start
  seen[start] = 1
  // границы области по строкам и столбцам: рамку берём по медианам, чтобы
  // «язычок» заливки в дверном проёме не растягивал комнату до соседней стены
  const rowMin = new Int32Array(h).fill(w)
  const rowMax = new Int32Array(h).fill(-1)
  const colMin = new Int32Array(w).fill(h)
  const colMax = new Int32Array(w).fill(-1)
  let count = 0
  const limit = w * h * 0.6
  while (head < tail) {
    const i = queue[head++]
    const x = i % w
    const y = (i - x) / w
    count++
    if (count > limit) return null
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return null
    if (x < rowMin[y]) rowMin[y] = x
    if (x > rowMax[y]) rowMax[y] = x
    if (y < colMin[x]) colMin[x] = y
    if (y > colMax[x]) colMax[x] = y
    const visit = (j: number) => {
      if (!seen[j] && open(j)) {
        seen[j] = 1
        queue[tail++] = j
      }
    }
    visit(i - 1)
    visit(i + 1)
    visit(i - w)
    visit(i + w)
  }
  const median = (arr: Int32Array, skip: number): number => {
    const vals = Array.from(arr).filter((v) => v !== skip).sort((a, b) => a - b)
    return vals[Math.floor(vals.length / 2)]
  }
  const x1 = median(rowMin, w)
  const x2 = median(rowMax, -1)
  const y1 = median(colMin, h)
  const y2 = median(colMax, -1)
  const area = (x2 - x1 + 1) * (y2 - y1 + 1)
  return { x1: x1 - closePx, y1: y1 - closePx, x2: x2 + closePx, y2: y2 + closePx, fill: area ? Math.min(1, count / area) : 0 }
}

/**
 * Привязать рамку комнаты от модели к настоящим стенам на картинке: заливка от
 * центра рамки по очищенному растру даёт прямоугольник по внутренним граням стен.
 * Модель со зрением называет координаты примерно, а линии на картинке точны —
 * так у соседних комнат общая стена оказывается одной и той же линией.
 * Рамка принимается, только если заливка похожа на комнату и пересекается с
 * тем, что назвала модель: иначе это соседняя комната или утечка.
 */
export function groundRoomBox(
  d2: Float32Array,
  w: number,
  h: number,
  box: { x1: number; y1: number; x2: number; y2: number },
  closePx: number,
): { x1: number; y1: number; x2: number; y2: number; fill: number } | null {
  const bx1 = box.x1 * w
  const by1 = box.y1 * h
  const bx2 = box.x2 * w
  const by2 = box.y2 * h
  const seed = { x: (bx1 + bx2) / 2, y: (by1 + by2) / 2 }
  const r = floodRoom(d2, w, h, seed, closePx)
  if (!r || r.fill < 0.6) return null
  // пересечение с рамкой модели: IoU не меньше четверти
  const ix = Math.max(0, Math.min(bx2, r.x2) - Math.max(bx1, r.x1))
  const iy = Math.max(0, Math.min(by2, r.y2) - Math.max(by1, r.y1))
  const inter = ix * iy
  const union = (bx2 - bx1) * (by2 - by1) + (r.x2 - r.x1) * (r.y2 - r.y1) - inter
  if (union <= 0 || inter / union < 0.25) return null
  return { x1: r.x1 / w, y1: r.y1 / h, x2: r.x2 / w, y2: r.y2 / h, fill: r.fill }
}

// ---------- все комнаты с картинки разом ----------

export interface RoomRegion {
  /** рамка по внутренним граням стен, пиксели */
  x1: number
  y1: number
  x2: number
  y2: number
  /** площадь области заливки, px² */
  areaPx: number
  /** доля рамки, залитая областью: меньше 0,75 — комната не прямоугольная */
  fill: number
  /** доля полного охватывающего прямоугольника области: низкая — область Г-образная или подтекает */
  fillBox: number
  /** кусок Г-образной области: по линии разреза стены нет, это одна комната с соседним куском или проём без двери */
  cut?: boolean
  /** скольких краёв листа касается область: три-четыре — это поле вокруг плана, не комната */
  edges: number
  /** центр масс области */
  cx: number
  cy: number
  /** номер области в разметке — служебный, для разрешения перекрытий рамок */
  id?: number
  /** сколько точек в самой области (без расширения до стен) — для порогов «слишком мелко» */
  points: number
  /**
   * контур по внутренним граням стен, пиксели: многоугольник с прямыми углами,
   * обведённый по самой области. Г-образная комната — шесть углов, а не рамка
   */
  poly?: Pt[]
}

/**
 * Все комнаты с картинки: тот же приём, что «комната по клику», но клик ставится
 * во все свободные пиксели разом. Свободное — дальше closePx от чернил (так
 * закрываются дверные проёмы); каждая связная область — комната, если она не
 * касается края листа (снаружи квартиры) и не крошечная. Так делают сегментацию
 * нейросети у лидеров; на чертеже БТИ с толстыми стенами это делает и растр.
 */
export interface PxRect {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** рамка по медианам границ строк и столбцов области: «язычок» в проёме или утечка в поле её не растягивают */
type CutSides = { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean }

function measureRegion(labels: Int32Array, id: number, w: number, h: number, box: PxRect, closePx: number, cut: CutSides = {}): RoomRegion | null {
  const rowMin = new Int32Array(h).fill(w)
  const rowMax = new Int32Array(h).fill(-1)
  const colMin = new Int32Array(w).fill(h)
  const colMax = new Int32Array(w).fill(-1)
  const rowN = new Int32Array(h)
  const colN = new Int32Array(w)
  let count = 0
  let sx = 0
  let sy = 0
  for (let y = box.y1; y <= box.y2; y++) {
    for (let x = box.x1; x <= box.x2; x++) {
      if (labels[y * w + x] !== id) continue
      count++
      sx += x
      sy += y
      rowN[y]++
      colN[x]++
      if (x < rowMin[y]) rowMin[y] = x
      if (x > rowMax[y]) rowMax[y] = x
      if (y < colMin[x]) colMin[x] = y
      if (y > colMax[x]) colMax[x] = y
    }
  }
  if (!count) return null
  // медиана границ строк (столбцов), взвешенная числом точек в строке: узкий
  // язычок в проёме или полоска поля в две точки шириной, даже длинная, рамку
  // не сдвигают
  const median = (arr: Int32Array, n: Int32Array, skip: number): number => {
    const vals: { v: number; wt: number }[] = []
    let total = 0
    for (let k = 0; k < arr.length; k++) {
      if (arr[k] === skip) continue
      const wt = n[k]
      vals.push({ v: arr[k], wt })
      total += wt
    }
    vals.sort((a, b) => a.v - b.v)
    let acc = 0
    for (const { v, wt } of vals) {
      acc += wt
      if (acc * 2 >= total) return v
    }
    return vals[vals.length - 1].v
  }
  const x1 = median(rowMin, rowN, w)
  const x2 = median(rowMax, rowN, -1)
  const y1 = median(colMin, colN, h)
  const y2 = median(colMax, colN, -1)
  const boxArea = (x2 - x1 + 1) * (y2 - y1 + 1)
  // полный охват области: по нему видно Г-образность, медианная рамка её прячет
  let fx1 = w, fy1 = h, fx2 = -1, fy2 = -1
  for (let y = box.y1; y <= box.y2; y++) if (rowMin[y] !== w) { fy1 = Math.min(fy1, y); fy2 = Math.max(fy2, y); fx1 = Math.min(fx1, rowMin[y]); fx2 = Math.max(fx2, rowMax[y]) }
  const fullArea = (fx2 - fx1 + 1) * (fy2 - fy1 + 1)
  const edges = [fx1 <= 0, fy1 <= 0, fx2 >= w - 1, fy2 >= h - 1].filter(Boolean).length
  // По линии разреза стены нет — грань куска и есть граница, расширять её нечем.
  // Но только если кусок и правда лежит на линии разреза: полоса шириной closePx
  // вдоль неё заполнена хотя бы наполовину. Остаток поля после отрезанной полосы
  // к её линии прилегает лишь тонким слоем — ему граница по медиане
  const touches = (side: keyof CutSides): boolean => {
    const band = Math.max(1, closePx)
    let hit = 0
    let full = 0
    if (side === 'left' || side === 'right') {
      const from = side === 'left' ? box.x1 : Math.max(box.x1, box.x2 - band + 1)
      const to = side === 'left' ? Math.min(box.x2, box.x1 + band - 1) : box.x2
      for (let y = y1; y <= y2; y++) {
        if (rowMin[y] === w) continue
        for (let x = from; x <= to; x++) if (labels[y * w + x] === id) hit++
      }
      full = (to - from + 1) * (y2 - y1 + 1)
    } else {
      const from = side === 'top' ? box.y1 : Math.max(box.y1, box.y2 - band + 1)
      const to = side === 'top' ? Math.min(box.y2, box.y1 + band - 1) : box.y2
      for (let x = x1; x <= x2; x++) {
        if (colMin[x] === h) continue
        for (let y = from; y <= to; y++) if (labels[y * w + x] === id) hit++
      }
      full = (to - from + 1) * (x2 - x1 + 1)
    }
    return full > 0 && hit / full >= 0.5
  }
  const cutL = !!cut.left && touches('left')
  const cutR = !!cut.right && touches('right')
  const cutT = !!cut.top && touches('top')
  const cutB = !!cut.bottom && touches('bottom')
  const isCut = cutL || cutR || cutT || cutB
  // Площадь комнаты — по рамке до стен, помноженной на заполнение: сама область
  // съедена закрытием проёмов на closePx с каждой стороны, считать её точки —
  // занижать площадь маленьких комнат на треть. Утечка в поле листа считаться
  // не должна: заполнение не больше единицы, площадь — не больше рамки
  const fill = boxArea ? Math.min(1, count / boxArea) : 0
  const X1 = cutL ? box.x1 : x1 - closePx
  const Y1 = cutT ? box.y1 : y1 - closePx
  const X2 = cutR ? box.x2 : x2 + closePx
  const Y2 = cutB ? box.y2 : y2 + closePx
  return {
    id,
    x1: X1,
    y1: Y1,
    x2: X2,
    y2: Y2,
    areaPx: fill * (X2 - X1 + 1) * (Y2 - Y1 + 1),
    points: count,
    fill,
    fillBox: fullArea ? count / fullArea : 0,
    cx: sx / count,
    cy: sy / count,
    edges,
    ...(isCut ? { cut: true } : {}),
  }
}

/**
 * Область у края листа, к которой подтекло поле через дырку в стене или
 * обрезанный угол: срезаем поле полосами там, где ширина области резко
 * меняется, — по строке или столбцу со ступенькой профиля, и только если куски
 * заполняют свои рамки лучше целого. Области внутри плана не режутся: их форму
 * честно передаёт контур по пикселям. Куски метятся новыми номерами в labels.
 */
function splitRegion(labels: Int32Array, id: number, w: number, h: number, box: PxRect, closePx: number, minArea: number, nextId: () => number, depth: number, cutIn: CutSides = {}): RoomRegion[] {
  const whole = measureRegion(labels, id, w, h, box, closePx, cutIn)
  if (!whole) return []
  if (whole.fillBox >= 0.8 || depth >= 5) return [whole]
  // профили: ширина области по строкам и высота по столбцам
  const rowW = new Int32Array(h)
  const colH = new Int32Array(w)
  for (let y = box.y1; y <= box.y2; y++) for (let x = box.x1; x <= box.x2; x++) if (labels[y * w + x] === id) (rowW[y]++, colH[x]++)
  const maxRow = Math.max(...Array.from(rowW.subarray(box.y1, box.y2 + 1)))
  const maxCol = Math.max(...Array.from(colH.subarray(box.x1, box.x2 + 1)))
  let best: { horizontal: boolean; at: number; gain: number } | null = null
  const tryCut = (horizontal: boolean, at: number) => {
    // помечаем куски временными номерами, меряем, возвращаем метки
    const idA = nextId()
    const idB = nextId()
    for (let y = box.y1; y <= box.y2; y++) for (let x = box.x1; x <= box.x2; x++) {
      const i = y * w + x
      if (labels[i] !== id) continue
      labels[i] = (horizontal ? y < at : x < at) ? idA : idB
    }
    const a = measureRegion(labels, idA, w, h, box, closePx)
    const b = measureRegion(labels, idB, w, h, box, closePx)
    for (let y = box.y1; y <= box.y2; y++) for (let x = box.x1; x <= box.x2; x++) {
      const i = y * w + x
      if (labels[i] === idA || labels[i] === idB) labels[i] = id
    }
    if (!a || !b || a.points < minArea || b.points < minArea) return
    // режем ради заметного выигрыша (ниша или эркер комнату на две не делят) —
    // либо чтобы отщипнуть чистый прямоугольник, не ухудшив остальное: так по
    // полосе снимается поле листа вокруг плана, пока не останется комната,
    // подтёкшая в него через дырку в стене
    const gain = (a.fillBox * a.areaPx + b.fillBox * b.areaPx) / (a.areaPx + b.areaPx) - whole.fillBox
    const peel = Math.max(a.fillBox, b.fillBox) >= 0.9 && gain >= 0
    if ((gain > 0.2 || peel) && (!best || gain > best.gain)) best = { horizontal, at, gain }
  }
  // ступенька профиля размыта на ширину закрытия проёмов (углы области скруглены),
  // поэтому ищем её, сравнивая строки по обе стороны окна, а режем по самой
  // резкой ступеньке внутри окна — иначе от отрезанной полосы остаётся полоска
  const k = Math.max(2, closePx)
  const step = Math.max(1, Math.floor(closePx / 4))
  const sharpest = (prof: Int32Array, at: number, lo: number, hi: number): number => {
    let best = at
    let jump = -1
    for (let t = Math.max(lo + 1, at - k); t <= Math.min(hi, at + k); t++) {
      const d = Math.abs(prof[t] - prof[t - 1])
      if (d > jump) (jump = d), (best = t)
    }
    return best
  }
  const triedH = new Set<number>()
  const triedV = new Set<number>()
  for (let y = box.y1 + k; y <= box.y2 - k; y += step) {
    if (!(rowW[y - k] && rowW[y + k] && Math.abs(rowW[y + k] - rowW[y - k]) > maxRow * 0.25)) continue
    const at = sharpest(rowW, y, box.y1, box.y2)
    if (!triedH.has(at)) (triedH.add(at), tryCut(true, at))
  }
  for (let x = box.x1 + k; x <= box.x2 - k; x += step) {
    if (!(colH[x - k] && colH[x + k] && Math.abs(colH[x + k] - colH[x - k]) > maxCol * 0.25)) continue
    const at = sharpest(colH, x, box.x1, box.x2)
    if (!triedV.has(at)) (triedV.add(at), tryCut(false, at))
  }
  if (!best) return [whole]
  const cut0 = cutIn
  const cut = best as { horizontal: boolean; at: number }
  const idA = nextId()
  const idB = nextId()
  for (let y = box.y1; y <= box.y2; y++) for (let x = box.x1; x <= box.x2; x++) {
    const i = y * w + x
    if (labels[i] !== id) continue
    labels[i] = (cut.horizontal ? y < cut.at : x < cut.at) ? idA : idB
  }
  const boxA: PxRect = cut.horizontal ? { ...box, y2: cut.at - 1 } : { ...box, x2: cut.at - 1 }
  const boxB: PxRect = cut.horizontal ? { ...box, y1: cut.at } : { ...box, x1: cut.at }
  const cutA: CutSides = cut.horizontal ? { ...cut0, bottom: true } : { ...cut0, right: true }
  const cutB: CutSides = cut.horizontal ? { ...cut0, top: true } : { ...cut0, left: true }
  return [...splitRegion(labels, idA, w, h, boxA, closePx, minArea, nextId, depth + 1, cutA), ...splitRegion(labels, idB, w, h, boxB, closePx, minArea, nextId, depth + 1, cutB)]
}

/** сколько сторон рамки упираются в стену (чернила в полосе у грани) или в край листа */
function walledSides(d2: Float32Array, w: number, h: number, r: RoomRegion): number {
  const NEAR = 8 // px: чернила в этой полосе у грани считаются стеной
  const inkNear = (x: number, y: number) => x < 0 || y < 0 || x >= w || y >= h || d2[y * w + x] <= 1
  const frac = (horizontal: boolean, at: number, from: number, to: number): number => {
    let hit = 0
    let n = 0
    for (let t = from; t <= to; t++) {
      n++
      let found = false
      for (let k = 0; k <= NEAR && !found; k++) found = horizontal ? inkNear(t, at - k) || inkNear(t, at + k) : inkNear(at - k, t) || inkNear(at + k, t)
      if (found) hit++
    }
    return n ? hit / n : 0
  }
  const x1 = Math.max(0, Math.round(r.x1))
  const x2 = Math.min(w - 1, Math.round(r.x2))
  const y1 = Math.max(0, Math.round(r.y1))
  const y2 = Math.min(h - 1, Math.round(r.y2))
  let sides = 0
  if (r.x1 <= 0 || frac(false, x1, y1, y2) >= 0.5) sides++
  if (r.x2 >= w - 1 || frac(false, x2, y1, y2) >= 0.5) sides++
  if (r.y1 <= 0 || frac(true, y1, x1, x2) >= 0.5) sides++
  if (r.y2 >= h - 1 || frac(true, y2, x1, x2) >= 0.5) sides++
  return sides
}

export function segmentRooms(d2: Float32Array, w: number, h: number, closePx: number, opts: { minAreaPx?: number; maxAreaFrac?: number; clip?: PxRect | null; inkD2?: Float32Array } = {}): RoomRegion[] {
  const r2 = closePx * closePx
  const minArea = opts.minAreaPx ?? Math.max(400, (w * h) / 400)
  const maxArea = (opts.maxAreaFrac ?? 0.5) * w * h
  const clip = opts.clip ?? { x1: 0, y1: 0, x2: w - 1, y2: h - 1 }
  const open = (i: number) => {
    if (d2[i] <= r2) return false
    const x = i % w
    const y = (i - x) / w
    return x >= clip.x1 && x <= clip.x2 && y >= clip.y1 && y <= clip.y2
  }
  const labels = new Int32Array(w * h)
  const queue = new Int32Array(w * h)
  const out: RoomRegion[] = []
  // обрывки меньше комнаты (карман за выноской, петли букв): при дорастании
  // комнат до стен они никому не мешают, в отличие от поля листа
  const tiny = new Set<number>()
  let next = 1
  const nextId = () => next++
  for (let start = 0; start < d2.length; start++) {
    if (labels[start] || !open(start)) continue
    const id = nextId()
    let head = 0
    let tail = 0
    queue[tail++] = start
    labels[start] = id
    let count = 0
    const box: PxRect = { x1: w, y1: h, x2: 0, y2: 0 }
    while (head < tail) {
      const i = queue[head++]
      const x = i % w
      const y = (i - x) / w
      count++
      if (x < box.x1) box.x1 = x
      if (x > box.x2) box.x2 = x
      if (y < box.y1) box.y1 = y
      if (y > box.y2) box.y2 = y
      const visit = (j: number) => {
        if (!labels[j] && open(j)) {
          labels[j] = id
          queue[tail++] = j
        }
      }
      if (x > 0) visit(i - 1)
      if (x < w - 1) visit(i + 1)
      if (y > 0) visit(i - w)
      if (y < h - 1) visit(i + w)
    }
    // Слишком большая область — это поле листа, возможно с подтёкшей в него
    // комнатой; её всё равно режем, а предел площади проверяем по кускам
    if (count < minArea) {
      tiny.add(id)
      continue
    }
    // Внутри плана область не режется: Г-образная прихожая — одна комната, и
    // контур по пикселям это покажет. Режется только область у края листа —
    // там к комнате могло подтечь поле через дырку в стене
    const atEdge = box.x1 <= clip.x1 || box.y1 <= clip.y1 || box.x2 >= clip.x2 || box.y2 >= clip.y2
    const pieces = atEdge ? splitRegion(labels, id, w, h, box, closePx, minArea, nextId, 0) : [measureRegion(labels, id, w, h, box, closePx)].filter((r): r is RoomRegion => !!r)
    for (const piece of pieces) {
      if (piece.areaPx > maxArea) continue
      // Поле вокруг квартиры обнимает план и касается трёх-четырёх сторон листа —
      // это не комната. Комната, обрезанная краем фото, касается одной-двух
      // сторон: её оставляем, край листа для неё становится стеной. Проверяется
      // после разрезания: комната, подтекающая в поле через обрезанный угол,
      // отделяется от поля разрезом
      if (piece.edges >= 3) continue
      const boxW = piece.x2 - piece.x1 + 1
      const boxH = piece.y2 - piece.y1 + 1
      // полоса поля вдоль одной стороны листа — не комната: слишком узкая или вытянутая
      const minSide = Math.max(12, Math.min(w, h) * 0.04)
      if (Math.min(boxW, boxH) < minSide || Math.max(boxW, boxH) / Math.min(boxW, boxH) > 8) continue
      // кусок поля вдоль края листа лежит на нём длинной стороной и неглубок;
      // комната, обрезанная краем, упирается в него торцом и уходит вглубь
      if (fieldStrip(piece, w, h)) continue
      // комната обнесена стенами: вдоль хотя бы трёх сторон рамки — чернила или край листа;
      // у куска Г-образной области одна сторона — разрез, ему хватит двух
      if (walledSides(d2, w, h, piece) < (piece.cut ? 2 : 3)) continue
      out.push(piece)
    }
  }
  // комнаты квартиры примыкают друг к другу; область в стороне от всех — обрывок
  // поля, текст на полях или кусок соседнего плана
  const near = Math.max(2 * closePx + 6, Math.min(w, h) * 0.06)
  const kept = out.length < 2 ? out : out.filter((r) => out.some((s) => s !== r && adjacent(r, s, near)))
  // Контур каждой комнаты — по пикселям: область дорастает до стен, обводится
  // и выпрямляется. Рамка и площадь дальше — по контуру
  const { outlines } = outlineRegions(labels, kept.map((r) => r.id ?? 0), d2, w, h, closePx, tiny, opts.inkD2)
  kept.forEach((r, k) => {
    const o = outlines[k]
    if (!o) return
    r.poly = o.poly
    r.areaPx = o.areaPx
    r.x1 = o.box.x1
    r.y1 = o.box.y1
    r.x2 = o.box.x2
    r.y2 = o.box.y2
    r.fill = o.areaPx / Math.max(1, (o.box.x2 - o.box.x1) * (o.box.y2 - o.box.y1))
    // центр масс Г-образной комнаты может лечь в соседку — берём точку внутри контура
    if (!pointInPoly({ x: r.cx, y: r.cy }, o.poly)) {
      const p = interiorPoint(o.poly)
      r.cx = p.x
      r.cy = p.y
    }
  })
  // Поле листа, огибающее план подковой, после срезания полос тоже бывает
  // «областью»: рамка у неё — почти весь лист, а занимает она из неё седьмую
  // часть. Комната, даже Г-образная, заполняет свою рамку больше чем наполовину
  return kept.filter((r) => !r.poly || r.fill >= 0.35).sort((a, b) => b.areaPx - a.areaPx)
}

/**
 * Полоса поля листа: касается края листа (или тянется от края до края) и вдоль
 * него втрое длиннее, чем вглубь. Обрезанная фото комната тоже касается края,
 * но уходит от него вглубь плана, а не стелется вдоль.
 */
function fieldStrip(r: RoomRegion, w: number, h: number): boolean {
  const boxW = r.x2 - r.x1 + 1
  const boxH = r.y2 - r.y1 + 1
  // у скана по краю часто идёт рамка в пару пикселей: полоса за ней — тоже край листа
  const tol = Math.max(3, Math.round(0.006 * Math.min(w, h)))
  const left = r.x1 <= tol
  const right = r.x2 >= w - 1 - tol
  const top = r.y1 <= tol
  const bottom = r.y2 >= h - 1 - tol
  if ((left && right) || (top && bottom)) return true
  if ((left || right) && boxH > 3 * boxW) return true
  if ((top || bottom) && boxW > 3 * boxH) return true
  return false
}

/** две рамки примыкают: щель между обращёнными гранями не шире near, а по другой оси они перекрываются */
function adjacent(a: RoomRegion, b: RoomRegion, near: number): boolean {
  const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)
  const oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1)
  const gapX = Math.max(b.x1 - a.x2, a.x1 - b.x2)
  const gapY = Math.max(b.y1 - a.y2, a.y1 - b.y2)
  return (gapX <= near && oy > 0) || (gapY <= near && ox > 0)
}

/**
 * Заштрихованные полосы — не комнаты. Вентшахту, кладку, колонну на плане
 * БТИ рисуют густой штриховкой из мелких квадратиков; очистка их стирает, и
 * полоса выглядит пустой узкой комнатой. Выдаёт её плотность меток по
 * исходной картинке: в комнате — подпись и пара цифр (1–3 % точек), в
 * штриховке — каждая десятая точка. Одной плотности мало (на планах с мебелью
 * комнаты тоже пёстрые), поэтому ещё и форма: полоса заметно уже остальных
 * комнат или вытянута втрое.
 */
export function hatchedStrips(regions: RoomRegion[], marks: Bin): number[] {
  const { ink, w } = marks
  const shortSide = (r: RoomRegion) => Math.min(r.x2 - r.x1, r.y2 - r.y1)
  const out: number[] = []
  regions.forEach((r, k) => {
    const poly = r.poly
    if (!poly) return
    let n = 0
    let dark = 0
    for (let y = Math.max(0, Math.floor(r.y1)); y < Math.min(marks.h, Math.ceil(r.y2)); y++) {
      for (let x = Math.max(0, Math.floor(r.x1)); x < Math.min(w, Math.ceil(r.x2)); x++) {
        if (!pointInPoly({ x: x + 0.5, y: y + 0.5 }, poly)) continue
        n++
        if (ink[y * w + x]) dark++
      }
    }
    if (!n || dark / n < 0.06) return
    const others = regions.filter((s) => s !== r).map(shortSide).sort((a, b) => a - b)
    const typical = others.length ? others[Math.floor(others.length / 2)] : Infinity
    const long = Math.max(r.x2 - r.x1, r.y2 - r.y1)
    // шахта — полоса в треть комнаты шириной или вытянутая; санузел в полкомнаты
    // шириной на фото с фоновой сеткой бывает не светлее штриховки
    if (shortSide(r) < 0.35 * typical || long >= 2.5 * shortSide(r)) out.push(k)
  })
  return out
}

/**
 * Радиус закрытия проёмов подбирается сам: слишком малый сливает комнаты через
 * двери и находит «комнаты» в тексте на полях, слишком большой съедает
 * маленькие комнаты и режет большие по нишам. Пробуем несколько радиусов и
 * голосуем: настоящая комната находится почти при любом радиусе, случайная —
 * при одном. Берём радиус, чей набор ближе всего к согласованному; при
 * равенстве — с меньшим числом кусков разрезов, потом больший радиус.
 */
export function segmentRoomsAuto(d2: Float32Array, w: number, h: number, basePx: number, clip?: PxRect | null, inkD2?: Float32Array): { regions: RoomRegion[]; closePx: number } {
  const tries = [0.5, 0.65, 0.8, 1, 1.25].map((k) => {
    const closePx = Math.max(3, Math.round(basePx * k))
    return { closePx, regions: segmentRooms(d2, w, h, closePx, { clip, inkD2 }) }
  })
  // кластеры похожих рамок (IoU ≥ 0,6) по всем радиусам; поддержка — в скольких радиусах кластер встретился
  const clusters: { box: RoomRegion; support: number }[] = []
  const matches = tries.map(({ regions }) => {
    const taken = new Set<number>()
    return regions.map((r) => {
      let best = -1
      let bestIou = 0.6
      clusters.forEach((c, k) => {
        if (taken.has(k)) return
        const iou = boxIou(r, c.box)
        if (iou >= bestIou) (bestIou = iou), (best = k)
      })
      if (best < 0) {
        clusters.push({ box: r, support: 0 })
        best = clusters.length - 1
      }
      taken.add(best)
      clusters[best].support++
      return best
    })
  })
  const need = Math.ceil(tries.length / 2)
  let pick = 0
  let pickScore = -Infinity
  tries.forEach((t, i) => {
    const agreed = matches[i].filter((k) => clusters[k].support >= need).length
    const extra = t.regions.length - agreed
    const cut = t.regions.filter((r) => r.cut).length
    // согласованных больше, лишних меньше; куски разрезов — признак излишнего радиуса
    const score = agreed - extra - cut * 0.25 + t.closePx * 1e-4
    if (score > pickScore) (pickScore = score), (pick = i)
  })
  return { regions: tries[pick].regions, closePx: tries[pick].closePx }
}

function boxIou(a: PxRect, b: PxRect): number {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1))
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1))
  const inter = ix * iy
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter
  return union > 0 ? inter / union : 0
}
