// Комната с картинки — многоугольник по пикселям.
//
// Так делают открытые проекты и советуют на форумах по OpenCV: заливка →
// контур → прямые углы. Комнату не режут на прямоугольники и не собирают
// обратно с правилами «кто кому уступил угол». Область заливки дорастает до
// граней стен, обводится по пикселям и выпрямляется до прямых углов —
// Г-образная прихожая или комната с вырезом под шахту получаются сами.
//
// Стены — из граней соседних комнат. Где правая грань одной комнаты смотрит на
// левую грань другой через полосу чернил, там перегородка ровно этой толщины и
// ровно посередине. Грань без соседа — наружная стена: её толщина меряется по
// чернилам наружу, а не вышло — берётся обычная. Подписи геометрию не двигают:
// они дают имена, масштаб и проверку площадей.
import type { Pt, Underlay, Wall } from './types'
import { uid } from './types'
import { buildRooms } from './rooms'
import { interiorPoint, pointInPoly, polyArea } from './geometry'
import type { AiSide } from './aicontract'
import type { AreaFit, PlacedRoom, ReconstructResult } from './reconstruct'

/**
 * Область заливки держится на расстоянии closePx от чернил — так закрыты
 * дверные проёмы. Дорастить её обратно до граней стен: все области растут
 * разом, по шагу за раз, через бумагу, но не через чернила. В проёме соседи
 * встречаются посередине, и чужого никто не забирает. Остальные области
 * разметки (поле листа, отброшенные обрывки) растут вместе со всеми, только
 * ничьими: иначе комната через входную дверь или дырку в стене расползлась бы
 * по полю вдоль наружной стены. Обрывки из ignore (карманы меньше комнаты)
 * не растут и не мешают: их место достаётся соседней комнате.
 * Возвращает карту: номер области с единицы (порядок ids), −1 — прочие
 * области разметки, 0 — ничьё (чернила и то, куда рост не дошёл).
 */
export function growRegions(labels: Int32Array, ids: number[], d2: Float32Array, w: number, h: number, steps: number, ignore?: Set<number>): Int32Array {
  const owner = new Int32Array(w * h)
  const index = new Map(ids.map((id, k) => [id, k + 1]))
  const NOBODY = -1
  const queue = new Int32Array(w * h)
  let head = 0
  let tail = 0
  for (let i = 0; i < labels.length; i++) {
    if (!labels[i] || ignore?.has(labels[i])) continue
    owner[i] = index.get(labels[i]) ?? NOBODY
    queue[tail++] = i
  }
  // по восьми соседям: за steps шагов область доходит до угла комнаты так же, как до стены
  for (let s = 0; s < steps && head < tail; s++) {
    const end = tail
    while (head < end) {
      const i = queue[head++]
      const x = i % w
      const y = (i - x) / w
      const k = owner[i]
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const j = ny * w + nx
          if (owner[j] || d2[j] === 0) continue
          owner[j] = k
          queue[tail++] = j
        }
      }
    }
  }
  return owner
}

/**
 * Закутки, куда рост не дотянулся. Область держится на радиус от стен, и в
 * нишу уже двух радиусов (закуток у балкона 0,27 × 0,73) или в карман за
 * рамкой окна её ядро не заходит. Свободный кусок бумаги, окружённый
 * чернилами и одной комнатой, — часть этой комнаты, если он к ней выходит
 * широкой стороной и невелик. Кусок, что касается двух комнат, поля или
 * края листа, — проём или улица; выход в щель — полость в пустой стене или
 * квадратик штриховки: их не трогаем.
 */
export function fillPockets(owner: Int32Array, d2: Float32Array, w: number, h: number, maxArea: number): void {
  // Пиксель, что стал чьим при росте по стеновым линиям, а по всей графике —
  // чернила (цифра), свободным не считается: закуток ограничивают все линии
  const seen = new Uint8Array(w * h)
  const queue = new Int32Array(w * h)
  for (let start = 0; start < owner.length; start++) {
    if (owner[start] !== 0 || d2[start] === 0 || seen[start]) continue
    let head = 0
    let tail = 0
    queue[tail++] = start
    seen[start] = 1
    let only = 0
    let mixed = false
    let contact = 0
    let x1 = w
    let y1 = h
    let x2 = 0
    let y2 = 0
    while (head < tail) {
      const i = queue[head++]
      const x = i % w
      const y = (i - x) / w
      if (x < x1) x1 = x
      if (x > x2) x2 = x
      if (y < y1) y1 = y
      if (y > y2) y2 = y
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) mixed = true
      const look = (j: number) => {
        const o = owner[j]
        if (o === 0) {
          if (d2[j] !== 0 && !seen[j]) (seen[j] = 1), (queue[tail++] = j)
          return
        }
        if (o < 0 || (only && o !== only)) mixed = true
        else (only = o), contact++
      }
      if (x > 0) look(i - 1)
      if (x < w - 1) look(i + 1)
      if (y > 0) look(i - w)
      if (y < h - 1) look(i + w)
    }
    const span = Math.max(x2 - x1 + 1, y2 - y1 + 1)
    if (!mixed && only && tail <= maxArea && contact >= Math.max(6, 0.4 * span)) for (let k = 0; k < tail; k++) owner[queue[k]] = only
  }
}

/** прочие области разметки после роста — ничьи */
function releaseNobody(owner: Int32Array): void {
  for (let i = 0; i < owner.length; i++) if (owner[i] < 0) owner[i] = 0
}

/**
 * Внешний контур области по границам пикселей. Вершины — углы пикселей
 * (пиксель x,y занимает квадрат x..x+1, y..y+1), только там, где контур
 * поворачивает. Обход — область справа по ходу; на экране (ось y вниз) это
 * по часовой стрелке и положительная площадь. Дыры внутри не обходятся.
 */
