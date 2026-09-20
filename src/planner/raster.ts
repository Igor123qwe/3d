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
  const maxSide = opts.maxSide ?? Math.max(12, Math.round(Math.max(bin.w, bin.h) / 45))
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

export interface CleanResult {
  /** очищенная картинка: белая бумага, чёрные линии */
  gray: Uint8Array
  bin: Bin
}

/** Полная очистка: выровнять фон, бинаризовать, убрать мелочь */
export function cleanRaster(gray: Uint8Array, w: number, h: number): CleanResult {
  const flat = flattenBackground(gray, w, h)
  const bin = despeckle(binarize(flat, w, h))
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = bin.ink[i] ? 0 : 255
  return { gray: out, bin }
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
