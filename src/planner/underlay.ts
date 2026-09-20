// Подложка: картинка плана (скан БТИ, скрин из объявления) под чертежом.
// Масштаб задаётся калибровкой по известному размеру, стены можно обвести
// вручную или распознать автоматически.
import type { Opening, Plan, PlanSettings, Pt, Underlay, Wall } from './types'
import { emptyPlan, uid } from './types'
import { dist } from './geometry'

/** максимальная сторона сохраняемой картинки, px: больше нет смысла, а память экономит */
const MAX_SIDE = 1800
/** при какой ширине изображения считаем, что план занимает 10 м */
const ASSUMED_WIDTH_CM = 1000
/** разрывы уже этого считаем дефектом скана, а не проёмом, см */
const MIN_TRACE_OPENING = 40

export interface LoadedImage {
  src: string
  w: number
  h: number
}

/** Загрузить картинку, при необходимости уменьшив и сжав её */
export async function loadUnderlayImage(file: File): Promise<LoadedImage> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Не удалось прочитать изображение'))
      el.src = url
    })
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * k))
    const h = Math.max(1, Math.round(img.naturalHeight * k))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Браузер не дал холст для обработки картинки')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    // планы — почти чёрно-белые, JPEG даёт заметно меньший объём
    const src = canvas.toDataURL('image/jpeg', 0.85)
    return { src, w, h }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function makeUnderlay(img: LoadedImage, center: Pt): Underlay {
  const scale = ASSUMED_WIDTH_CM / img.w
  return {
    src: img.src,
    px: { w: img.w, h: img.h },
    x: center.x - (img.w * scale) / 2,
    y: center.y - (img.h * scale) / 2,
    scale,
    opacity: 0.55,
    visible: true,
    locked: false,
  }
}

/** точка плана (см) → пиксель картинки */
export const toPixel = (u: Underlay, p: Pt): Pt => ({ x: (p.x - u.x) / u.scale, y: (p.y - u.y) / u.scale })
/** пиксель картинки → точка плана (см) */
export const toPlan = (u: Underlay, p: Pt): Pt => ({ x: u.x + p.x * u.scale, y: u.y + p.y * u.scale })

/**
 * Калибровка: пользователь показал на подложке отрезок известной длины.
 * Масштаб меняем так, чтобы первая точка осталась на месте.
 */
export function calibrate(u: Underlay, a: Pt, b: Pt, realCm: number): Underlay {
  const pa = toPixel(u, a)
  const pb = toPixel(u, b)
  const px = dist(pa, pb)
  if (px < 1 || !(realCm > 0)) return u
  const scale = realCm / px
  return { ...u, scale, x: a.x - pa.x * scale, y: a.y - pa.y * scale }
}

// ---------- автоматическое распознавание стен ----------

export interface DetectOptions {
  /** порог «чернил», 0..255: пиксель темнее считается линией */
  threshold: number
  /** минимальная длина стены, px */
  minLength: number
  /** минимальная толщина стены, px */
  minThickness: number
  /** максимальная толщина стены, px */
  maxThickness: number
}

export interface DetectedSegment {
  a: Pt
  b: Pt
  thickness: number
  dir: 'h' | 'v'
}

/**
 * Порог «чернил» по методу Оцу: делит гистограмму яркости на фон и линии.
 * Сканы бывают серыми, поэтому фиксированный порог не годится.
 */
export function otsuThreshold(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0)
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++
  const total = gray.length
  if (!total) return 128
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0
  let wB = 0
  let best = 128
  let bestVar = -1
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > bestVar) {
      bestVar = between
      best = t
    }
  }
  return best
}

/** длины непрерывных серий «чернил» по строкам и по столбцам */
function runLengths(ink: Uint8Array, w: number, h: number): { ht: Uint16Array; vt: Uint16Array } {
  const ht = new Uint16Array(w * h)
  const vt = new Uint16Array(w * h)
  for (let y = 0; y < h; y++) {
    let x = 0
    while (x < w) {
      if (!ink[y * w + x]) {
        x++
        continue
      }
      let e = x
      while (e < w && ink[y * w + e]) e++
      const len = e - x
      for (let i = x; i < e; i++) ht[y * w + i] = len
      x = e
    }
  }
  for (let x = 0; x < w; x++) {
    let y = 0
    while (y < h) {
      if (!ink[y * w + x]) {
        y++
        continue
      }
      let e = y
      while (e < h && ink[e * w + x]) e++
      const len = e - y
      for (let i = y; i < e; i++) vt[i * w + x] = len
      y = e
    }
  }
  return { ht, vt }
}

