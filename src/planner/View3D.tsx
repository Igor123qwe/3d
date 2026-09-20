// 3D-вид плана и AR-режим (WebXR) с привязкой к входной двери. iPhone: Quick Look (USDZ).
import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js'
import type { Plan, Room, Selection } from './types'
import { buildPlanGroup, disposeGroup, findAnchor, highlightSelection, yawOf, M, type AnchorInfo, type WallsMode } from './scene3d'

export interface View3DProps {
  plan: Plan
  rooms: Room[]
  selection: Selection
  onSelect: (s: Selection) => void
  onExit: () => void
  onToast: (t: string) => void
  onShare: () => void
}

interface ThreeState {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  ground: THREE.Group
  reticle: THREE.Mesh
  marker: THREE.Group
  markerBar: THREE.Mesh
  group: THREE.Group | null
  center: THREE.Vector3
  size: number
}

interface XRState {
  active: boolean
  anchored: boolean
  yawOffset: number
  nudge: THREE.Vector3
  anchorPos: THREE.Vector3 | null
  heading: number
  lastHit: THREE.Vector3 | null
  hitTestSource: XRHitTestSource | null
  session: XRSession | null
  hasHitUi: boolean
}

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const DEG = Math.PI / 180
const isIOS = (): boolean => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const WALL_LABEL: Record<WallsMode, string> = { solid: 'обычные', ghost: 'прозрачные', hidden: 'скрыты' }
const nextWalls = (m: WallsMode): WallsMode => (m === 'solid' ? 'ghost' : m === 'ghost' ? 'hidden' : 'solid')

function currentHeading(renderer: THREE.WebGLRenderer): number {
  const dir = new THREE.Vector3()
  renderer.xr.getCamera().getWorldDirection(dir)
  if (Math.hypot(dir.x, dir.z) < 1e-3) return 0
  return yawOf(dir.x, dir.z)
}

