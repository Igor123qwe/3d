// Сборка 3D-сцены (three.js) из плана: стены с проёмами, полы, мебель (боксы или модели).
// Единицы сцены — метры. План (x, y) → мир (x, 0, y), высота → Y.
import * as THREE from 'three'
import type { Furniture, Plan, Pt, Room } from './types'
import { CATALOG_MAP, CATEGORY_COLORS, FLOORS, dims3d } from './catalog'
import { openingGeom } from './checks'
import { wallsAtNode } from './snapping'
import { add, angleDeg, dist, mul, norm, perp, pointInPoly, sub } from './geometry'
import { loadModel } from './models'
import { buildFurnitureMesh, SHARED_MATERIAL } from './furniture3d'

export const M = 0.01
export const WALL_H = 270
export const DOOR_H = 210
export const WINDOW_SILL = 90
export const WINDOW_TOP = 230
const DEG = Math.PI / 180

export type WallsMode = 'solid' | 'ghost' | 'hidden'

export interface SceneOpts {
  wallsMode: WallsMode
  /** высота стен, см — из исходных данных плана (потолок); по умолчанию 270 */
  wallHeight?: number
  /** AR: без пола-подложки, стены полупрозрачные */
  ar?: boolean
  onModelLoaded?: () => void
  /** не удалось загрузить модель: предмет остался боксом */
  onModelError?: (name: string) => void
  /** сборка ещё нужна? модели грузятся асинхронно и могут опоздать к своей сцене */
  alive?: () => boolean
}

/** пометка «ресурсы общие с кэшем моделей» — такое поддерево освобождать нельзя */
const SHARED = 'sharedModel'

/** материалы библиотеки мебели общие для всех предметов — их освобождать нельзя */
function freeMaterial(m: THREE.Material): void {
  if (!m.userData?.[SHARED_MATERIAL]) m.dispose()
}

function disposeObject(o: THREE.Object3D): void {
  if (o.userData?.[SHARED]) return
  for (const child of [...o.children]) disposeObject(child)
  const m = o as THREE.Mesh
  if (m.geometry) m.geometry.dispose()
  const mat = m.material as THREE.Material | THREE.Material[] | undefined
  if (Array.isArray(mat)) mat.forEach(freeMaterial)
  else if (mat) freeMaterial(mat)
}

export function disposeGroup(g: THREE.Object3D): void {
  g.userData.disposed = true
  disposeObject(g)
  g.parent?.remove(g)
}

function edgesOf(geom: THREE.BufferGeometry, color = 0x3a3d44, opacity = 1): THREE.LineSegments {
  return new THREE.LineSegments(new THREE.EdgesGeometry(geom, 20), new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }))
}

