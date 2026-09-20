// Загрузка 3D-моделей (glTF/GLB) для 3D-вида и AR с кэшированием.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { ModelRef } from './types'
import { modelKey, phModelUrl } from './polyhaven'

const modelCache = new Map<string, Promise<THREE.Group>>()

/** загрузка модели с кэшированием; возвращает копию сцены glTF */
export function loadModel(ref: ModelRef): Promise<THREE.Group> {
  const key = modelKey(ref)
  let p = modelCache.get(key)
  if (!p) {
    p = (async () => {
      let url = ref.id
      let include: Record<string, string> = {}
      if (ref.provider === 'polyhaven') {
        const m = await phModelUrl(ref.id)
        if (!m) throw new Error('Модель недоступна')
        url = m.url
        include = m.include
      }
      const manager = new THREE.LoadingManager()
      const base = url.slice(0, url.lastIndexOf('/') + 1)
      manager.setURLModifier((u) => {
        for (const [rel, abs] of Object.entries(include)) {
          if (u === base + rel || u === base + encodeURI(rel) || u.endsWith(`/${rel}`)) return abs
        }
        return u
      })
      const loader = new GLTFLoader(manager)
      const gltf = await loader.loadAsync(url)
      const g = gltf.scene
      g.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh) {
          m.castShadow = true
          m.receiveShadow = true
        }
      })
      return g
    })()
    p.catch(() => modelCache.delete(key))
    modelCache.set(key, p)
  }
  return p.then((g) => g.clone(true))
}
