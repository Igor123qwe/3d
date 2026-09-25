// Правка стен как в режиме строительства The Sims.
//
// После распознавания одна прямая стена — несколько кусков, и у нарисованного
// руками чертежа их тоже много: Т-стыки, ниши. Тянуть кусок значило отрывать
// его от соседей: стена расходилась на обрывки, стена в Т-стыке оставалась на
// месте, комната размыкалась. Здесь единица правки — прямая стена целиком (все
// соосные куски подряд), и двигается она только поперёк себя: примыкающие
// стены тянутся за ней, углы остаются прямыми, комнаты — замкнутыми. Участок
// между соседними стыками выдвигается отдельно (Alt): по его краям встают
// перемычки — так делается ниша или выступ. После каждой правки чертёж
// склеивается: соосные куски без стыка между ними — одна стена, стена нулевой
// длины уходит, наложенные стены сливаются.
import type { Opening, Plan, Pt, Wall } from './types'
import { uid } from './types'
import { add, cross, dist, dot, lerp, mul, norm, perp, sub } from './geometry'
import { cleanupWalls, MIN_WALL_LENGTH } from './ops'

/** конец стены лежит на прямой, если отстоит от неё не дальше, см */
const ON = 1

/** прямая стена целиком: соосные куски подряд */
export interface WallRun {
  ids: string[]
  /** начало и конец прямой вдоль dir */
  a: Pt
  b: Pt
  dir: Pt
  /** поперёк прямой: сюда она двигается при положительном сдвиге */
  normal: Pt
  /** самая толстая из кусков: стены в её полосе считаются примкнувшими */
  thickness: number
}

const along = (p: Pt, o: Pt, d: Pt) => dot(sub(p, o), d)
const across = (p: Pt, o: Pt, n: Pt) => dot(sub(p, o), n)

/** куски на одной прямой с w: параллельны и оба конца лежат на ней */
function collinear(w: Wall, o: Pt, d: Pt, n: Pt, tol = ON): boolean {
  const v = sub(w.b, w.a)
  const l = Math.hypot(v.x, v.y)
  if (l < 0.5) return false
  return Math.abs(cross(d, mul(v, 1 / l))) < 0.01 && Math.abs(across(w.a, o, n)) <= tol && Math.abs(across(w.b, o, n)) <= tol
}

/** Прямая стена, в которую входит стена id: связная цепочка соосных кусков */
export function wallRun(walls: Wall[], id: string): WallRun | null {
  const w0 = walls.find((w) => w.id === id)
  if (!w0 || dist(w0.a, w0.b) < 0.5) return null
  const d = norm(sub(w0.b, w0.a))
  const n = perp(d)
  const o = w0.a
  const spans = walls
    .filter((w) => collinear(w, o, d, n))
    .map((w) => {
      const t1 = along(w.a, o, d)
      const t2 = along(w.b, o, d)
      return { w, lo: Math.min(t1, t2), hi: Math.max(t1, t2) }
    })
    .sort((p, q) => p.lo - q.lo)
  const groups: { lo: number; hi: number; items: typeof spans }[] = []
  for (const s of spans) {
    const g = groups[groups.length - 1]
    if (g && s.lo <= g.hi + ON) {
      g.items.push(s)
      g.hi = Math.max(g.hi, s.hi)
    } else groups.push({ lo: s.lo, hi: s.hi, items: [s] })
  }
  const g = groups.find((x) => x.items.some((s) => s.w.id === id))!
  return {
    ids: g.items.map((s) => s.w.id),
    a: add(o, mul(d, g.lo)),
    b: add(o, mul(d, g.hi)),
    dir: d,
    normal: n,
    thickness: Math.max(...g.items.map((s) => s.w.thickness)),
  }
}

/** концы чужих стен, что держатся за прямую на участке [lo, hi] (вдоль неё от run.a) */
function attachedEnds(walls: Wall[], run: WallRun, lo: number, hi: number): { id: string; end: 'a' | 'b'; t: number }[] {
  const ids = new Set(run.ids)
  const band = Math.max(ON, run.thickness / 2)
  const out: { id: string; end: 'a' | 'b'; t: number }[] = []
  for (const w of walls) {
    if (ids.has(w.id)) continue
    for (const end of ['a', 'b'] as const) {
      const p = w[end]
      if (Math.abs(across(p, run.a, run.normal)) > band) continue
      const t = along(p, run.a, run.dir)
      if (t >= lo - ON && t <= hi + ON) out.push({ id: w.id, end, t })
    }
  }
  return out
}