// ---------- стены ----------
function buildWalls(plan: Plan, opts: SceneOpts): THREE.Group {
  const H = opts.wallHeight ?? WALL_H
  const g = new THREE.Group()
  g.name = 'walls'
  if (opts.wallsMode === 'hidden') return g
  const ghost = opts.wallsMode === 'ghost' || !!opts.ar
  const wallMat = new THREE.MeshStandardMaterial({
    color: ghost ? 0x8fa3c7 : 0xf3f2ee,
    roughness: 0.9,
    transparent: ghost,
    opacity: ghost ? 0.22 : 1,
    depthWrite: !ghost,
  })
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x9cc8ff, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0 })
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xc9a77b, roughness: 0.7 })

  for (const w of plan.walls) {
    const L = dist(w.a, w.b)
    if (L < 1) continue
    const dir = norm(sub(w.b, w.a))
    const ang = angleDeg(w.a, w.b) * DEG
    const ext = (p: Pt) => wallsAtNode(plan.walls, p).filter((o) => o.id !== w.id).reduce((m, o) => Math.max(m, o.thickness / 2), 0)
    const extA = ext(w.a)
    const extB = ext(w.b)
    const addBox = (s: number, e: number, y0: number, y1: number, mat = wallMat, thick = w.thickness) => {
      if (e - s < 0.5 || y1 - y0 < 0.5) return
      const c = add(w.a, mul(dir, (s + e) / 2))
      const geom = new THREE.BoxGeometry((e - s) * M, (y1 - y0) * M, thick * M)
      const mesh = new THREE.Mesh(geom, mat)
      mesh.position.set(c.x * M, ((y0 + y1) / 2) * M, c.y * M)
      mesh.rotation.y = -ang
      mesh.castShadow = !ghost
      mesh.receiveShadow = true
      g.add(mesh)
      if (mat === wallMat) {
        const ed = edgesOf(geom, ghost ? 0x5b74a8 : 0x3a3d44, ghost ? 0.9 : 1)
        ed.position.copy(mesh.position)
        ed.rotation.copy(mesh.rotation)
        g.add(ed)
      }
    }
    const ops = plan.openings
      .filter((o) => o.wallId === w.id)
      .map((o) => ({ o, s: o.t * L - o.width / 2, e: o.t * L + o.width / 2 }))
      .sort((p, q) => p.s - q.s)
    let cursor = -extA
    for (const { o, s, e } of ops) {
      if (s > cursor) addBox(cursor, s, 0, H)
      if (o.kind === 'window') {
        addBox(s, e, 0, WINDOW_SILL)
        addBox(s, e, WINDOW_TOP, H)
        const c = add(w.a, mul(dir, (s + e) / 2))
        const glass = new THREE.Mesh(new THREE.PlaneGeometry((e - s) * M, (WINDOW_TOP - WINDOW_SILL) * M), glassMat)
        glass.position.set(c.x * M, ((WINDOW_SILL + WINDOW_TOP) / 2) * M, c.y * M)
        glass.rotation.y = -ang
        g.add(glass)
        // рама
        const frameEdges = edgesOf(new THREE.BoxGeometry((e - s) * M, (WINDOW_TOP - WINDOW_SILL) * M, 4 * M), 0x6b6b6b)
        frameEdges.position.copy(glass.position)
        frameEdges.rotation.copy(glass.rotation)
        g.add(frameEdges)
      } else {
        addBox(s, e, DOOR_H, H)
        if (o.kind === 'door') {
          // открытое полотно двери
          const geo = openingGeom(o, w)
          const leafDir = norm(sub(geo.leafEnd, geo.hinge))
          const c = add(geo.hinge, mul(leafDir, o.width / 2))
          const leaf = new THREE.Mesh(new THREE.BoxGeometry(o.width * M, (DOOR_H - 2) * M, 4 * M), leafMat)
          leaf.position.set(c.x * M, (DOOR_H / 2) * M, c.y * M)
          leaf.rotation.y = -angleDeg(geo.hinge, geo.leafEnd) * DEG
          leaf.castShadow = !ghost
          g.add(leaf)
        }
      }
      cursor = Math.max(cursor, e)
    }
    if (cursor < L + extB) addBox(cursor, L + extB, 0, H)
  }
  return g
}

// ---------- полы ----------
function buildFloors(rooms: Room[], opts: SceneOpts): THREE.Group {
  const g = new THREE.Group()
  g.name = 'floors'
  for (const r of rooms) {
    if (r.inner.length < 3) continue
    const shape = new THREE.Shape(r.inner.map((p) => new THREE.Vector2(p.x * M, -p.y * M)))
    const geom = new THREE.ShapeGeometry(shape)
    const color = FLOORS.find((f) => f.key === r.meta.floor)?.color ?? '#eeeeee'
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.85,
      transparent: !!opts.ar,
      opacity: opts.ar ? 0.35 : 1,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = 0.002
    mesh.receiveShadow = true
    g.add(mesh)
    // контур комнаты на полу
    const pts = [...r.inner, r.inner[0]].map((p) => new THREE.Vector3(p.x * M, 0.004, p.y * M))
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x556070, transparent: true, opacity: 0.8 })))
  }
  return g
}

