// Модель данных планировщика. Все размеры — в сантиметрах, углы — в градусах.

export interface Pt {
  x: number
  y: number
}

export interface Wall {
  id: string
  a: Pt
  b: Pt
  thickness: number
  /** зафиксирована: двигать, растягивать и удалять нельзя, пока не снят замок */
  locked?: boolean
}

export type OpeningKind = 'door' | 'window' | 'doorway'

export interface Opening {
  id: string
  kind: OpeningKind
  wallId: string
  /** положение центра проёма вдоль стены, 0..1 */
  t: number
  width: number
  /** где петли: у точки a или b стены */
  hinge: 'a' | 'b'
  /** в какую сторону от оси стены открывается дверь */
  side: 1 | -1
}

/** ссылка на фотореалистичную 3D-модель (для 3D-вида и AR) */
export interface ModelRef {
  provider: 'polyhaven' | 'url'
  /** slug модели на Poly Haven или прямая ссылка на GLB/glTF */
  id: string
  name?: string
  thumb?: string
  /** лицензия / источник — показывается в панели */
  license?: string
}

export interface Furniture {
  id: string
  /** ключ элемента каталога */
  type: string
  x: number
  y: number
  w: number
  d: number
  rot: number
  /** высота, см (если не задана — из каталога) */
  h?: number
  flip?: boolean
  label?: string
  /** почему предмет стоит именно тут — пояснение от расстановщика */
  note?: string
  color?: string
  model?: ModelRef
  /** электрическая точка: вид, высота установки и причина размещения */
  electric?: ElectricPoint
  /** товар из магазина: ссылка, фото и цена */
  product?: ProductRef
}

export type ElectricKind =
  | 'outlet'
  | 'switch'
  | 'light'
  | 'spot'
  | 'wall-lamp'
  | 'smart-outlet'
  | 'smart-switch'
  | 'switch-master'
  | 'dimmer'
  | 'motion-sensor'
  | 'leak-sensor'
  | 'thermostat'
  | 'curtain-motor'
  | 'panel'

/** Точка электрики: вид прибора, высота установки над полом и причина размещения */
export interface ElectricPoint {
  kind: ElectricKind
  why: string
  height: number
}

/** Товар из магазина, поставленный в план по ссылке */
export interface ProductRef {
  url: string
  name: string
  photo?: string
  price?: number
  currency?: string
}

export interface RoomMeta {
  id: string
  /** точка внутри комнаты, по которой она узнаётся после перестройки стен */
  anchor: Pt
  name: string
  floor: FloorKey
}

export type FloorKey = 'laminate' | 'parquet' | 'tile' | 'carpet' | 'concrete' | 'plain'

export interface DimensionLine {
  id: string
  a: Pt
  b: Pt
  /** смещение размерной линии от отрезка a-b, см */
  offset: number
}

export interface PlanSettings {
  grid: number
}

/** Картинка плана под чертежом: по ней обводят или распознают стены */
export interface Underlay {
  /** изображение (data URL): после «Очистить» — очищенное, по нему ищутся стены */
  src: string
  /** исходное фото до очистки (data URL): по нему модель читает подписи — цифры очистка стирает */
  original?: string
  /** размер изображения, px */
  px: { w: number; h: number }
  /** положение левого верхнего угла на плане, см */
  x: number
  y: number
  /** сантиметров в одном пикселе изображения */
  scale: number
  opacity: number
  visible: boolean
  /** заблокирована: не двигается мышью */
  locked: boolean
}

export interface Plan {
  version: 1
  name: string
  walls: Wall[]
  openings: Opening[]
  furniture: Furniture[]
  rooms: RoomMeta[]
  dims: DimensionLine[]
  settings: PlanSettings
  underlay?: Underlay
}

/** Комната, найденная по замкнутому контуру стен */
export interface Room {
  meta: RoomMeta
  /** контур по осям стен */
  polygon: Pt[]
  /** контур по внутренним граням стен (для заливки пола и полезной площади) */
  inner: Pt[]
  /** площадь по внутренним граням, м² */
  area: number
  /** периметр по осям, см */
  perimeter: number
}

export type Selection =
  | { kind: 'wall'; id: string }
  | { kind: 'opening'; id: string }
  | { kind: 'furniture'; id: string }
  | { kind: 'room'; id: string }
  | { kind: 'dim'; id: string }
  | null

export type Tool =
  | 'select'
  | 'wall'
  | 'room'
  | 'door'
  | 'window'
  | 'doorway'
  | 'place'
  | 'dimension'
  | 'measure'
  | 'calibrate'
  /** клик внутри комнаты на картинке — комната по заливке */
  | 'roomPick'
  /** четыре угла наружных стен на фото — выпрямить перспективу */
  | 'corners'
  /** обвести спорное место на чертеже и сказать, что там на самом деле */
  | 'refine'

export type LengthUnit = 'cm' | 'mm' | 'm'

export interface Layers {
  grid: boolean
  underlay: boolean
  rooms: boolean
  furniture: boolean
  electric: boolean
  dims: boolean
  ergo: boolean
  labels: boolean
}

export interface Issue {
  id: string
  level: 'error' | 'warn' | 'info'
  text: string
  /** что выделить при клике на проблему */
  target?: Selection
}

let counter = 0
export const uid = (prefix = 'id'): string => {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export const emptyPlan = (name = 'Моя квартира'): Plan => ({
  version: 1,
  name,
  walls: [],
  openings: [],
  furniture: [],
  rooms: [],
  dims: [],
  settings: { grid: 10 },
})