interface Band {
  from: number
  to: number
  start: number
  end: number
  lastLine: number
}

/** собрать полосы из построчных серий: серия продолжает полосу, если заметно с ней пересекается */
function collectBands(lineRuns: { line: number; from: number; to: number }[][], o: DetectOptions): Band[] {
  const done: Band[] = []
  let open: Band[] = []
  for (const runs of lineRuns) {
    const next: Band[] = []
    const usedBand = new Set<Band>()
    for (const r of runs) {
      let best: Band | null = null
      let bestOverlap = 0
      for (const b of open) {
        if (usedBand.has(b)) continue
        const ov = Math.min(b.to, r.to) - Math.max(b.from, r.from)
        const shorter = Math.min(b.to - b.from, r.to - r.from)
        if (ov > bestOverlap && ov >= shorter * 0.5) {
          bestOverlap = ov
          best = b
        }
      }
      if (best) {
        usedBand.add(best)
        best.from = Math.min(best.from, r.from)
        best.to = Math.max(best.to, r.to)
        best.end = r.line
        best.lastLine = r.line
        next.push(best)
      } else {
        next.push({ from: r.from, to: r.to, start: r.line, end: r.line, lastLine: r.line })
      }
    }
    for (const b of open) if (!next.includes(b)) done.push(b)
    open = next
  }
  done.push(...open)
  return done.filter((b) => {
    const thickness = b.end - b.start + 1
    return b.to - b.from >= o.minLength && thickness >= o.minThickness && thickness <= o.maxThickness
  })
}

/**
 * Найти стены на растре плана.
 * Стена — это длинная тёмная полоса ограниченной толщины: размерные линии
 * слишком тонкие, буквы и штриховка — слишком короткие.
 */
export function detectWalls(gray: Uint8Array, w: number, h: number, o: DetectOptions): DetectedSegment[] {
  if (w < 4 || h < 4) return []
  const ink = new Uint8Array(w * h)
  for (let i = 0; i < ink.length; i++) ink[i] = gray[i] < o.threshold ? 1 : 0
  const { ht, vt } = runLengths(ink, w, h)

  // горизонтальные: длинная серия по строке при небольшой толщине по вертикали
  const rows: { line: number; from: number; to: number }[][] = []
  for (let y = 0; y < h; y++) {
    const runs: { line: number; from: number; to: number }[] = []
    let x = 0
    while (x < w) {
      const i = y * w + x
      const ok = ink[i] && ht[i] >= o.minLength && vt[i] <= o.maxThickness
      if (!ok) {
        x++
        continue
      }
      let e = x
      while (e < w && ink[y * w + e] && ht[y * w + e] >= o.minLength && vt[y * w + e] <= o.maxThickness) e++
      if (e - x >= o.minLength) runs.push({ line: y, from: x, to: e - 1 })
      x = e
    }
    rows.push(runs)
  }

  const cols: { line: number; from: number; to: number }[][] = []
  for (let x = 0; x < w; x++) {
    const runs: { line: number; from: number; to: number }[] = []
    let y = 0
    while (y < h) {
      const i = y * w + x
      const ok = ink[i] && vt[i] >= o.minLength && ht[i] <= o.maxThickness
      if (!ok) {
        y++
        continue
      }
      let e = y
      while (e < h && ink[e * w + x] && vt[e * w + x] >= o.minLength && ht[e * w + x] <= o.maxThickness) e++
      if (e - y >= o.minLength) runs.push({ line: x, from: y, to: e - 1 })
      y = e
    }
    cols.push(runs)
  }

  const out: DetectedSegment[] = []
  for (const b of collectBands(rows, o)) {
    const y = (b.start + b.end) / 2
    out.push({ a: { x: b.from, y }, b: { x: b.to, y }, thickness: b.end - b.start + 1, dir: 'h' })
  }
  for (const b of collectBands(cols, o)) {
    const x = (b.start + b.end) / 2
    out.push({ a: { x, y: b.from }, b: { x, y: b.to }, thickness: b.end - b.start + 1, dir: 'v' })
  }
  return out
}

/**
 * Свести углы: горизонтальные и вертикальные отрезки должны сходиться,
 * иначе комната не замкнётся. Изменяет переданные отрезки на месте, чтобы
 * ссылки на них (например, из найденных разрывов) оставались рабочими.
 */