// ---------- мебель ----------
function placeholderFor(f: Furniture, h: number, elev: number, color: THREE.Color, ghost: boolean): THREE.Object3D {
  const cat = CATALOG_MAP[f.type]
  const holder = new THREE.Group()
  holder.name = 'placeholder'
  if (cat?.symbol) {
    const geom = new THREE.SphereGeometry(Math.max(f.w, f.d, 6) * 0.5 * M, 12, 8)
    const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0x332200 }))
    mesh.position.y = (elev + h / 2) * M
    holder.add(mesh)
    return holder
  }
  // параметрическая модель по виду предмета; если её нет — габаритный короб
  if (!ghost && cat?.glyph) {
    const shaped = buildFurnitureMesh(cat.glyph, f.w * M, f.d * M, h * M, color)
    if (shaped) {
      shaped.position.y = elev * M
      holder.add(shaped)
      return holder
    }
  }
  const geom = new THREE.BoxGeometry(f.w * M, h * M, f.d * M)
  const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color, roughness: 0.8, transparent: ghost, opacity: ghost ? 0.6 : 1 }))
  mesh.position.y = (elev + h / 2) * M
  mesh.castShadow = h > 2
  mesh.receiveShadow = true
  holder.add(mesh)
  const ed = edgesOf(geom, 0x2f3238, 0.9)
  ed.position.copy(mesh.position)
  holder.add(ed)
  return holder
}

/** вписать загруженную модель в габариты w×h×d и поставить низом на elev */
export function fitModel(model: THREE.Object3D, w: number, h: number, d: number, elev: number): void {
  model.rotation.set(0, 0, 0)
  model.scale.set(1, 1, 1)
  model.position.set(0, 0, 0)
  model.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const sx = size.x > 1e-6 ? (w * M) / size.x : 1
  const sy = size.y > 1e-6 ? (h * M) / size.y : 1
  const sz = size.z > 1e-6 ? (d * M) / size.z : 1
  model.scale.set(sx, sy, sz)
  model.updateMatrixWorld(true)
  const box2 = new THREE.Box3().setFromObject(model)
  const c = box2.getCenter(new THREE.Vector3())
  model.position.set(-c.x, -box2.min.y + elev * M, -c.z)
}

function buildFurniture(plan: Plan, opts: SceneOpts): THREE.Group {
  const g = new THREE.Group()
  g.name = 'furniture'
  for (const f of plan.furniture) {
    const cat = CATALOG_MAP[f.type]
    const { h, elev } = dims3d(f)
    const color = new THREE.Color(f.color || CATEGORY_COLORS[cat?.category ?? 'misc'])
    const item = new THREE.Group()
    item.name = `item:${f.id}`
    item.userData = { furnitureId: f.id }
    item.position.set(f.x * M, 0, f.y * M)
    item.rotation.y = -f.rot * DEG
    if (f.flip) item.scale.x = -1
    const ph = placeholderFor(f, h, elev, color, !!f.model)
    item.add(ph)
    g.add(item)
    if (f.model) {
      const ref = f.model
      loadModel(ref)
        .then((model) => {
          if (!item.parent || opts.alive?.() === false || g.userData.disposed) return
          fitModel(model, f.w, h, f.d, elev)
          model.name = 'model'
          // геометрия и материалы общие с кэшем: их нельзя освобождать вместе со сценой
          model.userData[SHARED] = true
          item.remove(ph)
          disposeObject(ph)
          item.add(model)
          opts.onModelLoaded?.()
        })
        .catch(() => {
          // предмет остаётся боксом — об этом нужно сказать пользователю
          opts.onModelError?.(f.label || ref.name || cat?.name || f.type)
        })
    }
  }
  return g
}

export interface PlanGroup {
  group: THREE.Group
  center: THREE.Vector3
  size: number
}

