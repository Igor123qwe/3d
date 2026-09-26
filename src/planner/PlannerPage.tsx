import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditMode, Layers, LengthUnit, Plan, Pt, Selection, Tool, Underlay, WallRef } from './types'
import { CATALOG, CATALOG_MAP, CATEGORIES, FLOORS, ROOM_NAMES, dims3d, itemMode, type CatalogItem, type CategoryKey } from './catalog'
import { usePlanHistory } from './store'
import { buildRooms } from './rooms'
import { runChecks } from './checks'
import { PlannerCanvas, dialogOpen, type CanvasHandle, type View } from './PlannerCanvas'
import { Scene, planBounds } from './Scene'
import { Glyph } from './Glyph'
import { TEMPLATES } from './templates'
import { downloadCsv, downloadJson, downloadPng, downloadSvg, normalizePlan, readPlanFile } from './exporters'
import type { Area } from './ops'
import {
  addOpening,
  clearWallsIn,
  deleteSelection,
  duplicateFurniture,
  isEmptyPlan,
  MIN_OPENING_WIDTH,
  MIN_WALL_LENGTH,
  OPENING_WIDTHS,
  wallNeededFor,
  rotateFurniture,
  setWallLength,
  updateDim,
  updateFurniture,
  updateOpening,
  setUnderlay,
  scalePlan,
  addRect,
  updateRoomMeta,
  updateUnderlay,
  updateWall,
  wallInArea,
  openingInArea,
  WALL_THICKNESSES,
} from './ops'
import { dist, fmtArea, fmtLen, fmtNum, lerp, normDeg, pointInPoly } from './geometry'
import { getTelegramWebApp } from '../telegram'
import { guessType, modelRefFromAsset, modelRefFromUrl, phAssets, phCategories, phDimsCm, phInfo, phPage, type PhAsset } from './polyhaven'
import { decodePlan, parseHash, planShareUrl } from './share'
import { DEFAULT_TRACE, calibrate, detectWalls, grayscaleOf, joinCorners, loadUnderlayImage, makeUnderlay, mergeCollinear, nameFromFile, planFromImage, toPixel, toPlan, tracePlan, type LoadedImage, type TraceOptions } from './underlay'
import { applyH, cleanRaster, distanceToInk, dominantAngle, floodRoom, grayToImage, groundRoomBox, hatchedStrips, labelBoxes, perspectiveQuad, rectTarget, rotateImage, segmentRooms, segmentRoomsAuto, textHeight, warpToRect, withoutLooseText, type CleanResult, type RoomRegion, type TextBox } from './raster'
import type { Guide } from './snapping'
import { aiStatus, askLayout, askNumbers, askZones, askRoomLabel, askSpot, cropForVision, lookupProductViaServer, numberSheet, recognizePlan, type AiCost, type AiStatus, type NumbersResult } from './ai'
import { applyAiPlan, convertAiPlan, fitResultToLabels, marksFromReads, roomLabelInBox, type ConvertResult } from './planai'
import { evenWalls, rectifyWalls } from './rectify'
import { followDims, roomDims } from './dims'
import { closeGaps, deleteRun, findGaps, guardLocks, refLength, setAllLocked, setRunLengthBy, setRunLocked, setRunThickness, touchesLocked, wallRun } from './walledit'
import { pointOnSide } from './reconstruct'
import { pointOnOutline } from './picture'
import type { LabelDispute } from './segment'
import type { AiBox, AiMark, AiPlan, AiRoomLabel } from './aicontract'
import { checkAiPlan, sizeFromText } from './aicontract'
import { furnish, type FurnishOptions } from './furnish'
import { FurnishDialog } from './FurnishDialog'
import { DEFAULT_AUTO, DEFAULT_ELECTRIC, ELECTRIC_NAMES, FEED_HEIGHT, FEED_NAMES, MOUNT_HEIGHT, autoElectrics, catalogTypeOf, type AutoElectricOptions } from './electrics'
import { designCsv, designElectrics, feedOf, powerOf } from './electricplan'
import { emptyPlan, type ElectricKind, type ElectricSettings, type Feed, type ProductRef } from './types'
import { fetchProduct, formatPrice, typeForProduct, type ProductInfo } from './products'
import { modelKey } from './polyhaven'
import { Icon, type IconName } from './icons'
import { Dropdown, MenuChoice, MenuGroup, MenuItem, MenuSep } from './Menu'
import { StartDialog } from './StartDialog'
import { AskDialog, type AskOption } from './AskDialog'
import { isEditable, useFileIntake } from './intake'
import './planner.css'

const View3D = lazy(() => import('./View3D'))

const LS_PLAN = 'boop.planner.plan.v1'
const LS_UI = 'boop.planner.ui.v1'

const DEFAULT_LAYERS: Layers = { grid: true, underlay: true, rooms: true, furniture: true, electric: true, dims: true, ergo: false, labels: true }

/** растр подложки для распознавания и его производные, считаются по требованию */
/** коммит, с которого запущен сервер: по нему видно, что работает свежий код, а не прежняя копия */
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'

interface Raster {
  src: string
  /** ширина растра, px: у рабочей копии меньше, чем у подложки */
  w: number
  gray: Uint8Array
  clean: CleanResult
  d2: Float32Array | null
  wallD2: Float32Array | null
  pocketD2: Float32Array | null
  /** подписи рамками — считаются, только когда их читать */
  texts?: TextBox[]
}

/** высота мелких цифр, на которой выверен разбор, и выше какой картинку уменьшаем */
const WORK_TEXT_PX = 13
const MAX_TEXT_PX = 16

/** результат распознавания по рабочей копии — обратно на подложку: масштаб в её пикселях */
function fromWork(res: ConvertResult, u: Underlay): ConvertResult {
  const k = res.underlay.px.w / u.px.w
  if (k === 1) return res
  return {
    ...res,
    underlay: { ...res.underlay, px: u.px, scale: res.underlay.scale * k },
    report: { ...res.report, scale: { ...res.report.scale, cmPerPx: res.report.scale.cmPerPx * k } },
  }
}

interface UiPrefs {
  layers: Layers
  unit: LengthUnit
  ortho: boolean
  wallThickness: number
  mode: EditMode
  wallRef: WallRef
}

const loadPrefs = (): UiPrefs => {
  try {
    const raw = localStorage.getItem(LS_UI)
    if (raw) {
      const p = JSON.parse(raw) as Partial<UiPrefs>
      return {
        layers: { ...DEFAULT_LAYERS, ...(p.layers ?? {}) },
        unit: p.unit ?? 'cm',
        ortho: p.ortho ?? true,
        wallThickness: p.wallThickness ?? 10,
        mode: p.mode === 'furnish' || p.mode === 'electric' ? p.mode : 'build',
        wallRef: p.wallRef === 'inner' || p.wallRef === 'outer' ? p.wallRef : 'axis',
      }
    }
  } catch {
    /* ignore */
  }
  return { layers: DEFAULT_LAYERS, unit: 'cm', ortho: true, wallThickness: 10, mode: 'build', wallRef: 'axis' }
}

/** был ли в этом браузере сохранённый план — чтобы не затирать работу планом из ссылки */
const hasSavedPlan = (): boolean => {
  try {
    return !!localStorage.getItem(LS_PLAN)
  } catch {
    return false
  }
}

const loadInitialPlan = (): Plan => {
  try {
    const raw = localStorage.getItem(LS_PLAN)
    if (raw) return normalizePlan(JSON.parse(raw))
  } catch {
    /* ignore */
  }
  // без сохранённого плана показываем стартовый экран, а под ним — чистый лист
  return TEMPLATES[0].build()
}

type PanelTab = 'props' | 'catalog' | 'electric' | 'checks' | 'help'

/** приборы, которые ставят вручную из меню электрики */
const ELECTRIC_MENU: { kind: ElectricKind; why: string; group: string }[] = [
  { kind: 'outlet', why: 'поставлена вручную', group: 'Силовая часть' },
  { kind: 'switch', why: 'поставлен вручную', group: 'Силовая часть' },
  { kind: 'light', why: 'поставлен вручную', group: 'Свет' },
  { kind: 'spot', why: 'поставлен вручную', group: 'Свет' },
  { kind: 'wall-lamp', why: 'поставлено вручную', group: 'Свет' },
  { kind: 'smart-outlet', why: 'управляется со смартфона', group: 'Умный дом' },
  { kind: 'smart-switch', why: 'сценарии и управление со смартфона', group: 'Умный дом' },
  { kind: 'switch-master', why: 'гасит весь свет одним нажатием', group: 'Умный дом' },
  { kind: 'dimmer', why: 'регулировка яркости', group: 'Умный дом' },
  { kind: 'curtain-motor', why: 'шторы по расписанию', group: 'Умный дом' },
  { kind: 'motion-sensor', why: 'свет по движению', group: 'Датчики' },
  { kind: 'leak-sensor', why: 'перекрывает воду при протечке', group: 'Датчики' },
  { kind: 'thermostat', why: 'тёплый пол по расписанию', group: 'Датчики' },
  { kind: 'panel', why: 'автоматы и модули умного дома', group: 'Щит' },
]

const TOOLS: { tool: Tool; icon: IconName; name: string; key: string }[] = [
  { tool: 'select', icon: 'select', name: 'Выбор', key: 'V' },
  { tool: 'wall', icon: 'wall', name: 'Стена', key: 'W' },
  { tool: 'room', icon: 'room', name: 'Комната', key: 'C' },
  { tool: 'door', icon: 'door', name: 'Дверь', key: 'D' },
  { tool: 'window', icon: 'window', name: 'Окно', key: 'N' },
  { tool: 'doorway', icon: 'doorway', name: 'Проём', key: '' },
  { tool: 'dimension', icon: 'dimension', name: 'Размер', key: 'M' },
  { tool: 'measure', icon: 'ruler', name: 'Рулетка', key: 'L' },
]

/** инструменты стройки: выбрали такой — режим сам переключается на стройку */
const BUILD_TOOLS: Tool[] = ['wall', 'room', 'door', 'window', 'doorway', 'dimension', 'calibrate', 'roomPick', 'corners', 'refine']

const MODES: { mode: EditMode; icon: IconName; name: string; hint: string }[] = [
  { mode: 'build', icon: 'wall', name: 'Стройка', hint: 'Стены, двери, окна, размеры. Мебель и электрика видны, но не цепляются мышью' },
  { mode: 'furnish', icon: 'furniture', name: 'Мебель', hint: 'Только мебель: стены и электрика не сдвинутся случайно' },
  { mode: 'electric', icon: 'bolt', name: 'Электрика', hint: 'Только точки электрики: розетки, выключатели, свет, щит' },
]

/** пустой проект электрики — пока он не нужен на экране */
const NO_DESIGN = designElectrics(emptyPlan(), [], DEFAULT_ELECTRIC)

const WALL_REFS: { ref: WallRef; name: string; long: string }[] = [
  { ref: 'axis', name: 'по оси', long: 'по оси' },
  { ref: 'inner', name: 'внутри', long: 'по внутренней грани' },
  { ref: 'outer', name: 'снаружи', long: 'по наружной грани' },
]

const COLORS = ['', '#e6edf7', '#f5e9d8', '#e6f3e8', '#e0f1f7', '#fdf1dc', '#fbe7ee', '#ececec', '#d9c9b4', '#c7d2fe', '#bbf7d0', '#fecaca', '#fde68a', '#ffffff', '#4b5563']

/**
 * Числовое поле, которое применяет значение по Enter или уходу фокуса.
 * Применение на каждый символ ломало данные: набирая «350» в длине стены,
 * пользователь на середине ввода получал стену 35 см и терял примыкающие.
 */
