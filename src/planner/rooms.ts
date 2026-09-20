import type { Plan, Pt, Room, RoomMeta, Wall } from './types'
import { uid } from './types'
import {
  dist,
  eq,
  interiorPoint,
  lerp,
  minEdgeDist,
  offsetPolygon,
  pointInPoly,
  pointSegDist,
  polyArea,
  polyPerimeter,
  projectT,
  removeSpikes,
  segIntersect,
} from './geometry'

const EPS = 0.75 // см — допуск совпадения точек
const MIN_ROOM_AREA = 3000 // см² (0.3 м²)

interface Seg {
  a: Pt
  b: Pt
  th: number
}

interface Edge {
  u: number
  v: number
  th: number
}

/** Делим стены во всех точках пересечений и Т-примыканий */
function splitWalls(walls: Wall[]): Seg[] {
  const out: Seg[] = []
  for (const w of walls) {
    const L = dist(w.a, w.b)
    if (L < EPS) continue
    const ts = new Set<number>([0, 1])
    for (const o of walls) {
      if (o === w) continue
      const x = segIntersect(w.a, w.b, o.a, o.b)
      if (x && x.u > -1e-6 && x.u < 1 + 1e-6 && x.t > 1e-6 && x.t < 1 - 1e-6) ts.add(x.t)
      // концы другой стены, лежащие на теле этой (Т-примыкание, в т.ч. под углом)
      for (const p of [o.a, o.b]) {
        if (pointSegDist(p, w.a, w.b) < EPS) {
          const t = projectT(p, w.a, w.b)
          if (t > 1e-6 && t < 1 - 1e-6) ts.add(t)
        }
      }
    }
    const sorted = [...ts].sort((p, q) => p - q)
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = lerp(w.a, w.b, sorted[i])
      const b = lerp(w.a, w.b, sorted[i + 1])
      if (dist(a, b) >= EPS) out.push({ a, b, th: w.thickness })
    }
  }
  return out
}

interface Face {
  polygon: Pt[]
  thick: number[]
}

/** Поиск граней планарного графа стен. Возвращает только внутренние контуры (комнаты). */
export function detectFaces(walls: Wall[]): Face[] {
  const segs = splitWalls(walls)
  const verts: Pt[] = []
  const vertexId = (p: Pt): number => {
    for (let i = 0; i < verts.length; i++) if (eq(verts[i], p, EPS)) return i
    verts.push({ x: p.x, y: p.y })
    return verts.length - 1
  }
  const edges: Edge[] = []
  const edgeKey = new Set<string>()
  for (const s of segs) {
    const u = vertexId(s.a)
    const v = vertexId(s.b)
    if (u === v) continue
    const key = u < v ? `${u}-${v}` : `${v}-${u}`
    if (edgeKey.has(key)) continue
    edgeKey.add(key)
    edges.push({ u, v, th: s.th })
  }
  // соседи, отсортированные по углу
  const adj: { to: number; th: number; ang: number }[][] = verts.map(() => [])
  for (const e of edges) {
    const p = verts[e.u]
    const q = verts[e.v]
    adj[e.u].push({ to: e.v, th: e.th, ang: Math.atan2(q.y - p.y, q.x - p.x) })
    adj[e.v].push({ to: e.u, th: e.th, ang: Math.atan2(p.y - q.y, p.x - q.x) })
  }
  for (const list of adj) list.sort((a, b) => a.ang - b.ang)

  const visited = new Set<string>()
  const faces: Face[] = []
  for (const e of edges) {
    for (const [start, next] of [
      [e.u, e.v],
      [e.v, e.u],
    ]) {
      if (visited.has(`${start}>${next}`)) continue
      const poly: number[] = []
      const thick: number[] = []
      let u = start
      let v = next
      let guard = 0
      while (guard++ < 10000) {
        const key = `${u}>${v}`
        if (visited.has(key)) break
        visited.add(key)
        poly.push(u)
        const list = adj[v]
        const idx = list.findIndex((n) => n.to === u)
        if (idx < 0) {
          poly.length = 0 // ребро потерялось: контур недостоверен
          break
        }
        thick.push(list[idx].th)
        // следующее ребро против часовой относительно обратного направления
        const nxt = list[(idx + 1) % list.length]
        u = v
        v = nxt.to
        if (u === start && v === next) break
      }
      if (guard >= 10000) continue // обход не замкнулся — контур отбрасываем
      if (poly.length < 3) continue
      const pts = poly.map((i) => verts[i])
      const area = polyArea(pts)
      // внутренние грани при таком обходе имеют отрицательную площадь (экранные координаты)
      if (area >= -MIN_ROOM_AREA) continue
      faces.push({ polygon: pts, thick })
    }
  }
  return faces
}

