// Проверка планировки по правилам эргономики, которыми пользуются дизайнеры интерьера.
import { isLiving, isWet, roomKind } from './roomkind'
import type { Furniture, Issue, Opening, Plan, Pt, Room, Wall } from './types'
import { CATALOG_MAP, type CatalogItem, type Clearance } from './catalog'
import { findGaps } from './walledit'
import { add, angleDeg, angleDiff, bboxOf, convexOverlap, dist, lerp, localRect, mul, norm, obbCorners, perp, pointInPoly, pointSegDist, rotate, sub } from './geometry'

export interface Triangle {
  pts: Pt[]
  sides: number[]
  total: number
  ok: boolean
}

export interface CheckResult {
  issues: Issue[]
  /** ключи нарушенных зон: `${itemId}:${side}` */
  badZones: Set<string>
  triangle: Triangle | null
  /** id дверей, которые задевают мебель */
  badDoors: Set<string>
}

export type ZoneSide = keyof Clearance

export function wallBody(w: Wall): Pt[] {
  const c = lerp(w.a, w.b, 0.5)
  return obbCorners(c.x, c.y, dist(w.a, w.b), w.thickness, angleDeg(w.a, w.b))
}

export const furnitureBody = (f: Furniture): Pt[] => obbCorners(f.x, f.y, f.w, f.d, f.rot)

export function zonesOf(f: Furniture, cat: CatalogItem | undefined): { side: ZoneSide; poly: Pt[]; size: number }[] {
  const cl = cat?.clearance
  if (!cl) return []
  const out: { side: ZoneSide; poly: Pt[]; size: number }[] = []
  if (cl.front) out.push({ side: 'front', size: cl.front, poly: localRect(f.x, f.y, f.rot, 0, f.d / 2 + cl.front / 2, f.w, cl.front) })
  if (cl.back) out.push({ side: 'back', size: cl.back, poly: localRect(f.x, f.y, f.rot, 0, -(f.d / 2 + cl.back / 2), f.w, cl.back) })
  if (cl.left) out.push({ side: 'left', size: cl.left, poly: localRect(f.x, f.y, f.rot, -(f.w / 2 + cl.left / 2), 0, cl.left, f.d) })
  if (cl.right) out.push({ side: 'right', size: cl.right, poly: localRect(f.x, f.y, f.rot, f.w / 2 + cl.right / 2, 0, cl.right, f.d) })
  return out
}

export interface OpeningGeom {
  center: Pt
  dir: Pt
  n: Pt
  hw: number
  th: number
  /** петля */
  hinge: Pt
  /** противоположный край проёма */
  far: Pt
  /** конец открытого полотна */
  leafEnd: Pt
  /** сектор открывания (для дверей) */
  swing: Pt[]
}

export function openingGeom(op: Opening, wall: Wall): OpeningGeom {
  const dir = norm(sub(wall.b, wall.a))
  const n = perp(dir)
  const center = lerp(wall.a, wall.b, op.t)
  const hw = op.width / 2
  const hinge = add(center, mul(dir, op.hinge === 'a' ? -hw : hw))
  const far = add(center, mul(dir, op.hinge === 'a' ? hw : -hw))
  const leafEnd = add(hinge, mul(n, op.side * op.width))
  const swing: Pt[] = [hinge]
  const a0 = Math.atan2(far.y - hinge.y, far.x - hinge.x)
  const a1 = Math.atan2(leafEnd.y - hinge.y, leafEnd.x - hinge.x)
  let delta = a1 - a0
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  const steps = 8
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (delta * i) / steps
    swing.push({ x: hinge.x + Math.cos(a) * op.width, y: hinge.y + Math.sin(a) * op.width })
  }
  return { center, dir, n, hw, th: wall.thickness, hinge, far, leafEnd, swing }
}

const SIDE_TEXT: Record<ZoneSide, string> = { front: 'Перед', back: 'Позади', left: 'Слева от', right: 'Справа от' }