export function joinCorners(segs: DetectedSegment[], tol: number): DetectedSegment[] {
  const out = segs
  const hs = out.filter((s) => s.dir === 'h')
  const vs = out.filter((s) => s.dir === 'v')
  for (const hseg of hs) {
    for (const vseg of vs) {
      const ix = vseg.a.x
      const iy = hseg.a.y
      const inH = ix >= Math.min(hseg.a.x, hseg.b.x) - tol && ix <= Math.max(hseg.a.x, hseg.b.x) + tol
      const inV = iy >= Math.min(vseg.a.y, vseg.b.y) - tol && iy <= Math.max(vseg.a.y, vseg.b.y) + tol
      if (!inH || !inV) continue
      if (ix < Math.min(hseg.a.x, hseg.b.x)) hseg.a.x < hseg.b.x ? (hseg.a.x = ix) : (hseg.b.x = ix)
      if (ix > Math.max(hseg.a.x, hseg.b.x)) hseg.a.x > hseg.b.x ? (hseg.a.x = ix) : (hseg.b.x = ix)
      if (iy < Math.min(vseg.a.y, vseg.b.y)) vseg.a.y < vseg.b.y ? (vseg.a.y = iy) : (vseg.b.y = iy)
      if (iy > Math.max(vseg.a.y, vseg.b.y)) vseg.a.y > vseg.b.y ? (vseg.a.y = iy) : (vseg.b.y = iy)
    }
  }
  return out
}

/** Слить дублирующиеся и перекрывающиеся отрезки одного направления */
export function mergeCollinear(segs: DetectedSegment[], tol: number): DetectedSegment[] {
  const out: DetectedSegment[] = []
  for (const s of segs) {
    const axis = s.dir === 'h' ? s.a.y : s.a.x
    const lo = s.dir === 'h' ? Math.min(s.a.x, s.b.x) : Math.min(s.a.y, s.b.y)
    const hi = s.dir === 'h' ? Math.max(s.a.x, s.b.x) : Math.max(s.a.y, s.b.y)
    const same = out.find((o) => {
      if (o.dir !== s.dir) return false
      const oAxis = o.dir === 'h' ? o.a.y : o.a.x
      if (Math.abs(oAxis - axis) > tol) return false
      const oLo = o.dir === 'h' ? Math.min(o.a.x, o.b.x) : Math.min(o.a.y, o.b.y)
      const oHi = o.dir === 'h' ? Math.max(o.a.x, o.b.x) : Math.max(o.a.y, o.b.y)
      return hi >= oLo - tol && lo <= oHi + tol
    })
    if (!same) {
      out.push({ ...s, a: { ...s.a }, b: { ...s.b } })
      continue
    }
    const sLo = same.dir === 'h' ? Math.min(same.a.x, same.b.x) : Math.min(same.a.y, same.b.y)
    const sHi = same.dir === 'h' ? Math.max(same.a.x, same.b.x) : Math.max(same.a.y, same.b.y)
    const nLo = Math.min(lo, sLo)
    const nHi = Math.max(hi, sHi)
    const nAxis = (axis + (same.dir === 'h' ? same.a.y : same.a.x)) / 2
    same.thickness = Math.max(same.thickness, s.thickness)
    if (same.dir === 'h') {
      same.a = { x: nLo, y: nAxis }
      same.b = { x: nHi, y: nAxis }
    } else {
      same.a = { x: nAxis, y: nLo }
      same.b = { x: nAxis, y: nHi }
    }
  }
  return out
}

/**
 * Слить пары параллельных линий в одну стену: на чертежах стена нарисована
 * двумя контурными линиями, и без слияния между ними возникает «комната-щель».
 * Толщина получившейся стены — расстояние между линиями.
 */