function cleanFace(face: Face): Face | null {
  const n = face.polygon.length
  const cleaned = removeSpikes(face.polygon)
  if (cleaned.length < 3) return null
  // сопоставляем толщины: для каждого ребра очищенного контура ищем исходное ребро
  const thick = cleaned.map((p, i) => {
    const q = cleaned[(i + 1) % cleaned.length]
    for (let k = 0; k < n; k++) {
      const a = face.polygon[k]
      const b = face.polygon[(k + 1) % n]
      if ((eq(a, p, EPS) && eq(b, q, EPS)) || (eq(a, q, EPS) && eq(b, p, EPS))) return face.thick[k]
    }
    // ребро могло склеиться из нескольких коллинеарных — берём ближайшее
    let best = 10
    let bestD = Infinity
    for (let k = 0; k < n; k++) {
      const a = face.polygon[k]
      const b = face.polygon[(k + 1) % n]
      const d = pointSegDist(lerp(p, q, 0.5), a, b)
      if (d < bestD) {
        bestD = d
        best = face.thick[k]
      }
    }
    return best
  })
  return { polygon: cleaned, thick }
}

const DEFAULT_NAMES = ['Гостиная', 'Спальня', 'Кухня', 'Детская', 'Кабинет']

/** имя новой комнаты по площади (м²) с учётом уже занятых имён */
function defaultName(areaM2: number, taken: Set<string>): string {
  const pick = (candidates: string[]) => {
    for (const c of candidates) if (!taken.has(c)) return c
    const b = candidates[0]
    for (let i = 2; i < 50; i++) if (!taken.has(`${b} ${i}`)) return `${b} ${i}`
    return b
  }
  if (areaM2 < 2.2) return pick(['Кладовая', 'Гардеробная'])
  if (areaM2 < 5) return pick(['Санузел', 'Ванная'])
  if (areaM2 < 7) return pick(['Прихожая', 'Коридор', 'Кухня'])
  return pick(DEFAULT_NAMES)
}

/** Комнаты плана с привязкой к сохранённым метаданным (имя, пол) */
export function buildRooms(plan: Plan): { rooms: Room[]; metas: RoomMeta[] } {
  const faces = detectFaces(plan.walls)
    .map(cleanFace)
    .filter((f): f is Face => !!f)
  const used = new Set<string>()
  const metas = plan.rooms.slice()
  const rooms: Room[] = []
  faces.forEach((f) => {
    const inner = offsetPolygon(f.polygon, f.thick.map((t) => t / 2))
    const areaM2 = Math.abs(polyArea(inner)) / 10000
    const anchor = interiorPoint(f.polygon)
    const idx = metas.findIndex((m) => !used.has(m.id) && pointInPoly(m.anchor, f.polygon))
    let meta: RoomMeta
    if (idx >= 0) {
      meta = metas[idx]
      // форма комнаты могла измениться — подпись держим по свежей внутренней точке
      if (minEdgeDist(meta.anchor, f.polygon) < minEdgeDist(anchor, f.polygon) / 2) {
        meta = { ...meta, anchor }
        metas[idx] = meta
      }
    } else {
      // занятыми считаем только имена уже найденных комнат: метаданные исчезнувших
      // комнат не должны превращать следующую «Гостиную» в «Гостиную 2»
      const taken = new Set(rooms.map((r) => r.meta.name))
      meta = { id: uid('room'), anchor, name: defaultName(areaM2, taken), floor: areaM2 < 5 ? 'tile' : 'laminate' }
      metas.push(meta)
    }
    used.add(meta.id)
    rooms.push({ meta, polygon: f.polygon, inner, area: areaM2, perimeter: polyPerimeter(f.polygon) })
  })
  return { rooms, metas }
}
