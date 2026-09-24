// Выпрямить готовый чертёж. Снимок под углом разбирается как есть — по нему
// выверены двери, закутки и короба в стенах, а пересчёт картинки размывает
// тонкие черты. Выпрямляется результат: концы стен переводятся тем же
// преобразованием, что и картинка («По 4 углам» сам находит углы по точкам
// схода стен), и почти соосные стены сводятся на одну прямую. Так верхняя
// стена, которую каждая комната видела на своей высоте, становится одной.
import type { Plan, Pt, Wall } from './types'
import { buildRooms } from './rooms'
import { pointInPoly } from './geometry'

const key = (p: Pt) => `${Math.round(p.x * 2)}:${Math.round(p.y * 2)}`

/**
 * Перевести стены через map и выровнять: горизонтальные — строго
 * горизонтальны, вертикальные — строго вертикальны; прямые, что после
 * перевода разошлись меньше чем на tolCm, — одна прямая. Общие концы стен
 * остаются общими, конец стены, упёртой в середину другой (Т-стык), встаёт
 * на её линию. Косые стены только переводятся.
 */
export function rectifyWalls(walls: Wall[], map: (p: Pt) => Pt, tolCm = 6): Wall[] {
  if (!walls.length) return walls
  const nodes = new Map<string, { orig: Pt; at: Pt; x?: number; y?: number }>()
  const node = (p: Pt) => {
    const k = key(p)
    let n = nodes.get(k)
    if (!n) nodes.set(k, (n = { orig: p, at: map(p) }))
    return n
  }
  const kind = walls.map((w) => {
    const dx = Math.abs(w.b.x - w.a.x)
    const dy = Math.abs(w.b.y - w.a.y)
    // косая — больше 3° от оси
    return dy <= 0.05 * dx ? 'h' : dx <= 0.05 * dy ? 'v' : 'd'
  })
  // линии после перевода: средняя по концам, вес — длина
  const lines = walls.map((w, i) => {
    const a = node(w.a).at
    const b = node(w.b).at
    const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)
    return { i, kind: kind[i], at: kind[i] === 'h' ? (a.y + b.y) / 2 : (a.x + b.x) / 2, len }
  })
  // соосные — одна прямая: жадные кучки по возрастанию координаты
  const snapped = new Map<number, number>()
  for (const k of ['h', 'v'] as const) {
    const list = lines.filter((l) => l.kind === k).sort((p, q) => p.at - q.at)
    let group: typeof list = []
    const flush = () => {
      if (!group.length) return
      const total = group.reduce((s, l) => s + l.len, 0) || 1
      const at = group.reduce((s, l) => s + l.at * l.len, 0) / total
      for (const l of group) snapped.set(l.i, at)
      group = []
    }
    for (const l of list) {
      if (group.length && l.at - group[group.length - 1].at > tolCm) flush()
      group.push(l)
    }
    flush()
  }
  // концы: горизонтальная стена задаёт y своих концов, вертикальная — x
  walls.forEach((w, i) => {
    const v = snapped.get(i)
    if (v === undefined) return
    for (const p of [w.a, w.b]) {
      const n = node(p)
      if (kind[i] === 'h' && n.y === undefined) n.y = v
      if (kind[i] === 'v' && n.x === undefined) n.x = v
    }
  })
  // Т-стык: конец, лежащий на середине поперечной стены, встаёт на её линию
  for (const n of nodes.values()) {
    walls.forEach((w, i) => {
      const v = snapped.get(i)
      if (v === undefined) return
      if (kind[i] === 'v' && n.x === undefined) {
        const y1 = Math.min(w.a.y, w.b.y)
        const y2 = Math.max(w.a.y, w.b.y)
        if (Math.abs(n.orig.x - w.a.x) < 1.5 && n.orig.y > y1 - 1 && n.orig.y < y2 + 1) n.x = v
      }
      if (kind[i] === 'h' && n.y === undefined) {
        const x1 = Math.min(w.a.x, w.b.x)
        const x2 = Math.max(w.a.x, w.b.x)
        if (Math.abs(n.orig.y - w.a.y) < 1.5 && n.orig.x > x1 - 1 && n.orig.x < x2 + 1) n.y = v
      }
    })
  }
  const place = (p: Pt): Pt => {
    const n = node(p)
    return { x: n.x ?? n.at.x, y: n.y ?? n.at.y }
  }
  return walls.map((w) => ({ ...w, a: place(w.a), b: place(w.b) })).filter((w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) >= 1)
}