export function traceOutline(owner: Int32Array, w: number, h: number, k: number, start: number): Pt[] {
  const inR = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && owner[y * w + x] === k
  // направления: 0 вправо, 1 вниз, 2 влево, 3 вверх
  const DX = [1, 0, -1, 0]
  const DY = [0, 1, 0, -1]
  // пиксели впереди слева и справа от угла x,y при движении в направлении d
  const ahead = (x: number, y: number, d: number): [boolean, boolean] => {
    switch (d) {
      case 0:
        return [inR(x, y - 1), inR(x, y)]
      case 1:
        return [inR(x, y), inR(x - 1, y)]
      case 2:
        return [inR(x - 1, y), inR(x - 1, y - 1)]
      default:
        return [inR(x - 1, y - 1), inR(x, y - 1)]
    }
  }
  const sx = start % w
  const sy = (start - sx) / w
  let x = sx
  let y = sy
  let d = 0
  const out: Pt[] = []
  // первый пиксель по строкам — верхний левый: угол над ним принадлежит контуру один раз
  for (let guard = 0; guard < 4 * w * h + 8; guard++) {
    const [left, right] = ahead(x, y, d)
    // области по диагонали не соединяются: контур четырёхсвязный
    const nd = !right ? (d + 1) % 4 : left ? (d + 3) % 4 : d
    if (nd !== d) out.push({ x, y })
    d = nd
    x += DX[d]
    y += DY[d]
    if (x === sx && y === sy) {
      if (d !== 0) out.push({ x: sx, y: sy })
      break
    }
  }
  return out
}

const edgeLen = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

/** убрать совпавшие точки и вершины посреди прямой */
function tidy(pts: Pt[]): Pt[] {
  let cur = pts
  for (let pass = 0; pass < 8; pass++) {
    const out: Pt[] = []
    for (const p of cur) if (!out.length || edgeLen(out[out.length - 1], p) > 1e-9) out.push({ x: p.x, y: p.y })
    while (out.length > 1 && edgeLen(out[0], out[out.length - 1]) <= 1e-9) out.pop()
    const kept: Pt[] = []
    const n = out.length
    for (let i = 0; i < n; i++) {
      const a = out[(i - 1 + n) % n]
      const b = out[i]
      const c = out[(i + 1) % n]
      const straight = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)
      if (!straight) kept.push(b)
    }
    if (kept.length === cur.length) return kept
    cur = kept
  }
  return cur
}

/**
 * Прямые углы без мелочи: ступеньки, язычки в дверных проёмах и зазубрины
 * короче minEdge убираются, начиная с самой короткой. Ступенька — две
 * параллельные стороны, идущие в одну сторону: они сводятся на линию длинной.
 * Острый выступ или узкая щель (стороны навстречу друг другу) срезаются по
 * короткой из боковых сторон.
 */
export function simplifyOrthogonal(poly: Pt[], minEdge: number): Pt[] {
  let pts = tidy(poly)
  for (let guard = 0; guard < 4 * poly.length + 8 && pts.length > 4; guard++) {
    const n = pts.length
    let i = -1
    let shortest = minEdge
    for (let k = 0; k < n; k++) {
      const L = edgeLen(pts[k], pts[(k + 1) % n])
      if (L < shortest) (shortest = L), (i = k)
    }
    if (i < 0) break
    const ip = (i - 1 + n) % n
    const ia = i
    const ib = (i + 1) % n
    const inx = (i + 2) % n
    const p0 = pts[ip]
    const a = pts[ia]
    const b = pts[ib]
    const n1 = pts[inx]
    const next = pts.map((p) => ({ ...p }))
    // короткая сторона горизонтальна — соседние вертикальны, и наоборот
    const horizontal = a.y === b.y
    const c = horizontal ? 'y' : 'x'
    const dirP = Math.sign(a[c] - p0[c])
    const dirN = Math.sign(n1[c] - b[c])
    const lenP = Math.abs(a[c] - p0[c])
    const lenN = Math.abs(n1[c] - b[c])
    const along = horizontal ? 'x' : 'y'
    if (dirP === dirN) {
      // ступенька: обе соседние стороны — на линию длинной
      const v = lenP >= lenN ? a[along] : b[along]
      next[ip][along] = v
      next[ia][along] = v
      next[ib][along] = v
      next[inx][along] = v
    } else {
      // выступ или щель шириной в короткую сторону: срезать на глубину короткой из боковых
      const depth = Math.min(lenP, lenN)
      const v = a[c] - dirP * depth
      next[ia][c] = v
      next[ib][c] = v
    }
    const tidied = tidy(next)
    // на всякий случай: упрощение не должно выворачивать контур
    if (tidied.length < 4 || polyArea(tidied) <= 0) break
    pts = tidied
  }
  return pts
}

/**
 * Мелкие выступы наружу — не комната. Область дорастает до стен на closePx,
 * и в дверном проёме, в нише окна или под батареей она заходит в толщу стены
 * язычком. Выступ наружу не глубже maxDepth срезается по линии грани; вырезы
 * внутрь (колонна, короб шахты) остаются — это стены, заходящие в комнату.
 * С wallAt язычок срезается, только если он проходит сквозь стену: по обе
 * стороны от его основания за гранью комнаты — стена. Отсек ниши между
 * выносными линиями размеров («1,29» и «0,68» в нише прихожей) — не язычок:
 * рядом с его основанием бумага и цифры.
 */
export function cutBumps(poly: Pt[], maxDepth: number, tol: number, wallAt?: (x: number, y: number) => boolean): Pt[] {
  let pts = tidy(poly)
  const area0 = polyArea(pts)
  for (let guard = 0; guard < 2 * poly.length + 8 && pts.length > 4; guard++) {
    const n = pts.length
    let cut: Pt[] | null = null
    for (let i = 0; i < n && !cut; i++) {
      const p0 = pts[(i - 1 + n) % n]
      const a = pts[i]
      const b = pts[(i + 1) % n]
      const n1 = pts[(i + 2) % n]
      const horizontal = a.y === b.y
      const c = horizontal ? 'y' : 'x'
      const dirP = Math.sign(a[c] - p0[c])
      const dirN = Math.sign(n1[c] - b[c])
      if (dirP !== -dirN) continue
      // куда смотрит наружу эта сторона: область справа по ходу
      const out = horizontal ? (b.x > a.x ? -1 : 1) : b.y > a.y ? 1 : -1
      if (dirP !== out) continue
      const lenP = Math.abs(a[c] - p0[c])
      const lenN = Math.abs(n1[c] - b[c])
      // выступ возвращается на ту же линию, с которой вышел: язычок на грани, а не угол комнаты
      if (Math.abs(lenP - lenN) > tol) continue
      const depth = Math.min(lenP, lenN)
      if (depth > maxDepth) continue
      const v = a[c] - dirP * depth
      if (wallAt && !throughWall(a, b, horizontal, v, out, wallAt)) continue
      const next = pts.map((p) => ({ ...p }))
      next[i][c] = v
      next[(i + 1) % n][c] = v
      const tidied = tidy(next)
      // срез не должен съесть комнату: это язычок, а не её половина
      if (tidied.length >= 4 && polyArea(tidied) >= area0 * 0.75) cut = tidied
    }
    if (!cut) break
    pts = cut
  }
  return pts
}