/**
 * Стыки вдоль прямой: где за неё держатся другие стены, плюс её концы.
 * Участок для Alt — между соседними стыками вокруг точки
 */
export function runSection(walls: Wall[], run: WallRun, p: Pt): { lo: number; hi: number } {
  const L = dist(run.a, run.b)
  const t = along(p, run.a, run.dir)
  const stops = [0, L, ...attachedEnds(walls, run, 0, L).map((e) => e.t)]
  let lo = 0
  let hi = L
  for (const s of stops) {
    if (s < t - ON && s > lo) lo = s
    if (s > t + ON && s < hi) hi = s
  }
  return { lo, hi }
}

/** отрезок прямой [lo, hi] в точках чертежа */
export const runSpan = (run: WallRun, lo: number, hi: number): [Pt, Pt] => [add(run.a, mul(run.dir, lo)), add(run.a, mul(run.dir, hi))]

/** проёмы стены — к кускам, на которые она разрезана */
function reassignOpenings(openings: Opening[], from: Wall, pieces: Wall[]): Opening[] {
  return openings.map((o) => {
    if (o.wallId !== from.id) return o
    const c = lerp(from.a, from.b, o.t)
    let best: { w: Wall; t: number; d: number } | null = null
    for (const w of pieces) {
      const L = dist(w.a, w.b)
      if (L < 0.5) continue
      const t = dot(sub(c, w.a), sub(w.b, w.a)) / (L * L)
      const d = t < 0 ? -t * L : t > 1 ? (t - 1) * L : 0
      if (!best || d < best.d) best = { w, t: Math.min(1, Math.max(0, t)), d }
    }
    return best ? { ...o, wallId: best.w.id, t: best.t } : o
  })
}

/**
 * Сдвинуть прямую стену поперёк себя на offset см. Примыкающие стены
 * (в том числе Т-стыки посреди прямой) тянутся за ней. part — только участок
 * [lo, hi] вдоль прямой: он выдвигается, по краям встают перемычки
 */
export function pushRun(plan: Plan, id: string, offset: number, part?: { lo: number; hi: number }): Plan {
  const run = wallRun(plan.walls, id)
  if (!run || Math.abs(offset) < 0.01) return plan
  const L = dist(run.a, run.b)
  const shift = mul(run.normal, offset)
  const lo = part ? Math.max(0, part.lo) : 0
  const hi = part ? Math.min(L, part.hi) : L
  const whole = lo <= ON && hi >= L - ON
  const ids = new Set(run.ids)
  let walls: Wall[] = []
  let openings = plan.openings
  // куски прямой; у участка они режутся по его краям
  const pieces = new Set<string>()
  for (const w of plan.walls) {
    if (!ids.has(w.id)) {
      walls.push(w)
      continue
    }
    const ta = along(w.a, run.a, run.dir)
    const tb = along(w.b, run.a, run.dir)
    const cuts = whole ? [] : [lo, hi].filter((c) => c > Math.min(ta, tb) + 0.5 && c < Math.max(ta, tb) - 0.5).sort((x, y) => (ta < tb ? x - y : y - x))
    if (!cuts.length) {
      walls.push(w)
      pieces.add(w.id)
      continue
    }
    const pts = [w.a, ...cuts.map((c) => add(run.a, mul(run.dir, c))), w.b]
    const cut = pts.slice(1).map((p, k) => ({ ...w, id: k === 0 ? w.id : uid('w'), a: pts[k], b: p }))
    openings = reassignOpenings(openings, w, cut)
    for (const c of cut) pieces.add(c.id)
    walls.push(...cut)
  }
  // едут куски внутри участка и концы чужих стен, что держатся за него; на
  // самих краях участка концы стоят — там встают перемычки
  const moving = new Set(walls.filter((w) => pieces.has(w.id) && ((m) => m > lo && m < hi)(along(lerp(w.a, w.b, 0.5), run.a, run.dir))).map((w) => w.id))
  const ends = attachedEnds(walls, { ...run, ids: [...pieces] }, lo, hi).filter((e) => whole || (e.t > lo + ON && e.t < hi - ON))
  walls = walls.map((w) => {
    if (moving.has(w.id)) return { ...w, a: add(w.a, shift), b: add(w.b, shift) }
    const ea = ends.some((e) => e.id === w.id && e.end === 'a')
    const eb = ends.some((e) => e.id === w.id && e.end === 'b')
    if (!ea && !eb) return w
    return { ...w, a: ea ? add(w.a, shift) : w.a, b: eb ? add(w.b, shift) : w.b }
  })
  if (!whole) {
    for (const c of [lo, hi]) {
      // край участка на свободном конце прямой — перемычка не нужна
      const atEnd = c <= ON || c >= L - ON
      if (atEnd && !attachedEnds(plan.walls, run, c, c).length) continue
      const from = add(run.a, mul(run.dir, c))
      walls.push({ id: uid('w'), a: from, b: add(from, shift), thickness: run.thickness })
    }
  }
  return normalizeWalls({ ...plan, walls, openings })
}

