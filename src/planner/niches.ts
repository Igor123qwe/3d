// Ниши комнаты: где «карман» просится под шкаф или гардеробную.
//
// Модель получает комнату списком углов и нишу в нём не видит — у пользователя
// углубление 83 × 258 см рядом с кроватью осталось пустым, а шкаф встал поперёк
// прохода. Здесь ниша находится геометрией: в комнате ищется самый большой
// прямоугольник — основная часть, — а прямоугольные остатки при нём и есть
// ниши. Открытая сторона ниши — та, что смотрит в основную часть.
import type { Pt } from './types'
import { pointInPoly } from './geometry'

export type NicheSide = 'left' | 'right' | 'top' | 'bottom'

export interface Niche {
  x0: number
  y0: number
  x1: number
  y1: number
  /** куда ниша открыта: 'left' — в сторону меньших x */
  open: NicheSide
  /** вдоль открытой стороны, см */
  width: number
  /** от открытой стороны до задней стены, см */
  depth: number
  /** в нише окно: высокий шкаф его закроет */
  window: boolean
}

export interface NicheOptions {
  /** центры дверей: ниша с дверью — это проход, а не ниша */
  doors?: Pt[]
  windows?: Pt[]
  /** шаг сетки, см */
  cell?: number
}

/** стены комнаты только вдоль осей — иначе прямоугольники не про неё */
const orthogonal = (poly: Pt[]) =>
  poly.every((a, i) => {
    const b = poly[(i + 1) % poly.length]
    return Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1
  })

/** самый большой прямоугольник из заполненных клеток: по строкам, как гистограмма */
function largestRect(grid: boolean[][], nx: number, ny: number): { i0: number; i1: number; j0: number; j1: number } | null {
  const h = new Array<number>(nx).fill(0)
  let best: { area: number; i0: number; i1: number; j0: number; j1: number } | null = null
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) h[i] = grid[j][i] ? h[i] + 1 : 0
    const stack: number[] = []
    for (let i = 0; i <= nx; i++) {
      const cur = i === nx ? 0 : h[i]
      while (stack.length && h[stack[stack.length - 1]] >= cur) {
        const top = stack.pop()!
        const height = h[top]
        const left = stack.length ? stack[stack.length - 1] + 1 : 0
        const area = height * (i - left)
        if (height && (!best || area > best.area)) best = { area, i0: left, i1: i - 1, j0: j - height + 1, j1: j }
      }
      stack.push(i)
    }
  }
  return best
}