/**
 * Вырезы внутрь без стены — не стена. Подпись у стены в узком закутке
 * («0,73» в нише у балкона) заслоняет от роста клочок бумаги, и контур
 * огибает цифру зазубриной. Колонна или короб шахты нарисованы стеновыми
 * линиями, дверь в соседнюю комнату — это чужая область; вырез, где нет ни
 * того ни другого, закрывается по линии стены. У самой стены (устье выреза,
 * две линии пикселей) неровная грань не в счёт.
 */
export function fillDents(poly: Pt[], maxDepth: number, blocked: (x: number, y: number) => boolean): Pt[] {
  let pts = tidy(poly)
  for (let guard = 0; guard < 2 * poly.length + 8 && pts.length > 4; guard++) {
    const n = pts.length
    let fill: Pt[] | null = null
    for (let i = 0; i < n && !fill; i++) {
      const p0 = pts[(i - 1 + n) % n]
      const a = pts[i]
      const b = pts[(i + 1) % n]
      const n1 = pts[(i + 2) % n]
      const horizontal = a.y === b.y
      const c = horizontal ? 'y' : 'x'
      const along = horizontal ? 'x' : 'y'
      const dirP = Math.sign(a[c] - p0[c])
      const dirN = Math.sign(n1[c] - b[c])
      const out = horizontal ? (b.x > a.x ? -1 : 1) : b.y > a.y ? 1 : -1
      // Ступенька в углу: обе боковые идут в одну сторону, и сторона a–b —
      // её площадка. Цифры «0,68», лежащие на стене ниши, не пускают рост
      // области в угол, и остаётся вмятина в 7 см — по ней строилась
      // лесенка. Площадка сдвигается наружу до уровня соседней стороны, если
      // между ними нет стены (одна бумага и цифры): настоящий уступ ограничен
      // стеновой линией и остаётся
      if (dirP === dirN && dirP !== 0) {
        // за подступенком грань идёт дальше в ту же сторону, что площадка, —
        // иначе это бок выреза-корыта, его закрывает правило ниже
        const step = Math.sign(b[along] - a[along])
        const beyond = dirN === out ? pts[(i + 3) % n] : pts[(i - 2 + n) % n]
        const from = dirN === out ? n1 : p0
        const cont = dirN === out ? Math.sign(beyond[along] - from[along]) : Math.sign(from[along] - beyond[along])
        if (cont !== step) continue
        const rise = dirN === out ? Math.abs(n1[c] - b[c]) : Math.abs(a[c] - p0[c])
        if (rise > maxDepth || edgeLen(a, b) > 2 * maxDepth) continue
        const v = a[c] + out * rise
        const lo = Math.min(a[along], b[along])
        const hi = Math.max(a[along], b[along])
        const c1 = out > 0 ? a[c] : v + 2
        const c2 = out > 0 ? v - 2 : a[c]
        let wall = false
        for (let s = lo; s < hi && !wall; s++) for (let t = c1; t < c2 && !wall; t++) wall = horizontal ? blocked(s, t) : blocked(t, s)
        if (wall) continue
        const next = pts.map((p) => ({ ...p }))
        next[i][c] = v
        next[(i + 1) % n][c] = v
        const tidied = tidy(next)
        if (tidied.length >= 4 && polyArea(tidied) > 0 && Math.abs(polyArea(tidied)) >= Math.abs(polyArea(pts))) fill = tidied
        continue
      }
      if (dirP !== -dirN) continue
      // вырез: боковая сторона уходит внутрь комнаты, дно выреза — сторона a–b
      if (dirP !== -out) continue
      const depth = Math.min(Math.abs(a[c] - p0[c]), Math.abs(n1[c] - b[c]))
      if (depth > maxDepth || edgeLen(a, b) > 2 * maxDepth) continue
      const v = a[c] + out * depth
      const lo = Math.min(a[along], b[along])
      const hi = Math.max(a[along], b[along])
      // пиксели выреза: от дна до устья, без двух линий у устья
      const c1 = out > 0 ? a[c] : v + 2
      const c2 = out > 0 ? v - 2 : a[c]
      let wall = false
      for (let s = lo; s < hi && !wall; s++) for (let t = c1; t < c2 && !wall; t++) wall = horizontal ? blocked(s, t) : blocked(t, s)
      if (wall) continue
      const next = pts.map((p) => ({ ...p }))
      next[i][c] = v
      next[(i + 1) % n][c] = v
      const tidied = tidy(next)
      if (tidied.length >= 4 && polyArea(tidied) > 0) fill = tidied
    }
    if (!fill) break
    pts = fill
  }
  return pts
}

/**
 * Основание язычка лежит на стене: за гранью комнаты по обе стороны от
 * язычка (в двух–восьми точках от его боков) — чернила стены
 */
function throughWall(a: Pt, b: Pt, horizontal: boolean, v: number, out: number, wallAt: (x: number, y: number) => boolean): boolean {
  const lo = Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y)
  const hi = Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y)
  const side = (from: number, to: number) => {
    let n = 0
    let hit = 0
    for (let t = from; t <= to; t++) {
      n++
      let ink = false
      for (let k = 1; k <= 3 && !ink; k++) {
        const c = out > 0 ? v + k - 1 : v - k
        ink = horizontal ? wallAt(t, c) : wallAt(c, t)
      }
      if (ink) hit++
    }
    return n > 0 && hit >= 0.5 * n
  }
  return side(lo - 8, lo - 2) && side(hi + 1, hi + 7)
}