export const View3D: React.FC<View3DProps> = ({ plan, rooms, selection, onSelect, onExit, onToast, onShare }) => {
  const wrapRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const arControlsRef = useRef<HTMLDivElement>(null)
  const three = useRef<ThreeState | null>(null)
  const xr = useRef<XRState>({ active: false, anchored: false, yawOffset: 0, nudge: new THREE.Vector3(), anchorPos: null, heading: 0, lastHit: null, hitTestSource: null, session: null, hasHitUi: false })
  const anchorRef = useRef<AnchorInfo>(findAnchor(plan, rooms))
  const buildId = useRef(0)
  const reportedModelErrors = useRef(new Set<string>())
  const planRef = useRef(plan)
  planRef.current = plan
  const roomsRef = useRef(rooms)
  roomsRef.current = rooms
  const selRef = useRef(selection)
  selRef.current = selection
  const [wallsMode, setWallsMode] = useState<WallsMode>('solid')
  const wallsRef = useRef(wallsMode)
  wallsRef.current = wallsMode
  const [arSupported, setArSupported] = useState(false)
  const [arUi, setArUi] = useState({ active: false, anchored: false, yaw: 0, hasHit: false })
  const [busy, setBusy] = useState<string | null>(null)
  const fitted = useRef(false)
  const pointer = useRef<{ x: number; y: number; t: number } | null>(null)

  useEffect(() => {
    anchorRef.current = findAnchor(plan, rooms)
  }, [plan, rooms])

  useEffect(() => {
    let alive = true
    navigator.xr
      ?.isSessionSupported('immersive-ar')
      .then((v) => alive && setArSupported(v))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const selId = () => (selRef.current?.kind === 'furniture' ? selRef.current.id : null)

  const fitCamera = (mode: 'iso' | 'top') => {
    const t = three.current
    if (!t) return
    const c = t.center
    const s = t.size
    if (mode === 'top') t.camera.position.set(c.x, s * 1.35 + 1, c.z + 0.001)
    else t.camera.position.set(c.x + s * 0.7, s * 0.65 + 1.5, c.z + s * 0.85)
    t.controls.target.copy(c)
    t.controls.update()
  }

  /** AR: поставить план по якорю (порог входной двери) */
  const placeGroup = () => {
    const t = three.current
    const x = xr.current
    if (!t?.group) return
    const pos = x.anchored ? x.anchorPos : x.lastHit
    if (!pos) return
    const heading = x.anchored ? x.heading : currentHeading(t.renderer)
    const a = anchorRef.current
    const theta = heading - yawOf(a.forward.x, a.forward.y) + x.yawOffset
    const p0 = new THREE.Vector3(a.p0.x * M, 0, a.p0.y * M).applyAxisAngle(Y_AXIS, theta)
    t.group.rotation.set(0, theta, 0)
    t.group.position.copy(pos).sub(p0).add(x.nudge)
    t.group.visible = true
    t.marker.position.copy(pos).add(x.nudge)
    t.marker.rotation.set(0, heading + x.yawOffset + Math.PI / 2, 0)
    t.markerBar.scale.x = Math.max(0.3, a.width * M)
    t.marker.visible = true
  }

  const rebuild = () => {
    const t = three.current
    if (!t) return
    if (t.group) disposeGroup(t.group)
    const build = ++buildId.current
    const built = buildPlanGroup(planRef.current, roomsRef.current, {
      wallsMode: wallsRef.current,
      ar: xr.current.active,
      alive: () => buildId.current === build,
      onModelLoaded: () => {
        if (buildId.current === build && three.current?.group) highlightSelection(three.current.group, selId())
      },
      onModelError: (name) => {
        if (buildId.current !== build || reportedModelErrors.current.has(name)) return
        reportedModelErrors.current.add(name)
        onToast(`Не удалось загрузить модель «${name}» — предмет показан габаритами`)
      },
    })
    t.group = built.group
    t.center = built.center
    t.size = built.size
    t.scene.add(built.group)
    highlightSelection(built.group, selId())
    if (xr.current.active) {
      built.group.visible = false
      placeGroup()
    } else if (!fitted.current) {
      fitCamera('iso')
      fitted.current = true
    }
  }

  const handleXRFrame = (frame: XRFrame) => {
    const t = three.current
    const x = xr.current
    if (!t) return
    const refSpace = t.renderer.xr.getReferenceSpace()
    if (!refSpace) return
    if (x.hitTestSource) {
      const hits = frame.getHitTestResults(x.hitTestSource)
      const pose = hits.length ? hits[0].getPose(refSpace) : null
      if (pose) {
        t.reticle.visible = !x.anchored
        t.reticle.matrix.fromArray(pose.transform.matrix)
        x.lastHit = new THREE.Vector3().setFromMatrixPosition(t.reticle.matrix)
      } else {
        t.reticle.visible = false
        if (!x.anchored) x.lastHit = null
      }
    }
    if (!x.anchored) {
      if (x.lastHit) placeGroup()
      else if (t.group) {
        t.group.visible = false
        t.marker.visible = false
      }
    }
    const hasHit = !!x.lastHit
    if (hasHit !== x.hasHitUi) {
      x.hasHitUi = hasHit
      setArUi((u) => ({ ...u, hasHit }))
    }
  }

  // ---------- инициализация three ----------
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(el.clientWidth || 300, el.clientHeight || 300)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    el.insertBefore(renderer.domElement, el.firstChild)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xe6eaf0)
    const camera = new THREE.PerspectiveCamera(50, (el.clientWidth || 1) / (el.clientHeight || 1), 0.05, 300)
    camera.position.set(6, 6, 8)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.1
    controls.maxPolarAngle = Math.PI / 2 - 0.03
    controls.minDistance = 0.5
    controls.maxDistance = 80

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c0cc, 1.1))
    const sun = new THREE.DirectionalLight(0xffffff, 2.2)
    sun.position.set(8, 14, 6)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -20
    sun.shadow.camera.right = 20
    sun.shadow.camera.top = 20
    sun.shadow.camera.bottom = -20
    sun.shadow.camera.near = 0.5
    sun.shadow.camera.far = 60
    sun.shadow.bias = -0.0005
    scene.add(sun)

    const ground = new THREE.Group()
    const gm = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0xdde2e8, roughness: 1 }))
    gm.rotation.x = -Math.PI / 2
    gm.position.y = -0.003
    gm.receiveShadow = true
    ground.add(gm)
    const grid = new THREE.GridHelper(100, 100, 0xc5cbd3, 0xd9dee5)
    grid.position.y = -0.001
    ground.add(grid)
    scene.add(ground)

    const reticle = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2563eb }))
    reticle.matrixAutoUpdate = false
    reticle.visible = false
    scene.add(reticle)

    const marker = new THREE.Group()
    const markerBar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.012, 0.05), new THREE.MeshBasicMaterial({ color: 0x2563eb }))
    marker.add(markerBar)
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 12).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x16a34a }))
    arrow.position.set(0, 0.01, 0.2)
    marker.add(arrow)
    marker.visible = false
    scene.add(marker)

    three.current = { renderer, scene, camera, controls, ground, reticle, marker, markerBar, group: null, center: new THREE.Vector3(), size: 6 }

    renderer.setAnimationLoop((_time: number, frame?: XRFrame) => {
      const t = three.current
      if (!t) return
      if (frame && xr.current.active) handleXRFrame(frame)
      else t.controls.update()
      t.renderer.render(t.scene, t.camera)
    })

    const resize = () => {
      if (xr.current.active) return
      const w = el.clientWidth
      const h = el.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    rebuild()

    return () => {
      ro.disconnect()
      renderer.setAnimationLoop(null)
      xr.current.session?.end().catch(() => {})
      if (three.current?.group) disposeGroup(three.current.group)
      renderer.dispose()
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement)
      three.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = setTimeout(rebuild, 80)
    return () => clearTimeout(id)
  }, [plan, rooms, wallsMode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (three.current?.group) highlightSelection(three.current.group, selId())
  }, [selection]) // eslint-disable-line react-hooks/exhaustive-deps

  // тапы по кнопкам AR-панели не должны становиться XR-выбором
  useEffect(() => {
    const el = arControlsRef.current
    if (!el) return
    const stop = (e: Event) => e.preventDefault()
    el.addEventListener('beforexrselect', stop)
    return () => el.removeEventListener('beforexrselect', stop)
  }, [arUi.active])

  // ---------- выбор кликом ----------
  const onPointerDown = (e: React.PointerEvent) => {
    pointer.current = { x: e.clientX, y: e.clientY, t: Date.now() }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const p = pointer.current
    pointer.current = null
    const t = three.current
    if (!p || !t?.group || xr.current.active) return
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6 || Date.now() - p.t > 600) return
    const rect = t.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, t.camera)
    const furn = t.group.getObjectByName('furniture')
    const hits = furn ? ray.intersectObjects(furn.children, true) : []
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object
      while (o && !o.userData?.furnitureId) o = o.parent
      if (o?.userData?.furnitureId) {
        onSelect({ kind: 'furniture', id: o.userData.furnitureId as string })
        return
      }
    }
    onSelect(null)
  }

  // ---------- AR (WebXR) ----------
  const endAR = () => {
    xr.current.session?.end().catch(() => {})
  }

  const onXREnd = () => {
    const t = three.current
    const x = xr.current
    x.active = false
    x.anchored = false
    x.session = null
    x.hitTestSource = null
    x.lastHit = null
    x.hasHitUi = false
    if (t) {
      t.renderer.xr.enabled = false
      t.scene.background = new THREE.Color(0xe6eaf0)
      t.ground.visible = true
      t.controls.enabled = true
      t.reticle.visible = false
      t.marker.visible = false
      const el = wrapRef.current
      if (el && el.clientWidth && el.clientHeight) {
        t.renderer.setSize(el.clientWidth, el.clientHeight)
        t.camera.aspect = el.clientWidth / el.clientHeight
        t.camera.updateProjectionMatrix()
      }
      rebuild()
      fitCamera('iso')
    }
    setArUi({ active: false, anchored: false, yaw: 0, hasHit: false })
  }

  const startAR = async () => {
    const t = three.current
    if (!t || !navigator.xr) return
    try {
      const overlay = overlayRef.current
      const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'local-floor', 'light-estimation'],
        domOverlay: overlay ? { root: overlay } : undefined,
      })
      const x = xr.current
      x.session = session
      x.active = true
      x.anchored = false
      x.yawOffset = 0
      x.nudge.set(0, 0, 0)
      x.lastHit = null
      t.renderer.xr.enabled = true
      t.renderer.xr.setReferenceSpaceType('local')
      await t.renderer.xr.setSession(session)
      t.scene.background = null
      t.ground.visible = false
      t.controls.enabled = false
      const viewer = await session.requestReferenceSpace('viewer')
      x.hitTestSource = (await session.requestHitTestSource?.({ space: viewer })) ?? null
      session.addEventListener('select', () => {
        const xs = xr.current
        if (!xs.anchored && xs.lastHit && three.current) {
          xs.anchorPos = xs.lastHit.clone()
          xs.heading = currentHeading(three.current.renderer)
          xs.anchored = true
          placeGroup()
          setArUi((u) => ({ ...u, anchored: true }))
        }
      })
      session.addEventListener('end', onXREnd)
      rebuild()
      setArUi({ active: true, anchored: false, yaw: 0, hasHit: false })
    } catch (e) {
      onToast(`Не удалось запустить AR: ${(e as Error).message}`)
      onXREnd()
    }
  }

  const setYaw = (deg: number) => {
    xr.current.yawOffset = deg * DEG
    placeGroup()
    setArUi((u) => ({ ...u, yaw: deg }))
  }
  const nudge = (dx: number, dz: number) => {
    const t = three.current
    if (!t?.group) return
    const v = new THREE.Vector3(dx * M, 0, dz * M).applyAxisAngle(Y_AXIS, t.group.rotation.y)
    xr.current.nudge.add(v)
    placeGroup()
  }
  const reanchor = () => {
    xr.current.anchored = false
    xr.current.nudge.set(0, 0, 0)
    setArUi((u) => ({ ...u, anchored: false }))
  }

  // ---------- iPhone: Quick Look ----------
  const quickLook = async () => {
    setBusy('Готовим модель для AR…')
    try {
      let pending = planRef.current.furniture.filter((f) => f.model).length
      const built = buildPlanGroup(planRef.current, roomsRef.current, {
        wallsMode: 'ghost',
        ar: true,
        onModelLoaded: () => (pending -= 1),
        onModelError: () => (pending -= 1),
      })
      const a = anchorRef.current
      built.group.position.set(-a.p0.x * M, 0, -a.p0.y * M)
      const holder = new THREE.Group()
      holder.add(built.group)
      const deadline = Date.now() + 6000
      while (pending > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 150))
      const data = await new USDZExporter().parseAsync(holder, { quickLookCompatible: true, maxTextureSize: 1024 })
      disposeGroup(built.group)
      const blob = new Blob([data], { type: 'model/vnd.usdz+zip' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.rel = 'ar'
      link.href = url
      link.download = 'plan.usdz'
      const img = document.createElement('img')
      img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
      link.appendChild(img)
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      setTimeout(() => {
        link.remove()
        URL.revokeObjectURL(url)
      }, 60000)
    } catch (e) {
      onToast(`Не удалось подготовить USDZ: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const anchor = anchorRef.current
  const wallsBtn = (
    <button className="pl-btn" onClick={() => setWallsMode((m) => nextWalls(m))}>
      Стены: {WALL_LABEL[wallsMode]}
    </button>
  )

  return (
    <div className="pl3d-wrap" ref={wrapRef} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <div className="pl3d-overlay" ref={overlayRef}>
        {!arUi.active && (
          <>
            <div className="pl3d-bar">
              <button className="pl-btn" onClick={onExit}>
                ← 2D
              </button>
              <button className="pl-btn" onClick={() => fitCamera('iso')}>
                Изометрия
              </button>
              <button className="pl-btn" onClick={() => fitCamera('top')}>
                Сверху
              </button>
              {wallsBtn}
              {arSupported && (
                <button className="pl-btn active" onClick={startAR}>
                  📷 AR через камеру
                </button>
              )}
              {!arSupported && isIOS() && (
                <button className="pl-btn active" onClick={quickLook} disabled={!!busy}>
                  📷 AR на iPhone
                </button>
              )}
              <button className="pl-btn" onClick={onShare}>
                📱 Ссылка для телефона
              </button>
            </div>
            <div className="pl3d-hint">
              Вращение — левая кнопка или палец, сдвиг — правая кнопка или два пальца, масштаб — колесо или щипок. Клик по предмету выбирает его. Якорь для AR: {anchor.label.toLowerCase()}.
            </div>
          </>
        )}
        {arUi.active && (
          <div className="pl3d-ar" ref={arControlsRef}>
            <div className="pl3d-ar-step">
              {!arUi.anchored
                ? arUi.hasHit
                  ? `Встаньте в проёме («${anchor.label}»), смотрите внутрь квартиры, наведите кольцо на порог и коснитесь экрана`
                  : 'Медленно поводите телефоном, чтобы камера нашла пол'
                : 'План закреплён. Подстройте поворот и положение, если нужно'}
            </div>
            {arUi.anchored && (
              <div className="pl3d-ar-tune">
                <label>
                  Поворот {arUi.yaw}°
                  <input type="range" min={-180} max={180} step={1} value={arUi.yaw} onChange={(e) => setYaw(Number(e.target.value))} />
                </label>
                <div className="pl3d-ar-nudge">
                  <button className="pl-ibtn" onClick={() => nudge(-5, 0)}>◀</button>
                  <button className="pl-ibtn" onClick={() => nudge(5, 0)}>▶</button>
                  <button className="pl-ibtn" onClick={() => nudge(0, -5)}>▲</button>
                  <button className="pl-ibtn" onClick={() => nudge(0, 5)}>▼</button>
                  <span>по 5 см</span>
                  <button className="pl-btn" onClick={reanchor}>
                    Переставить
                  </button>
                </div>
              </div>
            )}
            <div className="pl3d-ar-actions">
              {wallsBtn}
              <button className="pl-btn danger" onClick={endAR}>
                Выйти из AR
              </button>
            </div>
          </div>
        )}
        {busy && <div className="pl3d-busy">{busy}</div>}
      </div>
    </div>
  )
}

export default View3D