/** контур плана по стенам (см) */
export function planBox(plan: Plan): { min: Pt; max: Pt } {
  const pts: Pt[] = []
  for (const w of plan.walls) pts.push(w.a, w.b)
  for (const f of plan.furniture) pts.push({ x: f.x, y: f.y })
  if (!pts.length) return { min: { x: 0, y: 0 }, max: { x: 600, y: 400 } }
  const min = { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) }
  const max = { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) }
  return { min, max }
}

export function buildPlanGroup(plan: Plan, rooms: Room[], opts: SceneOpts): PlanGroup {
  const group = new THREE.Group()
  group.name = 'plan'
  group.add(buildFloors(rooms, opts))
  group.add(buildWalls(plan, opts))
  group.add(buildFurniture(plan, opts))
  const b = planBox(plan)
  const center = new THREE.Vector3(((b.min.x + b.max.x) / 2) * M, 0, ((b.min.y + b.max.y) / 2) * M)
  const size = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, 300) * M
  return { group, center, size }
}

const OUTLINE = 'selection-outline'

/** Подсветить выбранный предмет контуром. Материалы моделей общие с кэшем,
 *  поэтому менять их свойства нельзя — подсветилась бы вся копия предмета. */
export function highlightSelection(group: THREE.Object3D, id: string | null | undefined): void {
  const prev = group.getObjectByName(OUTLINE) as THREE.Box3Helper | undefined
  if (prev) {
    group.remove(prev)
    prev.geometry?.dispose()
    ;(prev.material as THREE.Material | undefined)?.dispose()
  }
  if (!id) return
  let target: THREE.Object3D | null = null
  group.traverse((o) => {
    if (o.userData?.furnitureId === id) target = o
  })
  if (!target) return
  const box = new THREE.Box3().setFromObject(target)
  if (box.isEmpty()) return
  box.expandByScalar(0.02)
  const helper = new THREE.Box3Helper(box, new THREE.Color(0x2563eb))
  helper.name = OUTLINE
  group.add(helper)
}

// ---------- якорь для AR ----------
export interface AnchorInfo {
  /** точка на плане, см: середина порога входной двери */
  p0: Pt
  /** единичный вектор «внутрь квартиры» (в координатах плана) */
  forward: Pt
  /** ширина двери, см */
  width: number
  label: string
}

/** входная дверь: дверь на наружной стене (комната только с одной стороны) */
export function findAnchor(plan: Plan, rooms: Room[]): AnchorInfo {
  const doors = plan.openings.filter((o) => o.kind === 'door' || o.kind === 'doorway')
  let best: AnchorInfo | null = null
  let bestScore = -1
  for (const o of doors) {
    const w = plan.walls.find((x) => x.id === o.wallId)
    if (!w) continue
    const g = openingGeom(o, w)
    const n = perp(g.dir)
    const inside = (s: number) => rooms.some((r) => pointInPoly(add(g.center, mul(n, s * (w.thickness / 2 + 25))), r.polygon))
    const plus = inside(1)
    const minus = inside(-1)
    const exterior = plus !== minus
    const score = (exterior ? 10 : 0) + (o.kind === 'door' ? 1 : 0) + o.width / 1000
    if (score > bestScore) {
      bestScore = score
      const forward = plus && !minus ? n : minus && !plus ? mul(n, -1) : mul(n, o.side)
      best = { p0: g.center, forward, width: o.width, label: exterior ? 'Входная дверь' : 'Дверь' }
    }
  }
  if (best) return best
  const b = planBox(plan)
  return { p0: { x: (b.min.x + b.max.x) / 2, y: b.max.y }, forward: { x: 0, y: -1 }, width: 90, label: 'Нижний край плана' }
}

/** угол поворота вокруг Y для направления (dx, dz) в мире */
export const yawOf = (dx: number, dz: number): number => Math.atan2(-dz, dx)
