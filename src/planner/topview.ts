// Рендер вида сверху 3D-модели в картинку — для фотореалистичного 2D-плана.
import * as THREE from 'three'
import type { ModelRef } from './types'
import { loadModel } from './models'
import { fitModel, M } from './scene3d'
import { modelKey } from './polyhaven'

let renderer: THREE.WebGLRenderer | null = null
const cache = new Map<string, Promise<string>>()

export const topViewKey = (ref: ModelRef, w: number, d: number, h: number): string => `${modelKey(ref)}|${Math.round(w)}x${Math.round(d)}x${Math.round(h)}`

function getRenderer(): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
  }
  return renderer
}

/** PNG (data URL) с видом сверху: ширина картинки — вдоль w, высота — вдоль d, «спинка» объекта сверху */
export function renderTopView(ref: ModelRef, w: number, d: number, h: number): Promise<string> {
  const key = topViewKey(ref, w, d, h)
  let p = cache.get(key)
  if (!p) {
    p = (async () => {
      const model = await loadModel(ref)
      fitModel(model, w, h, d, 0)
      const scene = new THREE.Scene()
      scene.add(model)
      scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 1.3))
      const sun = new THREE.DirectionalLight(0xffffff, 1.6)
      sun.position.set(1, 4, 2)
      scene.add(sun)
      const hw = (w * M) / 2
      const hd = (d * M) / 2
      const cam = new THREE.OrthographicCamera(-hw, hw, hd, -hd, 0.01, 100)
      cam.position.set(0, 20, 0)
      cam.up.set(0, 0, -1)
      cam.lookAt(0, 0, 0)
      const px = Math.max(48, Math.min(512, Math.round(w * 2)))
      const py = Math.max(48, Math.min(512, Math.round((px * d) / w)))
      const r = getRenderer()
      r.setSize(px, py, false)
      r.setClearColor(0x000000, 0)
      r.render(scene, cam)
      const url = r.domElement.toDataURL('image/png')
      scene.remove(model)
      return url
    })()
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}