/**
 * Склейка после правки: стены нулевой длины уходят; соосные куски, что
 * стыкуются концами одинаковой толщины и без чужого стыка в точке встречи,
 * — одна стена; наложенные соосные стены сливаются в одну (толщина — большая).
 * Проёмы переезжают на склеенную стену на прежнее место
 */
export function normalizeWalls(plan: Plan): Plan {
  let walls = plan.walls.filter((w) => dist(w.a, w.b) >= 1)
  let openings = plan.openings
  const endAt = (p: Pt, skip: Set<string>) => walls.some((w) => !skip.has(w.id) && (dist(w.a, p) <= 0.75 || dist(w.b, p) <= 0.75))
  for (let guard = 0; guard < 500; guard++) {
    let merged = false
    outer: for (let i = 0; i < walls.length; i++) {
      const w1 = walls[i]
      const d = norm(sub(w1.b, w1.a))
      const n = perp(d)
      for (let j = i + 1; j < walls.length; j++) {
        const w2 = walls[j]
        // зафиксированная стена не склеивается: её концы не должны уехать
        if (w1.locked || w2.locked) continue
        if (!collinear(w2, w1.a, d, n, 0.75)) continue
        const t = [0, along(w1.b, w1.a, d), along(w2.a, w1.a, d), along(w2.b, w1.a, d)]
        const lo1 = Math.min(t[0], t[1])
        const hi1 = Math.max(t[0], t[1])
        const lo2 = Math.min(t[2], t[3])
        const hi2 = Math.max(t[2], t[3])
        const overlap = Math.min(hi1, hi2) - Math.max(lo1, lo2)
        if (overlap < -0.75) continue
        if (overlap <= 0.75) {
          // встык: той же толщины и без чужого стыка в точке встречи
          if (Math.abs(w1.thickness - w2.thickness) > 0.5) continue
          const meet = add(w1.a, mul(d, hi1 <= lo2 + 0.75 ? (hi1 + lo2) / 2 : (hi2 + lo1) / 2))
          if (endAt(meet, new Set([w1.id, w2.id]))) continue
        }
        const lo = Math.min(lo1, lo2)
        const hi = Math.max(hi1, hi2)
        const w: Wall = { id: w1.id, a: add(w1.a, mul(d, lo)), b: add(w1.a, mul(d, hi)), thickness: Math.max(w1.thickness, w2.thickness) }
        openings = reassignOpenings(reassignOpenings(openings, w1, [w]), w2, [w])
        walls = walls.filter((x) => x.id !== w1.id && x.id !== w2.id).concat(w)
        merged = true
        break outer
      }
    }
    if (!merged) break
  }
  return cleanupWalls({ ...plan, walls, openings })
}

/** Удалить прямую стену целиком */
export function deleteRun(plan: Plan, id: string): Plan {
  const run = wallRun(plan.walls, id)
  if (!run) return plan
  const ids = new Set(run.ids)
  return normalizeWalls(cleanupWalls({ ...plan, walls: plan.walls.filter((w) => !ids.has(w.id)) }))
}

/**
 * Конец прямой стены сдвинуть вдоль неё на delta см (end — у a или у b).
 * Если за этот конец держится поперечная стена, двигается она целиком —
 * углы остаются прямыми; иначе конец просто удлиняется
 */