export function mergeParallel(segs: DetectedSegment[], maxSep: number): DetectedSegment[] {
  const axisOf = (s: DetectedSegment) => (s.dir === 'h' ? s.a.y : s.a.x)
  const loOf = (s: DetectedSegment) => (s.dir === 'h' ? Math.min(s.a.x, s.b.x) : Math.min(s.a.y, s.b.y))
  const hiOf = (s: DetectedSegment) => (s.dir === 'h' ? Math.max(s.a.x, s.b.x) : Math.max(s.a.y, s.b.y))
  const rest = segs.slice()
  const out: DetectedSegment[] = []
  while (rest.length) {
    const s = rest.shift()!
    const mate = rest.find((o) => {
      if (o.dir !== s.dir) return false
      const sep = Math.abs(axisOf(o) - axisOf(s))
      if (sep < 1 || sep > maxSep) return false
      // склеиваем только сопоставимые линии: контур стены, а не стену с выноской
      if (Math.min(o.thickness, s.thickness) < Math.max(o.thickness, s.thickness) * 0.4) return false
      const overlap = Math.min(hiOf(o), hiOf(s)) - Math.max(loOf(o), loOf(s))
      const shorter = Math.min(hiOf(o) - loOf(o), hiOf(s) - loOf(s))
      return overlap >= shorter * 0.6
    })
    if (!mate) {
      out.push(s)
      continue
    }
    rest.splice(rest.indexOf(mate), 1)
    const axis = (axisOf(s) + axisOf(mate)) / 2
    const lo = Math.min(loOf(s), loOf(mate))
    const hi = Math.max(hiOf(s), hiOf(mate))
    const thickness = Math.abs(axisOf(s) - axisOf(mate)) + (s.thickness + mate.thickness) / 2
    out.push(
      s.dir === 'h'
        ? { dir: 'h', thickness, a: { x: lo, y: axis }, b: { x: hi, y: axis } }
        : { dir: 'v', thickness, a: { x: axis, y: lo }, b: { x: axis, y: hi } },
    )
  }
  return out
}

export interface Gap {
  /** отрезок, в котором обнаружен разрыв */
  seg: DetectedSegment
  /** положение центра разрыва вдоль отрезка, px от начала */
  at: number
  /** ширина разрыва, px */
  width: number
}

/**
 * Соединить отрезки одной линии через разрывы: на планах БТИ дверные проёмы
 * нарисованы разрывом стены, из-за чего контур комнаты не замыкается.
 * Сами разрывы возвращаем — из них получаются проёмы плана.
 */
export function bridgeGaps(segs: DetectedSegment[], maxGap: number, tol: number): { segs: DetectedSegment[]; gaps: Gap[] } {
  const out: DetectedSegment[] = []
  const gaps: Gap[] = []
  const axisOf = (s: DetectedSegment) => (s.dir === 'h' ? s.a.y : s.a.x)
  const loOf = (s: DetectedSegment) => (s.dir === 'h' ? Math.min(s.a.x, s.b.x) : Math.min(s.a.y, s.b.y))
  const hiOf = (s: DetectedSegment) => (s.dir === 'h' ? Math.max(s.a.x, s.b.x) : Math.max(s.a.y, s.b.y))

  for (const dir of ['h', 'v'] as const) {
    // группируем по одной линии
    const lines: DetectedSegment[][] = []
    for (const s of segs.filter((x) => x.dir === dir)) {
      const line = lines.find((l) => Math.abs(axisOf(l[0]) - axisOf(s)) <= tol)
      if (line) line.push(s)
      else lines.push([s])
    }
    for (const line of lines) {
      line.sort((a, b) => loOf(a) - loOf(b))
      let cur = { ...line[0], a: { ...line[0].a }, b: { ...line[0].b } }
      const curGaps: Gap[] = []
      for (let i = 1; i < line.length; i++) {
        const next = line[i]
        const gap = loOf(next) - hiOf(cur)
        if (gap > 0 && gap <= maxGap) {
          curGaps.push({ seg: cur, at: hiOf(cur) - loOf(cur) + gap / 2, width: gap })
          const axis = (axisOf(cur) + axisOf(next)) / 2
          const lo = loOf(cur)
          const hi = hiOf(next)
          cur = dir === 'h'
            ? { dir, thickness: Math.max(cur.thickness, next.thickness), a: { x: lo, y: axis }, b: { x: hi, y: axis } }
            : { dir, thickness: Math.max(cur.thickness, next.thickness), a: { x: axis, y: lo }, b: { x: axis, y: hi } }
          for (const g of curGaps) g.seg = cur
        } else {
          out.push(cur)
          gaps.push(...curGaps.splice(0))
          cur = { ...next, a: { ...next.a }, b: { ...next.b } }
        }
      }
      out.push(cur)
      gaps.push(...curGaps)
    }
  }
  return { segs: out, gaps }
}

export interface TraceOptions {
  /** чувствительность: 0..100, выше — распознаёт более светлые линии */
  sensitivity: number
  /** минимальная длина стены, см */
  minLengthCm: number
  /** максимальная толщина стены, см */
  maxThicknessCm: number
  /** разрыв такой ширины считаем дверным проёмом, а не концом стены, см */
  maxGapCm: number
}

export const DEFAULT_TRACE: TraceOptions = { sensitivity: 50, minLengthCm: 40, maxThicknessCm: 60, maxGapCm: 150 }

export interface TraceResult {
  walls: Wall[]
  openings: Opening[]
}