/** контур области с картинки, пиксели; площадь и рамка — по нему */
export interface Outline {
  poly: Pt[]
  areaPx: number
  box: { x1: number; y1: number; x2: number; y2: number }
}

/**
 * Контуры всех областей: дорастить до стен, обвести, выпрямить. minEdge —
 * мельче этого ступеньки считаются неровностью линий, а не выступом стены.
 */
export function outlineRegions(labels: Int32Array, ids: number[], d2: Float32Array, w: number, h: number, closePx: number, ignore?: Set<number>, inkD2?: Float32Array): { outlines: (Outline | null)[]; owner: Int32Array } {
  const owner = growRegions(labels, ids, d2, w, h, closePx + 2, ignore)
  // закутки ищутся по всей графике: у квадратика штриховки в стене короткая
  // сторона стёрта из стеновых линий вместе с цифрами, но на картинке она есть
  fillPockets(owner, inkD2 ?? d2, w, h, 3 * closePx * closePx)
  releaseNobody(owner)
  // Кусок, отрезанный от поля листа, может нести с собой обрывки поля с той же
  // меткой: обводим самый большой связный кусок области, остальное — ничьё
  const first = new Int32Array(ids.length + 1).fill(-1)
  const size = new Int32Array(ids.length + 1)
  const comp = new Int32Array(w * h).fill(-1)
  const queue = new Int32Array(w * h)
  const starts: number[] = []
  for (let i = 0; i < owner.length; i++) {
    const k = owner[i]
    if (k <= 0 || comp[i] >= 0) continue
    const c = starts.length
    starts.push(i)
    let head = 0
    let tail = 0
    queue[tail++] = i
    comp[i] = c
    while (head < tail) {
      const j = queue[head++]
      const x = j % w
      const y = (j - x) / w
      if (x > 0 && owner[j - 1] === k && comp[j - 1] < 0) (comp[j - 1] = c), (queue[tail++] = j - 1)
      if (x < w - 1 && owner[j + 1] === k && comp[j + 1] < 0) (comp[j + 1] = c), (queue[tail++] = j + 1)
      if (y > 0 && owner[j - w] === k && comp[j - w] < 0) (comp[j - w] = c), (queue[tail++] = j - w)
      if (y < h - 1 && owner[j + w] === k && comp[j + w] < 0) (comp[j + w] = c), (queue[tail++] = j + w)
    }
    if (tail > size[k]) (size[k] = tail), (first[k] = i)
  }
  for (let i = 0; i < owner.length; i++) if (owner[i] > 0 && starts[comp[i]] !== first[owner[i]]) owner[i] = 0
  // ступенька мельче шестой части радиуса (≈ 7 см) — неровность линии; выступ
  // наружу не глубже радиуса — язычок в проёме или нише окна
  const minEdge = Math.max(4, Math.round(0.15 * closePx))
  const outlines = ids.map((_, k) => {
    if (first[k + 1] < 0) return null
    const raw = traceOutline(owner, w, h, k + 1, first[k + 1])
    // в вырезе стена — чернила стеновых линий или чужая область
    const blocked = (x: number, y: number) => x < 0 || y < 0 || x >= w || y >= h || d2[y * w + x] === 0 || (owner[y * w + x] > 0 && owner[y * w + x] !== k + 1)
    const wallAt = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d2[y * w + x] === 0
    const bare = simplifyOrthogonal(cutBumps(simplifyOrthogonal(raw, minEdge), closePx, minEdge, wallAt), minEdge)
    const poly = simplifyOrthogonal(fillDents(bare, closePx, blocked), minEdge)
    if (poly.length < 4) return null
    const xs = poly.map((p) => p.x)
    const ys = poly.map((p) => p.y)
    return { poly, areaPx: Math.abs(polyArea(poly)), box: { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) } }
  })
  return { outlines, owner }
}

/**
 * Точка на стороне комнаты-многоугольника: side — какая сторона, at — доля
 * вдоль всей комнаты. У Г-образной комнаты правая сторона — это несколько
 * граней на разной глубине: берётся та, что лежит напротив этой доли, и из
 * таких — крайняя. Так дверь «справа внизу» встаёт в стену выреза, а не в
 * пустоту рамки.
 */
export function pointOnOutline(poly: Pt[], side: AiSide, at: number): Pt {
  const t = Math.min(1, Math.max(0, at))
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  const x1 = Math.min(...xs)
  const x2 = Math.max(...xs)
  const y1 = Math.min(...ys)
  const y2 = Math.max(...ys)
  const vertical = side === 'left' || side === 'right'
  const along = vertical ? y1 + (y2 - y1) * t : x1 + (x2 - x1) * t
  // обход с областью справа (положительная площадь на экране) или наоборот
  const cw = polyArea(poly) > 0 ? 1 : -1
  let best: { at: number; d: number } | null = null
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (vertical ? a.x !== b.x : a.y !== b.y) continue
    // куда смотрит грань наружу
    const out = (vertical ? (b.y > a.y ? 1 : -1) : b.x > a.x ? -1 : 1) * cw
    const want = side === 'right' || side === 'bottom' ? 1 : -1
    if (out !== want) continue
    const lo = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x)
    const hi = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x)
    const d = along < lo ? lo - along : along > hi ? along - hi : 0
    const coord = vertical ? a.x : a.y
    // ближе к доле; при равенстве — крайняя грань этой стороны
    if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && (coord - best.at) * want > 0)) best = { at: coord, d }
  }
  const c = best ? best.at : side === 'left' ? x1 : side === 'right' ? x2 : side === 'top' ? y1 : y2
  return vertical ? { x: c, y: along } : { x: along, y: c }
}

// ---------- стены из граней комнат ----------

export interface PictureRoom {
  name: string
  kind?: string
  /** контур по внутренним граням стен, пиксели картинки */
  poly: Pt[]
  wantM2?: number
}

export interface PictureOptions {
  /** толщина перегородки, если между гранями нет чернил, см */
  interiorCm: number
  /** толщина наружной стены, если по картинке она не измерилась, см */
  exteriorCm: number
  /** шире — между гранями не стена, а что-то ещё (шахта, неопознанное помещение), см */
  maxGapCm?: number
}

