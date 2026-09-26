import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { DimRef, DimensionLine, EditMode, Furniture, Layers, LengthUnit, Opening, Plan, Pt, Room, Selection, Tool, Wall, WallRef } from './types'
import type { Area } from './ops'
import type { PlanHistory } from './store'
import type { CatalogItem } from './catalog'
import { CATALOG_MAP, itemMode } from './catalog'
import { openingGeom, type CheckResult } from './checks'
import { Glyph } from './Glyph'
import { ACCENT, Scene, planBounds, ptsAttr, sortedFurniture, wallPolygon } from './Scene'
import { snapFurniture, snapOpening, snapWallPoint, type Guide } from './snapping'
import { deleteRun, deleteSection, movedSection, normalizeWalls, pushRun, refLength, runSection, runSpan, setRoomSide, stretchRun, touchesLocked, wallAtCorner, wallRun, type WallRun } from './walledit'
import { buildRooms } from './rooms'
import { addDimRef, dimSnap, squareDim } from './dims'
import type { ElectricDesign } from './electricplan'
import {
  addFurniture,
  addOpening,
  addRect,
  addWall,
  cleanupWalls,
  deleteSelection,
  duplicateFurniture,
  moveNodes,
  normalizeArea,
  nudgeFurniture,
  OPENING_DEFAULT_WIDTH,
  rotateFurniture,
  updateDim,
  updateFurniture,
  updateOpening,
} from './ops'
import {
  add,
  angleDeg,
  clamp,
  dist,
  dot,
  eq,
  fmtLen,
  lerp,
  mul,
  norm,
  normDeg,
  obbCorners,
  perp,
  pointInPoly,
  pointSegDist,
  rotate,
  roundTo,
  snapPt,
  sub,
} from './geometry'

export interface View {
  x: number
  y: number
  zoom: number
}

export interface CanvasHandle {
  fit: () => void
  zoomBy: (k: number) => void
  centerOn: (p: Pt) => void
  finishDraft: () => void
}

export interface CanvasProps {
  plan: Plan
  rooms: Room[]
  check: CheckResult
  badItems: Set<string>
  history: PlanHistory
  tool: Tool
  onToolChange: (t: Tool) => void
  selection: Selection
  onSelect: (s: Selection) => void
  layers: Layers
  unit: LengthUnit
  ortho: boolean
  wallThickness: number
  placing: CatalogItem | null
  view: View
  onViewChange: (v: View) => void
  onHint: (text: string) => void
  photos?: Record<string, string>
  /** пользователь показал отрезок известной длины на подложке */
  onCalibrate?: (a: Pt, b: Pt, cm: number) => void
  /** линии, найденные на картинке подложки: магнит при обводке */
  imageLines?: Guide[]
  /** клик внутри комнаты на картинке */
  onRoomPick?: (p: Pt) => void
  /** четыре угла наружных стен на фото */
  onCorners?: (pts: Pt[]) => void
  /** обведён спорный участок: что там на самом деле — решает страница */
  onRefine?: (area: Area) => void
  /** короткое сообщение пользователю: правка разомкнула комнату и т. п. */
  onNotice?: (text: string) => void
  /** режим правки: мышь цепляет только объекты этого режима */
  mode?: EditMode
  /** по какой линии стены подписывать её длину */
  wallRef?: WallRef
  /** проект электрики: трассы групп и высоты точек — в режиме электрики */
  electricDesign?: ElectricDesign | null
  /** подсвеченная группа щита */
  hlCircuit?: string | null
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; view0: View; moved: boolean; clickSel: Selection }
  | { kind: 'maybe'; sx: number; sy: number; view0: View }
  | { kind: 'room'; a: Pt }
  | { kind: 'refine'; a: Pt }
  | { kind: 'move'; id: string; offset: Pt; plan0: Plan; item0: Furniture }
  | { kind: 'rotate'; id: string; plan0: Plan }
  | { kind: 'resize'; id: string; plan0: Plan; item0: Furniture }
  | { kind: 'node'; from: Pt; plan0: Plan }
  | { kind: 'wall'; id: string; plan0: Plan; start: Pt; run: WallRun; part?: { lo: number; hi: number }; offset: number; last?: Plan; warned?: boolean }
  | { kind: 'stretch'; id: string; plan0: Plan; end: 'a' | 'b'; from: Pt; dirOut: Pt; delta: number; last?: Plan; warned?: boolean }
  | { kind: 'opening'; id: string; plan0: Plan }
  | { kind: 'dim'; id: string; plan0: Plan; dim0: DimensionLine }
  | { kind: 'underlay'; start: Pt; plan0: Plan }

const NS = { vectorEffect: 'non-scaling-stroke' as const }
const sameSel = (a: Selection, b: Selection) => (a === null && b === null) || (!!a && !!b && a.kind === b.kind && a.id === b.id)
/** открыт диалог или стартовый экран: горячие клавиши холста не должны работать под ним */
export const dialogOpen = () => !!document.querySelector('.pl-ask-backdrop, .pl-start-backdrop, .pl-furnish')
const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/**
 * Выделенный участок прямой (Alt + щелчок): пока точка щелчка лежит на
 * выбранной прямой и участок до стыков короче всей прямой
 */
const sectionOf = (walls: Wall[], sel: Selection, part: { id: string; at: Pt } | null) => {
  if (!part || sel?.kind !== 'wall' || sel.id !== part.id) return null
  const run = wallRun(walls, sel.id)
  if (!run || pointSegDist(part.at, run.a, run.b) > run.thickness / 2 + 2) return null
  const s = runSection(walls, run, part.at)
  return s.hi - s.lo < dist(run.a, run.b) - 0.5 ? s : null
}
const UNIT_CM: Record<LengthUnit, number> = { cm: 1, mm: 0.1, m: 100 }
const UNIT_NAME: Record<LengthUnit, string> = { cm: 'см', mm: 'мм', m: 'м' }