export function stretchRun(plan: Plan, id: string, end: 'a' | 'b', delta: number): Plan {
  const run = wallRun(plan.walls, id)
  if (!run || Math.abs(delta) < 0.01) return plan
  const p = end === 'a' ? run.a : run.b
  const dirOut = end === 'a' ? mul(run.dir, -1) : run.dir
  const ids = new Set(run.ids)
  // поперечная стена, что держится за этот конец
  const cross = plan.walls.find((w) => {
    if (ids.has(w.id)) return false
    const v = norm(sub(w.b, w.a))
    if (Math.abs(dot(v, run.dir)) > 0.1) return false
    return dist(w.a, p) <= Math.max(ON, w.thickness / 2) || dist(w.b, p) <= Math.max(ON, w.thickness / 2) || distToSeg(p, w) <= Math.max(ON, w.thickness / 2)
  })
  if (cross) {
    const other = wallRun(plan.walls, cross.id)
    if (other) return pushRun(plan, cross.id, delta * dot(dirOut, other.normal))
  }
  // свободный конец: удлинить крайний кусок
  const move = mul(dirOut, delta)
  const walls = plan.walls.map((w) => {
    if (!ids.has(w.id)) return w
    if (dist(w.a, p) <= ON) return { ...w, a: add(w.a, move) }
    if (dist(w.b, p) <= ON) return { ...w, b: add(w.b, move) }
    return w
  })
  return normalizeWalls({ ...plan, walls })
}

function distToSeg(p: Pt, w: Wall): number {
  const v = sub(w.b, w.a)
  const L2 = dot(v, v) || 1
  const t = Math.min(1, Math.max(0, dot(sub(p, w.a), v) / L2))
  return dist(p, add(w.a, mul(v, t)))
}

/** Длина прямой целиком: конец b уходит на нужное место (поперечная стена за ним — вместе с ним) */
export function setRunLength(plan: Plan, id: string, length: number): Plan {
  const run = wallRun(plan.walls, id)
  if (!run || !Number.isFinite(length) || length < MIN_WALL_LENGTH) return plan
  return stretchRun(plan, id, 'b', length - dist(run.a, run.b))
}

/** Толщина прямой целиком */
export function setRunThickness(plan: Plan, id: string, thickness: number): Plan {
  const run = wallRun(plan.walls, id)
  if (!run) return plan
  const ids = new Set(run.ids)
  return normalizeWalls({ ...plan, walls: plan.walls.map((w) => (ids.has(w.id) ? { ...w, thickness } : w)) })
}

// ---------- замок ----------

/**
 * Правка задела зафиксированную стену: сдвинула, растянула, изменила
 * толщину или убрала её. Такая правка не применяется
 */
export function touchesLocked(before: Plan, after: Plan): boolean {
  if (before === after) return false
  const next = new Map(after.walls.map((w) => [w.id, w]))
  return before.walls.some((w) => {
    if (!w.locked) return false
    const v = next.get(w.id)
    return !v || dist(v.a, w.a) > 0.01 || dist(v.b, w.b) > 0.01 || v.thickness !== w.thickness
  })
}

/** Правка, но не в обход замка: задела зафиксированную стену — план как был */
export function guardLocks(before: Plan, after: Plan): Plan {
  return touchesLocked(before, after) ? before : after
}

/** Зафиксировать или освободить прямую стену целиком */
export function setRunLocked(plan: Plan, id: string, locked: boolean): Plan {
  const run = wallRun(plan.walls, id)
  if (!run) return plan
  const ids = new Set(run.ids)
  return { ...plan, walls: plan.walls.map((w) => (ids.has(w.id) ? { ...w, locked: locked || undefined } : w)) }
}

/** Зафиксировать или освободить все стены разом */
export function setAllLocked(plan: Plan, locked: boolean): Plan {
  return { ...plan, walls: plan.walls.map((w) => ({ ...w, locked: locked || undefined })) }
}

// ---------- размер комнаты цифрой ----------

/**
 * Стена за углом комнаты: поперёк стороны, её грань проходит через угол, а
 * сама она лежит дальше угла по направлению out
 */
export function wallAtCorner(walls: Wall[], corner: Pt, out: Pt): Wall | null {
  let best: { w: Wall; err: number } | null = null
  for (const w of walls) {
    const L = dist(w.a, w.b)
    if (L < 1) continue
    const v = norm(sub(w.b, w.a))
    if (Math.abs(dot(v, out)) > 0.1) continue
    // ось стены — на полтолщины дальше угла
    const err = Math.abs(dot(sub(w.a, corner), out) - w.thickness / 2)
    if (err > Math.max(2, w.thickness / 4)) continue
    const t = dot(sub(corner, w.a), v)
    if (t < -w.thickness || t > L + w.thickness) continue
    if (!best || err < best.err) best = { w, err }
  }
  return best?.w ?? null
}

/**
 * Сторона комнаты a→b (по внутренним граням) — ровно length см: сдвигается
 * стена за углом end, целиком, поперёк себя; соседние стены тянутся за ней.
 * Как в Planner 5D и RoomSketcher — щелчок по размеру и число, — но
 * двигается именно та стена, что нужна, а не вся длинная прямая
 */
