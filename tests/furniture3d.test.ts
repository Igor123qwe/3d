import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildFurnitureMesh, SHARED_MATERIAL } from '../src/planner/furniture3d'
import { CATALOG } from '../src/planner/catalog'
import type { GlyphKind } from '../src/planner/catalog'

/** виды, для которых модели нет: светильники и электрика рисуются отдельно */
const SYMBOLIC: GlyphKind[] = ['outlet', 'switch', 'light', 'spot', 'lamp', 'sensor', 'thermostat', 'curtain', 'panel']

/** все виды, встречающиеся в каталоге */
const glyphs = [...new Set(CATALOG.map((c) => c.glyph))]
const shaped = glyphs.filter((g) => !SYMBOLIC.includes(g))

const GREY = new THREE.Color(0xc8c8c8)

function boundsOf(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true)
  return new THREE.Box3().setFromObject(o)
}

describe('библиотека 3D-мебели', () => {
  it('в каталоге нет вида без модели и без символа', () => {
    for (const c of CATALOG) {
      if (c.symbol) continue
      expect(SYMBOLIC.includes(c.glyph) || buildFurnitureMesh(c.glyph, 1, 1, 1, GREY) !== null, `${c.type} (${c.glyph})`).toBe(true)
    }
  })

  it('символические виды модели не дают', () => {
    for (const g of SYMBOLIC) expect(buildFurnitureMesh(g, 0.5, 0.5, 0.5, GREY), g).toBeNull()
  })

  it('вырожденные габариты модели не дают', () => {
    for (const bad of [[0, 1, 1], [1, 0, 1], [1, 1, 0], [-1, 1, 1], [NaN, 1, 1]]) {
      expect(buildFurnitureMesh('bed', bad[0], bad[1], bad[2], GREY)).toBeNull()
    }
  })

  // главное свойство: предмет обязан помещаться в свой габарит из плана,
  // иначе в 2D и 3D он будет занимать разное место
  it.each(shaped)('%s помещается в габарит и стоит на полу', (glyph) => {
    for (const [w, d, h] of [
      [1.6, 2, 0.5],
      [0.4, 0.4, 2.4],
      [3, 0.6, 0.9],
      [0.3, 1.8, 0.05],
    ]) {
      const o = buildFurnitureMesh(glyph, w, d, h, GREY)
      expect(o, glyph).not.toBeNull()
      const b = boundsOf(o!)
      const tol = 1e-6
      expect(b.min.y, `${glyph} ${w}x${d}x${h} низ`).toBeGreaterThan(-tol)
      expect(b.max.y, `${glyph} ${w}x${d}x${h} верх`).toBeLessThan(h + tol)
      expect(b.max.x - b.min.x, `${glyph} ${w}x${d}x${h} ширина`).toBeLessThan(w + tol)
      expect(b.max.z - b.min.z, `${glyph} ${w}x${d}x${h} глубина`).toBeLessThan(d + tol)
      // центр габарита в нуле по X и Z
      expect(Math.abs(b.max.x + b.min.x), `${glyph} центр X`).toBeLessThan(w * 0.5)
      expect(Math.abs(b.max.z + b.min.z), `${glyph} центр Z`).toBeLessThan(d * 0.5)
    }
  })

  it.each(shaped)('%s заполняет габарит, а не жмётся в точку', (glyph) => {
    const [w, d, h] = [1.4, 0.9, 1.1]
    const b = boundsOf(buildFurnitureMesh(glyph, w, d, h, GREY)!)
    // ковёр и зеркало плоские по одной оси — проверяем только две большие стороны
    const fill = [(b.max.x - b.min.x) / w, (b.max.z - b.min.z) / d, (b.max.y - b.min.y) / h].sort((a, x) => x - a)
    expect(fill[0], `${glyph} главная сторона`).toBeGreaterThan(0.6)
    expect(fill[1], `${glyph} вторая сторона`).toBeGreaterThan(0.3)
  })

  it.each(shaped)('%s состоит из живой геометрии', (glyph) => {
    const o = buildFurnitureMesh(glyph, 1.2, 0.8, 0.9, GREY)!
    let meshes = 0
    o.traverse((c) => {
      const m = c as THREE.Mesh
      if (!m.isMesh) return
      meshes++
      const pos = m.geometry.getAttribute('position')
      expect(pos, glyph).toBeTruthy()
      expect(pos.count, glyph).toBeGreaterThan(2)
      for (let i = 0; i < pos.count * pos.itemSize; i++) expect(Number.isFinite(pos.array[i]), `${glyph} NaN в вершине`).toBe(true)
    })
    expect(meshes, `${glyph} число деталей`).toBeGreaterThan(0)
    expect(o.name).toBe(`furniture:${glyph}`)
  })

  // материалы общие на всю сцену: сцена их не освобождает, см. disposeObject
  it('все материалы помечены как общие и переиспользуются', () => {
    const seen = new Set<THREE.Material>()
    for (const glyph of shaped) {
      const o = buildFurnitureMesh(glyph, 1, 1, 1, GREY)!
      o.traverse((c) => {
        const m = c as THREE.Mesh
        if (!m.isMesh) return
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          expect(mat.userData[SHARED_MATERIAL], `${glyph}: ${mat.name || mat.type}`).toBe(true)
          seen.add(mat)
        }
      })
    }
    // вторая сборка тех же предметов не должна плодить новые материалы
    const before = seen.size
    for (const glyph of shaped) {
      buildFurnitureMesh(glyph, 2, 2, 2, GREY)!.traverse((c) => {
        const m = c as THREE.Mesh
        if (m.isMesh) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) seen.add(mat)
      })
    }
    expect(seen.size).toBe(before)
  })

  it('геометрия у каждого предмета своя — её освобождать можно', () => {
    const a = buildFurnitureMesh('bed', 1.6, 2, 0.5, GREY)!
    const b = buildFurnitureMesh('bed', 1.6, 2, 0.5, GREY)!
    const geoms = new Set<THREE.BufferGeometry>()
    for (const o of [a, b]) o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) geoms.add(m.geometry) })
    let count = 0
    a.traverse((c) => { if ((c as THREE.Mesh).isMesh) count++ })
    expect(geoms.size).toBe(count * 2)
  })

  it('цвет предмета попадает в материалы', () => {
    const red = new THREE.Color(0xcc3344)
    const o = buildFurnitureMesh('wardrobe', 1.2, 0.6, 2.2, red)!
    const hues: number[] = []
    o.traverse((c) => {
      const m = c as THREE.Mesh
      if (m.isMesh) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) hues.push((mat as THREE.MeshStandardMaterial).color.getHSL({ h: 0, s: 0, l: 0 }).h)
    })
    expect(hues.some((h) => Math.abs(h - red.getHSL({ h: 0, s: 0, l: 0 }).h) < 0.03)).toBe(true)
  })
})