export const PlannerCanvas = forwardRef<CanvasHandle, CanvasProps>((props, ref) => {
  const { plan, rooms, check, badItems, history, tool, onToolChange, selection, onSelect, layers, unit, ortho, wallThickness, placing, view, onViewChange, onHint, photos, onCalibrate, imageLines, onRoomPick, onCorners, onRefine, onNotice, mode = 'build', wallRef = 'axis', electricDesign, hlCircuit } = props
  const build = mode === 'build'
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [cursor, setCursor] = useState<{ p: Pt; kind: string } | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  const [draft, setDraft] = useState<Pt[]>([])
  const [roomDraft, setRoomDraft] = useState<{ a: Pt; b: Pt } | null>(null)
  const [areaDraft, setAreaDraft] = useState<{ a: Pt; b: Pt } | null>(null)
  const [dimStart, setDimStart] = useState<Pt | null>(null)
  /** первый конец размера привязан к стене */
  const [dimStartRef, setDimStartRef] = useState<DimRef | undefined>(undefined)
  const [measure, setMeasure] = useState<{ a: Pt; b: Pt; live: boolean } | null>(null)
  const [calibA, setCalibA] = useState<Pt | null>(null)
  /** отрезок показан — спрашиваем его длину прямо у него, без window.prompt */
  const [calibEdit, setCalibEdit] = useState<{ a: Pt; b: Pt; value: string } | null>(null)
  const [cornerPts, setCornerPts] = useState<Pt[]>([])
  useEffect(() => setCornerPts([]), [tool])
  useEffect(() => setTyped(''), [tool])
  const [hover, setHover] = useState<Selection>(null)
  const [hoverPart, setHoverPart] = useState<{ id: string; lo: number; hi: number } | null>(null)
  /** Alt + щелчок по стене: выделен только участок до стыков — точка щелчка, участок считается заново */
  const [selPart, setSelPart] = useState<{ id: string; at: Pt } | null>(null)
  /** длина следующей стены, набранная цифрами, пока рисуется стена */
  const [typed, setTyped] = useState('')
  /** правка размера стороны комнаты: щелчок по подписи «230 см» */
  const [sideEdit, setSideEdit] = useState<{ a: Pt; b: Pt; value: string; end: 'a' | 'b'; at: Pt } | null>(null)
  const [overLabel, setOverLabel] = useState(false)
  const [ghost, setGhost] = useState<{ x: number; y: number; rot: number } | null>(null)
  const [ghostRot, setGhostRot] = useState(0)
  const [openingGhost, setOpeningGhost] = useState<Opening | null>(null)
  const [panning, setPanning] = useState(false)
  const drag = useRef<Drag | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d0: number; mid0: Pt; view0: View } | null>(null)
  const spaceDown = useRef(false)
  const viewRef = useRef(view)
  viewRef.current = view
  const planRef = useRef(plan)
  planRef.current = plan
  const draftRef = useRef(draft)
  draftRef.current = draft
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor

  const zoom = view.zoom
  const tol = 12 / zoom
  const grid = plan.settings.grid
  const wallMap = useMemo(() => new Map(plan.walls.map((w) => [w.id, w])), [plan.walls])
  const ordered = useMemo(() => sortedFurniture(plan), [plan])
  // подписи сторон комнат — там же, где их рисует Scene: по щелчку их можно править
  const sideLabels = useMemo(
    () =>
      rooms.flatMap((r) =>
        r.inner.flatMap((a, i) => {
          const b = r.inner[(i + 1) % r.inner.length]
          const L = dist(a, b)
          if (L < 30) return []
          const n = perp(norm(sub(b, a)))
          const m = lerp(a, b, 0.5)
          const s = pointInPoly(add(m, mul(n, 4)), r.inner) ? 1 : -1
          return [{ a, b, L, p: add(m, mul(n, s * (9 / zoom))) }]
        }),
      ),
    [rooms, zoom],
  )

  // ---------- размеры ----------
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setSize({ w: Math.max(50, Math.floor(r.width)), h: Math.max(50, Math.floor(r.height)) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const toWorld = useCallback((cx: number, cy: number): Pt => {
    const r = svgRef.current?.getBoundingClientRect()
    const v = viewRef.current
    const sx = cx - (r?.left ?? 0)
    const sy = cy - (r?.top ?? 0)
    return { x: (sx - v.x) / v.zoom, y: (sy - v.y) / v.zoom }
  }, [])

  const fit = useCallback(() => {
    const b = planBounds(planRef.current) ?? { minX: 0, minY: 0, maxX: 800, maxY: 600 }
    const pad = 90
    const bw = b.maxX - b.minX + pad * 2
    const bh = b.maxY - b.minY + pad * 2
    const z = clamp(Math.min(size.w / bw, size.h / bh), 0.12, 6)
    onViewChange({ zoom: z, x: (size.w - bw * z) / 2 - (b.minX - pad) * z, y: (size.h - bh * z) / 2 - (b.minY - pad) * z })
  }, [size, onViewChange])

  const zoomAt = useCallback(
    (factor: number, sx: number, sy: number) => {
      const v = viewRef.current
      const z = clamp(v.zoom * factor, 0.12, 8)
      const k = z / v.zoom
      onViewChange({ zoom: z, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k })
    },
    [onViewChange],
  )

  const finishDraft = useCallback(() => {
    setDraft([])
    setGuides([])
    setTyped('')
  }, [])

  /**
   * Конец следующей стены по набранной длине: от последней точки в сторону
   * курсора; при ортогональности или почти по оси — строго по оси
   */
  const typedEnd = (t: string): Pt | null => {
    const d = draftRef.current
    const last = d[d.length - 1]
    const c = cursorRef.current?.p
    const v = parseFloat(t.replace(',', '.'))
    if (!last || !c || !(v > 0) || dist(c, last) < 0.5) return null
    let dir = norm(sub(c, last))
    const ax = Math.abs(dir.x) >= Math.abs(dir.y) ? { x: Math.sign(dir.x), y: 0 } : { x: 0, y: Math.sign(dir.y) }
    if (ortho || dot(dir, ax) > Math.cos((4 * Math.PI) / 180)) dir = ax
    return add(last, mul(dir, v * UNIT_CM[unit]))
  }

  useImperativeHandle(
    ref,
    () => ({
      fit,
      zoomBy: (k) => zoomAt(k, size.w / 2, size.h / 2),
      centerOn: (p) => {
        const v = viewRef.current
        onViewChange({ ...v, x: size.w / 2 - p.x * v.zoom, y: size.h / 2 - p.y * v.zoom })
      },
      finishDraft,
    }),
    [fit, zoomAt, size, finishDraft, onViewChange],
  )

  // ---------- колесо: масштаб ----------
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      if (e.ctrlKey || !e.shiftKey) zoomAt(Math.exp(-e.deltaY * 0.0012), e.clientX - r.left, e.clientY - r.top)
      else {
        const v = viewRef.current
        onViewChange({ ...v, x: v.x - e.deltaY })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt, onViewChange])

  // ---------- сброс временных состояний при смене инструмента ----------
  useEffect(() => {
    setDraft([])
    setRoomDraft(null)
    setAreaDraft(null)
    setDimStart(null)
    setMeasure(null)
    setCalibA(null)
    setGhost(null)
    setOpeningGhost(null)
    setGuides([])
    setCursor(null)
    setHover(null)
  }, [tool, placing])

  useEffect(() => {
    if (selPart && (selection?.kind !== 'wall' || selection.id !== selPart.id)) setSelPart(null)
  }, [selection, selPart])

  // ---------- подсказки ----------
  useEffect(() => {
    let text = ''
    switch (tool) {
      case 'select':
        // подсказка — по типу выбранного: у проёма нет ручки поворота, у размера — дублирования
        text =
          selection?.kind === 'wall'
            ? 'Стена: тяните поперёк — вся прямая; стрелки — 1 см, с Shift — 10; Alt + щелчок — участок до стыков; кружок на конце — длина; Del — удалить'
            : selection?.kind === 'opening'
              ? 'Дверь или окно: тяните вдоль стены. Ширина, сторона и петли — в панели справа. Del — удалить'
              : selection?.kind === 'dim'
                ? 'Размер: тяните — отступ от стены. Концы, привязанные к стенам, следуют за ними. Del — удалить'
                : selection?.kind === 'room'
                  ? 'Комната: имя и пол — в панели справа. Размер стороны — щелчком по подписи на плане'
                  : selection
                    ? 'Предмет: тяните — двигать; ручка сверху — поворот, уголок — размер; R — на 90°, Ctrl+D — дублировать, Del — удалить'
                    : mode === 'furnish'
                ? 'Мебель: клик — выбрать предмет, тянуть — двигать. Стены и электрика сейчас не цепляются. Добавить — «Каталог» слева'
                : mode === 'electric'
                  ? 'Электрика: клик — выбрать точку, тянуть — двигать. Стены и мебель сейчас не цепляются. Расставить по нормам — панель «Электрика»'
                  : 'Стройка: клик — стена, дверь, окно или размер. Щелчок по размеру комнаты — ввести точное число. Мебель и электрика не цепляются. Пустое место — сдвиг, колесо — масштаб'
        break
      case 'wall':
        text = draft.length
          ? 'Клик — следующая точка. Или наберите длину цифрами и Enter — стена этой длины (по оси) в сторону курсора. Повторный клик в той же точке, Enter или Esc — завершить. Клик в начало — замкнуть контур'
          : 'Клик — первая точка стены. Привязка к концам стен, осям и сетке'
        break
      case 'room':
        text = 'Потяните прямоугольник — получится комната из четырёх стен'
        break
      case 'door':
      case 'window':
      case 'doorway':
        text = 'Клик по стене — проём встанет на неё; ещё клик — ещё один. Ширина и петли — в панели справа. Esc — закончить'
        break
      case 'place':
        text = placing ? `«${placing.name}»: кликните, куда поставить. R — повернуть, Esc — отмена. Объект сам прилипает к стене` : 'Выберите предмет в каталоге'
        break
      case 'dimension':
        text = dimStart
          ? 'Клик — вторая точка. На грани стены напротив размер встанет поперёк'
          : 'Клик по грани, оси или концу стены — размер привяжется к стене и будет следовать за ней. Щелчок мимо стен — свободная точка'
        break
      case 'measure':
        text = measure?.live ? 'Клик — зафиксировать измерение' : 'Клик — начать измерение рулеткой'
        break
      case 'calibrate':
        text = calibA
          ? 'Клик — вторая точка известного размера, потом введите его длину'
          : 'Покажите на подложке отрезок с известным размером: клик — первая точка'
        break
      case 'roomPick':
        text = 'Кликните внутри комнаты на картинке — стены вокруг неё появятся сами. Esc — выйти'
        break
      case 'refine':
        text = 'Обведите спорное место — и скажите, что там: стена, проём, дверь или окно. Остальной чертёж не изменится. Esc — выйти'
        break
      case 'corners':
        text = `Угол ${cornerPts.length + 1} из 4: кликайте по углам наружных стен на фото в любом порядке. Esc — сначала`
        break
    }
    onHint(text)
  }, [tool, selection, draft.length, placing, dimStart, measure?.live, calibA, cornerPts.length, onHint, mode])

  // ---------- вспомогательные ----------
  const handlePositions = (f: Furniture) => {
    const c = { x: f.x, y: f.y }
    return {
      rotate: add(c, rotate({ x: 0, y: -f.d / 2 - 26 / zoom }, f.rot)),
      rotateBase: add(c, rotate({ x: 0, y: -f.d / 2 }, f.rot)),
      resize: add(c, rotate({ x: f.w / 2, y: f.d / 2 }, f.rot)),
    }
  }

  const hitTest = useCallback(
    (p: Pt): Selection => {
      const z = viewRef.current.zoom
      const t = 5 / z
      for (let i = ordered.length - 1; i >= 0; i--) {
        const { f, cat } = ordered[i]
        const isElectric = cat?.category === 'electric'
        if (isElectric ? !layers.electric : !layers.furniture) continue
        // чужой режим: предмет видно, но мышь его не цепляет
        if (itemMode(f) !== mode) continue
        if (cat?.symbol) {
          if (dist(p, { x: f.x, y: f.y }) < 14 / z) return { kind: 'furniture', id: f.id }
        } else if (pointInPoly(p, obbCorners(f.x, f.y, f.w, f.d, f.rot))) return { kind: 'furniture', id: f.id }
      }
      // стены, проёмы и размеры — только в режиме стройки
      for (const op of build ? plan.openings : []) {
        const w = wallMap.get(op.wallId)
        if (!w) continue
        const g = openingGeom(op, w)
        const s0 = add(g.center, mul(g.dir, -g.hw))
        const s1 = add(g.center, mul(g.dir, g.hw))
        if (pointSegDist(p, s0, s1) < w.thickness / 2 + t) return { kind: 'opening', id: op.id }
      }
      for (const w of build ? plan.walls : []) if (pointSegDist(p, w.a, w.b) < w.thickness / 2 + t) return { kind: 'wall', id: w.id }
      if (layers.dims && build) {
        for (const d of plan.dims) {
          const dir = norm(sub(d.b, d.a))
          const n = perp(dir)
          if (pointSegDist(p, add(d.a, mul(n, d.offset)), add(d.b, mul(n, d.offset))) < 7 / z) return { kind: 'dim', id: d.id }
        }
      }
      for (const r of rooms) if (pointInPoly(p, r.polygon)) return { kind: 'room', id: r.meta.id }
      return null
    },
    [ordered, plan.openings, plan.walls, plan.dims, rooms, wallMap, layers, mode, build],
  )

  const updateDrawingCursor = useCallback(
    (raw: Pt) => {
      const p = planRef.current
      const g = p.settings.grid
      switch (tool) {
        case 'wall': {
          const last = draftRef.current[draftRef.current.length - 1] ?? null
          const s = snapWallPoint(raw, p.walls, { grid: g, tol, ortho, last, lines: imageLines })
          setCursor({ p: s.p, kind: s.kind })
          setGuides(s.guides)
          break
        }
        case 'room':
        case 'dimension': {
          // конец размера ложится на стену: конец, грань или ось; мимо стен — обычная привязка
          const w = dimSnap(p.walls, raw, tol)
          if (w) {
            setCursor({ p: w.p, kind: w.ref.end ? 'endpoint' : 'face' })
            setGuides([])
            break
          }
          const s = snapWallPoint(raw, p.walls, { grid: g, tol, ortho: false, lines: imageLines })
          setCursor({ p: s.p, kind: s.kind })
          setGuides(s.guides)
          break
        }
        case 'calibrate':
          // по картинке: сетка и стены чертежа тут ни при чём — курсор там, куда показали
          setCursor({ p: raw, kind: 'free' })
          setGuides([])
          break
        case 'measure': {
          const s = snapWallPoint(raw, p.walls, { grid: g, tol, ortho: false, lines: imageLines })
          setCursor({ p: s.p, kind: s.kind })
          setGuides(s.guides)
          setMeasure((m) => (m && m.live ? { ...m, b: s.p } : m))
          break
        }
        case 'roomPick':
        case 'corners':
        case 'refine':
          // по картинке кликают как есть: привязки к сетке и стенам тут только мешают
          setCursor({ p: raw, kind: 'free' })
          setGuides([])
          break
        case 'door':
        case 'window':
        case 'doorway': {
          const width = OPENING_DEFAULT_WIDTH[tool]
          const s = snapOpening(raw, p, width, tol + 10)
          setOpeningGhost(s ? { id: 'ghost', kind: tool, wallId: s.wallId, t: s.t, width, hinge: 'a', side: 1 } : null)
          break
        }
        case 'place': {
          if (!placing) break
          const temp: Furniture = { id: 'ghost', type: placing.type, x: raw.x, y: raw.y, w: placing.w, d: placing.d, rot: ghostRot }
          const s = snapFurniture(temp, raw, p, { grid: 5, tol: Math.max(tol, 12) })
          setGhost({ x: s.x, y: s.y, rot: s.rot })
          setGuides(s.guides)
          break
        }
      }
    },
    [tool, tol, ortho, placing, ghostRot],
  )

  const handleTap = useCallback(
    (raw: Pt) => {
      const p = planRef.current
      const g = p.settings.grid
      switch (tool) {
        case 'wall': {
          const d = draftRef.current
          const last = d[d.length - 1] ?? null
          const s = snapWallPoint(raw, p.walls, { grid: g, tol, ortho, last, lines: imageLines })
          if (!last) {
            setDraft([s.p])
            return
          }
          if (dist(s.p, last) < 1) {
            finishDraft()
            return
          }
          history.apply((pl) => normalizeWalls(addWall(pl, last, s.p, wallThickness)))
          if (d.length >= 2 && eq(s.p, d[0], 0.75)) {
            finishDraft()
            return
          }
          setDraft([...d, s.p])
          return
        }
        case 'door':
        case 'window':
        case 'doorway': {
          const width = OPENING_DEFAULT_WIDTH[tool]
          const s = snapOpening(raw, p, width, tol + 10)
          if (!s) {
            onHint('Здесь нет подходящей стены: проём ставится на стену длиннее проёма')
            return
          }
          const r = addOpening(p, tool, s.wallId, s.t, width, rooms)
          if (!r.id) {
            onHint('Стена слишком короткая для проёма')
            return
          }
          history.apply(() => r.plan)
          onSelect({ kind: 'opening', id: r.id })
          // инструмент остаётся: следующая дверь — ещё один клик, закончить — Esc или V
          return
        }
        case 'place': {
          if (!placing) return
          const temp: Furniture = { id: 'ghost', type: placing.type, x: raw.x, y: raw.y, w: placing.w, d: placing.d, rot: ghostRot }
          const s = snapFurniture(temp, raw, p, { grid: 5, tol: Math.max(tol, 12) })
          const r = addFurniture(p, placing, s.x, s.y, s.rot)
          history.apply(() => r.plan)
          onSelect({ kind: 'furniture', id: r.id })
          onToolChange('select')
          return
        }
        case 'dimension': {
          const w = dimSnap(p.walls, raw, tol)
          const pt = w ? w.p : snapWallPoint(raw, p.walls, { grid: g, tol, ortho: false, lines: imageLines }).p
          if (!dimStart) {
            setDimStart(pt)
            setDimStartRef(w?.ref)
          } else {
            const a = dimStart
            const aRef = dimStartRef
            const b = squareDim(p.walls, a, aRef, pt, w?.ref)
            if (dist(a, b) >= 1) history.apply((pl) => addDimRef(pl, a, b, 30, aRef, w?.ref))
            setDimStart(null)
            setDimStartRef(undefined)
          }
          return
        }
        case 'measure': {
          const s = snapWallPoint(raw, p.walls, { grid: g, tol, ortho: false, lines: imageLines })
          setMeasure((m) => (!m || !m.live ? { a: s.p, b: s.p, live: true } : { ...m, b: s.p, live: false }))
          return
        }
        case 'calibrate': {
          if (!calibA) setCalibA(raw)
          else if (dist(calibA, raw) > 2) {
            setCalibEdit({ a: calibA, b: raw, value: '' })
            setCalibA(null)
          }
          return
        }
        case 'roomPick':
          onRoomPick?.(raw)
          return
        case 'corners': {
          const next = [...cornerPts, raw]
          if (next.length >= 4) {
            setCornerPts([])
            onCorners?.(next)
          } else setCornerPts(next)
          return
        }
      }
    },
    [tool, tol, ortho, wallThickness, history, rooms, placing, ghostRot, dimStart, dimStartRef, calibA, cornerPts, onCalibrate, onRoomPick, onCorners, onSelect, onToolChange, onHint, finishDraft, imageLines],
  )

  // ---------- указатель ----------
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return
    const svg = svgRef.current
    svg?.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()]
      if (drag.current && 'plan0' in drag.current) history.cancelPreview()
      drag.current = null
      setRoomDraft(null)
      pinch.current = { d0: Math.hypot(p1.x - p2.x, p1.y - p2.y), mid0: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, view0: viewRef.current }
      return
    }
    if (pointers.current.size > 2) return
    const raw = toWorld(e.clientX, e.clientY)
    if (e.button === 1 || spaceDown.current) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, view0: viewRef.current, moved: false, clickSel: selection }
      setPanning(true)
      return
    }
    if (tool === 'select') {
      downSelect(raw, e)
      return
    }
    if (tool === 'room') {
      const s = snapWallPoint(raw, plan.walls, { grid, tol, ortho: false, lines: imageLines })
      drag.current = { kind: 'room', a: s.p }
      setRoomDraft({ a: s.p, b: s.p })
      return
    }
    if (tool === 'refine') {
      // участок обводится по картинке как есть: привязки к сетке тут мешают
      drag.current = { kind: 'refine', a: raw }
      setAreaDraft({ a: raw, b: raw })
      return
    }
    drag.current = { kind: 'maybe', sx: e.clientX, sy: e.clientY, view0: viewRef.current }
  }

  /** стена за углом стороны комнаты (end — a или b) */
  const cornerWall = (a: Pt, b: Pt, end: 'a' | 'b') => {
    const d = norm(sub(b, a))
    return wallAtCorner(planRef.current.walls, end === 'b' ? b : a, end === 'b' ? d : mul(d, -1))
  }
  /** По умолчанию двигается стена покороче (задевает меньше чертежа) и не зафиксированная */
  const sideDefaultEnd = (a: Pt, b: Pt): 'a' | 'b' => {
    const score = (end: 'a' | 'b') => {
      const w = cornerWall(a, b, end)
      if (!w) return Infinity
      const run = wallRun(planRef.current.walls, w.id)
      return (w.locked ? 1e6 : 0) + (run ? dist(run.a, run.b) : 0)
    }
    return score('a') < score('b') ? 'a' : 'b'
  }
  const applySide = () => {
    if (!sideEdit) return
    const v = Number(sideEdit.value.replace(',', '.')) * UNIT_CM[unit]
    const before = planRef.current
    const next = setRoomSide(before, sideEdit.a, sideEdit.b, v, sideEdit.end)
    if (touchesLocked(before, next)) {
      onNotice?.('Эта правка задевает зафиксированную стену — снимите замок (кнопка «Замок» слева или в свойствах стены)')
      return
    }
    if (next === before && Math.abs(v - dist(sideEdit.a, sideEdit.b)) >= 0.5) {
      onNotice?.('За этим углом не нашлось стены поперёк — потяните стену мышью')
      return
    }
    if (next !== before) {
      history.apply(() => next)
      const lost = buildRooms(before).rooms.length - buildRooms(next).rooms.length
      if (lost > 0) onNotice?.('Контур комнаты разомкнулся — Ctrl+Z вернёт как было')
    }
    setSideEdit(null)
  }

  const downSelect = (raw: Pt, e: React.PointerEvent) => {
    const z = viewRef.current.zoom
    // щелчок по размеру комнаты — ввести число; двигается стена за одним из углов
    if (layers.dims && build && !e.shiftKey && !e.altKey) {
      const lab = sideLabels.find((l) => {
        const d = norm(sub(l.b, l.a))
        const v = sub(raw, l.p)
        return Math.abs(dot(v, d)) <= 22 / z && Math.abs(dot(v, perp(d))) <= 8 / z
      })
      if (lab) {
        setSideEdit({ a: lab.a, b: lab.b, value: String(Math.round((lab.L / UNIT_CM[unit]) * 100) / 100), end: sideDefaultEnd(lab.a, lab.b), at: lab.p })
        return
      }
    }
    if (selection?.kind === 'furniture') {
      const f = plan.furniture.find((x) => x.id === selection.id)
      const cat = f ? CATALOG_MAP[f.type] : undefined
      if (f && !cat?.symbol) {
        const h = handlePositions(f)
        if (dist(raw, h.rotate) < 11 / z) {
          drag.current = { kind: 'rotate', id: f.id, plan0: plan }
          return
        }
        if (cat?.resizable !== false && dist(raw, h.resize) < 10 / z) {
          drag.current = { kind: 'resize', id: f.id, plan0: plan, item0: f }
          return
        }
      }
    }
    // кружки на концах выбранной прямой: длина; с Shift — свободно, как раньше
    if (selection?.kind === 'wall') {
      const run = wallRun(plan.walls, selection.id)
      if (run) {
        for (const end of ['a', 'b'] as const) {
          const p = run[end]
          if (dist(raw, p) >= 10 / z) continue
          if (e.shiftKey) drag.current = { kind: 'node', from: p, plan0: plan }
          else drag.current = { kind: 'stretch', id: selection.id, plan0: plan, end, from: p, dirOut: end === 'a' ? mul(run.dir, -1) : run.dir, delta: 0 }
          return
        }
      }
    }
    const hit = hitTest(raw)
    if (hit?.kind === 'furniture') {
      const f = plan.furniture.find((x) => x.id === hit.id)!
      if (!sameSel(hit, selection)) onSelect(hit)
      drag.current = { kind: 'move', id: f.id, offset: sub({ x: f.x, y: f.y }, raw), plan0: plan, item0: f }
      return
    }
    if (hit?.kind === 'opening') {
      if (!sameSel(hit, selection)) onSelect(hit)
      drag.current = { kind: 'opening', id: hit.id, plan0: plan }
      return
    }
    if (hit?.kind === 'wall') {
      if (!sameSel(hit, selection)) onSelect(hit)
      setSelPart(e.altKey ? { id: hit.id, at: raw } : null)
      const run = wallRun(plan.walls, hit.id)
      // вся прямая или, с Alt, участок до ближайших стыков
      if (run) drag.current = { kind: 'wall', id: hit.id, plan0: plan, start: raw, run, part: e.altKey ? runSection(plan.walls, run, raw) : undefined, offset: 0 }
      return
    }
    if (hit?.kind === 'dim') {
      if (!sameSel(hit, selection)) onSelect(hit)
      drag.current = { kind: 'dim', id: hit.id, plan0: plan, dim0: plan.dims.find((d) => d.id === hit.id)! }
      return
    }
    const u = plan.underlay
    if (!hit && build && u && !u.locked && u.visible && layers.underlay) {
      const inside = raw.x >= u.x && raw.y >= u.y && raw.x <= u.x + u.px.w * u.scale && raw.y <= u.y + u.px.h * u.scale
      if (inside) {
        drag.current = { kind: 'underlay', start: raw, plan0: plan }
        return
      }
    }
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, view0: viewRef.current, moved: false, clickSel: hit }
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pointers.current.size >= 2) {
      const [p1, p2] = [...pointers.current.values()]
      const r = svgRef.current?.getBoundingClientRect()
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y)
      const m = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      const v0 = pinch.current.view0
      const z = clamp((v0.zoom * d) / Math.max(1, pinch.current.d0), 0.12, 8)
      const wx = (pinch.current.mid0.x - (r?.left ?? 0) - v0.x) / v0.zoom
      const wy = (pinch.current.mid0.y - (r?.top ?? 0) - v0.y) / v0.zoom
      onViewChange({ zoom: z, x: m.x - (r?.left ?? 0) - wx * z, y: m.y - (r?.top ?? 0) - wy * z })
      return
    }
    const raw = toWorld(e.clientX, e.clientY)
    const d = drag.current
    if (!d) {
      if (tool === 'select') {
        const h = hitTest(raw)
        setHover((prev) => (sameSel(prev, h) ? prev : h))
        // над подписью размера комнаты — курсор-рука: по ней можно щёлкнуть и ввести число
        const z = viewRef.current.zoom
        const onLabel =
          layers.dims &&
          build &&
          sideLabels.some((l) => {
            const d = norm(sub(l.b, l.a))
            const v = sub(raw, l.p)
            return Math.abs(dot(v, d)) <= 22 / z && Math.abs(dot(v, perp(d))) <= 8 / z
          })
        setOverLabel((prev) => (prev === onLabel ? prev : onLabel))
        // с Alt над стеной подсвечивается участок, который выдвинется
        if (h?.kind === 'wall' && e.altKey) {
          const run = wallRun(plan.walls, h.id)
          const part = run ? runSection(plan.walls, run, raw) : null
          setHoverPart((prev) => (part && (!prev || prev.id !== h.id || prev.lo !== part.lo || prev.hi !== part.hi) ? { id: h.id, ...part } : part ? prev : null))
        } else setHoverPart((prev) => (prev ? null : prev))
      } else updateDrawingCursor(raw)
      return
    }
    switch (d.kind) {
      case 'pan': {
        const dx = e.clientX - d.sx
        const dy = e.clientY - d.sy
        if (!d.moved && Math.hypot(dx, dy) > 4) {
          d.moved = true
          setPanning(true)
        }
        if (d.moved) onViewChange({ ...d.view0, x: d.view0.x + dx, y: d.view0.y + dy })
        return
      }
      case 'maybe': {
        const dx = e.clientX - d.sx
        const dy = e.clientY - d.sy
        if (Math.hypot(dx, dy) > 6) {
          drag.current = { kind: 'pan', sx: d.sx, sy: d.sy, view0: d.view0, moved: true, clickSel: selection }
          setPanning(true)
          onViewChange({ ...d.view0, x: d.view0.x + dx, y: d.view0.y + dy })
        } else updateDrawingCursor(raw)
        return
      }
      case 'room': {
        const s = snapWallPoint(raw, plan.walls, { grid, tol, ortho: false, lines: imageLines })
        setRoomDraft({ a: d.a, b: s.p })
        setGuides(s.guides)
        return
      }
      case 'refine':
        setAreaDraft({ a: d.a, b: raw })
        return
      case 'move': {
        // с Shift — без магнита: предмет встаёт ровно туда, куда тянут, и не разворачивается к стене
        if (e.shiftKey) {
          const p = add(raw, d.offset)
          setGuides([])
          history.preview(updateFurniture(d.plan0, d.id, { x: Math.round(p.x), y: Math.round(p.y) }))
          return
        }
        const without: Plan = { ...d.plan0, furniture: d.plan0.furniture.filter((f) => f.id !== d.id) }
        const s = snapFurniture(d.item0, add(raw, d.offset), without, { grid: 5, tol: Math.max(tol, 10), selfId: d.id })
        setGuides(s.guides)
        history.preview(updateFurniture(d.plan0, d.id, { x: s.x, y: s.y, rot: s.rot }))
        return
      }
      case 'rotate': {
        const f = d.plan0.furniture.find((x) => x.id === d.id)
        if (!f) return
        const ang = roundTo(angleDeg({ x: f.x, y: f.y }, raw) + 90, e.shiftKey ? 1 : 15)
        history.preview(updateFurniture(d.plan0, d.id, { rot: normDeg(ang) }))
        return
      }
      case 'resize': {
        const f = d.item0
        const corner = add({ x: f.x, y: f.y }, rotate({ x: -f.w / 2, y: -f.d / 2 }, f.rot))
        const local = rotate(sub(raw, corner), -f.rot)
        const w = Math.max(10, roundTo(local.x, 5))
        const dd = Math.max(5, roundTo(local.y, 5))
        const c = add(corner, rotate({ x: w / 2, y: dd / 2 }, f.rot))
        history.preview(updateFurniture(d.plan0, d.id, { x: c.x, y: c.y, w, d: dd }))
        return
      }
      case 'node': {
        const s = snapWallPoint(raw, d.plan0.walls, { grid, tol, ortho: false, exclude: (p) => eq(p, d.from, 0.75), lines: imageLines })
        setGuides(s.guides)
        const next = moveNodes(d.plan0, [{ from: d.from, to: s.p }])
        if (touchesLocked(d.plan0, next)) return
        history.preview(next)
        return
      }
      case 'wall': {
        // только поперёк: на сетку и в линию с соседней параллельной стеной
        const n = d.run.normal
        const want = dot(sub(raw, d.start), n)
        let off = e.shiftKey ? want : roundTo(want, grid || 1)
        if (!e.shiftKey) {
          const ids = new Set(d.run.ids)
          let best = tol
          for (const w of d.plan0.walls) {
            if (ids.has(w.id) || Math.abs(dot(norm(sub(w.b, w.a)), n)) > 0.01) continue
            const at = dot(sub(w.a, d.run.a), n)
            if (Math.abs(at) > 0.5 && Math.abs(at - want) < best) {
              best = Math.abs(at - want)
              off = at
            }
          }
        }
        const next = pushRun(d.plan0, d.id, off, d.part)
        // зафиксированную стену правка не трогает — ни сдвигом, ни растяжкой
        if (touchesLocked(d.plan0, next)) {
          if (!d.warned) onNotice?.('Стена зафиксирована (или держится за зафиксированную) — снимите замок, чтобы двигать')
          d.warned = true
          return
        }
        d.offset = off
        d.last = next
        history.preview(d.last)
        return
      }
      case 'stretch': {
        const want = dot(sub(raw, d.from), d.dirOut)
        d.delta = e.shiftKey ? want : roundTo(want, grid || 1)
        const next = stretchRun(d.plan0, d.id, d.end, d.delta)
        if (touchesLocked(d.plan0, next)) {
          if (!d.warned) onNotice?.('Стена зафиксирована (или держится за зафиксированную) — снимите замок, чтобы менять длину')
          d.warned = true
          return
        }
        d.last = next
        history.preview(d.last)
        return
      }
      case 'opening': {
        const op = d.plan0.openings.find((o) => o.id === d.id)
        if (!op) return
        const s = snapOpening(raw, d.plan0, op.width, tol + 15, e.shiftKey)
        if (s) history.preview(updateOpening(d.plan0, d.id, { wallId: s.wallId, t: s.t }))
        return
      }
      case 'underlay': {
        const u = d.plan0.underlay
        if (!u) return
        history.preview({ ...d.plan0, underlay: { ...u, x: u.x + (raw.x - d.start.x), y: u.y + (raw.y - d.start.y) } })
        return
      }
      case 'dim': {
        const dir = norm(sub(d.dim0.b, d.dim0.a))
        const n = perp(dir)
        const off = roundTo(dot(sub(raw, d.dim0.a), n), 5)
        history.preview(updateDim(d.plan0, d.id, { offset: off === 0 ? 5 : off }))
        return
      }
    }
  }

  /** правка не должна тихо ломать комнаты: разомкнулась — сказать сразу */
  const warnOpened = (before: Plan, after: Plan) => {
    const n0 = buildRooms(before).rooms.length
    const n1 = buildRooms(after).rooms.length
    if (n1 < n0) onNotice?.(`Контур комнаты разомкнулся: комнат было ${n0}, стало ${n1}. Ctrl+Z вернёт как было`)
  }

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId)
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null
      return
    }
    const d = drag.current
    drag.current = null
    setPanning(false)
    if (!d) return
    const raw = toWorld(e.clientX, e.clientY)
    switch (d.kind) {
      case 'pan':
        if (!d.moved && tool === 'select') onSelect(d.clickSel)
        return
      case 'maybe':
        handleTap(raw)
        return
      case 'room': {
        setRoomDraft(null)
        setGuides([])
        const s = snapWallPoint(raw, plan.walls, { grid, tol, ortho: false, lines: imageLines })
        history.apply((pl) => addRect(pl, d.a, s.p, wallThickness))
        return
      }
      case 'refine': {
        setAreaDraft(null)
        // случайный клик без протяжки участком не считается
        if (Math.abs(raw.x - d.a.x) < 10 || Math.abs(raw.y - d.a.y) < 10) return
        onRefine?.(normalizeArea(d.a, raw))
        return
      }
      case 'node':
        history.preview((pl) => cleanupWalls(pl))
        history.endPreview()
        setGuides([])
        return
      case 'wall':
      case 'stretch': {
        history.endPreview()
        setGuides([])
        if (d.last) {
          warnOpened(d.plan0, d.last)
          // выдвинутый участок — теперь своя прямая: выделение переходит на него
          if (d.kind === 'wall' && d.part) {
            const w = movedSection(d.last.walls, d.run, d.part.lo, d.part.hi, d.offset)
            if (w) onSelect({ kind: 'wall', id: w.id })
            setSelPart(null)
          }
        }
        return
      }
      default:
        history.endPreview()
        setGuides([])
    }
  }

  const onPointerCancel = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId)
    pinch.current = null
    const d = drag.current
    drag.current = null
    setPanning(false)
    setRoomDraft(null)
    setGuides([])
    if (d && 'plan0' in d) history.cancelPreview()
  }

  // ---------- клавиатура ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target) || dialogOpen()) return
      const ctrl = e.ctrlKey || e.metaKey
      if (e.code === 'Space') {
        spaceDown.current = true
        e.preventDefault()
        return
      }
      // длина следующей стены цифрами, пока рисуется стена
      if (tool === 'wall' && draftRef.current.length && !ctrl && !e.altKey) {
        if (/^\d$/.test(e.key) || ((e.key === ',' || e.key === '.') && !/[.,]/.test(typed))) {
          e.preventDefault()
          if (typed.length < 7) setTyped(typed + e.key)
          return
        }
        if (e.key === 'Backspace' && typed) {
          e.preventDefault()
          setTyped(typed.slice(0, -1))
          return
        }
        if (e.key === 'Escape' && typed) {
          setTyped('')
          return
        }
        if (e.key === 'Enter' && typed) {
          const p = typedEnd(typed)
          if (!p) {
            onNotice?.('Наведите курсор туда, куда вести стену, — длина отложится в эту сторону')
            return
          }
          const d = draftRef.current
          const last = d[d.length - 1]
          history.apply((pl) => normalizeWalls(addWall(pl, last, p, wallThickness)))
          setTyped('')
          if (d.length >= 2 && eq(p, d[0], 0.75)) finishDraft()
          else setDraft([...d, p])
          return
        }
      }
      if (e.key === 'Escape') {
        if (sideEdit) setSideEdit(null)
        else if (calibEdit) setCalibEdit(null)
        else if (draftRef.current.length) finishDraft()
        else if (dimStart) setDimStart(null)
        else if (measure) setMeasure(null)
        else if (cornerPts.length) setCornerPts([])
        else if (tool !== 'select') onToolChange('select')
        else onSelect(null)
        return
      }
      if (e.key === 'Enter' && draftRef.current.length) {
        finishDraft()
        return
      }
      if (ctrl && e.code === 'KeyZ') {
        e.preventDefault()
        if (e.shiftKey) history.redo()
        else history.undo()
        return
      }
      if (ctrl && e.code === 'KeyY') {
        e.preventDefault()
        history.redo()
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        e.preventDefault()
        // комната — следствие контура стен, удалять в ней нечего
        if (selection.kind === 'room') return
        // стена: удаляется то, что подсвечено, — прямая целиком или участок (Alt + щелчок)
        if (selection.kind === 'wall') {
          const pl0 = planRef.current
          const part = sectionOf(pl0.walls, selection, selPart)
          const next = part ? deleteSection(pl0, selection.id, part.lo, part.hi) : deleteRun(pl0, selection.id)
          if (touchesLocked(pl0, next)) {
            onNotice?.('Стена зафиксирована — снимите замок, чтобы удалить')
            return
          }
          history.apply(() => next)
          setSelPart(null)
          onSelect(null)
          return
        }
        history.apply((pl) => deleteSelection(pl, selection))
        onSelect(null)
        return
      }
      if (ctrl && e.code === 'KeyD' && selection?.kind === 'furniture') {
        e.preventDefault()
        const r = duplicateFurniture(planRef.current, selection.id)
        if (r.id === selection.id) return
        history.apply(() => r.plan)
        onSelect({ kind: 'furniture', id: r.id })
        return
      }
      if (e.code === 'KeyR' && !ctrl) {
        if (selection?.kind === 'furniture') history.apply((pl) => rotateFurniture(pl, selection.id, e.shiftKey ? -90 : 90))
        else if (tool === 'place') setGhostRot((r) => normDeg(r + 90))
        return
      }
      // стрелки: стена сдвигается поперёк на 1 см, с Shift на 10 — вся прямая или выделенный участок
      if (e.key.startsWith('Arrow') && selection?.kind === 'wall') {
        e.preventDefault()
        const pl0 = planRef.current
        const run = wallRun(pl0.walls, selection.id)
        if (!run) return
        const v = { x: e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, y: e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0 }
        const k = dot(v, run.normal)
        if (Math.abs(k) < 0.3) {
          onNotice?.(Math.abs(run.dir.x) >= Math.abs(run.dir.y) ? 'Стена идёт поперёк экрана — её двигают стрелки ↑ ↓' : 'Стена идёт вдоль экрана — её двигают стрелки ← →')
          return
        }
        const off = Math.sign(k) * (e.shiftKey ? 10 : 1)
        const part = sectionOf(pl0.walls, selection, selPart)
        const next = pushRun(pl0, selection.id, off, part ?? undefined)
        if (next === pl0) return
        if (touchesLocked(pl0, next)) {
          onNotice?.('Стена зафиксирована (или держится за зафиксированную) — снимите замок, чтобы двигать')
          return
        }
        // серия нажатий — одна запись в истории
        history.nudge(() => next)
        warnOpened(pl0, next)
        // выбранный кусок мог склеиться с соседним, а участок — стал своей прямой
        if (part || !next.walls.some((w) => w.id === selection.id)) {
          const w = movedSection(next.walls, run, part?.lo ?? 0, part?.hi ?? dist(run.a, run.b), off)
          if (w) onSelect({ kind: 'wall', id: w.id })
          setSelPart(null)
        }
        return
      }
      // проём: стрелки двигают его вдоль стены на 1 см, с Shift — на 10
      if (e.key.startsWith('Arrow') && selection?.kind === 'opening') {
        e.preventDefault()
        const pl0 = planRef.current
        const op = pl0.openings.find((o) => o.id === selection.id)
        const wall = op && pl0.walls.find((w) => w.id === op.wallId)
        if (!op || !wall) return
        const v = { x: e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, y: e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0 }
        const dir = norm(sub(wall.b, wall.a))
        const k = dot(v, dir)
        if (Math.abs(k) < 0.3) {
          onNotice?.(Math.abs(dir.x) >= Math.abs(dir.y) ? 'Проём двигается вдоль стены — стрелками ← →' : 'Проём двигается вдоль стены — стрелками ↑ ↓')
          return
        }
        const L = dist(wall.a, wall.b)
        const hw = op.width / 2
        const pos = Math.min(L - hw, Math.max(hw, op.t * L + Math.sign(k) * (e.shiftKey ? 10 : 1)))
        history.nudge((pl) => updateOpening(pl, op.id, { t: pos / L }))
        return
      }
      if (e.key.startsWith('Arrow') && selection?.kind === 'furniture') {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        history.nudge((pl) => nudgeFurniture(pl, selection.id, dx, dy))
        return
      }
      if (ctrl) return
      const map: Record<string, Tool> = { KeyV: 'select', KeyW: 'wall', KeyC: 'room', KeyD: 'door', KeyN: 'window', KeyM: 'dimension', KeyL: 'measure' }
      if (map[e.code]) onToolChange(map[e.code])
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [tool, selection, selPart, typed, ortho, unit, wallThickness, history, onSelect, onToolChange, onNotice, finishDraft, dimStart, measure])

  // ---------- отрисовка ----------
  const drawing = tool !== 'select'
  const cursorStyle = panning ? 'grabbing' : drawing ? 'crosshair' : overLabel && tool === 'select' ? 'pointer' : hover?.kind === 'furniture' || hover?.kind === 'opening' ? 'move' : hover?.kind === 'wall' ? 'pointer' : 'default'
  const minor = 50 * zoom
  const major = 100 * zoom
  const draftWalls = draft.slice(1).map((p, i) => ({ id: `d${i}`, a: draft[i], b: p, thickness: wallThickness }))
  const typedPt = tool === 'wall' && typed ? typedEnd(typed) : null
  const rubber = tool === 'wall' && draft.length && cursor ? { a: draft[draft.length - 1], b: typedPt ?? cursor.p } : null
  const selFurn = selection?.kind === 'furniture' ? plan.furniture.find((f) => f.id === selection.id) : undefined
  const selCat = selFurn ? CATALOG_MAP[selFurn.type] : undefined
  const selRun = selection?.kind === 'wall' ? wallRun(plan.walls, selection.id) : null
  const selSec = selRun ? sectionOf(plan.walls, selection, selPart) : null
  const [selA, selB] = selRun && selSec ? runSpan(selRun, selSec.lo, selSec.hi) : selRun ? [selRun.a, selRun.b] : [null, null]
  // зафиксированные прямые — по одной на прямую, для значка замка
  const lockedRuns: WallRun[] = []
  for (const w of plan.walls) {
    if (!w.locked || lockedRuns.some((r) => r.ids.includes(w.id))) continue
    const r = wallRun(plan.walls, w.id)
    if (r && dist(r.a, r.b) * zoom > 30) lockedRuns.push(r)
  }
  const hoverRun = hover?.kind === 'wall' ? wallRun(plan.walls, hover.id) : null
  /** полоса прямой [lo, hi] во всю толщину — подсветка поверх стен */
  const runBand = (run: WallRun, lo: number, hi: number, fill: string, key: string) => {
    const [p, q] = runSpan(run, lo, hi)
    const h = mul(run.normal, run.thickness / 2 + 1 / zoom)
    return <polygon key={key} points={ptsAttr([add(p, h), add(q, h), sub(q, h), sub(p, h)])} fill={fill} stroke="none" pointerEvents="none" />
  }
  const ghostWall = openingGhost ? wallMap.get(openingGhost.wallId) : undefined

  const wallGhost = (w: Wall, key: string) => <polygon key={key} points={ptsAttr(wallPolygon(w, [...plan.walls, w]))} fill="rgba(37,99,235,0.45)" stroke={ACCENT} strokeWidth={1} {...NS} />
  const lengthLabel = (a: Pt, b: Pt, key: string) => {
    const m = lerp(a, b, 0.5)
    let ang = angleDeg(a, b)
    if (ang > 90 || ang <= -90) ang += 180
    return (
      <text key={key} transform={`translate(${m.x} ${m.y}) rotate(${ang})`} y={-8 / zoom} fontSize={12 / zoom} textAnchor="middle" fill={ACCENT} stroke="#fff" strokeWidth={3 / zoom} paintOrder="stroke" fontFamily="system-ui, sans-serif" fontWeight={600}>
        {fmtLen(dist(a, b), unit)}
      </text>
    )
  }

  return (
    <div
      ref={wrapRef}
      className="pl-canvas-wrap"
      style={{ cursor: cursorStyle }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('application/x-planner-item')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        // карточку каталога перетащили на план: предмет встаёт под курсором с магнитом к стене
        const type = e.dataTransfer.getData('application/x-planner-item')
        const cat = type ? CATALOG_MAP[type] : undefined
        if (!cat) return
        e.preventDefault()
        const raw = toWorld(e.clientX, e.clientY)
        const p = planRef.current
        const temp: Furniture = { id: 'ghost', type: cat.type, x: raw.x, y: raw.y, w: cat.w, d: cat.d, rot: 0 }
        const s = snapFurniture(temp, raw, p, { grid: 5, tol: Math.max(tol, 12) })
        const r = addFurniture(p, cat, s.x, s.y, s.rot)
        history.apply(() => r.plan)
        onSelect({ kind: 'furniture', id: r.id })
      }}
    >
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        style={{ touchAction: 'none', display: 'block', userSelect: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => {
          // курсор ушёл на панель — подсветка стены не должна висеть
          if (!drag.current) {
            setHover(null)
            setHoverPart(null)
            setOverLabel(false)
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          if (draft.length) finishDraft()
          else if (tool !== 'select') onToolChange('select')
        }}
      >
        <defs>
          <pattern id="pl-grid-minor" width={minor} height={minor} patternUnits="userSpaceOnUse" x={view.x % minor} y={view.y % minor}>
            <path d={`M ${minor} 0 L 0 0 0 ${minor}`} fill="none" stroke="#e5e7eb" strokeWidth={1} />
          </pattern>
          <pattern id="pl-grid-major" width={major} height={major} patternUnits="userSpaceOnUse" x={view.x % major} y={view.y % major}>
            <path d={`M ${major} 0 L 0 0 0 ${major}`} fill="none" stroke="#d1d5db" strokeWidth={1} />
          </pattern>
        </defs>
        <rect width={size.w} height={size.h} fill="#fbfbfa" />
        {layers.grid && minor > 7 && <rect width={size.w} height={size.h} fill="url(#pl-grid-minor)" />}
        {layers.grid && major > 12 && <rect width={size.w} height={size.h} fill="url(#pl-grid-major)" />}

        <g transform={`translate(${view.x} ${view.y}) scale(${zoom})`}>
          <Scene plan={plan} rooms={rooms} check={check} layers={layers} unit={unit} zoom={zoom} selection={selection?.kind === 'wall' ? null : selection} hover={hover?.kind === 'wall' ? null : hover} badItems={badItems} photos={photos} mode={mode} />
          {/* проект электрики: трассы групп от щита, номера групп, высоты точек */}
          {electricDesign && (
            <g pointerEvents="none" fontFamily="system-ui, sans-serif">
              {electricDesign.circuits.map((c) => {
                const dim = hlCircuit && hlCircuit !== c.id
                // номер группы — в конце трассы: у щита их слишком много
                const first = c.route[c.route.length - 1]
                return (
                  <g key={c.id} opacity={dim ? 0.15 : 0.9}>
                    <polyline points={ptsAttr(c.route)} fill="none" stroke={c.color} strokeWidth={hlCircuit === c.id ? 3 : 1.6} strokeDasharray="6 4" strokeLinejoin="round" {...NS} />
                    {first && (
                      <text x={first.x} y={first.y} dx={6 / zoom} dy={-6 / zoom} fontSize={10 / zoom} fontWeight={700} fill={c.color} stroke="#fff" strokeWidth={3 / zoom} paintOrder="stroke">
                        {c.id}
                      </text>
                    )}
                  </g>
                )
              })}
              {plan.furniture
                .filter((f) => f.electric && f.electric.kind !== 'light' && f.electric.kind !== 'spot' && f.electric.kind !== 'leak-sensor')
                .map((f) => (
                  <text key={`h-${f.id}`} x={f.x} y={f.y} dx={7 / zoom} dy={12 / zoom} fontSize={8.5 / zoom} fill="#374151" stroke="#fff" strokeWidth={2.5 / zoom} paintOrder="stroke">
                    {f.electric!.height}
                  </text>
                ))}
              {!electricDesign.panel.placed && electricDesign.circuits.length > 0 && (
                <g>
                  <rect x={electricDesign.panel.p.x - 12} y={electricDesign.panel.p.y - 8} width={24} height={16} fill="rgba(255,255,255,0.8)" stroke="#111827" strokeWidth={1.2} strokeDasharray="3 2" {...NS} />
                  <text x={electricDesign.panel.p.x} y={electricDesign.panel.p.y - 12} fontSize={10 / zoom} textAnchor="middle" fill="#111827" stroke="#fff" strokeWidth={3 / zoom} paintOrder="stroke">
                    щит (предложено)
                  </text>
                </g>
              )}
            </g>
          )}

          {/* направляющие */}
          {guides.map((g, i) => (
            <line key={i} x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke="#f43f5e" strokeWidth={1} strokeDasharray="4 3" {...NS} />
          ))}

          {/* черновик стен */}
          {draftWalls.map((w) => wallGhost(w, w.id))}
          {rubber && (
            <g>
              {wallGhost({ id: 'rubber', a: rubber.a, b: rubber.b, thickness: wallThickness }, 'rubber')}
              {lengthLabel(rubber.a, rubber.b, 'rubber-len')}
            </g>
          )}
          {draft.length > 0 && <circle cx={draft[0].x} cy={draft[0].y} r={6 / zoom} fill="#fff" stroke={ACCENT} strokeWidth={1.5} {...NS} />}

          {/* черновик комнаты */}
          {roomDraft &&
            (() => {
              const { a, b } = roomDraft
              const pts: Pt[] = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }]
              return (
                <g>
                  {pts.map((p, i) => wallGhost({ id: `rd${i}`, a: p, b: pts[(i + 1) % 4], thickness: wallThickness }, `rd${i}`))}
                  {lengthLabel(a, { x: b.x, y: a.y }, 'rd-w')}
                  {lengthLabel({ x: b.x, y: a.y }, b, 'rd-h')}
                </g>
              )
            })()}

          {/* обведённый участок для уточнения */}
          {areaDraft && (
            <rect
              x={Math.min(areaDraft.a.x, areaDraft.b.x)}
              y={Math.min(areaDraft.a.y, areaDraft.b.y)}
              width={Math.abs(areaDraft.b.x - areaDraft.a.x)}
              height={Math.abs(areaDraft.b.y - areaDraft.a.y)}
              fill="#d946ef22"
              stroke="#d946ef"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              pointerEvents="none"
              {...NS}
            />
          )}

          {/* призрак мебели */}
          {tool === 'place' && placing && ghost && (
            <g transform={`translate(${ghost.x} ${ghost.y}) rotate(${ghost.rot})`} opacity={0.65} pointerEvents="none">
              <Glyph item={{ id: 'ghost', type: placing.type, x: 0, y: 0, w: placing.w, d: placing.d, rot: 0 }} cat={placing} zoom={zoom} />
            </g>
          )}

          {/* призрак проёма */}
          {openingGhost &&
            ghostWall &&
            (() => {
              const g = openingGeom(openingGhost, ghostWall)
              const s0 = add(g.center, mul(g.dir, -g.hw))
              const s1 = add(g.center, mul(g.dir, g.hw))
              const half = ghostWall.thickness / 2 + 1
              const cut = [add(s0, mul(g.n, half)), add(s1, mul(g.n, half)), sub(s1, mul(g.n, half)), sub(s0, mul(g.n, half))]
              return <polygon points={ptsAttr(cut)} fill="rgba(37,99,235,0.35)" stroke={ACCENT} strokeWidth={1.2} {...NS} />
            })()}

          {/* размер: первая точка */}
          {dimStart && cursor && (
            <g>
              {(() => {
                // напротив грани — поперёк, как встанет размер
                const w = cursor.kind === 'face' ? dimSnap(plan.walls, cursor.p, 0.5) : null
                const b = squareDim(plan.walls, dimStart, dimStartRef, cursor.p, w?.ref)
                return (
                  <>
                    <line x1={dimStart.x} y1={dimStart.y} x2={b.x} y2={b.y} stroke={ACCENT} strokeWidth={1} strokeDasharray="4 3" {...NS} />
                    {lengthLabel(dimStart, b, 'dim-len')}
                  </>
                )
              })()}
            </g>
          )}

          {/* калибровка масштаба подложки */}
          {calibEdit && (
            <g pointerEvents="none">
              <line x1={calibEdit.a.x} y1={calibEdit.a.y} x2={calibEdit.b.x} y2={calibEdit.b.y} stroke="#16a34a" strokeWidth={2} {...NS} />
              <circle cx={calibEdit.a.x} cy={calibEdit.a.y} r={4 / zoom} fill="#16a34a" />
              <circle cx={calibEdit.b.x} cy={calibEdit.b.y} r={4 / zoom} fill="#16a34a" />
            </g>
          )}
          {calibA && cursor && (
            <g>
              <line x1={calibA.x} y1={calibA.y} x2={cursor.p.x} y2={cursor.p.y} stroke="#16a34a" strokeWidth={1.5} {...NS} />
              <circle cx={calibA.x} cy={calibA.y} r={4 / zoom} fill="#16a34a" />
              {lengthLabel(calibA, cursor.p, 'calib')}
            </g>
          )}

          {/* рулетка */}
          {measure && (
            <g>
              <line x1={measure.a.x} y1={measure.a.y} x2={measure.b.x} y2={measure.b.y} stroke="#f59e0b" strokeWidth={1.5} {...NS} />
              <circle cx={measure.a.x} cy={measure.a.y} r={3 / zoom} fill="#f59e0b" />
              <circle cx={measure.b.x} cy={measure.b.y} r={3 / zoom} fill="#f59e0b" />
              {lengthLabel(measure.a, measure.b, 'measure')}
            </g>
          )}

          {/* углы для выпрямления фото */}
          {cornerPts.length > 0 && (
            <g pointerEvents="none">
              <polyline points={[...cornerPts, ...(cursor ? [cursor.p] : [])].map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#d946ef" strokeWidth={1.5} strokeDasharray="5 4" {...NS} />
              {cornerPts.map((p, i) => (
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r={6 / zoom} fill="#fff" stroke="#d946ef" strokeWidth={2} {...NS} />
                  <text x={p.x} y={p.y - 10 / zoom} fontSize={11 / zoom} textAnchor="middle" fill="#a21caf" fontWeight={600}>
                    {i + 1}
                  </text>
                </g>
              ))}
            </g>
          )}

          {/* маркер курсора при рисовании */}
          {cursor && (tool === 'roomPick' || tool === 'corners' || tool === 'refine') && (
            <g pointerEvents="none">
              <line x1={cursor.p.x - 10 / zoom} y1={cursor.p.y} x2={cursor.p.x + 10 / zoom} y2={cursor.p.y} stroke="#d946ef" strokeWidth={1.5} {...NS} />
              <line x1={cursor.p.x} y1={cursor.p.y - 10 / zoom} x2={cursor.p.x} y2={cursor.p.y + 10 / zoom} stroke="#d946ef" strokeWidth={1.5} {...NS} />
            </g>
          )}
          {cursor && (tool === 'wall' || tool === 'room' || tool === 'dimension' || tool === 'measure' || tool === 'calibrate') && (
            <g pointerEvents="none">
              <circle cx={cursor.p.x} cy={cursor.p.y} r={(cursor.kind === 'endpoint' ? 7 : cursor.kind === 'face' ? 5 : 4) / zoom} fill="none" stroke={cursor.kind === 'endpoint' ? '#f43f5e' : cursor.kind === 'face' ? '#16a34a' : ACCENT} strokeWidth={1.5} {...NS} />
            </g>
          )}

          {/* ручки выбранной мебели */}
          {selFurn &&
            !selCat?.symbol &&
            (() => {
              const h = handlePositions(selFurn)
              return (
                <g>
                  <line x1={h.rotateBase.x} y1={h.rotateBase.y} x2={h.rotate.x} y2={h.rotate.y} stroke={ACCENT} strokeWidth={1} {...NS} />
                  <circle cx={h.rotate.x} cy={h.rotate.y} r={7 / zoom} fill="#fff" stroke={ACCENT} strokeWidth={1.5} {...NS} />
                  <text x={h.rotate.x} y={h.rotate.y} fontSize={9 / zoom} textAnchor="middle" dominantBaseline="central" fill={ACCENT} pointerEvents="none">
                    ↻
                  </text>
                  {selCat?.resizable !== false && (
                    <rect x={h.resize.x - 5 / zoom} y={h.resize.y - 5 / zoom} width={10 / zoom} height={10 / zoom} fill="#fff" stroke={ACCENT} strokeWidth={1.5} {...NS} transform={`rotate(${selFurn.rot} ${h.resize.x} ${h.resize.y})`} />
                  )}
                </g>
              )
            })()}

          {/* замки на зафиксированных стенах */}
          {lockedRuns.map((r) => {
            const m = lerp(r.a, r.b, 0.5)
            return (
              <g key={`lock-${r.ids[0]}`} transform={`translate(${m.x} ${m.y}) scale(${1 / zoom})`} pointerEvents="none">
                <circle r={9} fill="#fff" stroke="#6b7280" strokeWidth={1} />
                <g transform="translate(-6 -6.5) scale(0.5)" fill="none" stroke="#374151" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </g>
              </g>
            )
          })}
          {/* стена под курсором: вся прямая или, с Alt, участок до стыков */}
          {hoverRun && !(selRun && hoverRun.ids.includes(selection!.id)) && (
            hoverPart && hover?.kind === 'wall' && hoverPart.id === hover.id ? runBand(hoverRun, hoverPart.lo, hoverPart.hi, 'rgba(37,99,235,0.35)', 'hover-part') : runBand(hoverRun, 0, dist(hoverRun.a, hoverRun.b), 'rgba(75,85,99,0.55)', 'hover-run')
          )}
          {/* выбранный проём: расстояния до концов стены — видно, куда его двигать */}
          {selection?.kind === 'opening' &&
            build &&
            (() => {
              const op = plan.openings.find((o) => o.id === selection.id)
              const wall = op && wallMap.get(op.wallId)
              if (!op || !wall) return null
              const L = dist(wall.a, wall.b)
              const dir = norm(sub(wall.b, wall.a))
              const n = perp(dir)
              const hw = op.width / 2
              const left = op.t * L - hw
              const right = L - op.t * L - hw
              const off = wall.thickness / 2 + 14 / zoom
              const label = (from: number, to: number, key: string) => {
                if (to - from < 1) return null
                const m = add(wall.a, mul(dir, (from + to) / 2))
                const p = add(m, mul(n, off))
                let ang = angleDeg(wall.a, wall.b)
                if (ang > 90 || ang <= -90) ang += 180
                return (
                  <g key={key} pointerEvents="none">
                    <line x1={add(wall.a, mul(dir, from)).x + n.x * off} y1={add(wall.a, mul(dir, from)).y + n.y * off} x2={add(wall.a, mul(dir, to)).x + n.x * off} y2={add(wall.a, mul(dir, to)).y + n.y * off} stroke={ACCENT} strokeWidth={1} strokeDasharray="3 3" {...NS} />
                    <text transform={`translate(${p.x} ${p.y}) rotate(${ang})`} dy={-4 / zoom} fontSize={11 / zoom} textAnchor="middle" fill={ACCENT} stroke="#fff" strokeWidth={3 / zoom} paintOrder="stroke" fontFamily="system-ui, sans-serif" fontWeight={600}>
                      {fmtLen(to - from, unit)}
                    </text>
                  </g>
                )
              }
              return (
                <g>
                  {label(0, left, 'op-left')}
                  {label(L - right, L, 'op-right')}
                </g>
              )
            })()}
          {/* выбранная прямая (или её участок): подсветка, стрелки «тянуть поперёк», кружки на концах, длина */}
          {selRun && selA && selB && (
            <g>
              {selSec
                ? [runBand(selRun, 0, dist(selRun.a, selRun.b), 'rgba(37,99,235,0.3)', 'sel-run'), runBand(selRun, selSec.lo, selSec.hi, ACCENT, 'sel-part')]
                : runBand(selRun, 0, dist(selRun.a, selRun.b), ACCENT, 'sel-run')}
              {(() => {
                // стрелки — на трети прямой: посередине стоит её длина
                const m = lerp(selA, selB, dist(selA, selB) * zoom > 160 ? 0.3 : 0.5)
                const k = selRun.thickness / 2 + 10 / zoom
                const arrow = (sgn: number) => {
                  const tip = add(m, mul(selRun.normal, sgn * (k + 8 / zoom)))
                  const base = add(m, mul(selRun.normal, sgn * k))
                  const side = mul(selRun.dir, 6 / zoom)
                  return <polygon key={sgn} points={ptsAttr([tip, add(base, side), sub(base, side)])} fill={ACCENT} stroke="#fff" strokeWidth={1} {...NS} />
                }
                return [arrow(1), arrow(-1)]
              })()}
              {[selRun.a, selRun.b].map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={6 / zoom} fill="#fff" stroke={ACCENT} strokeWidth={1.5} {...NS} />
              ))}
              {selSec || wallRef === 'axis'
                ? lengthLabel(selA, selB, 'sel-wall-len')
                : (() => {
                    // длина по грани: линия грани и подпись снаружи от неё, у каждого её отрезка
                    const byRef = refLength(plan.walls, rooms, selRun, wallRef)
                    if (byRef.used === 'axis') return lengthLabel(selA, selB, 'sel-wall-len')
                    return byRef.segs.map((sg, i) => {
                      const m = lerp(sg.a, sg.b, 0.5)
                      const out = norm(sub(m, add(selRun.a, mul(selRun.dir, dot(sub(m, selRun.a), selRun.dir)))))
                      const p = add(m, mul(out, 10 / zoom))
                      let ang = angleDeg(sg.a, sg.b)
                      if (ang > 90 || ang <= -90) ang += 180
                      return (
                        <g key={`face-${i}`} pointerEvents="none">
                          <line x1={sg.a.x} y1={sg.a.y} x2={sg.b.x} y2={sg.b.y} stroke="#f59e0b" strokeWidth={2.5} {...NS} />
                          <text transform={`translate(${p.x} ${p.y}) rotate(${ang})`} fontSize={12 / zoom} textAnchor="middle" dominantBaseline="middle" fill={ACCENT} stroke="#fff" strokeWidth={3 / zoom} paintOrder="stroke" fontFamily="system-ui, sans-serif" fontWeight={600}>
                            {fmtLen(sg.length, unit)}
                          </text>
                        </g>
                      )
                    })
                  })()}
              {drag.current?.kind === 'wall' && Math.abs(drag.current.offset) >= 0.5 && (
                <text x={add(lerp(selRun.a, selRun.b, 0.7), mul(selRun.normal, selRun.thickness / 2 + 16 / zoom)).x} y={add(lerp(selRun.a, selRun.b, 0.7), mul(selRun.normal, selRun.thickness / 2 + 16 / zoom)).y} dy={4 / zoom} fontSize={12 / zoom} textAnchor="middle" fill={ACCENT} stroke="#fff" strokeWidth={3 / zoom} paintOrder="stroke" fontFamily="system-ui, sans-serif" fontWeight={700}>
                  сдвиг {fmtLen(Math.abs(drag.current.offset), unit)}
                </text>
              )}
            </g>
          )}
        </g>
      </svg>
      {/* набранная длина следующей стены */}
      {typed && cursor && tool === 'wall' && draft.length > 0 && (
        <div className="pl-typed" style={{ left: view.x + cursor.p.x * zoom + 16, top: view.y + cursor.p.y * zoom + 16 }}>
          <b>
            {typed} {UNIT_NAME[unit]}
          </b>
          <span>{typedPt ? 'по оси · Enter — поставить' : 'наведите, куда вести'}</span>
        </div>
      )}
      {/* масштаб подложки: длина показанного отрезка */}
      {calibEdit &&
        (() => {
          const m = lerp(calibEdit.a, calibEdit.b, 0.5)
          const commit = () => {
            const cm = Number(calibEdit.value.replace(',', '.')) * UNIT_CM[unit]
            if (!Number.isFinite(cm) || cm <= 0) {
              onNotice?.(`Нужно число больше нуля, например ${unit === 'm' ? '3,72' : unit === 'mm' ? '3720' : '372'}`)
              return
            }
            onCalibrate?.(calibEdit.a, calibEdit.b, cm)
            setCalibEdit(null)
          }
          return (
            <div className="pl-side-edit" style={{ left: view.x + m.x * zoom, top: view.y + m.y * zoom }} onPointerDown={(e) => e.stopPropagation()}>
              <div className="pl-side-edit-row">
                <span className="pl-side-edit-note">этот отрезок на плане —</span>
                <input
                  autoFocus
                  inputMode="decimal"
                  placeholder={unit === 'm' ? '3,72' : unit === 'mm' ? '3720' : '372'}
                  value={calibEdit.value}
                  onChange={(e) => setCalibEdit({ ...calibEdit, value: e.target.value })}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') commit()
                    if (e.key === 'Escape') setCalibEdit(null)
                  }}
                />
                <span>{UNIT_NAME[unit]}</span>
                <button className="pl-btn primary" onClick={commit}>
                  OK
                </button>
                <button className="pl-btn" onClick={() => setCalibEdit(null)} title="Отмена (Esc)">
                  ✕
                </button>
              </div>
            </div>
          )
        })()}
      {/* размер стороны комнаты: число и какую стену двигать */}
      {sideEdit &&
        (() => {
          const horizontal = Math.abs(sideEdit.b.x - sideEdit.a.x) >= Math.abs(sideEdit.b.y - sideEdit.a.y)
          const first: 'a' | 'b' = horizontal ? (sideEdit.a.x <= sideEdit.b.x ? 'a' : 'b') : sideEdit.a.y <= sideEdit.b.y ? 'a' : 'b'
          const ends: ('a' | 'b')[] = [first, first === 'a' ? 'b' : 'a']
          const names = horizontal ? ['◀ левую', 'правую ▶'] : ['▲ верхнюю', 'нижнюю ▼']
          return (
            <div className="pl-side-edit" style={{ left: view.x + sideEdit.at.x * zoom, top: view.y + sideEdit.at.y * zoom }} onPointerDown={(e) => e.stopPropagation()}>
              <div className="pl-side-edit-row">
                <input
                  autoFocus
                  inputMode="decimal"
                  value={sideEdit.value}
                  onChange={(e) => setSideEdit({ ...sideEdit, value: e.target.value })}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') applySide()
                    if (e.key === 'Escape') setSideEdit(null)
                  }}
                />
                <span>{UNIT_NAME[unit]}</span>
                <button className="pl-btn primary" onClick={applySide}>
                  OK
                </button>
                <button className="pl-btn" onClick={() => setSideEdit(null)} title="Отмена (Esc)">
                  ✕
                </button>
              </div>
              <div className="pl-side-edit-row">
                <span className="pl-side-edit-note">двигать</span>
                {ends.map((end, k) => {
                  const w = cornerWall(sideEdit.a, sideEdit.b, end)
                  return (
                    <button key={end} className={`pl-btn ${sideEdit.end === end ? 'active' : ''}`} disabled={!w || !!w.locked} title={!w ? 'за этим углом нет стены' : w.locked ? 'стена зафиксирована' : ''} onClick={() => setSideEdit({ ...sideEdit, end })}>
                      {names[k]}
                      {w?.locked ? ' 🔒' : ''}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })()}
    </div>
  )
})
PlannerCanvas.displayName = 'PlannerCanvas'