export function runChecks(plan: Plan, rooms: Room[]): CheckResult {
  const issues: Issue[] = []
  const badZones = new Set<string>()
  const badDoors = new Set<string>()
  const wallMap = new Map(plan.walls.map((w) => [w.id, w]))
  const wallBodies = plan.walls.map((w) => ({ w, poly: wallBody(w) }))
  const items = plan.furniture.map((f) => ({ f, cat: CATALOG_MAP[f.type], body: furnitureBody(f) }))
  const solid = items.filter((i) => !i.cat?.symbol && (i.cat?.z ?? 1) === 1)
  const nameOf = (f: Furniture) => `«${f.label || CATALOG_MAP[f.type]?.name || f.type}»`
  const push = (i: Issue) => {
    if (issues.length < 80) issues.push(i)
  }

  // 1. пересечения мебели между собой и со стенами
  for (let i = 0; i < solid.length; i++) {
    const A = solid[i]
    for (const wb of wallBodies) {
      if (convexOverlap(A.body, wb.poly, 1.5)) {
        push({ id: `wall-${A.f.id}`, level: 'error', text: `${nameOf(A.f)} заходит в стену`, target: { kind: 'furniture', id: A.f.id } })
        break
      }
    }
    for (let j = i + 1; j < solid.length; j++) {
      const B = solid[j]
      if (convexOverlap(A.body, B.body, 1.5)) {
        push({ id: `ov-${A.f.id}-${B.f.id}`, level: 'error', text: `${nameOf(A.f)} пересекается с ${nameOf(B.f)}`, target: { kind: 'furniture', id: A.f.id } })
      }
    }
  }

  // 2. зоны эргономики
  for (const A of items) {
    const zones = zonesOf(A.f, A.cat)
    for (const z of zones) {
      const key = `${A.f.id}:${z.side}`
      let blocker: string | null = null
      for (const wb of wallBodies) {
        if (convexOverlap(z.poly, wb.poly, 1.5)) {
          blocker = 'стена'
          break
        }
      }
      if (!blocker) {
        for (const B of solid) {
          if (B.f.id === A.f.id) continue
          if (A.cat?.allowInZone?.includes(B.f.type)) continue
          if (convexOverlap(z.poly, B.body, 1.5)) {
            blocker = nameOf(B.f)
            break
          }
        }
      }
      if (blocker) {
        badZones.add(key)
        push({
          id: `zone-${key}`,
          level: 'warn',
          text: `${SIDE_TEXT[z.side]} ${nameOf(A.f)} нужно ${z.size} см свободно — мешает ${blocker}`,
          target: { kind: 'furniture', id: A.f.id },
        })
      }
    }
  }

  // 3. двери задевают мебель
  for (const op of plan.openings) {
    if (op.kind !== 'door') continue
    const wall = wallMap.get(op.wallId)
    if (!wall) continue
    const g = openingGeom(op, wall)
    for (const B of solid) {
      if (convexOverlap(g.swing, B.body, 2)) {
        badDoors.add(op.id)
        push({ id: `door-${op.id}-${B.f.id}`, level: 'warn', text: `Дверь при открывании задевает ${nameOf(B.f)}`, target: { kind: 'opening', id: op.id } })
      }
    }
  }

  // 4. комнаты без дверей / без окон
  const openingsOnRoom = (room: Room, kinds: Opening['kind'][]) =>
    plan.openings.filter((op) => {
      if (!kinds.includes(op.kind)) return false
      const wall = wallMap.get(op.wallId)
      if (!wall) return false
      const c = lerp(wall.a, wall.b, op.t)
      for (let i = 0; i < room.polygon.length; i++) {
        if (pointSegDist(c, room.polygon[i], room.polygon[(i + 1) % room.polygon.length]) < wall.thickness / 2 + 1) return true
      }
      return false
    })
  for (const r of rooms) {
    if (openingsOnRoom(r, ['door', 'doorway']).length === 0) {
      push({ id: `nodoor-${r.meta.id}`, level: 'warn', text: `В комнату «${r.meta.name}» нет двери или проёма`, target: { kind: 'room', id: r.meta.id } })
    }
    if (isLiving(r.meta.name) && openingsOnRoom(r, ['window']).length === 0) {
      push({ id: `nowin-${r.meta.id}`, level: 'info', text: `В «${r.meta.name}» нет окна — жилой комнате нужен естественный свет`, target: { kind: 'room', id: r.meta.id } })
    }
    // минимальные площади и ширины жилых помещений (СП 54.13330.2022, п. 5.7–5.9)
    const kind = roomKind(r.meta.name)
    const bb = r.inner.length >= 3 ? bboxOf(r.inner) : null
    const minSide = bb ? Math.min(bb.maxX - bb.minX, bb.maxY - bb.minY) : Infinity
    const area = Math.round(r.area * 10) / 10
    const minArea: Partial<Record<ReturnType<typeof roomKind>, [number, string]>> = {
      bedroom: [8, 'спальня — от 8 м² (на двоих — от 10)'],
      kids: [8, 'детская — от 8 м²'],
      living: [12, 'общая комната — от 12 м² (в квартире с двумя и более комнатами — от 16)'],
      kitchen: [8, 'кухня — от 8 м² (кухня-ниша — от 5)'],
    }
    const rule = minArea[kind]
    if (rule && area < rule[0]) push({ id: `small-${r.meta.id}`, level: 'info', text: `«${r.meta.name}» ${area} м² — по СП 54.13330 ${rule[1]}`, target: { kind: 'room', id: r.meta.id } })
    if (kind === 'hall' && minSide < 85) push({ id: `narrow-${r.meta.id}`, level: 'warn', text: `«${r.meta.name}» шириной ${Math.round(minSide)} см — коридор не уже 85 см, прихожая от 140 (СП 54.13330)`, target: { kind: 'room', id: r.meta.id } })
    if (kind === 'wet' && minSide < 80) push({ id: `narrow-${r.meta.id}`, level: 'warn', text: `«${r.meta.name}» шириной ${Math.round(minSide)} см — туалет не уже 80 см (СП 54.13330)`, target: { kind: 'room', id: r.meta.id } })
  }

  // 5. правила для кроватей
  const doors = plan.openings.filter((o) => o.kind === 'door').map((o) => ({ o, wall: wallMap.get(o.wallId) })).filter((d) => d.wall)
  for (const A of items) {
    if (A.cat?.glyph !== 'bed' && A.cat?.glyph !== 'crib') continue
    const f = A.f
    const backC = add({ x: f.x, y: f.y }, rotate({ x: 0, y: -f.d / 2 }, f.rot))
    const frontC = add({ x: f.x, y: f.y }, rotate({ x: 0, y: f.d / 2 }, f.rot))
    let nearWall = false
    for (const w of plan.walls) if (pointSegDist(backC, w.a, w.b) < w.thickness / 2 + 6) nearWall = true
    if (!nearWall) push({ id: `bedwall-${f.id}`, level: 'info', text: `Изголовье ${nameOf(f)} лучше поставить к стене`, target: { kind: 'furniture', id: f.id } })
    for (const op of plan.openings) {
      if (op.kind !== 'window') continue
      const wall = wallMap.get(op.wallId)
      if (!wall) continue
      const g = openingGeom(op, wall)
      const s0 = add(g.center, mul(g.dir, -g.hw))
      const s1 = add(g.center, mul(g.dir, g.hw))
      if (pointSegDist(backC, s0, s1) < wall.thickness / 2 + 25) {
        push({ id: `bedwin-${f.id}`, level: 'info', text: `Изголовье ${nameOf(f)} под окном — сквозняк и шум, лучше переставить`, target: { kind: 'furniture', id: f.id } })
        break
      }
    }
    const frontDir = rotate({ x: 0, y: 1 }, f.rot)
    for (const d of doors) {
      const c = lerp(d.wall!.a, d.wall!.b, d.o.t)
      const v = sub(c, frontC)
      const L = dist(c, frontC)
      if (L > 250) continue
      const ang = angleDiff(angleDeg({ x: 0, y: 0 }, frontDir), angleDeg({ x: 0, y: 0 }, v))
      if (ang < 25) {
        push({ id: `beddoor-${f.id}`, level: 'info', text: `${nameOf(f)} стоит ногами к двери — обычно так не ставят`, target: { kind: 'furniture', id: f.id } })
        break
      }
    }
  }

  // 6. рабочий треугольник кухни
  let triangle: Triangle | null = null
  const fridge = plan.furniture.find((f) => f.type === 'fridge')
  const sink = plan.furniture.find((f) => f.type === 'sink')
  const stove = plan.furniture.find((f) => f.type === 'stove')
  if (fridge && sink && stove) {
    const pts = [fridge, sink, stove].map((f) => ({ x: f.x, y: f.y }))
    const sides = [dist(pts[0], pts[1]), dist(pts[1], pts[2]), dist(pts[2], pts[0])]
    const total = sides.reduce((a, b) => a + b, 0)
    const ok = total >= 360 && total <= 800 && sides.every((s) => s >= 90 && s <= 270)
    triangle = { pts, sides, total, ok }
    if (!ok) {
      push({
        id: 'triangle',
        level: 'warn',
        text: `Рабочий треугольник кухни ${(total / 100).toFixed(1)} м — норма 4–8 м в сумме, каждая сторона 1,2–2,7 м`,
        target: { kind: 'furniture', id: sink.id },
      })
    } else {
      push({ id: 'triangle-ok', level: 'info', text: `Рабочий треугольник кухни ${(total / 100).toFixed(1)} м — в норме`, target: { kind: 'furniture', id: sink.id } })
    }
    if (dist({ x: stove.x, y: stove.y }, { x: fridge.x, y: fridge.y }) < 65) {
      push({ id: 'stove-fridge', level: 'warn', text: 'Плита вплотную к холодильнику — нужен модуль 30–60 см между ними', target: { kind: 'furniture', id: stove.id } })
    }
  }

  // 6б. окно на внутренней стене: с обеих сторон комнаты — свет через него не попадёт
  for (const op of plan.openings) {
    if (op.kind !== 'window') continue
    const wall = wallMap.get(op.wallId)
    if (!wall) continue
    const g = openingGeom(op, wall)
    const inside = (s: number) => rooms.some((r) => pointInPoly(add(g.center, mul(g.n, s * (wall.thickness / 2 + 12))), r.polygon))
    if (inside(1) && inside(-1)) push({ id: `winin-${op.id}`, level: 'info', text: 'Окно на внутренней стене: с обеих сторон комнаты — наружного света через него не будет', target: { kind: 'opening', id: op.id } })
  }

  // 7. электрика
  const electrics = plan.furniture.filter((f) => f.electric)
  if (electrics.length) {
    for (const r of rooms) {
      const wet = isWet(r.meta.name)
      const inside = electrics.filter((f) => pointInPoly({ x: f.x, y: f.y }, r.polygon))
      if (!inside.some((f) => f.electric?.kind === 'light' || f.electric?.kind === 'spot')) {
        push({ id: `nolight-${r.meta.id}`, level: 'info', text: `В «${r.meta.name}» нет светильника`, target: { kind: 'room', id: r.meta.id } })
      }
      if (!wet) continue
      // в мокрой зоне розетки держат подальше от воды
      const water = plan.furniture.filter((f) => ['bathtub-170', 'bathtub-150', 'shower-90', 'shower-120'].includes(f.type))
      for (const o of inside) {
        if (o.electric?.kind !== 'outlet' && o.electric?.kind !== 'smart-outlet') continue
        for (const wsrc of water) {
          if (dist({ x: o.x, y: o.y }, { x: wsrc.x, y: wsrc.y }) < 60 + Math.max(wsrc.w, wsrc.d) / 2) {
            push({
              id: `wet-${o.id}`,
              level: 'warn',
              text: `Розетка в зоне брызг: до ${nameOf(wsrc)} меньше 60 см. Перенесите или ставьте влагозащищённую`,
              target: { kind: 'furniture', id: o.id },
            })
            break
          }
        }
      }
      for (const sw of inside) {
        if (sw.electric?.kind !== 'switch' && sw.electric?.kind !== 'smart-switch') continue
        push({
          id: `wetsw-${sw.id}`,
          level: 'info',
          text: `Выключатель внутри «${r.meta.name}»: обычно его выносят наружу`,
          target: { kind: 'furniture', id: sw.id },
        })
      }
    }
    // у спального места нужна розетка
    for (const A of items) {
      if (A.cat?.glyph !== 'bed') continue
      const near = electrics.some(
        (e) => (e.electric?.kind === 'outlet' || e.electric?.kind === 'smart-outlet') && dist({ x: e.x, y: e.y }, { x: A.f.x, y: A.f.y }) < 200,
      )
      if (!near) push({ id: `bedpower-${A.f.id}`, level: 'info', text: `У ${nameOf(A.f)} нет розетки в пределах 2 м`, target: { kind: 'furniture', id: A.f.id } })
    }
  }

  // 8. телевизор и диван
  const tv = plan.furniture.find((f) => f.type === 'tv')
  if (tv) {
    const seats = plan.furniture.filter((f) => ['sofa-3', 'sofa-2', 'sofa-corner', 'armchair'].includes(f.type))
    let nearest: { f: Furniture; d: number } | null = null
    for (const s of seats) {
      const d = dist({ x: s.x, y: s.y }, { x: tv.x, y: tv.y })
      if (!nearest || d < nearest.d) nearest = { f: s, d }
    }
    if (nearest && (nearest.d < 180 || nearest.d > 330)) {
      push({
        id: 'tv-dist',
        level: 'info',
        text: `От ${nameOf(nearest.f)} до телевизора ${(nearest.d / 100).toFixed(1)} м — для 55″ комфортно 2–3 м`,
        target: { kind: 'furniture', id: tv.id },
      })
    }
  }

  const order = { error: 0, warn: 1, info: 2 }
  issues.sort((a, b) => order[a.level] - order[b.level])
  // разрывы между стенами: из-за них комната не замыкается и не находится
  for (const g of findGaps(plan.walls).slice(0, 10)) {
    push({ id: `gap-${g.id}-${g.end}`, level: 'warn', text: `Стена не доходит до соседней на ${Math.max(1, Math.round(g.gap))} см — комната тут не замкнётся. «Замкнуть разрывы» выше исправит`, target: { kind: 'wall', id: g.id } })
  }
  return { issues, badZones, triangle, badDoors }
}