/** грань комнаты: сторона контура */
interface Face {
  room: number
  vertical: boolean
  /** координата грани: x у вертикальной, y у горизонтальной */
  at: number
  lo: number
  hi: number
  /** куда смотрит наружу: +1 — в сторону больших координат */
  out: 1 | -1
  /** обход идёт в сторону больших координат */
  forward: boolean
}

/** кусок грани с одним соседом (или без соседа): своя ось стены и толщина */
interface Piece {
  s: number
  e: number
  partner: number
  axis: number
  t: number
}

function facesOf(poly: Pt[], room: number): Face[] {
  const out: Face[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (a.x === b.x) {
      // вниз — область слева по экрану, грань правая
      const down = b.y > a.y
      out.push({ room, vertical: true, at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), out: down ? 1 : -1, forward: down })
    } else {
      const right = b.x > a.x
      out.push({ room, vertical: false, at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), out: right ? -1 : 1, forward: right })
    }
  }
  return out
}

/** толщина наружной стены по чернилам за гранью, пиксели; null — не измерилась */
function inkRun(d2: Float32Array, w: number, h: number, f: Face, s: number, e: number): number | null {
  const limit = Math.max(20, Math.round(Math.min(w, h) * 0.08))
  const runs: number[] = []
  const n = Math.min(9, Math.max(1, Math.floor((e - s) / 3)))
  for (let k = 1; k <= n; k++) {
    const t = Math.floor(s + ((e - s) * k) / (n + 1))
    // первый пиксель снаружи грани
    let x = f.vertical ? (f.out > 0 ? f.at : f.at - 1) : t
    let y = f.vertical ? t : f.out > 0 ? f.at : f.at - 1
    const dx = f.vertical ? f.out : 0
    const dy = f.vertical ? 0 : f.out
    const inside = () => x >= 0 && y >= 0 && x < w && y < h
    const ink = () => d2[y * w + x] === 0
    let skip = 0
    while (skip < 3 && inside() && !ink()) (x += dx), (y += dy), skip++
    if (!inside() || !ink()) continue
    let run = 0
    while (inside() && ink() && run <= limit) (x += dx), (y += dy), run++
    if (!inside() || run > limit) continue
    runs.push(run)
  }
  if (runs.length < Math.min(3, n)) return null
  runs.sort((a, b) => a - b)
  return runs[Math.floor(runs.length / 2)]
}

/**
 * Грани всех комнат и их куски по соседям: где грань смотрит на грань другой
 * комнаты через полосу не шире maxGap (стену), там у куска есть сосед.
 */
function pairFaces(polys: Pt[][], maxGap: number, joinPx: number): { faces: Face[][]; all: Face[]; pieces: Piece[][] } {
  const faces = polys.map((poly, k) => facesOf(poly, k))
  const all = faces.flat()
  // шахта или неопознанное помещение между гранями: тогда это не одна стена
  const between = (f: Face, g: Face, lo: number, hi: number): boolean => {
    const mid = (f.at + g.at) / 2
    if (Math.abs(g.at - f.at) < 4) return false
    for (let k = 1; k <= 3; k++) {
      const t = lo + ((hi - lo) * k) / 4
      const p = f.vertical ? { x: mid, y: t } : { x: t, y: mid }
      if (polys.some((poly, i) => i !== f.room && i !== g.room && pointInPoly(p, poly))) return true
    }
    return false
  }

  // каждая грань — на куски по соседям
  const pieces: Piece[][] = all.map((f) => {
    const cands = all.filter((g) => g.room !== f.room && g.vertical === f.vertical && g.out === -f.out && (g.at - f.at) * f.out >= -0.5 && (g.at - f.at) * f.out <= maxGap && Math.min(f.hi, g.hi) - Math.max(f.lo, g.lo) > 0)
    const cuts = new Set<number>([f.lo, f.hi])
    for (const g of cands) {
      if (g.lo > f.lo && g.lo < f.hi) cuts.add(g.lo)
      if (g.hi > f.lo && g.hi < f.hi) cuts.add(g.hi)
    }
    const xs = [...cuts].sort((a, b) => a - b)
    const out: Piece[] = []
    for (let m = 0; m + 1 < xs.length; m++) {
      const a = xs[m]
      const b = xs[m + 1]
      let best = -1
      let gap = Infinity
      for (const g of cands) {
        if (g.lo > a + 1e-9 || g.hi < b - 1e-9) continue
        const d = Math.abs(g.at - f.at)
        if (d < gap && !between(f, g, a, b)) (gap = d), (best = all.indexOf(g))
      }
      // соседство на пару пикселей — это касание углами, а не общая стена
      out.push({ s: a, e: b, partner: b - a < 3 ? -1 : best, axis: 0, t: 0 })
    }
    // Короткий кусок без соседа между стенами — торец поперечной стены: грань
    // комнаты проходит мимо него на её толщину. Это продолжение соседней
    // стены, а не наружная стена с уступом
    for (let m = 0; m < out.length; m++) {
      const p = out[m]
      if (p.partner >= 0 || p.e - p.s > joinPx) continue
      const nb = [out[m - 1], out[m + 1]].filter((q) => q && q.partner >= 0).sort((x, y) => y.e - y.s - (x.e - x.s))[0]
      if (nb) p.partner = nb.partner
    }
    const merged: Piece[] = []
    for (const p of out) {
      const last = merged[merged.length - 1]
      if (last && last.partner === p.partner) last.e = p.e
      else merged.push(p)
    }
    return merged
  })

  return { faces, all, pieces }
}

/** проём, найденный по картинке, пиксели */
export interface PictureOpening {
  kind: 'door' | 'window'
  /** комнаты, которые он соединяет (у окна — одна) */
  rooms: number[]
  /** стена вертикальная: проём идёт вдоль y */
  vertical: boolean
  /** середина стены поперёк, px */
  axis: number
  /** от и до вдоль стены, px */
  from: number
  to: number
  /** у окна — в какой стене комнаты оно */
  side?: AiSide
}