const asPlan = (walls: Wall[]): Plan => ({ version: 1, name: '', walls, openings: [], furniture: [], rooms: [], dims: [], settings: { grid: 10 } })

/**
 * Наружная стена — одна прямая. Кусок наружной стены над каждой комнатой
 * меряется по своему месту на картинке, и на фото стена ещё и чуть изогнута
 * объективом: над 5ж кусок той же толщины встаёт на 10 см ниже, чем над
 * санузлом, или выходит тоньше, и снаружи получается ступенька, которой на
 * плане нет. Соседние соосные куски наружной стены (с одной стороны комната,
 * с другой — ничего) становятся одной прямой стеной — грани по более длинным
 * кускам, — если
 * - внутренние грани почти совпали (не дальше innerTol), а наружные — не
 *   дальше maxStep: толщину намерило по-разному;
 * - или толщина та же (±6 см), а сдвиг оси не больше shift и 0,4 толщины:
 *   кусок стены съехал целиком.
 * Настоящий уступ меняет одну внутреннюю грань (выступ 0,13 — толщину на
 * 13 см) или больше этого (ниша, закуток) и остаётся. Концы примыкающих стен
 * переезжают на новую ось; если что-то размыкается — стены не трогаются.
 */
export function evenOuterWalls(walls: Wall[], opts: { innerTol?: number; maxStep?: number; shift?: number } = {}): Wall[] {
  const { innerTol = 6, maxStep = 16, shift: maxShift = 16 } = opts
  if (walls.length < 4) return walls
  const before = buildRooms(asPlan(walls)).rooms
  if (!before.length) return walls
  const inRoom = (p: Pt) => before.some((r) => pointInPoly(p, r.inner))
  interface Piece {
    i: number
    h: boolean
    lo: number
    hi: number
    outer: number
    inner: number
  }
  const pieces: Piece[] = []
  walls.forEach((w, i) => {
    const h = Math.abs(w.a.y - w.b.y) < 0.5 && Math.abs(w.a.x - w.b.x) >= 1
    const v = Math.abs(w.a.x - w.b.x) < 0.5 && Math.abs(w.a.y - w.b.y) >= 1
    if (!h && !v) return
    const at = h ? w.a.y : w.a.x
    const lo = h ? Math.min(w.a.x, w.b.x) : Math.min(w.a.y, w.b.y)
    const hi = h ? Math.max(w.a.x, w.b.x) : Math.max(w.a.y, w.b.y)
    const hasRoom = (s: number) =>
      [0.25, 0.5, 0.75].some((f) => {
        const along = lo + f * (hi - lo)
        const across = at + s * (w.thickness / 2 + 8)
        return inRoom(h ? { x: along, y: across } : { x: across, y: along })
      })
    const minus = hasRoom(-1)
    const plus = hasRoom(1)
    // комнаты с обеих сторон (перегородка) или ни с одной — не наружная стена
    if (minus === plus) return
    const out = minus ? 1 : -1
    pieces.push({ i, h, lo, hi, outer: at + (out * w.thickness) / 2, inner: at - (out * w.thickness) / 2 })
  })
  // цепочки: соседние по длине куски с одной стороной наружу и близкими гранями
  const parent = pieces.map((_, k) => k)
  const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])))
  for (let p = 0; p < pieces.length; p++)
    for (let q = p + 1; q < pieces.length; q++) {
      const A = pieces[p]
      const B = pieces[q]
      if (A.h !== B.h || Math.sign(A.outer - A.inner) !== Math.sign(B.outer - B.inner)) continue
      if (B.lo > A.hi + 1 || A.lo > B.hi + 1) continue
      const tA = Math.abs(A.outer - A.inner)
      const tB = Math.abs(B.outer - B.inner)
      const measured = Math.abs(A.inner - B.inner) <= innerTol && Math.abs(A.outer - B.outer) <= maxStep
      const slid = Math.abs(tA - tB) <= 6 && Math.abs((A.outer + A.inner) / 2 - (B.outer + B.inner) / 2) <= Math.min(maxShift, 0.4 * Math.max(tA, tB))
      if (!measured && !slid) continue
      parent[find(p)] = find(q)
    }
  const chains = new Map<number, Piece[]>()
  pieces.forEach((pc, k) => {
    const r = find(k)
    chains.set(r, [...(chains.get(r) ?? []), pc])
  })
  // грань цепочки — медиана по длине: у двух кусков — грань более длинного
  const median = (list: Piece[], key: 'outer' | 'inner') => {
    const sorted = [...list].sort((a, b) => a[key] - b[key])
    const total = sorted.reduce((s, pc) => s + pc.hi - pc.lo, 0)
    let acc = 0
    for (const pc of sorted) {
      acc += pc.hi - pc.lo
      if (acc >= total / 2) return pc[key]
    }
    return sorted[sorted.length - 1][key]
  }
  const moves: { i: number; h: boolean; old: number; at: number; t: number; lo: number; hi: number }[] = []
  const endsOf = (w: Wall) => [w.a, w.b]
  const same = (p: Pt, q: Pt) => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5
  for (const list of chains.values()) {
    if (list.length < 2) continue
    const outer = median(list, 'outer')
    const inner = median(list, 'inner')
    const at = (outer + inner) / 2
    const t = Math.abs(outer - inner)
    if (t < 4) continue
    const members = new Set(list.map((pc) => pc.i))
    // соосная стена вне цепочки, что стыкуется концом, — сдвиг оси её оторвёт
    const torn = list.some((pc) =>
      walls.some((w, j) => {
        if (members.has(j)) return false
        const wh = Math.abs(w.a.y - w.b.y) < 0.5
        const wv = Math.abs(w.a.x - w.b.x) < 0.5
        if (pc.h ? !wh : !wv) return false
        return endsOf(walls[pc.i]).some((p) => endsOf(w).some((q) => same(p, q)))
      }),
    )
    if (torn) continue
    for (const pc of list) {
      const w = walls[pc.i]
      const old = pc.h ? w.a.y : w.a.x
      if (Math.abs(old - at) < 0.05 && Math.abs(w.thickness - t) < 0.05) continue
      moves.push({ i: pc.i, h: pc.h, old, at, t, lo: pc.lo, hi: pc.hi })
    }
  }
  if (!moves.length) return walls
  const own = new Map(moves.map((m) => [m.i, m]))
  const shift = (p: Pt, skipH: boolean, skipV: boolean): Pt => {
    let { x, y } = p
    for (const m of moves) {
      if (m.h && !skipH && Math.abs(p.y - m.old) < 0.5 && p.x > m.lo - 0.5 && p.x < m.hi + 0.5) {
        y = m.at
        skipH = true
      }
      if (!m.h && !skipV && Math.abs(p.x - m.old) < 0.5 && p.y > m.lo - 0.5 && p.y < m.hi + 0.5) {
        x = m.at
        skipV = true
      }
    }
    return { x, y }
  }
  const out = walls.map((w, j) => {
    const m = own.get(j)
    const wh = Math.abs(w.a.y - w.b.y) < 0.5
    const wv = Math.abs(w.a.x - w.b.x) < 0.5
    // своя ось — по своему сдвигу; вдоль неё конец ездит за поперечными стенами
    const a = shift(w.a, wh, wv)
    const b = shift(w.b, wh, wv)
    if (!m) return { ...w, a, b }
    return m.h ? { ...w, a: { x: a.x, y: m.at }, b: { x: b.x, y: m.at }, thickness: m.t } : { ...w, a: { x: m.at, y: a.y }, b: { x: m.at, y: b.y }, thickness: m.t }
  })
  // проверка: комнат столько же, и каждая на месте
  const after = buildRooms(asPlan(out)).rooms
  if (after.length !== before.length) return walls
  return out
}