const NumberField: React.FC<{
  value: number
  onCommit: (v: number) => void
  min?: number
  max?: number
  step?: number
  list?: string
}> = ({ value, onCommit, min, max, step, list }) => {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const v = Number(draft.replace(',', '.'))
    setDraft(null)
    if (!Number.isFinite(v)) return
    onCommit(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)))
  }
  return (
    <input
      type="number"
      step={step}
      min={min}
      max={max}
      list={list}
      value={draft ?? String(Math.round(value * 100) / 100)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          setDraft(null)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

interface Props {
  onBack?: () => void
}

export const PlannerPage: React.FC<Props> = ({ onBack }) => {
  const history = usePlanHistory(loadInitialPlan, followDims)
  const { plan } = history
  const planRef = useRef(plan)
  planRef.current = plan
  const prefs = useMemo(loadPrefs, [])
  const [tool, setToolRaw] = useState<Tool>('select')
  const [selection, setSelection] = useState<Selection>(null)
  const [placing, setPlacing] = useState<CatalogItem | null>(null)
  const [layers, setLayers] = useState<Layers>(prefs.layers)
  const [unit, setUnit] = useState<LengthUnit>(prefs.unit)
  const [ortho, setOrtho] = useState(prefs.ortho)
  const [wallThickness, setWallThickness] = useState(prefs.wallThickness)
  /** режим правки: стройка, мебель или электрика */
  const [mode, setModeRaw] = useState<EditMode>(prefs.mode)
  /** по какой линии стены считать её длину */
  const [wallRef, setWallRef] = useState<WallRef>(prefs.wallRef)
  const [view, setView] = useState<View>({ x: 40, y: 40, zoom: 0.7 })
  const [panel, setPanel] = useState<PanelTab>('props')
  const [panelOpen, setPanelOpen] = useState(true)
  const [menu, setMenu] = useState<null | 'project' | 'view'>(null)
  // стартовый экран: при первом открытии и по «Новый…»; план из ссылки его не ждёт
  const [start, setStart] = useState(() => !hasSavedPlan() && !parseHash(location.hash).plan)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  /** вопрос с вариантами поверх холста: заменить проект, подложить схему и т. п. */
  const [ask, setAsk] = useState<{ title: string; text?: string; options: AskOption[]; onPick: (key: string) => void } | null>(null)
  /** план, который только что построили из шаблона или схемы, чтобы отличать его от своей работы */
  const untouched = useRef<Plan | null>(null)
  /** диалог «Расставить мебель с ИИ»: для всей квартиры или комнаты */
  const [furnishFor, setFurnishFor] = useState<null | 'all' | string>(null)
  /** масштаб подложки известен: задан руками или прочитан ИИ с размеров плана */
  const [scaleKnown, setScaleKnown] = useState(false)
  const [hint, setHint] = useState('')
  const [catQuery, setCatQuery] = useState('')
  const [catCategory, setCatCategory] = useState<CategoryKey | 'all'>('all')
  const [toast, setToast] = useState<string | null>(null)
  const [view3d, setView3d] = useState(false)
  const [catMode, setCatMode] = useState<'schemes' | 'photo' | 'link'>('schemes')
  const [phCats, setPhCats] = useState<{ name: string; count: number }[]>([])
  const [phCat, setPhCat] = useState('furniture')
  const [phItems, setPhItems] = useState<PhAsset[]>([])
  const [phState, setPhState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [customModelUrl, setCustomModelUrl] = useState('')
  const [trace, setTrace] = useState<TraceOptions>(DEFAULT_TRACE)
  /** магнит к линиям картинки при рисовании стен, комнат и размеров */
  const [magnet, setMagnet] = useState(true)
  /** линии, найденные на подложке, в пикселях картинки; в план переводятся по текущему положению подложки */
  const [imageLinesPx, setImageLinesPx] = useState<Guide[]>([])
  /** очищенный растр подложки: считается один раз на картинку и служит обводке, комнате по клику и магниту */
  /** сколько заштрихованных полос не стало комнатами при последнем поиске — для отчёта */
  const hatchedRef = useRef(0)
  const rasterRef = useRef<Raster | null>(null)
  const workRef = useRef<Raster | null>(null)
  const [tracing, setTracing] = useState(false)
  /** масштаб подложки задан руками — распознавание его не переопределяет */
  const [calibrated, setCalibrated] = useState(false)
  // состояние ИИ: приходит с сервера, потому что ключ живёт только там
  const [ai, setAi] = useState<AiStatus>({ enabled: false, tasks: [], spentToday: null })
  const [aiBusy, setAiBusy] = useState('')
  /** что и сколько стоил последний вызов — чтобы расходы не были сюрпризом */
  const [aiLast, setAiLast] = useState('')
  const [auto, setAuto] = useState<AutoElectricOptions>({ ...DEFAULT_AUTO, panel: true })
  /** вкладка проекта электрики и подсвеченная группа щита */
  const [elTab, setElTab] = useState<'panel' | 'bom' | 'norms' | 'add'>('panel')
  const [hlCircuit, setHlCircuit] = useState<string | null>(null)
  const [productUrl, setProductUrl] = useState('')
  const [product, setProduct] = useState<ProductInfo | null>(null)
  const [productState, setProductState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [productError, setProductError] = useState('')
  const imageInput = useRef<HTMLInputElement>(null)
  const [photoMode, setPhotoMode] = useState(() => {
    try {
      return localStorage.getItem('boop.planner.photo') !== '0'
    } catch {
      return true
    }
  })
  const [topViews, setTopViews] = useState<Record<string, string>>({})
  const topViewPending = useRef(new Set<string>())
  const topViewFailed = useRef(new Set<string>())
  const canvasRef = useRef<CanvasHandle>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const anyInput = useRef<HTMLInputElement>(null)
  const hadSavedPlan = useRef(hasSavedPlan()).current

  const roomsResult = useMemo(() => buildRooms(plan), [plan.walls, plan.rooms]) // eslint-disable-line react-hooks/exhaustive-deps
  const rooms = roomsResult.rooms
  useEffect(() => {
    // сравниваем содержимое, а не длину: так в план попадают и новые комнаты,
    // и пересчитанные якоря подписей, и при этом нет петли обновлений
    const metas = roomsResult.metas
    if (JSON.stringify(metas) !== JSON.stringify(plan.rooms)) history.silent((p) => ({ ...p, rooms: metas }))
  }, [roomsResult, plan.rooms, history])

  const check = useMemo(() => runChecks(plan, rooms), [plan, rooms])
  const badItems = useMemo(() => new Set(check.issues.filter((i) => i.level === 'error' && i.target?.kind === 'furniture').map((i) => i.target!.id)), [check])
  const problems = check.issues.filter((i) => i.level !== 'info').length

  // автосохранение
  const saveFailed = useRef(false)
  useEffect(() => {
    setSaveState('saving')
    const t = setTimeout(() => {
      try {
        try {
          localStorage.setItem(LS_PLAN, JSON.stringify(plan))
        } catch (e) {
          // исходное фото рядом с очищенным удваивает размер: без него план ещё может поместиться
          if (!plan.underlay?.original) throw e
          localStorage.setItem(LS_PLAN, JSON.stringify({ ...plan, underlay: { ...plan.underlay, original: undefined } }))
        }
        saveFailed.current = false
        setSaveState('saved')
      } catch {
        // чаще всего это переполнение хранилища из-за картинки-подложки
        setSaveState('error')
        if (!saveFailed.current) {
          saveFailed.current = true
          setToast('План не помещается в память браузера. Сохраните его в файл через «Проект» и уберите подложку')
        }
      }
    }, 400)
    return () => clearTimeout(t)
  }, [plan])
  useEffect(() => {
    try {
      localStorage.setItem(LS_UI, JSON.stringify({ layers, unit, ortho, wallThickness, mode, wallRef }))
    } catch {
      /* ignore */
    }
  }, [layers, unit, ortho, wallThickness, mode, wallRef])

  useEffect(() => {
    const t = setTimeout(() => canvasRef.current?.fit(), 60)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const tg = getTelegramWebApp() as (ReturnType<typeof getTelegramWebApp> & { disableVerticalSwipes?: () => void }) | null
    try {
      tg?.expand()
      tg?.disableVerticalSwipes?.()
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    // длинное сообщение висит дольше: ~45 мс на символ, но не дольше 9 с
    const t = setTimeout(() => setToast(null), Math.min(9000, Math.max(3500, 1500 + toast.length * 45)))
    return () => clearTimeout(t)
  }, [toast])

  // Esc закрывает открытое меню — иначе только щелчком мимо
  useEffect(() => {
    if (!menu) return
    const f = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [menu])

  // фотореалистичный план: виды сверху моделей
  useEffect(() => {
    try {
      localStorage.setItem('boop.planner.photo', photoMode ? '1' : '0')
    } catch {
      /* ignore */
    }
    if (!photoMode) return
    const items = plan.furniture.filter((f) => f.model)
    if (!items.length) return
    let alive = true
    import('./topview').then((mod) => {
      for (const f of items) {
        const h = f.h ?? dims3d(f).h
        const key = mod.topViewKey(f.model!, f.w, f.d, h)
        if (topViews[key] || topViewPending.current.has(key)) continue
        topViewPending.current.add(key)
        mod
          .renderTopView(f.model!, f.w, f.d, h)
          .then((url) => {
            if (alive) setTopViews((prev) => ({ ...prev, [key]: url }))
          })
          .catch(() => {
            if (alive && !topViewFailed.current.has(key)) {
              topViewFailed.current.add(key)
              setToast('Не удалось показать модель на плане — предмет нарисован схемой')
            }
          })
          .finally(() => topViewPending.current.delete(key))
      }
    })
    return () => {
      alive = false
    }
  }, [plan.furniture, photoMode]) // eslint-disable-line react-hooks/exhaustive-deps

  const photos = useMemo(() => {
    if (!photoMode) return undefined
    const out: Record<string, string> = {}
    for (const f of plan.furniture) {
      if (!f.model) continue
      const h = f.h ?? dims3d(f).h
      const url = topViews[`${modelKey(f.model)}|${Math.round(f.w)}x${Math.round(f.d)}x${Math.round(h)}`]
      if (url) out[f.id] = url
    }
    return Object.keys(out).length ? out : undefined
  }, [plan.furniture, topViews, photoMode])

  useEffect(() => {
    if (view3d) setHint('3D-вид: вращайте сцену мышью или пальцем. AR: на Android — «AR через камеру» в Chrome, на iPhone — «AR на iPhone» в Safari')
  }, [view3d])

  // план из ссылки (#mode=ar&plan=...)
  useEffect(() => {
    const h = parseHash(location.hash)
    if (!h.plan && !h.mode) return
    let alive = true
    const run = async () => {
      if (h.plan) {
        const p = await decodePlan(h.plan)
        if (!alive) return
        if (!p) setToast('Не удалось прочитать план из ссылки')
        else {
          const openIt = () => {
            history.replace(p)
            setSelection(null)
            setTimeout(() => canvasRef.current?.fit(), 30)
          }
          if (!hadSavedPlan) openIt()
          else
            setAsk({
              title: 'Открыть план из ссылки?',
              text: 'План, сохранённый в этом браузере, будет заменён. Прежний план вернёт Ctrl+Z.',
              options: [
                { key: 'open', label: 'Открыть план из ссылки', icon: 'link', primary: true },
                { key: 'keep', label: 'Оставить мой план', icon: 'file' },
              ],
              onPick: (k) => {
                setAsk(null)
                if (k === 'open') openIt()
              },
            })
        }
      }
      if (alive && (h.mode === '3d' || h.mode === 'ar')) {
        setView3d(true)
        if (h.mode === 'ar') setToast('Нажмите «AR через камеру» (Android) или «AR на iPhone»')
      }
      try {
        window.history.replaceState(null, '', location.pathname + location.search)
      } catch {
        /* ignore */
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // фотокаталог Poly Haven
  useEffect(() => {
    if (catMode !== 'photo') return
    let alive = true
    setPhState('loading')
    Promise.all([phCats.length ? Promise.resolve(phCats) : phCategories(), phAssets(phCat)])
      .then(([cats, items]) => {
        if (!alive) return
        setPhCats(cats)
        setPhItems(items)
        setPhState('idle')
      })
      .catch(() => alive && setPhState('error'))
    return () => {
      alive = false
    }
  }, [catMode, phCat]) // eslint-disable-line react-hooks/exhaustive-deps

  const isMobile = () => window.innerWidth < 860

  const setTool = useCallback((t: Tool) => {
    setToolRaw(t)
    if (t !== 'place') setPlacing(null)
    if (t !== 'select') setSelection(null)
    // инструмент стройки сам включает режим стройки
    if (BUILD_TOOLS.includes(t)) setModeRaw('build')
  }, [])

  /** выбранный объект показывает свой режим: из «Проверки» или 3D можно выбрать стену, когда включена мебель */
  const modeOfSelection = (s: Selection): EditMode | null => {
    if (!s || s.kind === 'room') return null
    if (s.kind === 'furniture') {
      const f = planRef.current.furniture.find((x) => x.id === s.id)
      return f ? itemMode(f) : null
    }
    return 'build'
  }

  const onSelect = useCallback((s: Selection) => {
    setSelection(s)
    const m = modeOfSelection(s)
    if (m) setModeRaw(m)
    if (s) {
      setPanel('props')
      if (!isMobile()) setPanelOpen(true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Переключить режим: инструмент — «Выбор», панель — своя, чужое выделение снимается */
  const switchMode = (m: EditMode) => {
    setModeRaw(m)
    setToolRaw('select')
    setPlacing(null)
    const cur = modeOfSelection(selection)
    if (cur && cur !== m) setSelection(null)
    if (m === 'furnish') setLayers((l) => (l.furniture ? l : { ...l, furniture: true }))
    if (m === 'electric') setLayers((l) => (l.electric ? l : { ...l, electric: true }))
    setPanel(m === 'furnish' ? 'catalog' : m === 'electric' ? 'electric' : 'props')
    if (!isMobile()) setPanelOpen(true)
  }

  const pick = (item: CatalogItem) => {
    // ставить можно только на чертеже: из 3D возвращаемся в 2D
    setView3d(false)
    setPlacing(item)
    setToolRaw('place')
    setSelection(null)
    setModeRaw(item.electric || item.category === 'electric' ? 'electric' : 'furnish')
    if (isMobile()) setPanelOpen(false)
  }

  const openCatalog = () => {
    setPanel('catalog')
    setPanelOpen(true)
    setModeRaw('furnish')
    if (tool !== 'place') setTool('select')
  }

  const pickPhoto = async (a: PhAsset) => {
    let dims = a.dims
    if (!dims) {
      try {
        dims = phDimsCm((await phInfo(a.id)).dimensions)
      } catch {
        /* размеры остались неизвестны — предупредим ниже */
      }
      if (!dims) setToast(`Размеры «${a.name}» неизвестны: задайте ширину и глубину в свойствах`)
    }
    const type = guessType(a)
    const cat = CATALOG_MAP[type] ?? CATALOG_MAP.box
    pick({ ...cat, name: a.name, w: dims?.w ?? cat.w, d: dims?.d ?? cat.d, h: dims?.h, model: modelRefFromAsset(a) })
  }

  const lookupProduct = async () => {
    const url = productUrl.trim()
    if (!url) return
    setProductState('loading')
    setProductError('')
    try {
      // Сервер читает страницу напрямую — без публичных читалок и их капризов,
      // а чего не нашлось в разметке, добирает дешёвой моделью.
      if (ai.enabled) {
        const res = await lookupProductViaServer(url)
        setProduct(res.product)
        setProductState('idle')
        if (res.ai && !res.ai.error) noteCost('товар', res.ai)
        return
      }
      const info = await fetchProduct(url)
      setProduct(info)
      setProductState('idle')
    } catch (e) {
      // ручной ввод всё равно доступен — подставляем заготовку
      setProduct({ url, name: '', source: 'ничего не найдено' })
      setProductError((e as Error).message)
      setProductState('error')
    }
  }

  const placeProduct = () => {
    if (!product) return
    const type = typeForProduct(product.name)
    const base = CATALOG_MAP[type] ?? CATALOG_MAP.box
    const ref: ProductRef = {
      url: product.url,
      name: product.name || base.name,
      photo: product.photo,
      price: product.price,
      currency: product.currency,
    }
    pick({
      ...base,
      name: ref.name,
      w: product.dims?.w ?? base.w,
      d: product.dims?.d ?? base.d,
      h: product.dims?.h,
      product: ref,
    })
  }

  const shareForPhone = async () => {
    try {
      const url = await planShareUrl(plan, 'ar')
      const tg = getTelegramWebApp() as (ReturnType<typeof getTelegramWebApp> & { openLink?: (u: string) => void }) | null
      if (tg?.openLink) {
        tg.openLink(url)
        return
      }
      await navigator.clipboard.writeText(url)
      setToast('Ссылка скопирована: откройте её на телефоне в Chrome (Android) или Safari (iPhone)')
    } catch {
      setToast('Не удалось скопировать ссылку')
    }
  }

  /**
   * В текущем проекте есть своя работа: не чистый лист и не шаблон, который никто не трогал.
   * Правки идут через операции, а те всегда создают новые массивы; служебные обновления
   * (имена комнат, название, сетка) массивы геометрии не трогают — по ним и сравниваем.
   */
  const hasOwnWork = () => {
    if (isEmptyPlan(plan)) return false
    const u = untouched.current
    return !u || u.walls !== plan.walls || u.openings !== plan.openings || u.furniture !== plan.furniture || u.dims !== plan.dims
  }

  /** новый проект (из шаблона или схемы) — через историю, чтобы Ctrl+Z вернул прежний */
  const openFresh = (next: Plan) => {
    history.apply(() => next)
    untouched.current = next
    setSelection(null)
    setMenu(null)
    setStart(false)
    setTimeout(() => canvasRef.current?.fit(), 30)
  }

  const newFromTemplate = (key: string) => {
    const t = TEMPLATES.find((x) => x.key === key)
    if (!t) return
    const go = () => openFresh(t.build())
    if (!hasOwnWork()) return go()
    setAsk({
      title: 'Заменить текущий план?',
      text: `Проект «${plan.name}» закроется. Ctrl+Z вернёт его, а Ctrl+S заранее сохранит в файл.`,
      options: [{ key: 'replace', label: `Открыть «${t.name}»`, hint: 'вместо текущего плана', icon: 'template', primary: true }],
      onPick: () => {
        setAsk(null)
        go()
      },
    })
  }

  // экспорт: рендерим сцену в скрытый SVG и сериализуем его
  const [exportJob, setExportJob] = useState<{ kind: 'png' | 'svg'; x: number; y: number; w: number; h: number; z: number } | null>(null)
  const exportSvgRef = useRef<SVGSVGElement>(null)
  const doExport = (kind: 'png' | 'svg') => {
    setMenu(null)
    const b = planBounds(plan)
    if (!b) {
      setToast('План пуст — нечего экспортировать')
      return
    }
    const pad = 120
    setExportJob({ kind, x: b.minX - pad, y: b.minY - pad, w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2, z: 2 })
  }
  useEffect(() => {
    if (!exportJob) return
    const el = exportSvgRef.current
    if (!el) {
      setExportJob(null)
      setToast('Не удалось подготовить изображение')
      return
    }
    const job = exportJob
    const run = async () => {
      try {
        const markup = new XMLSerializer().serializeToString(el)
        if (job.kind === 'svg') downloadSvg(plan.name, markup)
        else await downloadPng(plan.name, markup, job.w * job.z, job.h * job.z)
      } catch {
        setToast('Не удалось экспортировать')
      } finally {
        setExportJob(null)
      }
    }
    void run()
  }, [exportJob]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Куда девать картинку плана: 'new' — новый проект по схеме, 'underlay' — подложить
   * под текущий план (обвести заново), 'ask' — решить по ситуации: на чистом листе
   * и нетронутом шаблоне вопросов нет, в проект с правками спросим
   */
  type ImageMode = 'ask' | 'new' | 'underlay'
  const imageMode = useRef<ImageMode>('ask')

  const placeImage = (f: File, img: LoadedImage, mode: 'new' | 'underlay') => {
    setAsk(null)
    if (mode === 'new') {
      openFresh(planFromImage(img, nameFromFile(f.name, TEMPLATES[0].build().name), plan.settings))
    } else {
      const b = planBounds(plan)
      const center = b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : { x: 0, y: 0 }
      history.apply((p) => setUnderlay(p, makeUnderlay(img, center)))
      setSelection(null)
      setStart(false)
    }
    setCalibrated(false)
    setScaleKnown(false)
    setLayers((l) => ({ ...l, underlay: true }))
    setPanel('props')
    setPanelOpen(true)
    setView3d(false)
    setTimeout(() => canvasRef.current?.fit(), 50)
    const next = ai.enabled ? 'Нажмите «Распознать с ИИ» в панели справа' : 'Обведите стены по линиям или нарисуйте их поверх картинки'
    setToast(mode === 'new' ? `Новый проект по схеме. ${next}` : `Схема подложена под план. ${next}`)
  }

  /** Картинка плана: с холста, из буфера, из файла — путь один */
  const loadImageFile = async (f: File, mode: ImageMode = 'ask') => {
    const img = await loadUnderlayImage(f)
    if (mode !== 'ask') return placeImage(f, img, mode)
    if (!hasOwnWork()) return placeImage(f, img, 'new')
    const n = plan.furniture.length
    const what = [rooms.length ? `${rooms.length} ${rooms.length === 1 ? 'комната' : rooms.length <= 4 ? 'комнаты' : 'комнат'}` : plan.walls.length ? 'стены' : '', n ? `${n} ${n === 1 ? 'предмет' : n <= 4 ? 'предмета' : 'предметов'}` : ''].filter(Boolean).join(' и ')
    setAsk({
      title: 'Схема получена',
      text: `В проекте «${plan.name}» уже есть ${what || 'ваша работа'}. Начать новый проект по этой схеме или подложить её под текущий план?`,
      options: [
        { key: 'new', label: 'Новый проект по схеме', hint: 'текущий план закроется; Ctrl+Z вернёт его', icon: 'plus', primary: true },
        { key: 'underlay', label: 'Подложить под текущий план', hint: 'стены и мебель останутся, картинка ляжет под них', icon: 'image' },
      ],
      onPick: (key) => placeImage(f, img, key === 'underlay' ? 'underlay' : 'new'),
    })
  }

  const loadPlanFile = async (f: File) => {
    const p = await readPlanFile(f)
    history.replace(p)
    untouched.current = null
    setSelection(null)
    setStart(false)
    setTimeout(() => canvasRef.current?.fit(), 30)
    setToast(`Открыт план «${p.name}»`)
  }

  const loadPlanText = async (text: string) => {
    const p = normalizePlan(JSON.parse(text) as Partial<Plan>)
    history.replace(p)
    untouched.current = null
    setSelection(null)
    setStart(false)
    setTimeout(() => canvasRef.current?.fit(), 30)
    setToast(`Вставлен план «${p.name}»`)
  }

  // перетаскивание на окно, Ctrl+V и кнопка «Вставить из буфера» — всё сюда
  const intake = useFileIntake({ onImage: loadImageFile, onPlanFile: loadPlanFile, onPlanText: loadPlanText, onError: setToast })

  const onOpenImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      await loadImageFile(f, imageMode.current)
    } catch (err) {
      setToast((err as Error).message)
    }
  }

  /** общий выбор файла: картинка или JSON — разберёт приёмник */
  const onOpenAny = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    e.target.value = ''
    void intake.takeFiles(files)
  }

  // Ctrl+S сохраняет файл плана, Ctrl+O открывает; Ctrl+V обрабатывает приёмник
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target) || dialogOpen() || !(e.ctrlKey || e.metaKey)) return
      if (e.code === 'KeyS') {
        e.preventDefault()
        downloadJson(plan)
        setToast('План сохранён в файл')
      } else if (e.code === 'KeyO') {
        e.preventDefault()
        fileInput.current?.click()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [plan])

  const onCalibrate = (a: Pt, b: Pt, cm: number) => {
    const u = plan.underlay
    if (!u) return
    history.apply((p) => (p.underlay ? { ...p, underlay: calibrate(p.underlay, a, b, cm) } : p))
    setCalibrated(true)
    setScaleKnown(true)
    setTool('select')
    setToast(`Масштаб задан: ${(cm / 100).toFixed(2)} м на показанном отрезке`)
  }

  /** Очищенный растр текущей подложки; пересчитывается только при смене картинки */
  const ensureRaster = async (u: Underlay): Promise<Raster> => {
    const cur = rasterRef.current
    if (cur && cur.src === u.src) return cur
    const gray = await grayscaleOf(u)
    const clean = cleanRaster(gray, u.px.w, u.px.h)
    const next: Raster = { src: u.src, w: u.px.w, gray, clean, d2: null, wallD2: null, pocketD2: null }
    rasterRef.current = next
    return next
  }

  /**
   * Растр для распознавания комнат. Пороги разбора выверены на картинках, где
   * мелкие цифры — 8–16 точек в высоту. На крупном фото (цифры по 25 точек)
   * штрих цифры у стены сходит за кусок стены и перегораживает закутки, а
   * результат зависит от того, каким файлом прислали план. Такую картинку
   * разбираем уменьшенной; wu — та же подложка в пикселях рабочей копии:
   * положение и сантиметры те же, поэтому стены и проёмы из неё встают на место.
   */
  const ensureWork = async (u: Underlay): Promise<{ r: Raster; wu: Underlay }> => {
    const full = await ensureRaster(u)
    const text = textHeight(full.clean.marks)
    if (!text || text <= MAX_TEXT_PX) return { r: full, wu: u }
    const w = Math.max(1, Math.round((u.px.w * WORK_TEXT_PX) / text))
    const h = Math.max(1, Math.round((u.px.h * w) / u.px.w))
    const wu: Underlay = { ...u, px: { w, h }, scale: (u.scale * u.px.w) / w }
    const cur = workRef.current
    if (cur && cur.src === u.src && cur.w === w) return { r: cur, wu }
    const gray = await grayscaleOf(wu)
    const next: Raster = { src: u.src, w, gray, clean: cleanRaster(gray, w, h), d2: null, wallD2: null, pocketD2: null }
    workRef.current = next
    return { r: next, wu }
  }

  // линии на картинке для магнита: считаем при смене подложки, в фоне
  useEffect(() => {
    const u = plan.underlay
    if (!u) {
      setImageLinesPx([])
      return
    }
    let alive = true
    void ensureRaster(u)
      .then((r) => {
        if (!alive) return
        const px = (cm: number) => Math.max(2, Math.round(cm / u.scale))
        const found = detectWalls(r.clean.gray, u.px.w, u.px.h, { threshold: 128, minLength: px(40), minThickness: 2, maxThickness: px(60) })
        const segs = mergeCollinear(joinCorners(found, px(12)), px(12))
        setImageLinesPx(segs.map((sg) => ({ a: sg.a, b: sg.b })))
      })
      .catch(() => setImageLinesPx([]))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.underlay?.src])

  const imageLines = useMemo<Guide[] | undefined>(() => {
    const u = plan.underlay
    if (!u || !magnet || !u.visible || !layers.underlay || !imageLinesPx.length) return undefined
    return imageLinesPx.map((l) => ({ a: toPlan(u, l.a), b: toPlan(u, l.b) }))
  }, [plan.underlay, magnet, layers.underlay, imageLinesPx])

  /** Заменить картинку подложки, сохранив масштаб и центр */
  /** заменить картинку подложки, сохранив её центр; original — исходное фото в тех же пикселях (для чтения подписей моделью) */
  const replaceUnderlayImage = (img: LoadedImage, original?: string) => {
    history.apply((p) => {
      const u = p.underlay
      if (!u) return p
      const cx = u.x + (u.px.w * u.scale) / 2
      const cy = u.y + (u.px.h * u.scale) / 2
      return { ...p, underlay: { ...u, src: img.src, original, px: { w: img.w, h: img.h }, x: cx - (img.w * u.scale) / 2, y: cy - (img.h * u.scale) / 2 } }
    })
  }

  // отладочный доступ к растру из сквозных проверок: только в dev-сборке
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as { __plannerDebug?: unknown }).__plannerDebug = {
      raster: async () => {
        const u = plan.underlay
        if (!u) return null
        const r = await ensureRaster(u)
        if (!r.d2) r.d2 = distanceToInk(r.clean.bin)
        return { w: u.px.w, h: u.px.h, scale: u.scale, ink: r.clean.bin.ink, walls: r.clean.walls.ink, marks: r.clean.marks.ink, d2: r.d2 }
      },
      /** рабочая копия растра, по которой ищутся комнаты и проёмы */
      work: async () => {
        const u = plan.underlay
        if (!u) return null
        const { r, wu } = await ensureWork(u)
        return { w: wu.px.w, h: wu.px.h, scale: wu.scale, ink: r.clean.bin.ink, walls: r.clean.walls.ink, marks: r.clean.marks.ink }
      },
      /** комнаты с картинки — те же, что берёт распознавание, в пикселях подложки */
      regions: async () => {
        const u = plan.underlay
        if (!u) return []
        const { regions, wu } = await regionsOf(u)
        const k = u.px.w / wu.px.w
        return regions.map((g) => ({ ...g, x1: g.x1 * k, y1: g.y1 * k, x2: g.x2 * k, y2: g.y2 * k, cx: g.cx * k, cy: g.cy * k, areaPx: g.areaPx * k * k, poly: g.poly?.map((p) => ({ x: p.x * k, y: p.y * k })) }))
      },
      /** подписи, найденные на рабочей копии: рамки в пикселях подложки */
      texts: async () => {
        const u = plan.underlay
        if (!u) return []
        const { r, wu } = await ensureWork(u)
        const k = u.px.w / wu.px.w
        const text = textHeight(r.clean.marks)
        if (!r.texts) r.texts = text ? labelBoxes(r.clean.marks, r.clean.walls, text) : []
        return r.texts.map((g) => ({ ...g, x1: g.x1 * k, y1: g.y1 * k, x2: (g.x2 + 1) * k, y2: (g.y2 + 1) * k }))
      },
      /** лист вырезок, который уходит модели при «Распознать с ИИ» */
      numberSheet: async () => {
        const u = plan.underlay
        if (!u) return null
        const { regions, wu, r } = await regionsOf(u)
        const pick = labelsToRead(r, regions)
        return pick ? { image: await numberSheet(u.original ?? u.src, pick.boxes, wu.px.w, pick.text), count: pick.boxes.length } : null
      },
      segmentRooms,
      segmentRoomsAuto,
      /**
       * Прогон распознавания на текущей подложке с готовыми подписями — для
       * набора проверки (tools/bench.mjs): подписи берутся из проверенного
       * вручную эталона, а геометрию и оценку качества считает тот же код, что
       * и кнопка «Распознать с ИИ».
       */
      runWithLabels: async (labels: unknown, opts: { apply?: boolean; asPicture?: boolean; texts?: { x: number; y: number; text: string }[] } = {}) => {
        const u0 = plan.underlay
        if (!u0) return null
        const u = u0
        const straight = await planStraighten(u)
        const ai = checkAiPlan(labels)
        const { regions, wu, r: raster } = await regionsOf(u)
        // Размеры по одному: лист «читается» по эталону — в каждой рамке то
        // число, чья точка в эталоне попала в рамку. Так набор проверяет
        // поиск подписей, привязку к стенам и подгонку без модели
        let marksRead: { boxes: number; sizes: number } | null = null
        if (opts.texts) {
          const pick = labelsToRead(raster, regions)
          if (pick) {
            const m = 0.5 * pick.text
            const reads = pick.boxes.map((b) => opts.texts!.find((t) => t.x * wu.px.w >= b.x1 - m && t.x * wu.px.w <= b.x2 + 1 + m && t.y * wu.px.h >= b.y1 - m && t.y * wu.px.h <= b.y2 + 1 + m)?.text ?? null)
            ai.marks = marksFromReads(pick.boxes, reads, wu.px)
            marksRead = { boxes: pick.boxes.length, sizes: ai.marks.length }
          }
        }
        const ground = (box: AiBox, closeCm: number) => {
          const closePx = Math.min(80, Math.max(3, Math.round(closeCm / wu.scale)))
          const g = groundRoomBox(raster.d2!, wu.px.w, wu.px.h, box, closePx)
          return g ? { x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 } : null
        }
        const plain = straightenResult(fromWork(convertAiPlan(ai, wu, { ground, regions, raster: { d2: raster.d2!, w: wu.px.w, h: wu.px.h } }), u), straight)
        const result = opts.asPicture ? plain : fitResultToLabels(plain, ai.rooms)
        const { rooms } = buildRooms({ ...plan, walls: result.walls, openings: result.openings, rooms: result.rooms, furniture: [], dims: [] })
        // для снимков: чертёж как после «Распознать с ИИ»
        if (opts.apply) {
          history.apply((prev) => applyAiPlan(prev, result).plan)
          setTimeout(() => canvasRef.current?.fit(), 50)
        }
        return {
          report: result.report,
          marksRead,
          regions: regions.length,
          walls: result.walls.map((w) => [Math.round(w.a.x), Math.round(w.a.y), Math.round(w.b.x), Math.round(w.b.y), w.thickness]),
          // проёмы с комнатами по обе стороны стены: по ним набор сверяет двери и окна с эталоном
          openings: result.openings.map((o) => {
            const w = result.walls.find((x) => x.id === o.wallId)!
            const p = { x: w.a.x + (w.b.x - w.a.x) * o.t, y: w.a.y + (w.b.y - w.a.y) * o.t }
            const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1
            const n = { x: -(w.b.y - w.a.y) / L, y: (w.b.x - w.a.x) / L }
            const side = (k: number) => rooms.find((r) => pointInPoly({ x: p.x + n.x * k * (w.thickness / 2 + 20), y: p.y + n.y * k * (w.thickness / 2 + 20) }, r.polygon))?.meta.name
            return { kind: o.kind, widthCm: Math.round(o.width), rooms: [side(1), side(-1)].filter((x): x is string => !!x).sort() }
          }),
          regionBoxes: regions.map((g) => [Math.round(g.x1), Math.round(g.y1), Math.round(g.x2), Math.round(g.y2), g.poly?.length ?? 4]),
          rooms: rooms.map((r) => ({
            name: r.meta.name,
            areaM2: r.area,
            corners: r.polygon.length,
            at: { x: Math.round(r.meta.anchor.x), y: Math.round(r.meta.anchor.y) },
            box: { x1: Math.round(Math.min(...r.inner.map((p) => p.x))), y1: Math.round(Math.min(...r.inner.map((p) => p.y))), x2: Math.round(Math.max(...r.inner.map((p) => p.x))), y2: Math.round(Math.max(...r.inner.map((p) => p.y))) },
            // длины граней в чистоте: по ним набор проверяет ниши и уступы
            edges: r.inner.map((p, i) => Math.round(Math.hypot(r.inner[(i + 1) % r.inner.length].x - p.x, r.inner[(i + 1) % r.inner.length].y - p.y))),
            widthCm: Math.max(...r.inner.map((p) => p.x)) - Math.min(...r.inner.map((p) => p.x)),
            depthCm: Math.max(...r.inner.map((p) => p.y)) - Math.min(...r.inner.map((p) => p.y)),
          })),
        }
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.underlay])

  /** поля вокруг комнаты на её вырезке для модели, px */
  const cropPad = (u: Underlay) => Math.round(Math.max(u.px.w, u.px.h) * 0.05)

  /**
   * Место вдоль стены — из вырезки в рамку комнаты: модель видит комнату с
   * полями вокруг (вырезка обрезана краем картинки — как в cropForVision)
   */
  const inRoomBox = (room: AiRoomLabel, r: RoomRegion, u: Underlay): AiRoomLabel => {
    const pad = cropPad(u)
    const crop = { x1: Math.max(0, r.x1 - pad), y1: Math.max(0, r.y1 - pad), x2: Math.min(u.px.w, r.x2 + pad), y2: Math.min(u.px.h, r.y2 + pad) }
    return roomLabelInBox(room, crop, r)
  }

  /**
   * Подписи, которые стоит прочитать по одному: внутри найденных комнат и у
   * их стен, сверху вниз и слева направо. Квадратики штриховки за наружной
   * стеной и мусор на полях скриншота сюда не попадают
   */
  const labelsToRead = (r: Raster, regions: RoomRegion[]): { boxes: TextBox[]; text: number } | null => {
    const text = textHeight(r.clean.marks)
    if (!text) return null
    if (!r.texts) r.texts = labelBoxes(r.clean.marks, r.clean.walls, text)
    const near = 1.5 * text
    const boxes = r.texts
      .filter((b) => {
        const cx = (b.x1 + b.x2) / 2
        const cy = (b.y1 + b.y2) / 2
        return regions.some((g) => cx >= g.x1 - near && cx <= g.x2 + near && cy >= g.y1 - near && cy <= g.y2 + near)
      })
      .sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1)
      .slice(0, 60)
    return boxes.length >= 2 ? { boxes, text } : null
  }

  /**
   * Размеры по одному. Подписи уже найдены на картинке рамками — модели
   * остаётся прочитать числа на листе вырезок, крупных и прямых. Где стоит
   * число и какую стену меряет, видно по месту: сторону и место вдоль стены
   * модель больше не угадывает. Лист, который дешёвая модель вернула почти
   * пустым, уходит следующей: неполный ответ — не ошибка для цепочки, но и
   * не ответ
   */
  const readMarks = async (photo: string, r: Raster, wu: Underlay, regions: RoomRegion[]): Promise<{ marks: AiMark[]; ai: AiCost; boxes: number; sizes: number } | null> => {
    const pick = labelsToRead(r, regions)
    if (!pick) return null
    const { boxes, text } = pick
    const sheet = await numberSheet(photo, boxes, wu.px.w, text)
    const readsOf = (ans: NumbersResult) => boxes.map((_, i) => ans.numbers.find((x) => x.n === i + 1)?.text ?? null)
    const sizes = (reads: (string | null)[]) => reads.filter((t) => sizeFromText(t) !== null).length
    const first = await askNumbers(sheet, boxes.length)
    let reads = readsOf(first)
    let ai: AiCost = first.ai
    if (sizes(reads) < Math.ceil(boxes.length / 4)) {
      const again = await askNumbers(sheet, boxes.length, undefined, 1).catch(() => null)
      if (again) {
        // в отчёт — модель, чьи числа взяты; цена — за оба прохода
        const better = sizes(readsOf(again)) > sizes(reads)
        if (better) reads = readsOf(again)
        ai = { ...(better ? again.ai : first.ai), costRub: first.ai.costRub + again.ai.costRub, tried: [...(first.ai.tried ?? []), ...(again.ai.tried ?? [])] }
      }
    }
    return { marks: marksFromReads(boxes, reads, wu.px), ai, boxes: boxes.length, sizes: sizes(reads) }
  }

  /**
   * Прочитать подписи комнат по их фрагментам: каждая область с картинки
   * уходит модели отдельной картинкой, крупно. Возвращает готовый ответ в том
   * же виде, что и общий проход, или null, если подписей набралось слишком
   * мало — тогда работает прежний путь по всему снимку.
   */
  const readRoomLabels = async (photo: string, regions: RoomRegion[], u: Underlay): Promise<{ plan: AiPlan; ai: { model: string; costRub: number; tried: string[] }; notRooms: RoomRegion[] } | null> => {
    const take = regions.slice(0, 12)
    const rooms: AiPlan['rooms'] = []
    const openings: AiPlan['openings'] = []
    let model = ''
    let costRub = 0
    const tried: string[] = []
    const notRooms: RoomRegion[] = []
    let done = 0
    // по три зараз: дешёвой модели это быстро, а лимит запросов не выбирается
    for (let i = 0; i < take.length; i += 3) {
      const batch = take.slice(i, i + 3)
      setAiBusy(`Читаю подписи комнат… ${Math.min(i + batch.length, take.length)} из ${take.length}`)
      const answers = await Promise.all(
        batch.map(async (r, k) => {
          try {
            // соседние комнаты на фрагменте закрашены: у Г-образной комнаты
            // в рамку попадает соседка, и модель читала её номер
            const others = regions.filter((g) => g !== r && g.poly).map((g) => g.poly!)
            const crop = await cropForVision(photo, r, cropPad(u), 640, others, u.px.w)
            // пропорции подсказывают модели, что перед ней: вытянутый коридор и
            // квадратная комната путаются, если смотреть на них вслепую. Номера
            // в подсказке нет: модель переписывала его в имя комнаты
            const side = (r.x2 - r.x1) / Math.max(1, r.y2 - r.y1)
            const shape = r.poly && r.poly.length > 4 ? 'непрямоугольная, с уступами' : side >= 2 ? 'вытянута по горизонтали' : side <= 0.5 ? 'вытянута по вертикали' : 'близка к прямоугольнику'
            const hint = `На картинке она ${shape}.`
            const first = await askRoomLabel(crop, hint)
            // Без размеров комната остаётся как на картинке: у 4ж «4,26» написано
            // посреди комнаты, и дешёвая модель его пропускает, а у комнаты с
            // нишами без размеров вдоль стен ниша и коридор не подгоняются.
            // Переспросить следующую модель (она заточена под чтение
            // документов) и взять у неё то, чего не хватило
            const noSizes = !first.room.widthCm && !first.room.depthCm
            const noWalls = shape.startsWith('непрямоугольная') && !first.room.walls?.length
            if (!first.room.notRoom && (noSizes || noWalls)) {
              const again = await askRoomLabel(crop, `${hint} Прочитай ширину, глубину и все размеры, подписанные вдоль её стен (walls).`, undefined, 1).catch(() => null)
              if (again && !again.room.notRoom && (again.room.widthCm || again.room.depthCm || again.room.walls?.length)) {
                const tried = [...(first.ai.tried ?? []), ...(again.ai.tried ?? [])]
                return {
                  // прочитанное первой моделью остаётся, недостающее — от второй
                  room: { ...again.room, ...first.room, walls: first.room.walls?.length ? first.room.walls : again.room.walls },
                  ai: { ...again.ai, costRub: first.ai.costRub + again.ai.costRub, tried },
                }
              }
            }
            return first
          } catch (e) {
            console.info('[ИИ] комната не прочиталась', (e as Error).message)
            return null
          }
        }),
      )
      answers.forEach((ans0, k) => {
        const r = batch[k]
        const ans = ans0 ? { ...ans0, room: inRoomBox(ans0.room, r, u) } : null
        const box = { x1: r.x1 / u.px.w, y1: r.y1 / u.px.h, x2: r.x2 / u.px.w, y2: r.y2 / u.px.h }
        const at = { x: r.cx / u.px.w, y: r.cy / u.px.h }
        if (!ans) {
          rooms.push({ name: `Помещение ${rooms.length + 1}`, x: at.x, y: at.y, box })
          return
        }
        done++
        // модель видит штриховку, шахту или колонну — это не комната
        if (ans.room.notRoom) {
          notRooms.push(r)
          model = ans.ai.model
          costRub += ans.ai.costRub
          return
        }
        model = ans.ai.model
        costRub += ans.ai.costRub
        for (const t of ans.ai.tried ?? []) if (!tried.includes(t)) tried.push(t)
        const name = ans.room.name || `Помещение ${rooms.length + 1}`
        rooms.push({ name, kind: ans.room.kind, areaM2: ans.room.areaM2, widthCm: ans.room.widthCm, depthCm: ans.room.depthCm, walls: ans.room.walls, x: at.x, y: at.y, box })
        for (const o of ans.room.openings ?? []) {
          const p = r.poly ? pointOnOutline(r.poly, o.side, o.at) : pointOnSide({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 }, o.side, o.at)
          openings.push({ kind: o.kind, room: name, side: o.side, at: o.at, x: p.x / u.px.w, y: p.y / u.px.h, widthCm: o.widthCm })
        }
      })
    }
    // подписей меньше половины — фрагменты не помогли, пусть модель посмотрит план целиком
    if (done < Math.ceil(take.length / 2)) return null
    return { plan: { walls: [], openings, rooms, dimensions: [], note: `подписи прочитаны по ${done} фрагментам комнат` }, ai: { model, costRub, tried }, notRooms }
  }

  /**
   * Перечитать спорные подписи: для каждой комнаты, где цифра не сошлась с
   * картинкой, — тот же фрагмент модели посильнее и прямой вопрос. Правильный
   * ответ мы ей не подсказываем, только направление: «стена короче, чем ты
   * прочитала» — иначе она просто согласится с нами.
   */
  const rereadDisputed = async (photo: string, regions: RoomRegion[], u: Underlay, read: AiPlan, disputes: LabelDispute[]): Promise<{ plan: AiPlan; ai: { model: string; costRub: number; tried: string[] } } | null> => {
    const names = [...new Set(disputes.map((d) => d.room))].slice(0, 4)
    if (!names.length) return null
    setAiBusy(`Перечитываю спорные подписи: ${names.join(', ')}…`)
    const rooms = read.rooms.map((r) => ({ ...r }))
    let model = ''
    let costRub = 0
    const tried: string[] = []
    let changed = 0
    await Promise.all(
      names.map(async (name) => {
        const room = rooms.find((r) => r.name === name)
        if (!room?.box) return
        const at = { x: room.x * u.px.w, y: room.y * u.px.h }
        const region = regions.find((g) => (g.poly ? pointInPoly(at, g.poly) : at.x >= g.x1 && at.x <= g.x2 && at.y >= g.y1 && at.y <= g.y2))
        if (!region) return
        const what = disputes
          .filter((d) => d.room === name)
          .map((d) => {
            const field = d.field === 'area' ? 'площадь' : d.field === 'width' ? 'размер у верхней или нижней стены' : 'размер у левой или правой стены'
            const dir = d.label > d.picture ? 'на чертеже эта величина заметно меньше' : 'на чертеже эта величина заметно больше'
            return `${field}: ты прочитала ${d.label}, но ${dir}`
          })
          .join('; ')
        try {
          const others = regions.filter((g) => g !== region && g.poly).map((g) => g.poly!)
          const crop = await cropForVision(photo, region, Math.round(Math.max(u.px.w, u.px.h) * 0.05), 800, others, u.px.w)
          const ans = await askRoomLabel(crop, `Перечитай подписи этой комнаты очень внимательно, цифру за цифрой. Не сходится: ${what}. Если подпись и правда такая — оставь её.`, undefined, 1)
          model = ans.ai.model
          costRub += ans.ai.costRub
          for (const t of ans.ai.tried ?? []) if (!tried.includes(t)) tried.push(t)
          if (ans.room.areaM2 !== undefined) room.areaM2 = ans.room.areaM2
          if (ans.room.widthCm !== undefined) room.widthCm = ans.room.widthCm
          if (ans.room.depthCm !== undefined) room.depthCm = ans.room.depthCm
          changed++
        } catch (e) {
          console.info('[ИИ] перечитать не вышло', name, (e as Error).message)
        }
      }),
    )
    return changed ? { plan: { ...read, rooms }, ai: { model, costRub, tried } } : null
  }

  /**
   * Все комнаты с картинки: области заливки по очищенному растру. Области — в
   * пикселях рабочей копии wu (у крупной картинки она меньше подложки)
   */
  const regionsOf = async (u0: Underlay): Promise<{ regions: RoomRegion[]; wu: Underlay; r: Raster }> => {
    const { r, wu: u } = await ensureWork(u0)
    if (!r.d2) r.d2 = distanceToInk(r.clean.bin)
    // Комнаты ищем по одним стеновым линиям: подписи, выноски и панели
    // приложения на скриншоте иначе дают «комнаты» на полях. Рамка плана
    // отсекает всё, что лежит за чертежом
    if (!r.wallD2) r.wallD2 = distanceToInk(r.clean.walls)
    // закутки ограничивает вся графика, кроме отдельно стоящих цифр
    if (!r.pocketD2) r.pocketD2 = distanceToInk(withoutLooseText(r.clean.bin, r.clean.walls, textHeight(r.clean.marks), r.clean.labels))
    // дверной проём до 90 см закрывается радиусом в полпроёма; точный радиус подбирается сам
    const closePx = Math.min(80, Math.max(3, Math.round(45 / u.scale)))
    // заштрихованная полоса (вентшахта, кладка) — не комната: очистка стёрла
    // штриховку, но по исходным меткам она видна
    const rooms = (list: RoomRegion[]) => {
      const bad = new Set(hatchedStrips(list, r.clean.marks))
      return { list: list.filter((_, k) => !bad.has(k)), hatched: bad.size }
    }
    const byWalls = rooms(segmentRoomsAuto(r.wallD2, u.px.w, u.px.h, closePx, null, r.pocketD2).regions)
    // стеновые линии бывают прерывистыми: если по ним комнат нашлось меньше,
    // чем по всей графике, берём прежний путь
    const byAll = rooms(segmentRoomsAuto(r.d2, u.px.w, u.px.h, closePx).regions)
    const pick = byWalls.list.length >= byAll.list.length ? byWalls : byAll
    hatchedRef.current = pick.hatched
    return { regions: pick.list, wu: u, r }
  }

  /** Комнаты с картинки без ИИ: сегментация даёт геометрию, имена — по номерам */
  const roomsFromPicture = async () => {
    const u0 = plan.underlay
    if (!u0 || tracing) return
    setTracing(true)
    try {
      const u = u0
      const straight = await planStraighten(u).catch(() => null)
      const { regions, wu, r } = await regionsOf(u)
      if (regions.length < 2) {
        setToast(regions.length ? 'На картинке нашлась только одна замкнутая область — попробуйте «Очистить» фото или «Комната по клику»' : 'Замкнутых комнат на картинке не нашлось: линии стен прерываются. Попробуйте «Очистить» или «Комната по клику»')
        return
      }
      const result = straightenResult(fromWork(convertAiPlan({ walls: [], openings: [], rooms: [], dimensions: [] }, wu, { keepScale: true, regions, raster: r.d2 ? { d2: r.d2, w: wu.px.w, h: wu.px.h } : null }), u), straight)
      if (!result.walls.length) {
        setToast('Комнаты нашлись, но стены из них не собрались — проверьте картинку')
        return
      }
      setAsk({
        title: 'Комнаты с картинки',
        text: `Найдено комнат: ${result.report.rooms}, стен ${result.report.walls}. Масштаб — текущий (${u.scale.toFixed(2)} см в пикселе): задайте его по отрезку или по площади любой комнаты. Имена комнат — по номерам, переименуйте в свойствах.`,
        options: [{ key: 'apply', label: 'Заменить чертёж найденным', hint: 'прежний вернёт Ctrl+Z', icon: 'check', primary: true }],
        onPick: () => {
          setAsk(null)
          history.apply((prev) => applyAiPlan(prev, result).plan)
          setSelection(null)
          setTimeout(() => canvasRef.current?.fit(), 50)
          setToast(`Комнат ${result.report.rooms}, стен ${result.report.walls}. Проверьте масштаб и названия`)
        },
      })
    } catch (err) {
      setToast((err as Error).message)
    } finally {
      setTracing(false)
    }
  }

  /**
   * Снимок под углом. По линиям стен находятся точки схода; если прямые
   * сходятся заметно (углы сдвинулись бы больше чем на полторы точки),
   * картинка выпрямляется так же, как «По 4 углам». Разбор при этом идёт по
   * исходному снимку — пересчёт картинки размывает тонкие черты дверей, — а
   * выпрямляется готовый чертёж (straightenResult)
   */
  const planStraighten = async (u: Underlay): Promise<{ img: LoadedImage; original?: string; forward: number[] } | null> => {
    const r = await ensureRaster(u)
    const quad = perspectiveQuad(r.clean.walls, textHeight(r.clean.marks))
    if (!quad) return null
    const img = await warpToRect(u.src, quad)
    const original = u.original ? (await warpToRect(u.original, quad)).src : undefined
    return { img, original, forward: rectTarget(quad).forward }
  }

  /**
   * Готовый чертёж — на выпрямленную картинку: концы стен и подписи комнат
   * переводятся тем же преобразованием, стены ложатся строго по осям, а
   * почти соосные сводятся на одну прямую — верхняя стена, которую каждая
   * комната видела на своей высоте, становится одной. Проёмы держатся за стены
   */
  const straightenResult = (res: ConvertResult, st: { img: LoadedImage; original?: string; forward: number[] } | null): ConvertResult => {
    if (!st) {
      const walls = evenWalls(res.walls)
      const ids = new Set(walls.map((w) => w.id))
      return { ...res, walls, openings: res.openings.filter((o) => ids.has(o.wallId)) }
    }
    const from = res.underlay
    const s = from.scale
    const cx = from.x + (from.px.w * s) / 2
    const cy = from.y + (from.px.h * s) / 2
    const to: Underlay = { ...from, src: st.img.src, original: st.original ?? from.original, px: { w: st.img.w, h: st.img.h }, x: cx - (st.img.w * s) / 2, y: cy - (st.img.h * s) / 2 }
    const map = (p: Pt) => toPlan(to, applyH(st.forward, toPixel(from, p)))
    const walls = evenWalls(rectifyWalls(res.walls, map))
    const ids = new Set(walls.map((w) => w.id))
    return {
      ...res,
      walls,
      openings: res.openings.filter((o) => ids.has(o.wallId)),
      rooms: res.rooms.map((m) => ({ ...m, anchor: map(m.anchor) })),
      ...(res.marks ? { marks: res.marks.map((m) => ({ ...m, at: map(m.at) })) } : {}),
      underlay: to,
    }
  }

  /** Повернуть фото так, чтобы стены легли по осям */
  const levelImage = async () => {
    const u = plan.underlay
    if (!u || tracing) return
    setTracing(true)
    try {
      const r = await ensureRaster(u)
      const angle = dominantAngle(r.gray, u.px.w, u.px.h)
      if (Math.abs(angle) < 0.3) {
        setToast(`Картинка и так ровная: наклон ${angle.toFixed(1)}°`)
        return
      }
      const img = await rotateImage(u.src, -angle)
      const original = u.original ? (await rotateImage(u.original, -angle)).src : undefined
      replaceUnderlayImage(img, original)
      setToast(`Повернул на ${(-angle).toFixed(1)}°: линии стен легли по осям`)
    } catch (err) {
      setToast((err as Error).message)
    } finally {
      setTracing(false)
    }
  }

  /** Убрать тени, блики и мелкие метки: белая бумага, чёрные линии */
  const cleanPhoto = async () => {
    const u = plan.underlay
    if (!u || tracing) return
    setTracing(true)
    try {
      const r = await ensureRaster(u)
      // очищенное — для поиска стен; исходное остаётся рядом: по нему модель читает цифры
      replaceUnderlayImage(grayToImage(r.clean.gray, u.px.w, u.px.h), u.original ?? u.src)
      setToast('Фото очищено: фон выровнен, цифры и засечки убраны. Модель читает подписи по исходному. Ctrl+Z вернёт оригинал')
    } catch (err) {
      setToast((err as Error).message)
    } finally {
      setTracing(false)
    }
  }

  /** Четыре угла наружных стен → перспектива фото исправлена */
  const onCorners = async (pts: Pt[]) => {
    const u = plan.underlay
    if (!u) return
    setTracing(true)
    try {
      const corners = pts.map((p) => toPixel(u, p))
      const img = await warpToRect(u.src, corners)
      const original = u.original ? (await warpToRect(u.original, corners)).src : undefined
      replaceUnderlayImage(img, original)
      // пиксели теперь другие — прежний масштаб больше не факт
      setCalibrated(false)
      setScaleKnown(false)
      setTool('select')
      setTimeout(() => canvasRef.current?.fit(), 50)
      setToast('Фото выпрямлено по четырём углам. Теперь задайте масштаб или распознайте план')
    } catch (err) {
      setToast((err as Error).message)
    } finally {
      setTracing(false)
    }
  }

  /**
   * Уточнить участок: пользователь обвёл спорное место и говорит, что там на
   * самом деле. Правится только это место, проверенное вокруг остаётся как
   * есть. «Спросить ИИ» шлёт увеличенный кусок исходного фото — мелкую деталь
   * модель читает надёжнее, когда та занимает весь кадр.
   */
  const applySpot = (area: Area, what: 'wall' | 'door' | 'window' | 'doorway' | 'none') => {
    if (what === 'none') {
      history.apply((prev) => clearWallsIn(prev, area))
      setToast('Стены на участке убраны')
      return
    }
    if (what === 'wall') {
      history.apply((prev) => wallInArea(prev, area, wallThickness))
      setToast('Стена поставлена по участку')
      return
    }
    let done = false
    history.apply((prev) => {
      const { plan: next, id } = openingInArea(prev, area, what, buildRooms(prev).rooms)
      done = !!id
      return next
    })
    const name = what === 'door' ? 'Дверь' : what === 'window' ? 'Окно' : 'Проём'
    setToast(done ? `${name} поставлен${what === 'window' ? 'о' : ''} на стену участка` : 'На участке нет стены — сначала поставьте стену')
  }

  const onRefineArea = (area: Area) => {
    const u = plan.underlay
    setAsk({
      title: 'Что на этом месте?',
      text: 'Правка коснётся только обведённого участка: остальной чертёж останется как есть.',
      options: [
        { key: 'wall', label: 'Здесь стена', hint: 'поставить стену вдоль участка', icon: 'wall', primary: true },
        { key: 'doorway', label: 'Здесь проём без двери', icon: 'doorway' },
        { key: 'door', label: 'Здесь дверь', icon: 'door' },
        { key: 'window', label: 'Здесь окно', icon: 'window' },
        { key: 'none', label: 'Здесь ничего нет', hint: 'убрать стены с участка', icon: 'trash' },
        ...(ai.enabled && u ? [{ key: 'ai', label: 'Спросить ИИ', hint: 'увеличенный кусок фото уйдёт модели', icon: 'sparkles' as const }] : []),
      ],
      onPick: (key) => {
        setAsk(null)
        if (key !== 'ai') {
          applySpot(area, key as 'wall' | 'door' | 'window' | 'doorway' | 'none')
          return
        }
        if (!u) return
        void (async () => {
          setAiBusy('Смотрю участок…')
          try {
            const box = { x1: (area.x1 - u.x) / u.scale, y1: (area.y1 - u.y) / u.scale, x2: (area.x2 - u.x) / u.scale, y2: (area.y2 - u.y) / u.scale }
            const crop = await cropForVision(u.original ?? u.src, box)
            const { spot, ai: cost } = await askSpot(crop)
            noteCost('участок', cost)
            const label = spot.what === 'wall' ? 'стена' : spot.what === 'door' ? 'дверь' : spot.what === 'window' ? 'окно' : spot.what === 'doorway' ? 'проём без двери' : 'ничего'
            setAsk({
              title: 'Модель посмотрела участок',
              text: `Там ${label}${spot.note ? `: ${spot.note}` : ''}. Применить?`,
              options: [
                { key: 'yes', label: `Да, ${label}`, icon: 'check', primary: true },
                { key: 'no', label: 'Нет, оставить как было', icon: 'close' },
              ],
              onPick: (k) => {
                setAsk(null)
                if (k === 'yes') applySpot(area, spot.what)
              },
            })
          } catch (e) {
            setToast(`Спросить не вышло: ${(e as Error).message}`)
          } finally {
            setAiBusy('')
          }
        })()
      },
    })
  }

  /** Комната по клику: заливка по очищенному растру, стены вокруг */
  const onRoomPick = async (p: Pt) => {
    const u = plan.underlay
    if (!u) return
    try {
      const r = await ensureRaster(u)
      if (!r.d2) r.d2 = distanceToInk(r.clean.bin)
      // дверной проём до 90 см закрывается радиусом в полпроёма
      const closePx = Math.min(80, Math.max(3, Math.round(45 / u.scale)))
      const box = floodRoom(r.d2, u.px.w, u.px.h, toPixel(u, p), closePx)
      if (!box) {
        setToast('Вокруг этой точки нет замкнутого контура: линии на картинке прерываются или комната открыта наружу. Обведите её инструментом «Комната»')
        return
      }
      const t = wallThickness
      // рамка по внутренним граням → оси стен на полтолщины наружу
      let a = toPlan(u, { x: box.x1, y: box.y1 })
      let b = toPlan(u, { x: box.x2, y: box.y2 })
      a = { x: a.x - t / 2, y: a.y - t / 2 }
      b = { x: b.x + t / 2, y: b.y + t / 2 }
      // общая стена с уже нарисованной комнатой: грань липнет к её оси
      const tol = Math.max(15, t * 1.5)
      const snapTo = (v: number, axis: 'x' | 'y') => {
        let best = v
        let bestD = tol
        for (const w of plan.walls) {
          const aligned = axis === 'x' ? Math.abs(w.a.x - w.b.x) < 1 : Math.abs(w.a.y - w.b.y) < 1
          if (!aligned) continue
          const d = Math.abs(w.a[axis] - v)
          if (d < bestD) {
            bestD = d
            best = w.a[axis]
          }
        }
        return Math.round(best)
      }
      a = { x: snapTo(a.x, 'x'), y: snapTo(a.y, 'y') }
      b = { x: snapTo(b.x, 'x'), y: snapTo(b.y, 'y') }
      if (b.x - a.x < 20 || b.y - a.y < 20) {
        setToast('Слишком маленькая область для комнаты')
        return
      }
      history.apply((pl) => addRect(pl, a, b, t))
      const w = b.x - a.x
      const h = b.y - a.y
      setToast(
        box.fill < 0.75
          ? `Комната ${fmtLen(w, unit)} × ${fmtLen(h, unit)} не прямоугольная: поставил рамку, поправьте стены. Следующий клик — ещё комната`
          : `Комната ${fmtLen(w, unit)} × ${fmtLen(h, unit)}. Кликните в следующую или Esc`,
      )
    } catch (err) {
      setToast((err as Error).message)
    }
  }

  const detectWallsFromImage = async () => {
    const u = plan.underlay
    if (!u || tracing) return
    setTracing(true)
    try {
      // обводим очищенный растр: без теней и цифр линий-призраков меньше
      const r = await ensureRaster(u)
      const { walls, openings } = tracePlan(r.clean.gray, u, trace)
      if (!walls.length) {
        setToast('Стены не найдены: попробуйте поднять чувствительность или уменьшить минимальную длину')
        return
      }
      const put = (replace: boolean) => {
        history.apply((p) => ({
          ...p,
          walls: replace ? walls : [...p.walls, ...walls],
          openings: replace ? openings : [...p.openings, ...openings],
        }))
        setSelection(null)
        setToast(`Распознано: стен ${walls.length}, проёмов ${openings.length}. Проверьте и поправьте вручную`)
      }
      if (!plan.walls.length) put(false)
      else
        setAsk({
          title: `Найдено стен: ${walls.length}, проёмов: ${openings.length}`,
          text: 'На чертеже уже есть стены. Заменить их найденными или добавить к ним?',
          options: [
            { key: 'replace', label: 'Заменить нарисованные стены', icon: 'wall', primary: true },
            { key: 'add', label: 'Добавить к нарисованным', icon: 'plus' },
          ],
          onPick: (k) => {
            setAsk(null)
            put(k === 'replace')
          },
        })
    } catch (err) {
      setToast((err as Error).message)
    } finally {
      setTracing(false)
    }
  }

  // Состояние ИИ спрашиваем один раз: серверная часть может отсутствовать вовсе
  // (например, на GitHub Pages), и тогда все кнопки ИИ просто не показываются.
  useEffect(() => {
    let alive = true
    void aiStatus().then((st) => {
      if (alive) setAi(st)
    })
    return () => {
      alive = false
    }
  }, [])

  const noteCost = (what: string, cost: { model: string; costRub: number }) => {
    const price = cost.costRub > 0 ? `, ${cost.costRub.toFixed(2)} ₽` : ''
    setAiLast(`${what}: ${cost.model}${price}`)
  }

  /** Прочитать подложку моделью: стены, проёмы, названия комнат и масштаб разом */
  const recognizeWithAi = async () => {
    const u0 = plan.underlay
    if (!u0 || aiBusy) return
    setAiBusy('Читаю план…')
    try {
      const u = u0
      // снимок под углом: выпрямится готовый чертёж вместе с подложкой
      const straight = await planStraighten(u).catch(() => null)
      // комнаты с картинки: геометрия с растра, от модели — подписи. Крупную
      // картинку разбираем уменьшенной копией wu, результат — обратно на подложку
      const work = await regionsOf(u).catch(() => null)
      const wu = work?.wu ?? u
      const d2 = work?.r.d2 ?? null
      let regions = work?.regions ?? []
      // очищенный растр — чтобы привязать рамки комнат от модели к настоящим стенам
      const ground = d2
        ? (box: AiBox, closeCm: number) => {
            const closePx = Math.min(80, Math.max(3, Math.round(closeCm / wu.scale)))
            const g = groundRoomBox(d2, wu.px.w, wu.px.h, box, closePx)
            return g ? { x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 } : null
          }
        : undefined
      const rasterInfo = d2 ? { d2, w: wu.px.w, h: wu.px.h } : null
      // размеры, прочитанные по одному, идут в каждый вариант ответа модели
      let marks: AiMark[] = []
      const convert = (p: AiPlan) => fromWork(convertAiPlan(marks.length ? { ...p, marks } : p, wu, { keepScale: calibrated, ground, regions, raster: rasterInfo }), u)
      // подписи модель читает по исходному фото: очистка стирает цифры вместе с засечками
      const photo = u.original ?? u.src
      // размеры по одному — параллельно с подписями комнат
      const marksAsk = work && regions.length >= 2
        ? readMarks(photo, work.r, wu, regions).catch((e) => {
            console.info('[ИИ] размеры по одному не прочитались', (e as Error).message)
            return null
          })
        : Promise.resolve(null)
      // Комнаты уже найдены по картинке — значит модели можно показывать их по
      // одной, крупно. Мелкие цифры на общем снимке она путает («0.82» читает
      // как «3.84»), а на увеличенном фрагменте одной комнаты — нет
      const byRooms = regions.length >= 2 ? await readRoomLabels(photo, regions, wu) : null
      // что модель назвала не помещением (шахта, штриховка), из комнат уходит
      const notRooms = byRooms?.notRooms.length ?? 0
      if (byRooms && notRooms) regions = regions.filter((g) => !byRooms.notRooms.includes(g))
      let { plan: read, ai: cost } = byRooms ?? (await recognizePlan(photo))
      const byMarks = await marksAsk
      if (byMarks) {
        marks = byMarks.marks
        cost = { ...cost, costRub: cost.costRub + byMarks.ai.costRub, tried: [...(cost.tried ?? []), ...(byMarks.ai.tried ?? [])] }
      }
      // масштаб не трогаем, если пользователь уже откалибровал подложку руками
      let result = convert(read)
      let attempts = 1
      // Подписи, не сходящиеся с картинкой, переспрашиваем один раз у модели
      // посильнее — по тому же увеличенному фрагменту, с указанием, что именно не
      // сошлось. Стены от этого не двигаются: геометрия уже взята с фото, а
      // верная подпись нужна для масштаба и для названий в отчёте
      if (byRooms && result.report.quality.disputes.length) {
        const again = await rereadDisputed(photo, regions, wu, read, result.report.quality.disputes)
        if (again) {
          const next = convert(again.plan)
          noteCost('подписи', again.ai)
          if (next.walls.length && next.report.quality.disputes.length < result.report.quality.disputes.length) {
            read = again.plan
            result = next
          }
        }
      }
      // Комнаты потерялись, стены легли мимо линий или площади разошлись — модель,
      // скорее всего, прочитала план неверно. Вторая попытка идёт к модели
      // посильнее, с подсказкой, что именно не сошлось; остаётся лучший из двух:
      // сначала по полноте, потом по стенам на линиях, потом по площадям
      const weak = (res: ReturnType<typeof convertAiPlan>) => res.report.quality.verdict === 'weak'
      const score = (res: ReturnType<typeof convertAiPlan>) => {
        const q = res.report.quality
        return q.completeness.found * 100 + (q.walls?.onInk ?? 0) * 10 + (q.areas?.accuracy ?? 0)
      }
      if (result.walls.length && weak(result)) {
        setAiBusy('Не всё сошлось — перепроверяю моделью посильнее…')
        const hint =
          `Первая попытка разошлась с планом (${result.report.quality.issues.join('; ')}). Перепроверь: у каждой комнаты на плане подписаны номер и площадь — ` +
          'верни ровно те комнаты, что подписаны, не выдумывай лишних; размеры width_cm и depth_cm бери только с подписей у стен этой комнаты; box — по внутренним граням стен.'
        try {
          const second = await recognizePlan(photo, hint, undefined, 1)
          const again = convert(second.plan)
          attempts = 2
          noteCost('план', second.ai)
          if (again.walls.length && score(again) > score(result)) {
            read = second.plan
            cost = second.ai
            result = again
          }
        } catch (e) {
          console.info('[ИИ] вторая попытка не удалась', (e as Error).message)
        }
      }
      if (!result.walls.length) {
        setToast('Модель не нашла стен на картинке')
        return
      }
      const r = result.report
      const q = r.quality
      // Сначала — выпрямить по линиям стен, потом размеры — по подписям плана:
      // форма с картинки, числа — обмер. «Как на картинке» остаётся на выбор
      result = straightenResult(result, straight)
      const fitted = fitResultToLabels(result, read.rooms)
      const fixes = fitted.report.sizesFitted.filter((f) => Math.abs(f.toCm - f.fromCm) >= 3)
      const lines: string[] = []
      if (straight) lines.push('Фото снято под углом: чертёж и подложка выпрямлены по линиям стен, почти соосные стены сведены на одну прямую.')
      lines.push(
        r.method === 'по комнатам с картинки'
          ? `Комнаты взяты с картинки (найдено ${r.segmented?.regions ?? 0}), подписи от модели легли ${r.segmented?.matched ?? 0} из ${read.rooms.length}. Стен ${r.walls}, комнат ${r.rooms}.`
          : r.method === 'по размерам комнат'
            ? `Чертёж построен заново по размерам с плана${r.grounded ? `, рамки ${r.grounded} из ${read.rooms.length} комнат привязаны к стенам на картинке` : ''}. Стен ${r.walls}, комнат ${r.rooms}.`
            : `Чертёж собран по линиям стен с картинки: размеров комнат модель не прочитала, точность ниже. Стен ${r.walls}, комнат ${r.rooms}.`,
      )
      // масштаб: по чему посчитан и как подтвердить
      const scaleBy = r.scale.labels?.length ? ` по подписям ${r.scale.labels.slice(0, 5).join(', ')}${r.scale.labels.length > 5 ? '…' : ''} (медиана)` : ''
      lines.push(
        r.scale.source === 'прежняя калибровка'
          ? `Масштаб оставлен ваш: ${r.scale.cmPerPx.toFixed(2)} см в пикселе.`
          : `Масштаб ${r.scale.cmPerPx.toFixed(2)} см в пикселе — ${r.scale.source}${scaleBy}. Подтвердите одним известным размером: «Задать по отрезку» или площадь в свойствах комнаты.`,
      )
      // проверка по разделам: полнота, стены, формы, размеры, проёмы, площади
      lines.push(
        q.completeness.missing.length
          ? `Полнота: на чертеже ${q.completeness.found} из ${q.completeness.expected} помещений. Нет: ${q.completeness.missing.map((m) => `${m.name} — ${m.why}`).join('; ')}.`
          : `Полнота: все ${q.completeness.expected} помещений на чертеже.`,
      )
      if (q.walls) lines.push(`Стены на линиях картинки: ${Math.round(q.walls.onInk * 100)} % длины${q.walls.off.length ? `; мимо линий ${q.walls.off.length} (до ${Math.max(...q.walls.off.map((o) => (Number.isFinite(o.devCm) ? o.devCm : 0)))} см)` : ''}.`)
      if (q.shapes?.length) {
        const bad = q.shapes.filter((x) => x.iou < 0.8)
        lines.push(bad.length ? `Формы комнат: расходятся с картинкой у ${bad.map((x) => `${x.name} (${Math.round(x.iou * 100)} %)`).join(', ')} — выступ потерян или лишний угол.` : 'Формы комнат совпадают с картинкой, выступы на месте.')
      }
      const measured = q.dims.filter((d) => d.gotCm !== null)
      if (measured.length) lines.push(`Размеры по картинке: ${measured.slice(0, 6).map((d) => `${d.cm} → ${Math.round(d.gotCm!)} (${d.gotCm! - d.cm >= 0 ? '+' : ''}${Math.round(d.gotCm! - d.cm)} см)`).join(', ')}${measured.length > 6 ? '…' : ''}.`)
      if (fixes.length) {
        // подпись вдоль стены, что совпала с шириной или глубиной, — не повторять
        const shown = fixes.filter((f) => f.axis !== 'wall' || !fixes.some((g) => g.axis !== 'wall' && g.name === f.name && g.fromCm === f.fromCm && g.toCm === f.toCm))
        const what = (f: (typeof fixes)[number]) => (f.axis === 'width' ? 'ширина' : f.axis === 'depth' ? 'глубина' : 'у стены')
        lines.push(`Размеры — по подписям плана: ${shown.slice(0, 10).map((f) => `${f.name} ${what(f)} ${f.fromCm} → ${f.toCm}`).join(', ')}${shown.length > 10 ? '…' : ''} см. «Размеры как на картинке» оставит стены по линиям фото.`)
      }
      // подписи вдоль стен: без них ниши, уступы и коридор остаются как на картинке
      const wl = fitted.report.wallLabels
      // размеры по одному: сколько подписей нашлось, сколько прочитано, сколько легло на стены
      if (byMarks) {
        const on = wl?.placed?.matched ?? 0
        lines.push(`Размеры по одному: на картинке ${byMarks.boxes} подписей, числами прочитано ${byMarks.sizes}, легли на стены ${on}${byMarks.ai.model ? ` (${byMarks.ai.model})` : ''}.`)
      }
      if (wl && (wl.read || !wl.placed?.matched)) {
        const cm = (v: number) => fmtNum(v / 100)
        lines.push(
          !wl.read
            ? 'Размеры вдоль стен (0,26, 1,29, 2,77…) модель не прочитала — ниши и уступы остались как на картинке. Нажмите «Распознать с ИИ» ещё раз или пришлите отчёт.'
            : wl.unmatched.length
              ? `Размеры вдоль стен: прочитано ${wl.read}, не нашли своей стены ${wl.unmatched.length} — ${wl.unmatched.slice(0, 8).map((u) => `${u.name} ${cm(u.cm)}`).join(', ')}${wl.unmatched.length > 8 ? '…' : ''}: на картинке такой грани нет или она сильно другой длины.`
              : `Размеры вдоль стен: прочитано ${wl.read}, все легли на свои стены.`,
        )
      }
      if (q.openings.expected) {
        const pic = r.openingsFromPicture
        lines.push(`Проёмы: ${q.openings.placed} из ${q.openings.expected} встали на стены${pic ? ` — ${pic} найдено по самой картинке, ${q.openings.placed - pic} назвала модель` : ''}.`)
      }
      if (q.areas) {
        lines.push(`Площади: сходятся на ${Math.round(q.areas.accuracy * 100)} %${q.areas.off.length ? ` — ${q.areas.off.slice(0, 4).map((off) => `${off.name}: на плане ${fmtNum(off.wantM2)}, получилось ${fmtNum(off.haveM2)} м²`).join('; ')}` : ''}.`)
      }
      if (q.disputes.length) {
        const field = (f: string) => (f === 'area' ? 'площадь' : f === 'width' ? 'ширина' : 'глубина')
        const unit = (f: string) => (f === 'area' ? ' м²' : ' см')
        lines.push(`Спорные подписи — не сходятся с картинкой, стены по ним не двигались: ${q.disputes.map((d) => `${d.room} ${field(d.field)} ${fmtNum(d.label)}${unit(d.field)}, по картинке ${fmtNum(d.picture)}${unit(d.field)}`).join('; ')}.`)
      }
      const skipped = hatchedRef.current + notRooms
      if (skipped) lines.push(`Не комнаты: ${skipped === 1 ? 'один участок' : `участков — ${skipped}`} со штриховкой (вентшахта, кладка, колонна) — стены вокруг встали как наружные. Если это всё-таки помещение, обведите его «Комнатой по клику».`)
      if (q.slivers.length) lines.push(`Щели между стенами: ${q.slivers.map((x) => `${x.name} ${fmtNum(x.areaM2)} м²`).join(', ')} — оси разошлись, поправьте инструментом «Уточнить участок».`)
      if (r.roomsDropped.length) lines.push(`Выброшено: ${r.roomsDropped.join(', ')} — на картинке под рамкой нет комнаты, а без неё площади соседей сошлись.`)
      if (r.roomsDoubtful.length) lines.push(`Сомнительно: ${r.roomsDoubtful.join(', ')} — без этого площади соседей сошлись бы лучше, но на картинке комната есть, поэтому оставлена. Уточните это место.`)
      if (attempts > 1) lines.push(`Попыток две: первая разошлась, вторая — модель ${cost.model}.`)
      if (r.note) lines.push(`Модель: ${r.note}`)
      lines.push(q.verdict === 'ok' ? 'Проверьте чертёж поверх фото и подтвердите масштаб.' : 'Результат требует проверки: смотрите разделы выше и уточните спорные места.')
      lines.push(`Версия программы: ${APP_VERSION}.`)
      // сырой ответ модели и отчёт — в консоль и по кнопке в буфер: без них не разобрать, что пошло не так
      // размеры по одному и что из них легло на стены — чтобы по отчёту было видно, на каком шаге теряются числа
      const debugReport = {
        version: APP_VERSION,
        model: cost.model,
        tried: cost.tried,
        answer: read,
        marks,
        numbers: byMarks ? { boxes: byMarks.boxes, sizes: byMarks.sizes, model: byMarks.ai.model } : null,
        fitted: { sizes: fitted.report.sizesFitted, wallLabels: fitted.report.wallLabels },
        report: r,
      }
      console.info('[ИИ] распознавание плана', debugReport)
      setAsk({
        title: 'Распознано',
        text: lines.join('\n'),
        options: [
          { key: 'apply', label: 'Заменить чертёж распознанным', hint: 'прежний вернёт Ctrl+Z', icon: 'check', primary: true },
          ...(fixes.length ? [{ key: 'plain', label: 'Заменить, размеры как на картинке', hint: 'без подгонки под подписи плана', icon: 'check' as const }] : []),
          { key: 'copy', label: 'Скопировать отчёт распознавания', hint: 'ответ модели и разбор — чтобы прислать разработчику', icon: 'clipboard' },
        ],
        onPick: (key) => {
          if (key === 'copy') {
            void navigator.clipboard
              .writeText(JSON.stringify(debugReport, null, 2))
              .then(() => setToast('Отчёт скопирован в буфер обмена'))
              .catch(() => setToast('Не удалось скопировать: отчёт напечатан в консоли браузера (F12)'))
            return
          }
          setAsk(null)
          let lost = 0
          const chosen = key === 'plain' ? result : fitted
          history.apply((prev) => {
            const done = applyAiPlan(prev, chosen)
            lost = done.furnitureDropped
            return done.plan
          })
          if (result.report.scale.source !== 'прежняя калибровка') setScaleKnown(true)
          setSelection(null)
          setTimeout(() => canvasRef.current?.fit(), 50)
          const dropped = r.openingsDropped ? `, отброшено проёмов ${r.openingsDropped}` : ''
          const moved = lost ? `. Убрано предметов вне комнат: ${lost}` : ''
          setToast(`Готово: стен ${r.walls}, проёмов ${r.openings}, комнат ${r.rooms}${dropped}${moved}. Проверьте и поправьте`)
        },
      })
      noteCost('план', cost)
    } catch (e) {
      setToast(`Распознать не вышло: ${(e as Error).message}`)
    } finally {
      setAiBusy('')
    }
  }

  /** Расставить мебель с ИИ по пожеланиям: вся квартира или комната; всё проверено геометрией */
  const runFurnish = async (o: FurnishOptions, progress: (text: string) => void) => {
    if (aiBusy) return null
    setAiBusy('Расставляю мебель…')
    try {
      const rep = await furnish(plan, rooms, o, {
        zones: (a) => askZones(a),
        layout: (a) => askLayout(a),
        onProgress: (t) => {
          progress(t)
          setAiBusy(t)
        },
      })
      if (rep.plan !== plan) history.apply(() => rep.plan)
      const rub = rep.costs.reduce((sum, c) => sum + c.costRub, 0)
      if (rep.costs.length) setAiLast(`расстановка: ${rep.costs.length} запр., ${rep.costs[rep.costs.length - 1].model}${rub > 0 ? `, ${rub.toFixed(2)} ₽` : ''}`)
      setModeRaw('furnish')
      setLayers((l) => (l.furniture ? l : { ...l, furniture: true }))
      return rep
    } finally {
      setAiBusy('')
    }
  }

  const electricItems = plan.furniture.filter((f) => f.electric)
  const electricSettings = plan.electric ?? DEFAULT_ELECTRIC
  // проект электрики: группы, трассы, ведомость и нормы — заново на каждую правку
  // проект электрики нужен в режиме электрики, на её вкладке, в «Проверке» и у выбранной точки;
  // в остальное время его не считаем — иначе каждый кадр перетаскивания перекладывал бы щит
  const needDesign = mode === 'electric' || panel === 'electric' || panel === 'checks' || (selection?.kind === 'furniture' && !!plan.furniture.find((f) => f.id === selection.id)?.electric)
  const design = useMemo(() => (needDesign ? designElectrics(plan, rooms, electricSettings) : NO_DESIGN), [plan, rooms, electricSettings, needDesign])
  const setElectric = (patch: Partial<ElectricSettings>) => history.apply((p) => ({ ...p, electric: { ...(p.electric ?? DEFAULT_ELECTRIC), ...patch } }))

  const runAutoElectrics = () => {
    if (!rooms.length) {
      setToast('Сначала нарисуйте стены: электрика раскладывается по комнатам')
      return
    }
    const items = autoElectrics(plan, rooms, auto, electricSettings)
    if (!items.length) {
      setToast('Нечего ставить: включите хотя бы одно правило')
      return
    }
    const put = () => {
      history.apply((p) => ({ ...p, furniture: [...p.furniture.filter((f) => !f.electric), ...items] }))
      setSelection(null)
      setLayers((l) => ({ ...l, electric: true }))
      setModeRaw('electric')
      setElTab('panel')
      setToast(`Расставлено точек: ${items.length}. Группы щита, кабель и нормы — в панели «Электрика»`)
    }
    if (!electricItems.length) put()
    else
      setAsk({
        title: 'Заменить текущую электрику?',
        text: `Сейчас на плане ${electricItems.length} точек, по нормам встанет ${items.length}. Прежние точки вернёт Ctrl+Z.`,
        options: [
          { key: 'replace', label: 'Заменить', icon: 'bolt', primary: true },
          { key: 'keep', label: 'Оставить как есть' },
        ],
        onPick: (k) => {
          setAsk(null)
          if (k === 'replace') put()
        },
      })
  }

  const clearElectrics = () => {
    if (!electricItems.length) return
    setAsk({
      title: `Убрать всю электрику (${electricItems.length} точек)?`,
      text: 'Розетки, выключатели, свет и датчики уйдут с плана. Вернуть — Ctrl+Z.',
      options: [
        { key: 'clear', label: 'Убрать', icon: 'trash', primary: true },
        { key: 'keep', label: 'Оставить' },
      ],
      onPick: (k) => {
        setAsk(null)
        if (k !== 'clear') return
        history.apply((p) => ({ ...p, furniture: p.furniture.filter((f) => !f.electric) }))
        setSelection(null)
      },
    })
  }

  const pickElectric = (kind: ElectricKind, why: string) => {
    const base = CATALOG_MAP[catalogTypeOf(kind)]
    pick({ ...base, name: ELECTRIC_NAMES[kind], electric: { kind, why, height: MOUNT_HEIGHT[kind] } })
  }

  const onOpenFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      await loadPlanFile(f)
    } catch (err) {
      setToast((err as Error).message)
    }
  }

  const focusIssueTarget = (s: Selection) => {
    if (!s) return
    setSelection(s)
    let p: Pt | null = null
    if (s.kind === 'furniture') {
      const f = plan.furniture.find((x) => x.id === s.id)
      if (f) p = { x: f.x, y: f.y }
    } else if (s.kind === 'opening') {
      const o = plan.openings.find((x) => x.id === s.id)
      const w = o && plan.walls.find((x) => x.id === o.wallId)
      if (o && w) p = lerp(w.a, w.b, o.t)
    } else if (s.kind === 'room') {
      const r = rooms.find((x) => x.meta.id === s.id)
      if (r) p = r.meta.anchor
    }
    if (p) canvasRef.current?.centerOn(p)
    if (isMobile()) setPanelOpen(false)
  }

  const allWallsLocked = plan.walls.length > 0 && plan.walls.every((w) => w.locked)
  const wallGaps = useMemo(() => findGaps(plan.walls), [plan.walls])
  const totalArea = rooms.reduce((s, r) => s + r.area, 0)
  const toggleLayer = (k: keyof Layers) => setLayers((l) => ({ ...l, [k]: !l[k] }))

  // ---------- панель свойств ----------
  const renderProps = () => {
    if (selection?.kind === 'furniture') {
      const f = plan.furniture.find((x) => x.id === selection.id)
      if (!f) return null
      const cat = CATALOG_MAP[f.type]
      const upd = (patch: Partial<typeof f>) => history.apply((p) => updateFurniture(p, f.id, patch))
      return (
        <div>
          <div className="pl-props-title">{cat?.name ?? f.type}</div>
          <label className="pl-field">
            <span>Подпись</span>
            <input value={f.label ?? ''} placeholder={cat?.name} onChange={(e) => upd({ label: e.target.value })} />
          </label>
          {cat?.resizable !== false && (
            <>
              <label className="pl-field">
                <span>Ширина, см</span>
                <NumberField value={f.w} min={5} max={2000} step={5} onCommit={(v) => upd({ w: v })} />
              </label>
              <label className="pl-field">
                <span>Глубина, см</span>
                <NumberField value={f.d} min={5} max={2000} step={5} onCommit={(v) => upd({ d: v })} />
              </label>
            </>
          )}
          <label className="pl-field">
            <span>Поворот, °</span>
            <NumberField value={Math.round(f.rot)} step={15} onCommit={(v) => upd({ rot: normDeg(v) })} />
          </label>
          <label className="pl-field">
            <span>Высота, см</span>
            <NumberField value={f.h ?? dims3d(f).h} min={1} max={400} step={5} onCommit={(v) => upd({ h: v })} />
          </label>
          <div className="pl-row">
            <button className="pl-btn" onClick={() => history.apply((p) => rotateFurniture(p, f.id, -15))}>⟲ 15°</button>
            <button className="pl-btn" onClick={() => history.apply((p) => rotateFurniture(p, f.id, 15))}>⟳ 15°</button>
            <button className="pl-btn" onClick={() => history.apply((p) => rotateFurniture(p, f.id, 90))}>↻ 90°</button>
            <button className={`pl-btn ${f.flip ? 'active' : ''}`} onClick={() => upd({ flip: !f.flip })}>⇋ Отразить</button>
          </div>
          {!cat?.symbol && (
            <div className="pl-field pl-field-col">
              <span>Цвет</span>
              <div className="pl-swatches">
                {COLORS.map((c) => (
                  <button key={c || 'auto'} className={`pl-swatch ${(f.color ?? '') === c ? 'active' : ''}`} style={{ background: c || 'linear-gradient(135deg,#fff 45%,#999 55%)' }} title={c || 'По умолчанию'} onClick={() => upd({ color: c || undefined })} />
                ))}
              </div>
            </div>
          )}
          <div className="pl-row">
            <button
              className="pl-btn"
              onClick={() => {
                const r = duplicateFurniture(plan, f.id)
                if (r.id === f.id) return
                history.apply(() => r.plan)
                setSelection({ kind: 'furniture', id: r.id })
              }}
            >
              ⧉ Дублировать
            </button>
            <button
              className="pl-btn danger"
              onClick={() => {
                history.apply((p) => deleteSelection(p, selection))
                setSelection(null)
              }}
            >
              🗑 Удалить
            </button>
          </div>
          {f.product && (
            <div className="pl-block">
              <div className="pl-props-title">Товар</div>
              <div className="pl-model">
                {f.product.photo && <img src={f.product.photo} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                <div>
                  <b>{f.product.name}</b>
                  <div className="pl-note">
                    {f.product.price ? formatPrice(f.product.price, f.product.currency) : 'цена не указана'} ·{' '}
                    <a href={f.product.url} target="_blank" rel="noreferrer">
                      страница товара
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}
          {f.electric &&
            (() => {
              const e = f.electric
              const updE = (patch: Partial<typeof e>) => upd({ electric: { ...e, ...patch } })
              const c = design.circuits.find((x) => x.points.some((pt) => pt.id === f.id))
              const outlet = e.kind === 'outlet' || e.kind === 'smart-outlet'
              return (
                <div className="pl-block">
                  <div className="pl-props-title">⚡ {ELECTRIC_NAMES[e.kind]}</div>
                  <label className="pl-field">
                    <span>Высота от пола, см</span>
                    <NumberField value={e.height} min={0} max={400} step={5} onCommit={(v) => updE({ height: v })} />
                  </label>
                  {outlet && (
                    <label className="pl-field">
                      <span>Назначение</span>
                      <select
                        value={feedOf(f) ?? 'general'}
                        onChange={(ev) => {
                          const feeds = ev.target.value as Feed
                          updE({ feeds: feeds === 'general' ? undefined : feeds, height: FEED_HEIGHT[feeds], power: undefined })
                        }}
                      >
                        {(Object.keys(FEED_NAMES) as Feed[]).filter((k) => k !== 'floor-heating').map((k) => (
                          <option key={k} value={k}>
                            {FEED_NAMES[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {(outlet || e.kind === 'thermostat') && (
                    <label className="pl-field">
                      <span>Мощность, Вт</span>
                      <NumberField value={powerOf(f)} min={0} max={20000} step={100} onCommit={(v) => updE({ power: v })} />
                    </label>
                  )}
                  {c ? (
                    <div className="pl-hint-box">
                      <span className="pl-dot" style={{ background: c.color }} /> Группа <b>{c.id}</b> «{c.name}»: {c.device === 'автомат' ? `автомат ${c.breaker}` : `дифавтомат ${c.breaker}, ${c.rcdMa} мА`}, кабель ВВГнг(А)-LS {c.cable}, {c.currentA} А, {c.lengthM} м.
                    </div>
                  ) : (
                    e.kind !== 'panel' && e.kind !== 'leak-sensor' && <div className="pl-note">Не в группе.</div>
                  )}
                  <div className="pl-note">Причина: {e.why}</div>
                  {design.issues
                    .filter((x) => x.pointId === f.id)
                    .map((x, k) => (
                      <div key={k} className={`pl-hint-box ${x.level === 'error' ? 'pl-note-warn' : ''}`}>
                        {x.level === 'error' ? '⛔' : '⚠️'} {x.text}
                      </div>
                    ))}
                </div>
              )
            })()}
          {f.note && <div className="pl-hint-box">✨ {f.note}</div>}
          {cat?.hint && <div className="pl-hint-box">💡 {cat.hint}</div>}
          <div className="pl-block">
            <div className="pl-props-title">3D-модель</div>
            {f.model ? (
              <div className="pl-model">
                {f.model.thumb && <img src={f.model.thumb} alt="" loading="lazy" />}
                <div>
                  <b>{f.model.name ?? f.model.id}</b>
                  <div className="pl-note">
                    {f.model.license ?? 'Своя модель'}
                    {f.model.provider === 'polyhaven' && (
                      <>
                        {' · '}
                        <a href={phPage(f.model.id)} target="_blank" rel="noreferrer">
                          страница модели
                        </a>
                      </>
                    )}
                  </div>
                  <button className="pl-btn" onClick={() => upd({ model: undefined })}>
                    Убрать модель
                  </button>
                </div>
              </div>
            ) : (
              <div className="pl-note">В 3D и AR предмет показан встроенной моделью по своим габаритам. Нужна фотореалистичная — выберите её в каталоге («Фото 3D») или вставьте ссылку на свой GLB.</div>
            )}
            <div className="pl-row">
              <input className="pl-grow" placeholder="https://…/model.glb" value={customModelUrl} onChange={(e) => setCustomModelUrl(e.target.value)} />
              <button
                className="pl-btn"
                disabled={!/^https?:\/\/.+\.(glb|gltf)(\?.*)?$/i.test(customModelUrl.trim())}
                onClick={() => {
                  upd({ model: modelRefFromUrl(customModelUrl.trim()) })
                  setCustomModelUrl('')
                }}
              >
                Применить GLB
              </button>
            </div>
          </div>
          {cat?.clearance && (
            <div className="pl-note">
              Зоны эргономики: {Object.entries(cat.clearance).map(([k, v]) => `${k === 'front' ? 'перед' : k === 'back' ? 'сзади' : k === 'left' ? 'слева' : 'справа'} ${v} см`).join(', ')}
            </div>
          )}
        </div>
      )
    }
    if (selection?.kind === 'wall') {
      const w = plan.walls.find((x) => x.id === selection.id)
      if (!w) return null
      // стена — прямая целиком: длина и толщина у всей прямой
      const run = wallRun(plan.walls, w.id)
      const L = run ? dist(run.a, run.b) : dist(w.a, w.b)
      const locked = !!w.locked
      // длина по выбранной линии: оси, внутренней или наружной грани
      const byRef = run ? refLength(plan.walls, rooms, run, wallRef) : null
      const refName = WALL_REFS.find((r) => r.ref === (byRef?.used ?? 'axis'))!.long
      // правка, что задела зафиксированную стену, не применяется — и об этом сказано
      const guarded = (f: (p: Plan) => Plan) => {
        const next = f(plan)
        if (touchesLocked(plan, next)) setToast('Правка задевает зафиксированную стену — снимите замок')
        else history.apply(() => guardLocks(plan, next))
      }
      return (
        <div>
          <div className="pl-props-title">Стена</div>
          <div className="pl-field">
            <span>Длину считать</span>
            <div className="pl-chips">
              {WALL_REFS.map((r) => (
                <button key={r.ref} className={`pl-chip ${wallRef === r.ref ? 'active' : ''}`} onClick={() => setWallRef(r.ref)} title={`Длина стены ${r.long}`}>
                  {r.name}
                </button>
              ))}
            </div>
          </div>
          {byRef && byRef.value !== null ? (
            <label className="pl-field">
              <span>Длина {refName}, см</span>
              <NumberField value={Math.round(byRef.value * 10) / 10} min={MIN_WALL_LENGTH} step={5} onCommit={(v) => guarded((p) => setRunLengthBy(p, rooms, w.id, v, byRef.used))} />
            </label>
          ) : (
            <label className="pl-field">
              <span>Длина по оси, см</span>
              <NumberField value={Math.round(L)} min={MIN_WALL_LENGTH} step={5} onCommit={(v) => guarded((p) => setRunLengthBy(p, rooms, w.id, v, 'axis'))} />
            </label>
          )}
          {byRef && byRef.value === null && (
            <div className="pl-note">
              Внутренняя грань разрезана стенами, что к ней примыкают: {byRef.segs.map((x) => fmtLen(x.length, unit)).join(' + ')}. Это стороны разных комнат — каждую задают щелчком по её размеру на плане.
            </div>
          )}
          {byRef && byRef.used !== wallRef && <div className="pl-note">С обеих сторон этой стены комнаты — наружной грани нет, длина по оси.</div>}
          <label className="pl-field">
            <span>Толщина, см</span>
            <select value={w.thickness} disabled={locked} onChange={(e) => guarded((p) => setRunThickness(p, w.id, Number(e.target.value)))}>
              {WALL_THICKNESSES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <div className="pl-note">Тяните стену поперёк — сдвинется вся прямая, примыкающие стены потянутся за ней, комнаты останутся замкнутыми. Стрелки — на 1 см, с Shift — на 10. С Alt — только участок до ближайших стыков: так делается ниша или выступ, а Alt + щелчок и Del удаляют только этот участок. Кружки на концах — длина (поперечная стена едет следом), с Shift — свободно.</div>
          <div className="pl-row">
            {(['door', 'window', 'doorway'] as const).map((k) => (
              <button
                key={k}
                className="pl-btn"
                disabled={L < wallNeededFor(MIN_OPENING_WIDTH)}
                onClick={() => {
                  const r = addOpening(plan, k, w.id, 0.5, k === 'door' ? 80 : k === 'window' ? 150 : 90, rooms)
                  if (!r.id) {
                    setToast('Стена слишком короткая для проёма')
                    return
                  }
                  history.apply(() => r.plan)
                  setSelection({ kind: 'opening', id: r.id })
                }}
              >
                + {k === 'door' ? 'Дверь' : k === 'window' ? 'Окно' : 'Проём'}
              </button>
            ))}
          </div>
          <button
            className={`pl-btn ${locked ? 'active' : ''}`}
            onClick={() => history.apply((p) => setRunLocked(p, w.id, !locked))}
            title="Зафиксированную стену нельзя сдвинуть, растянуть или удалить, пока не снят замок"
          >
            <Icon name={locked ? 'lock' : 'unlock'} size={16} /> {locked ? 'Стена зафиксирована — снять замок' : 'Зафиксировать стену'}
          </button>
          <button
            className="pl-btn danger"
            onClick={() => {
              // стена — прямая целиком: удаляется то, что подсвечено
              if (touchesLocked(plan, deleteRun(plan, w.id))) {
                setToast('Стена зафиксирована — снимите замок, чтобы удалить')
                return
              }
              history.apply((p) => deleteRun(p, w.id))
              setSelection(null)
            }}
          >
            🗑 Удалить стену
          </button>
        </div>
      )
    }
    if (selection?.kind === 'opening') {
      const o = plan.openings.find((x) => x.id === selection.id)
      const w = o && plan.walls.find((x) => x.id === o.wallId)
      if (!o || !w) return null
      const L = dist(w.a, w.b)
      const pos = o.t * L
      const upd = (patch: Partial<typeof o>) => history.apply((p) => updateOpening(p, o.id, patch))
      return (
        <div>
          <div className="pl-props-title">{o.kind === 'door' ? 'Дверь' : o.kind === 'window' ? 'Окно' : 'Проём'}</div>
          <label className="pl-field">
            <span>Тип</span>
            <select value={o.kind} onChange={(e) => upd({ kind: e.target.value as typeof o.kind })}>
              <option value="door">Дверь</option>
              <option value="window">Окно</option>
              <option value="doorway">Проём без двери</option>
            </select>
          </label>
          <label className="pl-field">
            <span>Ширина, см</span>
            <NumberField value={o.width} min={MIN_OPENING_WIDTH} max={Math.max(MIN_OPENING_WIDTH, Math.floor(L - 2))} step={5} list={`pl-widths-${o.kind}`} onCommit={(v) => upd({ width: v })} />
            <datalist id={`pl-widths-${o.kind}`}>
              {OPENING_WIDTHS[o.kind].map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </label>
          <label className="pl-field pl-field-col">
            <span>
              Положение от начала стены: {fmtLen(pos, unit)} (до конца {fmtLen(L - pos, unit)})
            </span>
            <input
              type="range"
              min={Math.min(o.width / 2, L / 2)}
              max={Math.max(o.width / 2, L - o.width / 2)}
              step={1}
              value={pos}
              onChange={(e) => upd({ t: Number(e.target.value) / L })}
            />
          </label>
          <div className="pl-row">
            <button className="pl-btn" onClick={() => upd({ t: 0.5 })}>По центру стены</button>
            {o.kind === 'door' && (
              <>
                <button className="pl-btn" onClick={() => upd({ hinge: o.hinge === 'a' ? 'b' : 'a' })}>Петли с другой стороны</button>
                <button className="pl-btn" onClick={() => upd({ side: o.side === 1 ? -1 : 1 })}>Открывать в другую сторону</button>
              </>
            )}
          </div>
          <div className="pl-note">Дверь в санузел и кладовую открывают наружу; в жилые комнаты — внутрь. Дверь не должна упираться в мебель или другую дверь.</div>
          <button
            className="pl-btn danger"
            onClick={() => {
              history.apply((p) => deleteSelection(p, selection))
              setSelection(null)
            }}
          >
            🗑 Удалить
          </button>
        </div>
      )
    }
    if (selection?.kind === 'room') {
      const r = rooms.find((x) => x.meta.id === selection.id)
      if (!r) return null
      const upd = (patch: Partial<typeof r.meta>) => history.apply((p) => updateRoomMeta(p, r.meta.id, patch))
      return (
        <div>
          <div className="pl-props-title">Комната</div>
          <label className="pl-field">
            <span>Название</span>
            <input value={r.meta.name} onChange={(e) => upd({ name: e.target.value })} />
          </label>
          <div className="pl-chips">
            {ROOM_NAMES.map((n) => (
              <button key={n} className={`pl-chip ${r.meta.name === n ? 'active' : ''}`} onClick={() => upd({ name: n })}>
                {n}
              </button>
            ))}
          </div>
          <label className="pl-field">
            <span>Пол</span>
            <select value={r.meta.floor} onChange={(e) => upd({ floor: e.target.value as typeof r.meta.floor })}>
              {FLOORS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          {plan.underlay && (
            <div className="pl-block">
              <label className="pl-field" title="Площадь этой комнаты, подписанная на плане: весь чертёж и подложка подгонятся под неё">
                <span>На плане, м²</span>
                <NumberField
                  value={Math.round(r.area * 10) / 10}
                  min={0.5}
                  max={500}
                  step={0.1}
                  onCommit={(want) => {
                    const k = Math.sqrt(want / r.area)
                    if (!Number.isFinite(k) || k < 0.5 || k > 2) {
                      setToast('Площадь отличается больше чем вдвое: похоже, это не та комната')
                      return
                    }
                    if (Math.abs(k - 1) < 0.002) return
                    const c = r.polygon.reduce((acc, p) => ({ x: acc.x + p.x / r.polygon.length, y: acc.y + p.y / r.polygon.length }), { x: 0, y: 0 })
                    history.apply((p) => scalePlan(p, k, c))
                    setScaleKnown(true)
                    setCalibrated(true)
                    setToast(`Масштаб подогнан под ${fmtNum(want)} м²: чертёж и подложка умножены на ${k.toFixed(3)}`)
                  }}
                />
              </label>
              <div className="pl-note">Введите площадь с плана — масштаб встанет по ней. Точнее, чем по отрезку: площадь на плане БТИ подписана всегда.</div>
            </div>
          )}
          <div className="pl-stats">
            <div>
              <b>{fmtArea(r.area)}</b>
              <span>площадь</span>
            </div>
            <div>
              <b>{fmtLen(r.perimeter, 'm')}</b>
              <span>периметр по осям</span>
            </div>
          </div>
          <div className="pl-note">
            Площадь считается по внутренним граням стен — как в техпаспорте. Комната появляется сама из замкнутого контура: чтобы убрать её, удалите стену.
          </div>
          <button
            className="pl-btn"
            onClick={() => {
              history.apply((p) => roomDims(p, r.inner))
              setLayers((l) => ({ ...l, dims: true }))
              setToast('Размеры комнаты в чистоте на плане. Они привязаны к стенам: двигайте стены — размеры обновятся сами')
            }}
            title="Ширина и глубина комнаты между внутренними гранями — размерными линиями, привязанными к стенам"
          >
            ↔ Размеры комнаты на план
          </button>
          {ai.enabled && (
            <button className="pl-btn" onClick={() => setFurnishFor(r.meta.id)} title="ИИ обставит комнату по вашим пожеланиям">
              ✨ Обставить с ИИ…
            </button>
          )}
        </div>
      )
    }
    if (selection?.kind === 'dim') {
      const d = plan.dims.find((x) => x.id === selection.id)
      if (!d) return null
      return (
        <div>
          <div className="pl-props-title">Размерная линия</div>
          <label className="pl-field">
            <span>Длина</span>
            <b>{fmtLen(dist(d.a, d.b), unit)}</b>
          </label>
          <label className="pl-field">
            <span>Отступ, см</span>
            <NumberField value={d.offset} step={5} onCommit={(v) => history.apply((p) => updateDim(p, d.id, { offset: v || 5 }))} />
          </label>
          <div className="pl-note">
            {d.aRef && d.bRef
              ? 'Оба конца привязаны к стенам: размер следует за ними при любой правке.'
              : d.aRef || d.bRef
                ? 'Один конец привязан к стене и следует за ней, другой стоит на месте.'
                : 'Размер свободный: стоит на месте, когда стены двигают. Привязать — нарисуйте заново, щёлкая по грани или оси стены.'}
          </div>
          {(d.aRef || d.bRef) && (
            <button className="pl-btn" onClick={() => history.apply((p) => ({ ...p, dims: p.dims.map((x) => (x.id === d.id ? { id: x.id, a: x.a, b: x.b, offset: x.offset } : x)) }))}>
              Отвязать от стен
            </button>
          )}
          <button
            className="pl-btn danger"
            onClick={() => {
              history.apply((p) => deleteSelection(p, selection))
              setSelection(null)
            }}
          >
            🗑 Удалить
          </button>
        </div>
      )
    }
    // ничего не выбрано — обзор и настройки инструмента
    return (
      <div>
        {(tool === 'wall' || tool === 'room') && (
          <div className="pl-block">
            <div className="pl-props-title">Новые стены</div>
            <label className="pl-field">
              <span>Толщина, см</span>
              <select value={wallThickness} onChange={(e) => setWallThickness(Number(e.target.value))}>
                {WALL_THICKNESSES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="pl-field">
              <span>Только 0°/45°/90°</span>
              <input type="checkbox" checked={ortho} onChange={(e) => setOrtho(e.target.checked)} />
            </label>
            <div className="pl-note">Наружные стены обычно 38–51 см, межквартирные 20–25, перегородки 8–12 см.</div>
          </div>
        )}
        {plan.underlay && (
          <div className="pl-block pl-stepper">
            <div className="pl-props-title">Схема загружена</div>
            <ol className="pl-step-list">
              <li className={plan.walls.length ? 'done' : ''}>
                <b>Подготовить фото</b>
                <span className="pl-note">Скан или скрин — можно пропустить. Фото с телефона: тени, наклон и перспектива мешают распознаванию — исправьте прямо здесь.</span>
                <div className="pl-row">
                  <button className="pl-btn small" onClick={() => void levelImage()} disabled={tracing} title="Повернуть картинку так, чтобы линии стен легли по осям">
                    <Icon name="ortho" size={16} /> Выровнять
                  </button>
                  <button className={`pl-btn small ${tool === 'corners' ? 'active' : ''}`} onClick={() => setTool(tool === 'corners' ? 'select' : 'corners')} disabled={tracing} title="Кликните по четырём углам наружных стен — перспектива фото исправится">
                    <Icon name="corners" size={16} /> Выпрямить по 4 углам
                  </button>
                  <button className="pl-btn small" onClick={() => void cleanPhoto()} disabled={tracing} title="Убрать тени и блики, мелкие цифры и засечки">
                    <Icon name="sparkles" size={16} /> Очистить
                  </button>
                </div>
              </li>
              <li className={plan.walls.length ? 'done' : 'now'}>
                <b>Получить стены</b>
                {ai.enabled ? (
                  <>
                    <button className="pl-btn primary" onClick={() => void recognizeWithAi()} disabled={!!aiBusy}>
                      <Icon name="sparkles" size={18} /> {aiBusy === 'Читаю план…' ? 'Читаю план…' : 'Распознать с ИИ'}
                    </button>
                    <span className="pl-note">Читает размеры и площади комнат, двери и окна — и строит чертёж заново по числам с плана. Масштаб встанет сам.</span>
                    <div className="pl-row">
                      <button className="pl-btn small" onClick={() => void roomsFromPicture()} disabled={tracing} title="Найти все замкнутые комнаты на картинке разом, без ИИ">
                        <Icon name="room" size={16} /> {tracing ? 'Ищу…' : 'Комнаты с картинки'}
                      </button>
                      <button className={`pl-btn small ${tool === 'roomPick' ? 'active' : ''}`} onClick={() => setTool(tool === 'roomPick' ? 'select' : 'roomPick')} title="Кликните внутри комнаты на картинке — стены вокруг неё появятся сами">
                        <Icon name="wand" size={16} /> Комната по клику
                      </button>
                      <button className="pl-btn ghost small" onClick={detectWallsFromImage} disabled={tracing}>
                        {tracing ? 'Обвожу…' : 'Обвести линии без ИИ'}
                      </button>
                    </div>
                    {!!plan.walls.length && (
                      <button className={`pl-btn small ${tool === 'refine' ? 'active' : ''}`} onClick={() => setTool(tool === 'refine' ? 'select' : 'refine')} title="Обвести спорное место и сказать, что там на самом деле">
                        <Icon name="refine" size={16} /> Уточнить участок
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button className="pl-btn primary" onClick={() => void roomsFromPicture()} disabled={tracing} title="Найти все замкнутые комнаты на картинке разом">
                      <Icon name="room" size={18} /> {tracing ? 'Ищу комнаты…' : 'Комнаты с картинки'}
                    </button>
                    <span className="pl-note">Все замкнутые комнаты с картинки разом — общие стены сходятся сами. Не нашло какую-то — добавьте её кликом:</span>
                    <button className={`pl-btn small ${tool === 'roomPick' ? 'active' : ''}`} onClick={() => setTool(tool === 'roomPick' ? 'select' : 'roomPick')} title="Кликните внутри комнаты на картинке — стены вокруг неё появятся сами">
                      <Icon name="wand" size={16} /> Комната по клику
                    </button>
                    <button className="pl-btn small" onClick={detectWallsFromImage} disabled={tracing}>
                      <Icon name="wall" size={16} /> {tracing ? 'Обвожу…' : 'Или обвести все линии разом'}
                    </button>
                    <span className="pl-note">
                      Обводка — грубый черновик: цифры на плане она не читает, а выноски и штриховку принимает за стены. Точнее — «Распознать с ИИ»: чертёж строится
                      заново по размерам с плана. Или нарисуйте стены поверх картинки: «Комната», «Стена».
                    </span>
                    <div className="pl-note pl-note-warn">
                      <b>ИИ выключен.</b> {ai.hint || 'На сервере нет ключа ИИ (см. README, раздел «Подключение»).'}
                    </div>
                    <button
                      className="pl-btn small"
                      onClick={() =>
                        void aiStatus(true).then((st) => {
                          setAi(st)
                          setToast(st.enabled ? 'Ключ найден: кнопки ИИ включены' : `ИИ всё ещё выключен. ${st.hint || 'Ключ не найден'}`)
                        })
                      }
                      title="Перечитать .env: ключ подхватывается без перезапуска"
                    >
                      <Icon name="history" size={16} /> Я добавил ключ — проверить
                    </button>
                  </>
                )}
              </li>
              <li className={scaleKnown ? 'done' : plan.walls.length ? 'now' : ''}>
                <b>Проверить масштаб</b>
                <span className="pl-note">
                  Сейчас {plan.underlay.scale.toFixed(2)} см в пикселе: ширина картинки {fmtLen(plan.underlay.px.w * plan.underlay.scale, 'm')}.
                  {scaleKnown ? ' Масштаб задан.' : ' Если размеры не сходятся — покажите один известный отрезок.'}
                </span>
                <button className={`pl-btn ${tool === 'calibrate' ? 'active' : ''}`} onClick={() => setTool('calibrate')}>
                  <Icon name="calibrate" size={18} /> Задать по отрезку
                </button>
              </li>
              <li>
                <b>Подложка</b>
                <label className="pl-field pl-field-col">
                  <span>Прозрачность</span>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    step={5}
                    value={Math.round(plan.underlay.opacity * 100)}
                    onChange={(e) => history.silent((p) => updateUnderlay(p, { opacity: Number(e.target.value) / 100 }))}
                  />
                </label>
                <label className="pl-field">
                  <span>Закрепить, не двигать мышью</span>
                  <input type="checkbox" checked={plan.underlay.locked} onChange={() => history.silent((p) => updateUnderlay(p, { locked: !p.underlay?.locked }))} />
                </label>
                <label className="pl-field" title="При рисовании стен, комнат и размеров точки липнут к линиям, найденным на картинке">
                  <span>Магнит к линиям картинки{imageLinesPx.length ? ` (${imageLinesPx.length})` : ''}</span>
                  <input type="checkbox" checked={magnet} onChange={() => setMagnet((m) => !m)} />
                </label>
                <div className="pl-row">
                  <button
                    className="pl-btn small"
                    title="Подложить другую картинку под этот же план"
                    onClick={() => {
                      imageMode.current = 'underlay'
                      imageInput.current?.click()
                    }}
                  >
                    <Icon name="image" size={16} /> Заменить картинку
                  </button>
                  <button className="pl-btn danger small" onClick={() => history.apply((p) => setUnderlay(p, undefined))}>
                    <Icon name="trash" size={16} /> Убрать подложку
                  </button>
                </div>
              </li>
            </ol>
            <details className="pl-details">
              <summary>Настройки обводки линий</summary>
              <label className="pl-field pl-field-col">
                <span>Чувствительность: {trace.sensitivity}</span>
                <input type="range" min={10} max={95} step={5} value={trace.sensitivity} onChange={(e) => setTrace((t) => ({ ...t, sensitivity: Number(e.target.value) }))} />
              </label>
              <label className="pl-field">
                <span>Мин. длина стены, см</span>
                <NumberField value={trace.minLengthCm} min={20} max={500} step={10} onCommit={(v) => setTrace((t) => ({ ...t, minLengthCm: v }))} />
              </label>
              <label className="pl-field">
                <span>Макс. толщина стены, см</span>
                <NumberField value={trace.maxThicknessCm} min={10} max={150} step={5} onCommit={(v) => setTrace((t) => ({ ...t, maxThicknessCm: v }))} />
              </label>
            </details>
          </div>
        )}
        <div className="pl-props-title">План «{plan.name}»</div>
        <div className="pl-stats">
          <div>
            <b>{fmtArea(totalArea)}</b>
            <span>общая площадь</span>
          </div>
          <div>
            <b>{rooms.length}</b>
            <span>комнат</span>
          </div>
          <div>
            <b>{plan.furniture.length}</b>
            <span>объектов</span>
          </div>
        </div>
        {rooms.length > 0 && (
          <div className="pl-block">
            {rooms.map((r) => (
              <div key={r.meta.id} className="pl-room-row">
                <button className="pl-list-item" onClick={() => focusIssueTarget({ kind: 'room', id: r.meta.id })}>
                  <span>{r.meta.name}</span>
                  <b>{fmtArea(r.area)}</b>
                </button>
                {ai.enabled && (
                  <button
                    className="pl-btn pl-room-ai"
                    title={`Расставить мебель: ${r.meta.name}`}
                    onClick={() => setFurnishFor(r.meta.id)}
                    disabled={!!aiBusy}
                  >
                    ✨
                  </button>
                )}
              </div>
            ))}
            {ai.enabled && (
              <div className="pl-note">
                «✨» расставит мебель в комнате по вашим пожеланиям и правилам эргономики. Всё, что не помещается, перекрывает дверь или
                наезжает на соседний предмет, отбрасывается — в план попадает только проверенное.
              </div>
            )}
          </div>
        )}
        <div className="pl-block">
          <div className="pl-props-title">Как работать</div>
          <ol className="pl-steps">
            <li>Нарисуйте стены: «Комната» тянет прямоугольник, «Стена» — по точкам. Замкнутые контуры сами становятся комнатами.</li>
            <li>Поставьте двери и окна — они прилипают к стенам.</li>
            <li>Расставьте мебель из каталога: объекты магнитятся к стенам и выравниваются друг по другу.</li>
            <li>Откройте «Проверку» — планировщик подскажет, где не хватает проходов и что мешает дверям.</li>
          </ol>
        </div>
      </div>
    )
  }

  const filteredCatalog = CATALOG.filter((c) => (catCategory === 'all' || c.category === catCategory) && (!catQuery || c.name.toLowerCase().includes(catQuery.toLowerCase())))

  const filteredPhoto = phItems.filter((a) => !catQuery || `${a.name} ${a.tags.join(' ')}`.toLowerCase().includes(catQuery.toLowerCase()))

  const renderCatalog = () => (
    <div>
      {rooms.length > 0 && ai.enabled && (
        <button className="pl-btn pl-furnish-cta" onClick={() => setFurnishFor(selection?.kind === 'room' ? selection.id : 'all')} title="ИИ расставит мебель по вашим пожеланиям">
          ✨ Расставить с ИИ по пожеланиям
        </button>
      )}
      <div className="pl-segment">
        <button className={catMode === 'schemes' ? 'active' : ''} onClick={() => setCatMode('schemes')}>
          Схемы
        </button>
        <button className={catMode === 'photo' ? 'active' : ''} onClick={() => setCatMode('photo')}>
          Фото 3D
        </button>
        <button className={catMode === 'link' ? 'active' : ''} onClick={() => setCatMode('link')}>
          По ссылке
        </button>
      </div>
      {catMode !== 'link' && (
        <input
          className="pl-search"
          placeholder={catMode === 'photo' ? 'Поиск по Poly Haven (англ.): sofa, chair, lamp…' : 'Поиск: кровать, стол, розетка…'}
          value={catQuery}
          onChange={(e) => setCatQuery(e.target.value)}
        />
      )}
      {catMode === 'link' && (
        <div>
          <div className="pl-note">
            Понравился холодильник или диван в магазине — вставьте ссылку на товар. Планировщик попробует прочитать название, фото, цену и габариты; всё
            можно поправить руками.
          </div>
          <div className="pl-row">
            <input
              className="pl-grow"
              placeholder="https://магазин/товар…"
              value={productUrl}
              onChange={(e) => setProductUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void lookupProduct()
              }}
            />
            <button className="pl-btn" onClick={() => void lookupProduct()} disabled={productState === 'loading' || !productUrl.trim()}>
              {productState === 'loading' ? 'Читаю…' : 'Найти'}
            </button>
          </div>
          {productError && <div className="pl-note">{productError}</div>}
          {product && (
            <div className="pl-block">
              <div className="pl-model">
                {product.photo && <img src={product.photo} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                <div>
                  <b>{product.name || 'Без названия'}</b>
                  <div className="pl-note">
                    Источник данных: {product.source}
                    {product.price ? ` · ${formatPrice(product.price, product.currency)}` : ''}
                  </div>
                </div>
              </div>
              <label className="pl-field">
                <span>Название</span>
                <input value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })} />
              </label>
              <label className="pl-field">
                <span>Ширина, см</span>
                <NumberField
                  value={product.dims?.w ?? 60}
                  min={1}
                  max={1000}
                  step={5}
                  onCommit={(v) => setProduct({ ...product, dims: { w: v, d: product.dims?.d ?? 60, h: product.dims?.h ?? 80 } })}
                />
              </label>
              <label className="pl-field">
                <span>Глубина, см</span>
                <NumberField
                  value={product.dims?.d ?? 60}
                  min={1}
                  max={1000}
                  step={5}
                  onCommit={(v) => setProduct({ ...product, dims: { w: product.dims?.w ?? 60, d: v, h: product.dims?.h ?? 80 } })}
                />
              </label>
              <label className="pl-field">
                <span>Высота, см</span>
                <NumberField
                  value={product.dims?.h ?? 80}
                  min={1}
                  max={400}
                  step={5}
                  onCommit={(v) => setProduct({ ...product, dims: { w: product.dims?.w ?? 60, d: product.dims?.d ?? 60, h: v } })}
                />
              </label>
              <div className="pl-note">Тип на плане подбирается по названию: «{CATALOG_MAP[typeForProduct(product.name)]?.name ?? 'Произвольный объект'}».</div>
              <button className="pl-btn active" onClick={placeProduct}>
                Поставить в план
              </button>
            </div>
          )}
        </div>
      )}
      {catMode === 'link' ? null : catMode === 'photo' ? (
        <div>
          <div className="pl-chips">
            {(phCats.length ? phCats : [{ name: 'furniture', count: 0 }]).slice(0, 14).map((c) => (
              <button key={c.name} className={`pl-chip ${phCat === c.name ? 'active' : ''}`} onClick={() => setPhCat(c.name)}>
                {c.name}
                {c.count ? ` · ${c.count}` : ''}
              </button>
            ))}
          </div>
          {phState === 'loading' && <div className="pl-note">Загружаем каталог…</div>}
          {phState === 'error' && <div className="pl-note">Каталог недоступен: нет связи с polyhaven.com. Попробуйте позже или вставьте ссылку на свой GLB в свойствах предмета.</div>}
          <div className="pl-cat-grid">
            {filteredPhoto.map((a) => (
              <button key={a.id} className={`pl-cat-item photo ${placing?.model?.id === a.id ? 'active' : ''}`} onClick={() => pickPhoto(a)} title={a.tags.join(', ')}>
                <img src={a.thumb} alt="" loading="lazy" />
                <span className="pl-cat-name">{a.name}</span>
                <span className="pl-cat-size">{a.dims ? `${a.dims.w}×${a.dims.d}×${a.dims.h}` : 'размер из модели'}</span>
              </button>
            ))}
          </div>
          <div className="pl-note">Модели Poly Haven (лицензия CC0 — свободное использование). Фото и 3D подгружаются с polyhaven.com.</div>
        </div>
      ) : (
        <>
      <div className="pl-chips">
        <button className={`pl-chip ${catCategory === 'all' ? 'active' : ''}`} onClick={() => setCatCategory('all')}>
          Все
        </button>
        {CATEGORIES.map((c) => (
          <button key={c.key} className={`pl-chip ${catCategory === c.key ? 'active' : ''}`} onClick={() => setCatCategory(c.key)}>
            {c.icon} {c.name}
          </button>
        ))}
      </div>
      <div className="pl-cat-grid">
        {filteredCatalog.map((c) => {
          const vb = c.symbol ? '-14 -14 28 28' : `${-c.w / 2 - 4} ${-c.d / 2 - 4} ${c.w + 8} ${c.d + 8}`
          return (
            <button key={c.type} className={`pl-cat-item ${placing?.type === c.type ? 'active' : ''}`} onClick={() => pick(c)} title={c.hint}>
              <svg viewBox={vb} width={84} height={56} preserveAspectRatio="xMidYMid meet">
                <Glyph item={{ id: 'p', type: c.type, x: 0, y: 0, w: c.w, d: c.d, rot: 0 }} cat={c} zoom={1} />
              </svg>
              <span className="pl-cat-name">{c.name}</span>
              {!c.symbol && (
                <span className="pl-cat-size">
                  {c.w}×{c.d}
                </span>
              )}
            </button>
          )
        })}
      </div>
        </>
      )}
    </div>
  )

  const renderElectric = () => {
    const d = design
    const errors = d.issues.filter((x) => x.level === 'error').length
    return (
      <div>
        <div className="pl-props-title">Проект электрики</div>
        <div className="pl-stats">
          <div>
            <b>{electricItems.length}</b>
            <span>точек</span>
          </div>
          <div>
            <b>{d.circuits.length}</b>
            <span>групп в щите</span>
          </div>
          <div>
            <b>{d.cable.reduce((s2, c) => s2 + c.meters, 0)} м</b>
            <span>кабеля</span>
          </div>
          <div className={d.demandKw > electricSettings.allottedKw ? 'bad' : ''}>
            <b>
              {d.demandKw} / {electricSettings.allottedKw}
            </b>
            <span>кВт расчёт / выделено</span>
          </div>
        </div>

        <details className="pl-block pl-el-setup" open={!electricItems.length}>
          <summary>Исходные данные и расстановка по нормам</summary>
          <label className="pl-field">
            <span>Выделенная мощность</span>
            <select value={electricSettings.allottedKw} onChange={(e) => setElectric({ allottedKw: Number(e.target.value) })}>
              {[3, 5, 7, 10, 11, 15].map((k) => (
                <option key={k} value={k}>
                  {k} кВт
                </option>
              ))}
            </select>
          </label>
          <label className="pl-field">
            <span>Плита</span>
            <select value={electricSettings.stove} onChange={(e) => setElectric({ stove: e.target.value as ElectricSettings['stove'] })}>
              <option value="electric">электрическая — силовая линия 32 А</option>
              <option value="gas">газовая — розетки не ближе 50 см</option>
            </select>
          </label>
          <label className="pl-field">
            <span>Высота потолка, см</span>
            <NumberField value={electricSettings.ceiling} min={220} max={400} step={5} onCommit={(v) => setElectric({ ceiling: v })} />
          </label>
          {(
            [
              ['outlets', 'Розетки: у мебели и техники, по норме — 1 на 4 м периметра, на кухне не меньше 4'],
              ['switches', 'Выключатели у дверей со стороны ручки, у санузла — снаружи'],
              ['lights', 'Свет по комнатам'],
              ['panel', 'Щит в прихожей'],
              ['ac', 'Кондиционеры у окон жилых комнат'],
              ['boiler', 'Водонагреватель в санузле'],
              ['smart', 'Умный дом: умные выключатели, мастер-сценарии, тёплый пол'],
              ['curtains', 'Электрокарнизы на окна'],
              ['motion', 'Датчики движения в коридоре и санузле'],
              ['leak', 'Датчики протечки'],
            ] as [keyof AutoElectricOptions, string][]
          ).map(([k, name]) => (
            <label key={k} className="pl-field">
              <span>{name}</span>
              <input type="checkbox" checked={!!auto[k]} onChange={() => setAuto((a) => ({ ...a, [k]: !a[k] }))} />
            </label>
          ))}
          <div className="pl-row">
            <button className="pl-btn active" onClick={runAutoElectrics}>
              ⚡ Спроектировать по нормам
            </button>
            <button className="pl-btn danger" onClick={clearElectrics} disabled={!electricItems.length}>
              Убрать всю
            </button>
          </div>
          <div className="pl-note">Все точки садятся на стены лицом в комнату, мимо проёмов, зон ванны (60 см), газовой плиты (50 см) и мойки. Техника — на своих линиях.</div>
        </details>

        <div className="pl-segment pl-el-tabs">
          <button className={elTab === 'panel' ? 'active' : ''} onClick={() => setElTab('panel')}>
            Щит
          </button>
          <button className={elTab === 'bom' ? 'active' : ''} onClick={() => setElTab('bom')}>
            Материалы
          </button>
          <button className={elTab === 'norms' ? 'active' : ''} onClick={() => setElTab('norms')}>
            Нормы{d.issues.length ? ` · ${d.issues.length}` : ''}
          </button>
          <button className={elTab === 'add' ? 'active' : ''} onClick={() => setElTab('add')}>
            Поставить
          </button>
        </div>

        {elTab === 'panel' && (
          <div className="pl-block">
            {!d.circuits.length ? (
              <div className="pl-note">Пока пусто. «Спроектировать по нормам» разложит точки и соберёт щит.</div>
            ) : (
              <>
                <div className="pl-el-input">
                  <b>Ввод</b> автомат 2P C{d.input.ratingA} · реле напряжения {d.input.relayA} А · УЗО противопожарное 100 мА
                  <div className="pl-note">
                    Pуст {d.installedKw} кВт, расчётная {d.demandKw} кВт (группы не работают все разом). Щит {d.panel.placed ? `стоит: ${d.panel.room ?? ''}` : `не поставлен — трассы от предложенного места в «${d.panel.room ?? 'прихожей'}»`}, на {d.modules.box} модулей (занято {d.modules.used}).
                  </div>
                </div>
                <table className="pl-spec pl-circuits">
                  <thead>
                    <tr>
                      <th />
                      <th>Группа</th>
                      <th>Защита</th>
                      <th className="num">А</th>
                      <th className="num">м</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.circuits.map((c) => (
                      <tr
                        key={c.id}
                        className={`${hlCircuit === c.id ? 'active' : ''} ${c.currentA > c.ratingA ? 'bad' : ''}`}
                        onClick={() => setHlCircuit((h) => (h === c.id ? null : c.id))}
                        title="Показать группу на плане"
                      >
                        <td>
                          <span className="pl-dot" style={{ background: c.color }} />
                        </td>
                        <td>
                          <b>{c.id}</b> {c.name}
                          <div className="pl-note">
                            {c.points.length} точ. · {(c.installedW / 1000).toFixed(1)} кВт · ВВГнг(А)-LS {c.cable}
                          </div>
                        </td>
                        <td>{c.device === 'автомат' ? `автомат ${c.breaker}` : `диф ${c.breaker}, ${c.rcdMa} мА`}</td>
                        <td className="num">{c.currentA}</td>
                        <td className="num">{c.lengthM}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="pl-note">Трассы — по потолку, в 15 см от него, с изломами под прямым углом; к каждой точке кабель спускается по стене вертикально. Длина — с запасом 10 % и на разделку. Щелчок по группе — показать её на плане.</div>
              </>
            )}
          </div>
        )}

        {elTab === 'bom' && (
          <div className="pl-block">
            {!d.bom.length ? (
              <div className="pl-note">Пока пусто.</div>
            ) : (
              <>
                {[...new Set(d.bom.map((b) => b.group))].map((g) => (
                  <div key={g}>
                    <div className="pl-note">{g}</div>
                    <table className="pl-spec">
                      <tbody>
                        {d.bom
                          .filter((b) => b.group === g)
                          .map((b) => (
                            <tr key={b.name}>
                              <td>
                                {b.name}
                                {b.note && <div className="pl-note">{b.note}</div>}
                              </td>
                              <td className="num">
                                {b.qty} {b.unit}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ))}
                <button className="pl-btn" onClick={() => downloadCsv(`${plan.name || 'план'} электрика`, designCsv(d))}>
                  ⬇ Скачать щит и ведомость (CSV)
                </button>
              </>
            )}
          </div>
        )}

        {elTab === 'norms' && (
          <div className="pl-block">
            {!d.issues.length ? (
              <div className="pl-note">{electricItems.length ? 'Замечаний нет.' : 'Пока нечего проверять.'}</div>
            ) : (
              <div>
                {d.issues.map((x, k) => (
                  <button
                    key={k}
                    className={`pl-issue ${x.level}`}
                    onClick={() => {
                      if (x.pointId) onSelect({ kind: 'furniture', id: x.pointId })
                      else if (x.roomId) onSelect({ kind: 'room', id: x.roomId })
                    }}
                  >
                    <span>{x.level === 'error' ? '⛔' : x.level === 'warn' ? '⚠️' : 'ℹ️'}</span>
                    <span>{x.text}</span>
                  </button>
                ))}
              </div>
            )}
            {errors > 0 && <div className="pl-note">⛔ — нарушение нормы или перегрузка: исправьте до монтажа.</div>}
          </div>
        )}

        {elTab === 'add' && (
          <div className="pl-block">
            {[...new Set(ELECTRIC_MENU.map((m) => m.group))].map((group) => (
              <div key={group}>
                <div className="pl-note">{group}</div>
                <div className="pl-chips">
                  {ELECTRIC_MENU.filter((m) => m.group === group).map((m) => (
                    <button key={m.kind} className={`pl-chip ${placing?.electric?.kind === m.kind ? 'active' : ''}`} onClick={() => pickElectric(m.kind, m.why)} title={`${m.why}, высота ${MOUNT_HEIGHT[m.kind]} см`}>
                      {ELECTRIC_NAMES[m.kind]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="pl-note">Поставленная точка попадает в свою группу сама. Назначение розетки (техника на своей линии), высоту и мощность — в свойствах точки.</div>
          </div>
        )}
      </div>
    )
  }

  const renderChecks = () => (
    <div>
      {design.issues.length > 0 && (
        <button
          className={`pl-issue ${design.issues.some((x) => x.level === 'error') ? 'error' : 'warn'}`}
          onClick={() => {
            switchMode('electric')
            setElTab('norms')
          }}
        >
          <span>⚡</span>
          <span>Электрика: замечаний по нормам — {design.issues.length}. Открыть</span>
        </button>
      )}
      {wallGaps.length > 0 && (
        <div className="pl-block">
          <div className="pl-note">
            Стены не сходятся в {wallGaps.length === 1 ? 'одном месте' : `${wallGaps.length} местах`} (до 30 см) — там комната не замыкается и не считается комнатой.
          </div>
          <button
            className="pl-btn primary"
            onClick={() => {
              const before = rooms.length
              const r = closeGaps(plan)
              if (!r.closed) {
                setToast('Разрывы у зафиксированных стен — снимите замок, чтобы замкнуть')
                return
              }
              history.apply(() => r.plan)
              const after = buildRooms(r.plan).rooms.length
              setToast(`Замкнуто разрывов: ${r.closed}${after > before ? `, комнат стало ${after} (было ${before})` : ''}. Ctrl+Z вернёт`)
            }}
          >
            Замкнуть разрывы
          </button>
        </div>
      )}
      <label className="pl-field">
        <span>Показывать зоны эргономики на плане</span>
        <input type="checkbox" checked={layers.ergo} onChange={() => toggleLayer('ergo')} />
      </label>
      {check.issues.length === 0 ? (
        <div className="pl-ok">✅ Замечаний нет. Расставьте мебель — проверки появятся автоматически.</div>
      ) : (
        check.issues.map((i) => (
          <button key={i.id} className={`pl-issue ${i.level}`} onClick={() => focusIssueTarget(i.target ?? null)}>
            <span>{i.level === 'error' ? '⛔' : i.level === 'warn' ? '⚠️' : 'ℹ️'}</span>
            <span>{i.text}</span>
          </button>
        ))
      )}
      <div className="pl-block">
        <div className="pl-props-title">Что проверяется</div>
        <ul className="pl-rules">
          <li>Пересечения мебели между собой и со стенами.</li>
          <li>Свободные зоны: проходы у кровати 70 см, перед шкафом 90 см, вокруг стола 75 см, перед унитазом 60 см и т. д.</li>
          <li>Двери: сектор открывания не задевает мебель; в каждую комнату есть вход.</li>
          <li>Кухня: рабочий треугольник холодильник–мойка–плита 4–8 м.</li>
          <li>Спальня: изголовье у стены, не под окном, не ногами к двери.</li>
          <li>Гостиная: расстояние диван–телевизор 2–3 м.</li>
        </ul>
      </div>
    </div>
  )

  const renderHelp = () => (
    <div className="pl-help">
      <div className="pl-props-title">Помощь ИИ</div>
      {ai.enabled ? (
        <>
          <div className="pl-note">
            Под каждую задачу — своя модель: на дешёвую работу дешёвая, дорогая включается, только если дешёвая не
            справилась. Ключ хранится на сервере и в браузер не попадает.
          </div>
          <table className="pl-spec">
            <tbody>
              {ai.tasks.map((t) => (
                <tr key={t.task}>
                  <td>{t.about}</td>
                  <td className="pl-spec-models">{t.models.join(' → ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ai.spentToday && (
            <div className="pl-note">
              Потрачено за сутки: {ai.spentToday.rub.toFixed(2)} ₽ за {ai.spentToday.calls} вызовов
              {ai.spentToday.limitRub > 0 ? ` из лимита ${ai.spentToday.limitRub} ₽` : ''}.
            </div>
          )}
          {aiLast && <div className="pl-note">Последний вызов — {aiLast}.</div>}
        </>
      ) : (
        <div className="pl-note">
          ИИ не подключён, и всё работает без него: стены обводятся по линиям картинки, товар читается публичными
          читалками, мебель ставится вручную. Чтобы включить, добавьте на сервере ключ ROUTERAI_API_KEY.
        </div>
      )}
      <div className="pl-props-title">Правила дизайнеров</div>
      <ul className="pl-rules">
        <li><b>Проходы.</b> Основные — 90–100 см, второстепенные — 60–70 см. Меньше 60 см — уже не проход.</li>
        <li><b>Спальня.</b> С обеих сторон двуспальной кровати 70 см. Изголовье к глухой стене, не под окно, не ногами к двери. Шкаф-купе экономит 30 см перед собой по сравнению с распашным.</li>
        <li><b>Гостиная.</b> Диван ↔ телевизор 2–3 м для 55″. Журнальный стол в 40–45 см от дивана. Ковёр объединяет зону: передние ножки мебели на нём.</li>
        <li><b>Столовая.</b> 60 см ширины стола на человека; 75–80 см от края стола до стены, чтобы отодвинуть стул.</li>
        <li><b>Кухня.</b> Порядок холодильник → мойка → плита, между мойкой и плитой 60–90 см столешницы. Между рядами 120 см. Плита не у окна и не вплотную к холодильнику.</li>
        <li><b>Санузел.</b> Перед унитазом 60 см, по бокам 20–25. Перед раковиной и ванной 70 см. Дверь наружу.</li>
        <li><b>Двери.</b> Не бьются о мебель и друг о друга; выключатель со стороны ручки.</li>
        <li><b>Свет и розетки.</b> Три сценария света в каждой комнате. Розетки: у кровати по 2 с каждой стороны, у дивана, на кухне каждые 60–100 см над столешницей.</li>
        <li><b>Окна.</b> Не загораживать высокой мебелью; рабочий стол — боком к окну.</li>
      </ul>
      <div className="pl-props-title">Горячие клавиши</div>
      <table className="pl-keys">
        <tbody>
          <tr><td>V / W / C</td><td>Выбор / Стена / Комната</td></tr>
          <tr><td>D / N / M / L</td><td>Дверь / Окно / Размер / Рулетка</td></tr>
          <tr><td>R, Shift+R</td><td>Повернуть на 90° (и призрак при установке)</td></tr>
          <tr><td>Ctrl+D</td><td>Дублировать</td></tr>
          <tr><td>Стрелки, Shift</td><td>Сдвиг на 1 см / 10 см</td></tr>
          <tr><td>Del</td><td>Удалить</td></tr>
          <tr><td>Ctrl+Z / Ctrl+Y</td><td>Отменить / Вернуть</td></tr>
          <tr><td>Esc / Enter</td><td>Завершить стену, отменить инструмент</td></tr>
          <tr><td>Колесо, пинч, пробел+мышь</td><td>Масштаб и сдвиг</td></tr>
        </tbody>
      </table>
      <div className="pl-note">План сохраняется в браузере автоматически. Через «Файл» можно сохранить JSON, открыть его на другом устройстве, экспортировать PNG/SVG.</div>
    </div>
  )

  return (
    <div className={`pl-root ${view3d ? 'is3d' : ''}`}>
      <header className="pl-header">
        {onBack && (
          <button className="pl-ibtn ghost" onClick={onBack} title="Назад" aria-label="Назад">
            <Icon name="arrowLeft" />
          </button>
        )}
        <div className="pl-brand">
          <input className="pl-name" value={plan.name} onChange={(e) => history.silent((p) => ({ ...p, name: e.target.value }))} aria-label="Название плана" title="Название плана — можно переименовать" />
          <span className={`pl-saved ${saveState}`} title="План сохраняется в этом браузере сам">
            {saveState === 'saving' ? 'Сохраняю…' : saveState === 'error' ? 'Не сохранилось' : 'Сохранено'}
          </span>
        </div>
        {!view3d && (
          <div className="pl-view-switch pl-mode-switch" role="tablist" aria-label="Режим">
            {MODES.map((m) => (
              <button key={m.mode} role="tab" aria-selected={mode === m.mode} className={mode === m.mode ? 'active' : ''} onClick={() => switchMode(m.mode)} title={`${m.name}: ${m.hint}`}>
                <Icon name={m.icon} size={16} />
                <span>{m.name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="pl-view-switch" role="tablist" aria-label="Вид">
          <button role="tab" aria-selected={!view3d} className={!view3d ? 'active' : ''} onClick={() => setView3d(false)} title="Чертёж">
            <Icon name="grid" size={16} /> 2D
          </button>
          <button role="tab" aria-selected={view3d} className={view3d ? 'active' : ''} onClick={() => setView3d(true)} title="Объёмный вид и AR через камеру телефона">
            <Icon name="cube" size={16} /> 3D
          </button>
        </div>
        <div className="pl-header-actions">
          <button className="pl-ibtn ghost" disabled={!history.canUndo} onClick={history.undo} title="Отменить (Ctrl+Z)" aria-label="Отменить">
            <Icon name="undo" />
          </button>
          <button className="pl-ibtn ghost" disabled={!history.canRedo} onClick={history.redo} title="Вернуть (Ctrl+Y)" aria-label="Вернуть">
            <Icon name="redo" />
          </button>
          <span className="pl-zoom">
            <span className="pl-sep" />
            <button className="pl-ibtn ghost" disabled={view3d} onClick={() => canvasRef.current?.zoomBy(1 / 1.25)} title="Отдалить" aria-label="Отдалить">
              <Icon name="zoomOut" />
            </button>
            <button className="pl-ibtn ghost wide" disabled={view3d} onClick={() => canvasRef.current?.fit()} title="Показать весь план">
              {Math.round(view.zoom * 100)}%
            </button>
            <button className="pl-ibtn ghost" disabled={view3d} onClick={() => canvasRef.current?.zoomBy(1.25)} title="Приблизить" aria-label="Приблизить">
              <Icon name="zoomIn" />
            </button>
          </span>
          <span className="pl-sep" />
          <button
            className={`pl-btn ghost ${panel === 'checks' ? 'active' : ''}`}
            onClick={() => {
              setPanel('checks')
              setPanelOpen(true)
            }}
            title="Проверка планировки: проходы, двери, эргономика"
          >
            <Icon name="check" size={18} />
            <span className="pl-btn-text">Проверка</span>
            {problems > 0 && <span className="pl-badge">{problems}</span>}
          </button>
          <span className="pl-menu-anchor">
            <button className={`pl-btn ghost ${menu === 'view' ? 'active' : ''}`} onClick={() => setMenu((m) => (m === 'view' ? null : 'view'))} title="Слои, единицы, сетка" aria-haspopup="menu" aria-expanded={menu === 'view'}>
              <Icon name="layers" size={18} />
              <span className="pl-btn-text">Вид</span>
            </button>
            {menu === 'view' && (
              <Dropdown width={280}>
                <MenuGroup title="Слои" />
                {(
                  [
                    ['grid', 'Сетка'],
                    ['underlay', 'Схема-подложка'],
                    ['rooms', 'Полы и названия комнат'],
                    ['furniture', 'Мебель'],
                    ['electric', 'Электрика'],
                    ['labels', 'Подписи мебели'],
                    ['dims', 'Размеры'],
                    ['ergo', 'Зоны эргономики'],
                  ] as [keyof Layers, string][]
                ).map(([k, name]) => (
                  <MenuItem key={k} checked={layers[k]} label={name} onSelect={() => toggleLayer(k)} />
                ))}
                <MenuItem checked={photoMode} label="Фото-вид моделей на плане" onSelect={() => setPhotoMode((v) => !v)} />
                <MenuSep />
                <MenuGroup title="Единицы на плане" />
                <MenuChoice
                  options={[
                    { value: 'cm' as LengthUnit, label: 'см' },
                    { value: 'mm' as LengthUnit, label: 'мм' },
                    { value: 'm' as LengthUnit, label: 'м' },
                  ]}
                  value={unit}
                  onChange={setUnit}
                />
                <MenuGroup title="Длина стены" />
                <MenuChoice options={WALL_REFS.map((r) => ({ value: r.ref, label: r.name }))} value={wallRef} onChange={setWallRef} />
                <MenuGroup title="Шаг сетки" />
                <MenuChoice
                  options={[5, 10, 25, 50].map((g) => ({ value: g, label: `${g} см` }))}
                  value={plan.settings.grid}
                  onChange={(g) => history.silent((p) => ({ ...p, settings: { ...p.settings, grid: g } }))}
                />
              </Dropdown>
            )}
          </span>
          <span className="pl-menu-anchor">
            <button className={`pl-btn ${menu === 'project' ? 'active' : ''}`} onClick={() => setMenu((m) => (m === 'project' ? null : 'project'))} title="Проект: новый, открыть, сохранить, экспорт" aria-haspopup="menu" aria-expanded={menu === 'project'}>
              <Icon name="file" size={18} />
              <span className="pl-btn-text">Проект</span>
              <Icon name="chevronDown" size={14} className="pl-caret" />
            </button>
            {menu === 'project' && (
              <Dropdown width={310}>
                <MenuItem
                  icon="plus"
                  label="Новый…"
                  hint="шаблон или чистый лист"
                  onSelect={() => {
                    setMenu(null)
                    setStart(true)
                  }}
                />
                <MenuSep />
                <MenuGroup title="Загрузить" />
                <MenuItem
                  icon="image"
                  label="План картинкой…"
                  hint="скрин, фото"
                  onSelect={() => {
                    imageMode.current = 'ask'
                    imageInput.current?.click()
                    setMenu(null)
                  }}
                />
                <MenuItem
                  icon="clipboard"
                  label="Вставить из буфера"
                  hint="Ctrl+V"
                  onSelect={() => {
                    setMenu(null)
                    void intake.pasteFromClipboard()
                  }}
                />
                <MenuItem
                  icon="file"
                  label="Открыть файл плана…"
                  hint="Ctrl+O"
                  onSelect={() => {
                    fileInput.current?.click()
                    setMenu(null)
                  }}
                />
                <MenuSep />
                <MenuGroup title="Сохранить и поделиться" />
                <MenuItem
                  icon="save"
                  label="Сохранить план в файл"
                  hint="Ctrl+S"
                  onSelect={() => {
                    downloadJson(plan)
                    setMenu(null)
                    setToast('План сохранён в файл')
                  }}
                />
                <MenuItem icon="download" label="Экспорт картинки (PNG)" onSelect={() => doExport('png')} />
                <MenuItem icon="download" label="Экспорт вектора (SVG)" onSelect={() => doExport('svg')} />
                <MenuItem
                  icon="phone"
                  label="Ссылка для телефона"
                  hint="3D и AR"
                  onSelect={() => {
                    setMenu(null)
                    void shareForPhone()
                  }}
                />
              </Dropdown>
            )}
          </span>
          <button
            className={`pl-ibtn ghost ${panel === 'help' ? 'active' : ''}`}
            onClick={() => {
              setPanel('help')
              setPanelOpen(true)
            }}
            title="Справка и правила дизайнеров"
            aria-label="Справка"
          >
            <Icon name="help" />
          </button>
        </div>
        {menu && <div className="pl-backdrop" onClick={() => setMenu(null)} />}
        <input ref={fileInput} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onOpenFile} />
        <input ref={imageInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={onOpenImage} />
        <input ref={anyInput} type="file" accept="image/*,.json,application/json" style={{ display: 'none' }} onChange={onOpenAny} />
      </header>

      <nav className={`pl-tools ${view3d ? 'hidden' : ''}`}>
        {/* инструменты режима: в мебели и электрике стены не рисуются и не цепляются */}
        {(mode === 'build' ? TOOLS : TOOLS.filter((t) => t.tool === 'select' || t.tool === 'measure')).map((t) => (
          <button key={t.tool} className={`pl-tool ${tool === t.tool ? 'active' : ''}`} onClick={() => setTool(t.tool)} title={t.key ? `${t.name} (${t.key})` : t.name}>
            <span className="pl-tool-icon">
              <Icon name={t.icon} size={22} />
            </span>
            <span className="pl-tool-name">{t.name}</span>
          </button>
        ))}
        {mode === 'build' && plan.underlay && (
          <>
            <button className={`pl-tool ${tool === 'roomPick' ? 'active' : ''}`} onClick={() => setTool('roomPick')} title="Комната по клику на картинке">
              <span className="pl-tool-icon">
                <Icon name="wand" size={22} />
              </span>
              <span className="pl-tool-name">По клику</span>
            </button>
            <button className={`pl-tool ${tool === 'refine' ? 'active' : ''}`} onClick={() => setTool('refine')} title="Обвести спорное место и сказать, что там: стена, проём, дверь или окно">
              <span className="pl-tool-icon">
                <Icon name="refine" size={22} />
              </span>
              <span className="pl-tool-name">Уточнить</span>
            </button>
            <button className={`pl-tool ${tool === 'calibrate' ? 'active' : ''}`} onClick={() => setTool('calibrate')} title="Задать масштаб подложки по известному размеру">
              <span className="pl-tool-icon">
                <Icon name="calibrate" size={22} />
              </span>
              <span className="pl-tool-name">Масштаб</span>
            </button>
          </>
        )}
        {mode === 'furnish' && (
          <button className={`pl-tool ${tool === 'place' || panel === 'catalog' ? 'active' : ''}`} onClick={openCatalog} title="Каталог мебели">
            <span className="pl-tool-icon">
              <Icon name="furniture" size={22} />
            </span>
            <span className="pl-tool-name">Каталог</span>
          </button>
        )}
        {mode === 'furnish' && ai.enabled && (
          <button className="pl-tool" onClick={() => setFurnishFor(selection?.kind === 'room' ? selection.id : 'all')} disabled={!rooms.length} title="Расставить мебель с ИИ: вся квартира или комната, по вашим пожеланиям">
            <span className="pl-tool-icon">
              <Icon name="sparkles" size={22} />
            </span>
            <span className="pl-tool-name">ИИ</span>
          </button>
        )}
        {mode === 'electric' && (
          <button
            className={`pl-tool ${panel === 'electric' ? 'active' : ''}`}
            onClick={() => {
              setPanel('electric')
              setPanelOpen(true)
            }}
            title="Точки электрики, группы щита, ведомость"
          >
            <span className="pl-tool-icon">
              <Icon name="bolt" size={22} />
            </span>
            <span className="pl-tool-name">Проект</span>
          </button>
        )}
        <span className="pl-tools-gap" />
        {mode === 'build' && (
          <>
            <button
              className={`pl-tool small ${allWallsLocked ? 'active' : ''}`}
              onClick={() => {
                history.apply((p) => setAllLocked(p, !allWallsLocked))
                setToast(allWallsLocked ? 'Стены снова можно двигать' : 'Все стены зафиксированы: двигать можно мебель, двери и окна. Снять — той же кнопкой «Замок»')
              }}
              disabled={!plan.walls.length}
              title="Зафиксировать все стены: настроили размеры — больше их случайно не сдвинуть"
            >
              <span className="pl-tool-icon">
                <Icon name={allWallsLocked ? 'lock' : 'unlock'} size={20} />
              </span>
              <span className="pl-tool-name">Замок</span>
            </button>
            <button className={`pl-tool small ${ortho ? 'active' : ''}`} onClick={() => setOrtho((o) => !o)} title="Рисовать стены только под 0/45/90°">
              <span className="pl-tool-icon">
                <Icon name="ortho" size={20} />
              </span>
              <span className="pl-tool-name">Орто</span>
            </button>
          </>
        )}
        {mode === 'furnish' && (
          <button className={`pl-tool small ${layers.ergo ? 'active' : ''}`} onClick={() => toggleLayer('ergo')} title="Показать зоны эргономики">
            <span className="pl-tool-icon">
              <Icon name="zones" size={20} />
            </span>
            <span className="pl-tool-name">Зоны</span>
          </button>
        )}
      </nav>

      {view3d ? (
        <Suspense fallback={<div className="pl-canvas-wrap pl3d-loading">Загружаем 3D…</div>}>
          <View3D plan={plan} rooms={rooms} selection={selection} onSelect={onSelect} onExit={() => setView3d(false)} onToast={setToast} onShare={shareForPhone} />
        </Suspense>
      ) : (
        <PlannerCanvas
          ref={canvasRef}
          plan={plan}
          rooms={rooms}
          check={check}
          badItems={badItems}
          history={history}
          tool={tool}
          onToolChange={setTool}
          selection={selection}
          onSelect={onSelect}
          layers={layers}
          unit={unit}
          ortho={ortho}
          wallThickness={wallThickness}
          placing={placing}
          view={view}
          onViewChange={setView}
          onHint={setHint}
          photos={photos}
          onCalibrate={onCalibrate}
          imageLines={imageLines}
          onRoomPick={(p) => void onRoomPick(p)}
          onCorners={(pts) => void onCorners(pts)}
          onRefine={onRefineArea}
          onNotice={setToast}
          mode={mode}
          wallRef={wallRef}
          electricDesign={mode === 'electric' && layers.electric ? design : null}
          hlCircuit={hlCircuit}
        />
      )}

      <aside className={`pl-panel ${panelOpen ? 'open' : 'closed'}`}>
        <div className="pl-panel-tabs">
          {(
            [
              ['props', 'Свойства', 'list'],
              ['catalog', 'Каталог', 'furniture'],
              ['electric', 'Электрика', 'bolt'],
              ['checks', 'Проверка', 'check'],
            ] as [PanelTab, string, IconName][]
          ).map(([k, name, icon]) => (
            <button
              key={k}
              className={`pl-tab ${panel === k ? 'active' : ''}`}
              onClick={() => {
                if (k === 'catalog' && mode !== 'furnish') switchMode('furnish')
                else if (k === 'electric' && mode !== 'electric') switchMode('electric')
                setPanel(k)
                setPanelOpen(true)
              }}
              title={name}
            >
              <Icon name={icon} size={18} />
              <span className="pl-tab-name">{name}</span>
              {k === 'checks' && problems > 0 && <span className="pl-badge">{problems}</span>}
            </button>
          ))}
          <button className="pl-tab pl-tab-toggle" onClick={() => setPanelOpen((o) => !o)} aria-label="Свернуть панель">
            {panelOpen ? '▾' : '▴'}
          </button>
        </div>
        {panelOpen && (
          <div className="pl-panel-body">
            {panel === 'props' && renderProps()}
            {panel === 'catalog' && renderCatalog()}
            {panel === 'electric' && renderElectric()}
            {panel === 'checks' && renderChecks()}
            {panel === 'help' && renderHelp()}
          </div>
        )}
      </aside>

      {!view3d && !start && isEmptyPlan(plan) && !plan.underlay && (
        <div className="pl-empty">
          <div className="pl-empty-card">
            <h2>Чистый лист</h2>
            <p>Перетащите сюда картинку плана, вставьте скриншот по Ctrl+V или нарисуйте первую комнату.</p>
            <div className="pl-empty-actions">
              <button className="pl-btn primary" onClick={() => anyInput.current?.click()}>
                <Icon name="upload" size={18} /> Загрузить план
              </button>
              <button className="pl-btn" onClick={() => setStart(true)}>
                <Icon name="template" size={18} /> Шаблон
              </button>
              <button className="pl-btn" onClick={() => setTool('room')}>
                <Icon name="room" size={18} /> Нарисовать комнату
              </button>
            </div>
          </div>
        </div>
      )}
      {intake.dragging && (
        <div className="pl-drop">
          <div className="pl-drop-box">
            <Icon name="upload" size={44} stroke={1.4} />
            <b>Отпустите, чтобы загрузить</b>
            <span>Картинка станет подложкой для обводки, файл плана откроется</span>
          </div>
        </div>
      )}
      <StartDialog
        open={start}
        canClose
        templates={TEMPLATES}
        recent={hadSavedPlan || !isEmptyPlan(plan) ? { name: plan.name, rooms: rooms.length, areaM2: totalArea } : null}
        aiEnabled={ai.enabled}
        onClose={() => setStart(false)}
        onTemplate={newFromTemplate}
        onPickFile={() => anyInput.current?.click()}
        onPaste={() => void intake.pasteFromClipboard()}
      />
      {ask && <AskDialog title={ask.title} text={ask.text} options={ask.options} onPick={ask.onPick} onCancel={() => setAsk(null)} />}
      {furnishFor && (
        <FurnishDialog
          rooms={rooms.map((r) => ({ id: r.meta.id, name: r.meta.name, area: r.area }))}
          initialScope={furnishFor}
          aiEnabled={ai.enabled}
          aiHint={ai.hint}
          onRun={runFurnish}
          onClose={() => setFurnishFor(null)}
        />
      )}
      <footer className="pl-status">
        <span className="pl-status-hint" title={aiBusy ? aiBusy : hint}>
          {aiBusy ? `✨ ${aiBusy}` : hint}
        </span>
        <span className="pl-status-stats">
          {fmtArea(totalArea)} · {rooms.length} {rooms.length === 1 ? 'комната' : rooms.length >= 2 && rooms.length <= 4 ? 'комнаты' : 'комнат'} · сетка {fmtNum(plan.settings.grid)} см
        </span>
      </footer>
      {toast && (
        <div className="pl-toast" role="status" aria-live="polite" onClick={() => setToast(null)} title="Закрыть">
          {toast}
        </div>
      )}
      {exportJob && (
        <div style={{ position: 'absolute', left: -100000, top: 0, width: 10, height: 10, overflow: 'hidden' }} aria-hidden>
          <svg ref={exportSvgRef} xmlns="http://www.w3.org/2000/svg" width={exportJob.w * exportJob.z} height={exportJob.h * exportJob.z} viewBox={`${exportJob.x} ${exportJob.y} ${exportJob.w} ${exportJob.h}`}>
            <rect x={exportJob.x} y={exportJob.y} width={exportJob.w} height={exportJob.h} fill="#fff" />
            <Scene plan={plan} rooms={rooms} check={check} layers={{ ...layers, grid: false }} unit={unit} zoom={exportJob.z} photos={photos} />
          </svg>
        </div>
      )}
    </div>
  )
}

export default PlannerPage