/**
 * Двери и окна по картинке. Модель со зрением их на плане БТИ находит через раз,
 * а нарисованы они однозначно — в стене между двумя комнатами:
 * - разрыв: поперёк стены нет ни одной точки чернил;
 * - на плане БТИ чаще — участок стены, закрытый с концов тонкими поперечными
 *   чёрточками: стена там нарисована пустым прямоугольником шириной в дверь.
 *   Чёрточки у Т-стыков стоят парой на толщину стены, у двери — на её ширину.
 * Ширина двери — от 55 до 130 см.
 *
 * Окна — в наружной стене. Стена на плане БТИ — две линии с пустотой между
 * ними; на окне внутри идут ещё линии стекла, сплошные во всю его длину, а с
 * концов окно закрыто поперечными чертами через всю толщину стены. Штриховка
 * квадратиками даёт линии в пару сантиметров, вентканал внутри стены не
 * касается её граней — ни то, ни другое окном не считается. У сплошной стены
 * окно — участок, где заливка прервана и остались одни линии.
 */
export function detectOpenings(polys: Pt[][], d2: Float32Array, w: number, h: number, cmPerPx: number): PictureOpening[] {
  const maxGap = 110 / cmPerPx
  const joinPx = Math.max(4, 60 / cmPerPx)
  const minDoor = 55 / cmPerPx
  const maxDoor = 130 / cmPerPx
  const { all, pieces } = pairFaces(polys, maxGap, joinPx)
  const ink = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d2[y * w + x] === 0
  const out: PictureOpening[] = []
  // Общая стена двух комнат — все её куски разом: дверь, нарисованная
  // бледнее стены, даёт на грани комнаты уступ и режет стену на два куска
  interface Span {
    rooms: [number, number]
    vertical: boolean
    lo: number
    hi: number
    a: number
    b: number
  }
  const spans: Span[] = []
  all.forEach((f, fi) => {
    for (const p of pieces[fi]) {
      if (p.partner < 0) continue
      const g = all[p.partner]
      // каждую стену — один раз, от комнаты с меньшим номером
      if (g.room < f.room) continue
      const lo = Math.round(Math.min(f.at, g.at))
      const hi = Math.round(Math.max(f.at, g.at))
      if (hi - lo < 2) continue
      const a = Math.ceil(Math.max(p.s, g.lo))
      const b = Math.floor(Math.min(p.e, g.hi))
      if (b <= a) continue
      const same = spans.find((x) => x.rooms[0] === f.room && x.rooms[1] === g.room && x.vertical === f.vertical && Math.min(x.hi, hi) - Math.max(x.lo, lo) > -3 && Math.max(x.a, a) - Math.min(x.b, b) <= maxDoor)
      if (same) {
        same.lo = Math.min(same.lo, lo)
        same.hi = Math.max(same.hi, hi)
        same.a = Math.min(same.a, a)
        same.b = Math.max(same.b, b)
      } else spans.push({ rooms: [f.room, g.room], vertical: f.vertical, lo, hi, a, b })
    }
  })
  for (const { rooms: pair, vertical, lo, hi, a: a0, b: b0 } of spans) {
    const gap = hi - lo
    if (b0 - a0 < minDoor) continue
    // Профиль стены — с запасом в пять точек за концами общей грани: черта
    // двери у самого угла (дверь 4ж–прихожая упирается в перегородку) на
    // выпрямленном снимке уходит на точку-другую за конец грани
    const ext = 5
    const a = Math.max(0, a0 - ext)
    const b = Math.min(vertical ? h : w, b0 + ext)
    const across: number[] = []
    for (let t = a; t < b; t++) {
      let n = 0
      for (let c = lo; c < hi; c++) if (vertical ? ink(c, t) : ink(t, c)) n++
      across.push(n)
    }
    const push = (from: number, to: number) => out.push({ kind: 'door', rooms: [pair[0], pair[1]], vertical, axis: (lo + hi) / 2, from, to })
    // 1. разрыв: поперёк стены пусто
    for (let k = 0; k < across.length; ) {
      if (across[k] !== 0) {
        k++
        continue
      }
      let m = k
      while (m < across.length && across[m] === 0) m++
      if (m - k >= minDoor && m - k <= maxDoor) push(a + k, a + m)
      k = m
    }
    // 2. пустой прямоугольник между поперечными чертами: только у стены,
    //    нарисованной двумя линиями (у сплошной поперёк залито везде).
    //    Черта — заметно больше чернил поперёк стены, чем обычно у этой
    //    стены: хотя бы на полпути к сплошному. До самих граней она не
    //    доходит — грань стоит на пиксель-два от линии, а на снятом с экрана
    //    фото черты ещё и бледнее
    const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)]
    const usual = median(across)
    const full = across.map((n) => n >= usual + 0.4 * (gap - usual) && n > usual)
    const solid = across.filter((n) => n >= gap - 1).length / Math.max(1, across.length)
    if (solid > 0.5) continue
    const ticks: { from: number; to: number; peak: number }[] = []
    for (let k = 0; k < full.length; ) {
      if (!full[k]) {
        k++
        continue
      }
      let m = k
      while (m < full.length && full[m]) m++
      // ширина черты — по её ядру у пика: на размытой картинке к черте
      // липнет ореол, и она выходит толще стены
      const peak = Math.max(...across.slice(k, m))
      const core = usual + 0.7 * (peak - usual)
      let from = k
      while (across[from] < core) from++
      let to = m
      while (across[to - 1] < core) to--
      // черта с провалом в пиксель — одна черта
      const prev = ticks[ticks.length - 1]
      if (prev && from - prev.to <= 2) (prev.to = to), (prev.peak = Math.max(prev.peak, peak))
      else ticks.push({ from, to, peak })
      k = m
    }
    // черта, упёртая в край запаса, — край поперечной стены, а не черта двери
    for (let k = ticks.length - 1; k >= 0; k--) {
      const t = ticks[k]
      if ((t.from === 0 && a < a0) || (t.to === full.length && b > b0)) ticks.splice(k, 1)
    }
    const thin = Math.max(5, 0.6 * gap)
    for (let k = 0; k + 1 < ticks.length; k++) {
      const t0 = ticks[k]
      const t1 = ticks[k + 1]
      // черта тонкая; толстая поперечина — это стена, упёршаяся в эту
      if (t0.to - t0.from > thin || t1.to - t1.from > thin) continue
      const span = t1.to - t0.from
      if (span < minDoor || span > maxDoor) continue
      // внутри двери — две линии стены, не разрыв (он найден выше), и черты
      // над ними выделяются резко: шум на плотной стене так не выглядит
      const inside = across.slice(t0.to, t1.from)
      if (!inside.length || inside.some((n) => n === 0)) continue
      // На размытой картинке стена толще, и до полной черты места меньше:
      // хватит и половины свободного места, но не меньше пятой части стены
      const mid = median(inside)
      const rise = Math.min(t0.peak, t1.peak) - mid
      if (rise < Math.min(0.3 * gap, 0.5 * (gap - mid)) || rise < 0.2 * gap) continue
      push(a + t0.from, a + t1.to)
    }
  }
  // окна: куски граней без соседа — наружные стены
  const minWin = 50 / cmPerPx
  const maxWin = 300 / cmPerPx
  const D = Math.round(Math.min(90 / cmPerPx, 90))
  all.forEach((f, fi) => {
    for (const p of pieces[fi]) {
      if (p.partner >= 0) continue
      const a = Math.ceil(p.s)
      const b = Math.floor(p.e)
      if (b - a < minWin) continue
      // первый пиксель снаружи грани и шаг наружу
      const base = f.out > 0 ? f.at : f.at - 1
      const at = (t: number, d: number) => (f.vertical ? ink(base + f.out * d, t) : ink(t, base + f.out * d))
      const bits: Uint8Array[] = []
      const occ = new Float32Array(D)
      for (let t = a; t < b; t++) {
        const row = new Uint8Array(D)
        for (let d = 0; d < D; d++) if (at(t, d)) (row[d] = 1), occ[d]++
        bits.push(row)
      }
      for (let d = 0; d < D; d++) occ[d] /= bits.length
      // внутренняя линия стены — у самой грани; наружная — первая за ней
      // линия во всю длину стены (стекло занимает её часть, штриховка рвётся;
      // дальше бывает рамка листа — это уже не стена)
      let i0 = 0
      while (i0 < 4 && occ[i0] < 0.5) i0++
      if (i0 >= 4) continue
      let i1 = i0
      while (i1 + 1 < D && occ[i1 + 1] >= 0.5) i1++
      let o0 = i1 + 4
      while (o0 < D && occ[o0] < 0.8) o0++
      if (o0 >= D) continue
      let o1 = o0
      while (o1 + 1 < D && occ[o1 + 1] >= 0.5) o1++
      const inner = o0 - i1 - 1
      if (inner < 3) continue
      const full = bits.map((row) => {
        let n = 0
        for (let d = i0; d <= o1; d++) n += row[d]
        return n >= o1 - i0 + 1 - 2
      })
      const cand = bits.map((row) => {
        let n = 0
        for (let d = i1 + 1; d < o0; d++) n += row[d]
        return n > 0 && n < 0.8 * inner
      })
      for (let k = 0; k < cand.length; ) {
        if (!cand[k]) {
          k++
          continue
        }
        let m = k
        // пропуски в пару пикселей внутри окна — шум линии
        while (m < cand.length && (cand[m] || (m + 2 < cand.length && (cand[m + 1] || cand[m + 2])))) m++
        const len = m - k
        const closedAt = (i: number) => {
          for (let j = Math.max(0, i - 3); j <= Math.min(full.length - 1, i + 3); j++) if (full[j]) return true
          return false
        }
        if (len >= minWin && len <= maxWin && closedAt(k) && closedAt(m - 1)) {
          // линия стекла идёт во всю длину окна
          let glass = false
          for (let d = i1 + 1; d < o0 && !glass; d++) {
            let n = 0
            for (let t = k; t < m; t++) n += bits[t][d]
            glass = n >= 0.85 * len
          }
          const side: AiSide = f.vertical ? (f.out > 0 ? 'right' : 'left') : f.out > 0 ? 'bottom' : 'top'
          if (glass) out.push({ kind: 'window', rooms: [f.room], vertical: f.vertical, axis: base + f.out * ((i0 + o1) / 2), from: a + k, to: a + m, side })
        }
        k = m
      }
    }
  })
  // окно, разрезанное выносной линией размера или импостом, — одно окно
  const merged: PictureOpening[] = []
  for (const o of out) {
    const prev = merged.find((q) => q.kind === 'window' && o.kind === 'window' && q.rooms[0] === o.rooms[0] && q.vertical === o.vertical && Math.abs(q.axis - o.axis) < 3 && o.from - q.to <= 6 && o.to > q.to)
    if (prev) prev.to = o.to
    else merged.push({ ...o })
  }
  return merged
}