/** Полный проход: растр подложки → стены и проёмы плана */
export function tracePlan(gray: Uint8Array, u: Underlay, o: TraceOptions): TraceResult {
  const px = (cm: number) => Math.max(2, Math.round(cm / u.scale))
  // Оцу отделяет фон от линий, но края линий сглажены: берём порог с запасом
  // в сторону фона, величину запаса задаёт ползунок чувствительности
  const otsu = otsuThreshold(gray)
  let bgSum = 0
  let bgCount = 0
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] > otsu) {
      bgSum += gray[i]
      bgCount++
    }
  }
  const bg = bgCount ? bgSum / bgCount : 255
  const threshold = Math.min(240, Math.max(20, Math.round(otsu + (bg - otsu) * (o.sensitivity / 100) * 0.5)))
  const opts: DetectOptions = {
    threshold,
    minLength: px(o.minLengthCm),
    // на чертежах стена нарисована контуром из тонких линий, поэтому порог
    // минимальный; лишнее отсекают требования к длине и сопоставимости толщин
    minThickness: 2,
    maxThickness: px(o.maxThicknessCm),
  }
  const tolPx = px(12)
  const found = mergeCollinear(joinCorners(detectWalls(gray, u.px.w, u.px.h, opts), tolPx), tolPx)
  const raw = mergeCollinear(mergeParallel(found, px(Math.min(o.maxThicknessCm, 50))), tolPx)
  const bridged = bridgeGaps(raw, px(o.maxGapCm), tolPx)
  joinCorners(bridged.segs, tolPx) // после моста концы снова нужно свести к углам

  const walls: Wall[] = []
  const bySeg = new Map<DetectedSegment, Wall>()
  for (const s of bridged.segs) {
    const a = toPlan(u, s.a)
    const b = toPlan(u, s.b)
    const wall: Wall = {
      id: uid('w'),
      a: { x: Math.round(a.x), y: Math.round(a.y) },
      b: { x: Math.round(b.x), y: Math.round(b.y) },
      thickness: Math.max(5, Math.round((s.thickness * u.scale) / 5) * 5),
    }
    if (dist(wall.a, wall.b) < o.minLengthCm) continue
    walls.push(wall)
    bySeg.set(s, wall)
  }

  const openings: Opening[] = []
  for (const g of bridged.gaps) {
    const wall = bySeg.get(g.seg)
    if (!wall) continue
    const len = dist(wall.a, wall.b)
    const width = Math.round(g.width * u.scale)
    if (len < width + 4 || width < MIN_TRACE_OPENING) continue
    const t = (g.at * u.scale) / len
    if (t <= 0 || t >= 1) continue
    openings.push({ id: uid('o'), kind: 'doorway', wallId: wall.id, t, width, hinge: 'a', side: 1 })
  }
  return { walls, openings }
}

/** Оттенки серого из картинки подложки — для распознавания */
export async function grayscaleOf(u: Underlay): Promise<Uint8Array> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('Не удалось прочитать подложку'))
    el.src = u.src
  })
  const canvas = document.createElement('canvas')
  canvas.width = u.px.w
  canvas.height = u.px.h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Браузер не дал холст для распознавания')
  ctx.drawImage(img, 0, 0, u.px.w, u.px.h)
  const data = ctx.getImageData(0, 0, u.px.w, u.px.h).data
  const gray = new Uint8Array(u.px.w * u.px.h)
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
  }
  return gray
}

/** Служебные имена файлов, из которых имя проекта не сделать: «буфер.png», «image.png», «Снимок экрана…» */
const GENERIC_FILE_NAME = /^(буфер|image|img|clipboard|blob|paste|pasted|screenshot|снимок|скриншот|untitled|unnamed)/i

/** Имя проекта из имени файла: «квартира-87.png» → «квартира-87»; служебные имена заменяет запасным */
export function nameFromFile(fileName: string | undefined, fallback: string): string {
  const stem = (fileName || '').replace(/\.[a-z0-9]{1,5}$/i, '').trim()
  if (!stem || GENERIC_FILE_NAME.test(stem)) return fallback
  return stem.slice(0, 60)
}

/**
 * Новый проект по картинке: чистый лист, схема подложкой по центру.
 * Настройки (сетка) переезжают из прежнего проекта — это выбор пользователя, а не часть плана.
 */
export function planFromImage(img: LoadedImage, name: string, settings?: PlanSettings): Plan {
  const p = emptyPlan(name)
  return { ...p, settings: { ...p.settings, ...settings }, underlay: makeUnderlay(img, { x: 0, y: 0 }) }
}