/** Ниши комнаты по её чистовому контуру */
export function findNiches(poly: Pt[], o: NicheOptions = {}): Niche[] {
  if (poly.length < 5 || !orthogonal(poly)) return []
  const cell = o.cell ?? 5
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  const X0 = Math.min(...xs)
  const Y0 = Math.min(...ys)
  const nx = Math.ceil((Math.max(...xs) - X0) / cell)
  const ny = Math.ceil((Math.max(...ys) - Y0) / cell)
  if (nx < 4 || ny < 4 || nx * ny > 250_000) return []
  const grid = Array.from({ length: ny }, (_, j) => Array.from({ length: nx }, (_, i) => pointInPoly({ x: X0 + (i + 0.5) * cell, y: Y0 + (j + 0.5) * cell }, poly)))
  const main = largestRect(grid, nx, ny)
  if (!main) return []
  const inMain = (i: number, j: number) => i >= main.i0 && i <= main.i1 && j >= main.j0 && j <= main.j1
  const total = grid.flat().filter(Boolean).length

  // остатки — связные куски вне основного прямоугольника
  const seen = grid.map((row) => row.map(() => false))
  const out: Niche[] = []
  // координата клетки → ближайшая координата контура: ниша 83 см, а не 85 по сетке
  const snap = (v: number, axis: 'x' | 'y') => {
    const vals = axis === 'x' ? xs : ys
    const near = vals.reduce((m, q) => (Math.abs(q - v) < Math.abs(m - v) ? q : m), vals[0])
    return Math.abs(near - v) <= cell ? near : v
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!grid[j][i] || inMain(i, j) || seen[j][i]) continue
      const cells: [number, number][] = []
      const queue: [number, number][] = [[i, j]]
      seen[j][i] = true
      while (queue.length) {
        const [ci, cj] = queue.pop()!
        cells.push([ci, cj])
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = ci + di
          const b = cj + dj
          if (a < 0 || b < 0 || a >= nx || b >= ny || seen[b][a] || !grid[b][a] || inMain(a, b)) continue
          seen[b][a] = true
          queue.push([a, b])
        }
      }
      const i0 = Math.min(...cells.map((c) => c[0]))
      const i1 = Math.max(...cells.map((c) => c[0]))
      const j0 = Math.min(...cells.map((c) => c[1]))
      const j1 = Math.max(...cells.map((c) => c[1]))
      // ниша — почти ровный прямоугольник, а не рваный остаток
      if (cells.length < 0.9 * (i1 - i0 + 1) * (j1 - j0 + 1)) continue
      if (cells.length > 0.45 * total) continue
      // какой стороной прилегает к основной части
      const overlapY = j0 <= main.j1 && j1 >= main.j0
      const overlapX = i0 <= main.i1 && i1 >= main.i0
      const open: NicheSide | null =
        i0 === main.i1 + 1 && overlapY ? 'left' : i1 === main.i0 - 1 && overlapY ? 'right' : j0 === main.j1 + 1 && overlapX ? 'top' : j1 === main.j0 - 1 && overlapX ? 'bottom' : null
      if (!open) continue
      const x0 = snap(X0 + i0 * cell, 'x')
      const x1 = snap(X0 + (i1 + 1) * cell, 'x')
      const y0 = snap(Y0 + j0 * cell, 'y')
      const y1 = snap(Y0 + (j1 + 1) * cell, 'y')
      const horizontal = open === 'left' || open === 'right'
      const depth = Math.round(horizontal ? x1 - x0 : y1 - y0)
      const width = Math.round(horizontal ? y1 - y0 : x1 - x0)
      // мельче 45 см — выступ стены, глубже 2,6 м — уже не ниша, а часть комнаты
      if (depth < 45 || depth > 260 || width < 80) continue
      const near = (p: Pt, m: number) => p.x >= x0 - m && p.x <= x1 + m && p.y >= y0 - m && p.y <= y1 + m
      // дверь в нише — значит, через неё ходят: это проход, шкаф туда нельзя
      if ((o.doors ?? []).some((p) => near(p, 25))) continue
      out.push({ x0, y0, x1, y1, open, width, depth, window: (o.windows ?? []).some((p) => near(p, 25)) })
    }
  }
  return out
}

/** Место в нише для предмета w×d: спинкой к задней стене, по центру ниши */
export function nicheSpot(n: Niche, w: number, d: number): { x: number; y: number; rot: number; w: number; d: number } {
  const cx = (n.x0 + n.x1) / 2
  const cy = (n.y0 + n.y1) / 2
  // rot — куда смотрит спинка: 0 — к верхней стене, 90 — к правой, 180 — к нижней, 270 — к левой
  switch (n.open) {
    case 'left':
      return { x: n.x1 - d / 2 - 0.5, y: cy, rot: 90, w, d }
    case 'right':
      return { x: n.x0 + d / 2 + 0.5, y: cy, rot: 270, w, d }
    case 'top':
      return { x: cx, y: n.y1 - d / 2 - 0.5, rot: 180, w, d }
    default:
      return { x: cx, y: n.y0 + d / 2 + 0.5, rot: 0, w, d }
  }
}

/** «нише 258 × 83 см» — для пояснений вида «в нише …» */
export const nicheText = (n: Niche): string => `нише ${n.width} × ${n.depth} см`