export function setRoomSide(plan: Plan, a: Pt, b: Pt, length: number, end: 'a' | 'b'): Plan {
  const L = dist(a, b)
  if (!Number.isFinite(length) || length < 1 || L < 1 || Math.abs(length - L) < 0.01) return plan
  const d = norm(sub(b, a))
  const out = end === 'b' ? d : mul(d, -1)
  const w = wallAtCorner(plan.walls, end === 'b' ? b : a, out)
  if (!w) return plan
  const run = wallRun(plan.walls, w.id)
  if (!run) return plan
  return pushRun(plan, w.id, (length - L) * dot(out, run.normal))
}

// ---------- разрывы ----------

/** свободные концы стен: к ним не подходит ни конец, ни тело другой стены */
export function openEnds(walls: Wall[]): { id: string; end: 'a' | 'b'; p: Pt; out: Pt }[] {
  const out: { id: string; end: 'a' | 'b'; p: Pt; out: Pt }[] = []
  for (const w of walls) {
    if (dist(w.a, w.b) < 1) continue
    for (const end of ['a', 'b'] as const) {
      const p = w[end]
      const q = end === 'a' ? w.b : w.a
      const held = walls.some((o) => o.id !== w.id && (dist(o.a, p) <= 1 || dist(o.b, p) <= 1 || distToSeg(p, o) <= o.thickness / 2 + 1))
      if (!held) out.push({ id: w.id, end, p, out: norm(sub(p, q)) })
    }
  }
  return out
}

export interface WallGap {
  id: string
  end: 'a' | 'b'
  from: Pt
  to: Pt
  gap: number
  /** угол: конец другой стены тоже не дошёл — сводятся оба */
  other?: { id: string; end: 'a' | 'b' }
}

/**
 * Разрывы до maxGap см: свободный конец стены, которому вдоль неё до другой
 * стены (до её оси) не больше maxGap. Комната из таких стен не замыкается и
 * не находится — у пользователя прихожая после правок стала «пустым местом»
 */
export function findGaps(walls: Wall[], maxGap = 30): WallGap[] {
  const ends = openEnds(walls)
  const isOpen = (id: string, end: 'a' | 'b') => ends.some((e) => e.id === id && e.end === end)
  const gaps: WallGap[] = []
  for (const e of ends) {
    let best: WallGap | null = null
    for (const o of walls) {
      if (o.id === e.id) continue
      const Lo = dist(o.a, o.b)
      if (Lo < 1) continue
      const d = norm(sub(o.b, o.a))
      const den = cross(e.out, d)
      if (Math.abs(den) < 0.2) continue
      // луч p + out·s против оси o: a + d·t
      const ap = sub(o.a, e.p)
      const s = cross(ap, d) / den
      const t = cross(ap, e.out) / den
      if (s <= 0.5 || s > maxGap + o.thickness / 2) continue
      const to = add(e.p, mul(e.out, s))
      let other: WallGap['other']
      if (t < -o.thickness / 2 || t > Lo + o.thickness / 2) {
        // мимо конца o: годится, только если это угол, где o тоже не дошла
        const oend: 'a' | 'b' = t < 0 ? 'a' : 'b'
        const over = t < 0 ? -t : t - Lo
        if (over > maxGap || !isOpen(o.id, oend)) continue
        other = { id: o.id, end: oend }
      }
      if (!best || s < best.gap) best = { id: e.id, end: e.end, from: e.p, to, gap: s, ...(other ? { other } : {}) }
    }
    if (best) gaps.push(best)
  }
  // угол попадает дважды — с каждой стороны; оставляем один
  return gaps.filter((g, i) => !g.other || !gaps.slice(0, i).some((h) => h.other && h.id === g.other!.id && h.other.id === g.id))
}

/** Замкнуть разрывы: концы дотягиваются до соседних стен; зафиксированные стены не трогаются */
export function closeGaps(plan: Plan, maxGap = 30): { plan: Plan; closed: number } {
  let p = plan
  let closed = 0
  for (const g of findGaps(plan.walls, maxGap)) {
    const move = (walls: Wall[], id: string, end: 'a' | 'b', to: Pt) => walls.map((w) => (w.id === id ? { ...w, [end]: { ...to } } : w))
    let walls = move(p.walls, g.id, g.end, g.to)
    if (g.other) walls = move(walls, g.other.id, g.other.end, g.to)
    const next = { ...p, walls }
    if (touchesLocked(p, next)) continue
    p = next
    closed++
  }
  return { plan: closed ? normalizeWalls(p) : plan, closed }
}