/**
 * Стены по граням комнат. Координаты граней — в пикселях картинки, на выходе
 * чертёж в сантиметрах поверх подложки u.
 */
export function wallsFromPicture(rooms: PictureRoom[], u: Underlay, d2: Float32Array | null, o: PictureOptions): ReconstructResult {
  const s = u.scale
  const W = u.px.w
  const H = u.px.h
  const maxGap = (o.maxGapCm ?? 110) / s
  const joinPx = Math.max(4, 60 / s)
  const defaultExt = o.exteriorCm / s
  const defaultInt = o.interiorCm / s
  const { faces, all, pieces } = pairFaces(rooms.map((r) => r.poly), maxGap, joinPx)

  // 2. ось и толщина каждого куска
  all.forEach((f, fi) => {
    for (const p of pieces[fi]) {
      if (p.partner >= 0) {
        const g = all[p.partner]
        const gapPx = Math.abs(g.at - f.at)
        p.t = gapPx >= 1 ? gapPx : defaultInt
        p.axis = (f.at + g.at) / 2
      } else {
        const run = d2 ? inkRun(d2, W, H, f, p.s, p.e) : null
        // двойная линия БТИ даёт тонкий штрих у грани: такой замер — не толщина стены
        p.t = run !== null && run >= 6 ? run : defaultExt
        p.axis = f.at + (f.out * p.t) / 2
      }
    }
  })

  // 3. оси, разошедшиеся на пару пикселей, — одна ось: так стены соседних
  //    комнат на одной линии не дают ступенек в сантиметр
  const snap = Math.max(1.5, 4 / s)
  for (const vertical of [true, false]) {
    const list: Piece[] = []
    all.forEach((f, fi) => {
      if (f.vertical === vertical) list.push(...pieces[fi])
    })
    list.sort((a, b) => a.axis - b.axis)
    let from = 0
    for (let k = 1; k <= list.length; k++) {
      if (k < list.length && list[k].axis - list[k - 1].axis <= snap && list[k].axis - list[from].axis <= 2 * snap) continue
      const group = list.slice(from, k)
      const len = group.reduce((a, p) => a + (p.e - p.s), 0)
      const axis = len ? group.reduce((a, p) => a + p.axis * (p.e - p.s), 0) / len : group[0].axis
      for (const p of group) p.axis = axis
      from = k
    }
  }

  // 4. контур комнаты по осям: угол — пересечение осей соседних граней,
  //    смена оси посреди грани — перемычка поперёк стены
  interface Seg {
    vertical: boolean
    axis: number
    lo: number
    hi: number
    t: number
  }
  const segs: Seg[] = []
  const push = (a: Pt, b: Pt, t: number) => {
    if (Math.abs(a.x - b.x) < 1e-6) {
      if (Math.abs(a.y - b.y) > 1e-6) segs.push({ vertical: true, axis: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), t })
    } else if (Math.abs(a.y - b.y) < 1e-6) segs.push({ vertical: false, axis: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), t })
  }
  const outlines: Pt[][] = []
  let base = 0
  rooms.forEach((r, k) => {
    const fs = faces[k]
    const n = fs.length
    const ordered = fs.map((f, i) => {
      const ps = pieces[base + i]
      return f.forward ? ps : [...ps].reverse()
    })
    const point = (f: Face, axis: number, along: number): Pt => (f.vertical ? { x: axis, y: along } : { x: along, y: axis })
    const corner = (i: number): Pt => {
      const a = fs[i]
      const b = fs[(i + 1) % n]
      const pa = ordered[i][ordered[i].length - 1]
      const pb = ordered[(i + 1) % n][0]
      return a.vertical ? { x: pa.axis, y: pb.axis } : { x: pb.axis, y: pa.axis }
    }
    const verts: Pt[] = []
    for (let i = 0; i < n; i++) {
      const f = fs[i]
      let cur = corner((i - 1 + n) % n)
      verts.push(cur)
      const ps = ordered[i]
      for (let j = 0; j < ps.length; j++) {
        const p = ps[j]
        const nextP = ps[j + 1]
        if (!nextP) {
          push(cur, corner(i), p.t)
          continue
        }
        const split = f.forward ? p.e : p.s
        const end = point(f, p.axis, split)
        push(cur, end, p.t)
        cur = end
        if (nextP.axis !== p.axis) {
          const jog = point(f, nextP.axis, split)
          push(cur, jog, Math.min(p.t, nextP.t))
          verts.push(cur, jog)
          cur = jog
        }
      }
    }
    outlines.push(verts)
    base += n
  })

  // 5. одинаковые куски стен от двух комнат — одна стена; толщина — большая из заявленных
  const groups = new Map<string, Seg[]>()
  for (const g of segs) {
    const key = `${g.vertical ? 'v' : 'h'}${g.axis.toFixed(4)}`
    ;(groups.get(key) ?? groups.set(key, []).get(key)!).push(g)
  }
  const toCm = (p: Pt): Pt => ({ x: u.x + p.x * s, y: u.y + p.y * s })
  const walls: Wall[] = []
  for (const list of groups.values()) {
    const cuts = [...new Set(list.flatMap((g) => [g.lo, g.hi]))].sort((a, b) => a - b)
    let run: { lo: number; hi: number; t: number } | null = null
    const flush = () => {
      if (!run) return
      const g = list[0]
      const a = g.vertical ? { x: g.axis, y: run.lo } : { x: run.lo, y: g.axis }
      const b = g.vertical ? { x: g.axis, y: run.hi } : { x: run.hi, y: g.axis }
      walls.push({ id: uid('w'), a: toCm(a), b: toCm(b), thickness: Math.max(4, Math.round(run.t * s)) })
      run = null
    }
    for (let m = 0; m + 1 < cuts.length; m++) {
      const a = cuts[m]
      const b = cuts[m + 1]
      const mid = (a + b) / 2
      const cover = list.filter((g) => g.lo <= mid && g.hi >= mid)
      if (!cover.length) {
        flush()
        continue
      }
      const t = Math.max(...cover.map((g) => g.t))
      if (run && Math.abs(run.t - t) < 1e-6 && Math.abs(run.hi - a) < 1e-6) run.hi = b
      else {
        flush()
        run = { lo: a, hi: b, t }
      }
    }
    flush()
  }

  // 6. комнаты по контуру и сверка площадей с подписями
  const { rooms: built } = buildRooms({ version: 1, name: '', walls, openings: [], furniture: [], rooms: [], dims: [], settings: { grid: 10 } })
  const taken = new Set<number>()
  const placed: PlacedRoom[] = rooms.map((r, k) => {
    const anchor = toCm(interiorPoint(r.poly))
    const xs = outlines[k].map((p) => p.x)
    const ys = outlines[k].map((p) => p.y)
    const rect = { x1: u.x + Math.min(...xs) * s, y1: u.y + Math.min(...ys) * s, x2: u.x + Math.max(...xs) * s, y2: u.y + Math.max(...ys) * s }
    const idx = built.findIndex((b, i) => !taken.has(i) && pointInPoly(anchor, b.polygon))
    if (idx >= 0) taken.add(idx)
    return { name: r.name, kind: r.kind, anchor, rect, outline: outlines[k].map(toCm), wantM2: r.wantM2, haveM2: idx >= 0 ? built[idx].area : undefined }
  })
  const checked = placed.filter((r) => r.wantM2 && r.haveM2 !== undefined) as (PlacedRoom & { wantM2: number; haveM2: number })[]
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
  return { walls, rooms: placed, skipped: [], dropped: [], doubtful: [], areaFit }
}
