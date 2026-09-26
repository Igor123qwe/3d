// Цвета цветного вида: материалы и ткани.
//
// Раньше вся мебель одной категории была одного бледного цвета с чёрной
// обводкой — план читался как чертёж, а не как интерьер. Здесь у каждого вида
// мебели свой материал: дерево, ткань, камень, сталь, керамика, — а у текстиля
// в комнате — палитра, как у дизайнера: основной цвет и акцент.

export const MAT = {
  oak: '#dcbc92',
  walnut: '#94664a',
  birch: '#ecdcc2',
  linen: '#fbf7f1',
  pillow: '#fffdf9',
  stone: '#eeeae4',
  steel: '#d2d8dd',
  glass: '#2e3137',
  ceramic: '#ffffff',
  water: '#d9eaf3',
  white: '#f7f4ef',
  pot: '#c98162',
  metal: '#5e636b',
  leaves: ['#4f8f5f', '#6aa874', '#8cc08a', '#3f7a52'],
  glow: '#ffe7a3',
} as const

/** ткань и краска по умолчанию: у каждого вида своя, план не одноцветный */
const BASE: Record<string, string> = {
  'sofa-3': '#6f93a8',
  'sofa-2': '#7fa39a',
  'sofa-corner': '#8c8fb5',
  armchair: '#d9a35f',
  'bed-160': '#9fb8a8',
  'bed-180': '#a9a4c7',
  'bed-140': '#c9a58f',
  'bed-90': '#8fb3c9',
  'kid-bed': '#f1b8a8',
  crib: '#f2c6c2',
  chair: '#c9b8a4',
  bench: '#b7a3c9',
  'hall-bench': '#a7b8a0',
  rug: '#d9b8a3',
  'kid-rug': '#f6d98f',
  'office-chair': '#4f5966',
  'bar-stool': '#5e636b',
}

/** основной цвет предмета: ткань для мягкой мебели, материал для остальной */
export function baseColorOf(type: string, glyph: string): string {
  if (BASE[type]) return BASE[type]
  switch (glyph) {
    case 'table':
    case 'table-round':
    case 'desk':
    case 'drawers':
    case 'shelf':
    case 'bench':
      return MAT.oak
    case 'wardrobe':
    case 'wardrobe-slide':
      return MAT.white
    case 'counter':
    case 'sink':
    case 'stove':
    case 'dishwasher':
      return MAT.stone
    case 'fridge':
    case 'washer':
      return '#eef1f3'
    case 'toilet':
    case 'basin':
    case 'bathtub':
    case 'shower':
      return MAT.ceramic
    case 'tv':
      return MAT.glass
    case 'plant':
      return MAT.leaves[1]
    case 'lamp':
      return '#fff3d1'
    case 'crib':
      return MAT.birch
    case 'column':
      return '#50545c'
    case 'mirror':
      return '#d7e9f5'
    case 'sofa':
    case 'armchair':
      return '#7f98a8'
    case 'bed':
      return '#9fb8a8'
    case 'chair':
    case 'stool':
      return '#c9b8a4'
    case 'rug':
      return '#d9b8a3'
    default:
      return '#e7e1d8'
  }
}

/**
 * Палитры комнат — правило 60-30-10: спокойная основа (пол, стены, дерево),
 * основной цвет текстиля и акцент. Акцент — подушки, плед, ковёр, мелочи
 */
export interface RoomPalette {
  name: string
  /** диван, покрывало, кресла */
  main: string
  /** подушки, плед, мелочи */
  accent: string
  /** ковёр */
  rug: string
}

export const PALETTES: Record<string, RoomPalette> = {
  bedroom: { name: 'шалфей и терракота', main: '#9fb8a8', accent: '#d98b6d', rug: '#e6d3c0' },
  living: { name: 'морская волна и горчица', main: '#5f8f9a', accent: '#e0a84f', rug: '#e8dccb' },
  kids: { name: 'мята и персик', main: '#9fd3c0', accent: '#f4a97f', rug: '#f6dfa0' },
  office: { name: 'графит и латунь', main: '#5c6b7a', accent: '#c9a45c', rug: '#d9d3ca' },
  dining: { name: 'олива и глина', main: '#9aa36b', accent: '#c7774f', rug: '#e5d8c3' },
  guest: { name: 'пыльная роза и серый', main: '#c9a2a6', accent: '#7b8794', rug: '#e8dcd6' },
}

/** палитра по назначению комнаты */
export function paletteFor(purpose: string): RoomPalette {
  const n = purpose.toLowerCase()
  if (/детск/.test(n)) return PALETTES.kids
  if (/кабинет/.test(n)) return PALETTES.office
  if (/гостев/.test(n)) return PALETTES.guest
  if (/столов|кухн/.test(n)) return PALETTES.dining
  if (/спальн/.test(n)) return PALETTES.bedroom
  return PALETTES.living
}

/** акцент к основному цвету: из палитры, если цвет оттуда, иначе тёплый по умолчанию */
export function accentOf(main: string): string {
  const p = Object.values(PALETTES).find((x) => x.main.toLowerCase() === main.toLowerCase())
  return p?.accent ?? '#e0a84f'
}

const parse = (hex: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return null
  const v = parseInt(m[1], 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
const toHex = (c: number[]) => `#${c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`

/** смесь цветов: t = 0 — a, t = 1 — b */
export function mix(a: string, b: string, t: number): string {
  const x = parse(a)
  const y = parse(b)
  if (!x || !y) return a
  return toHex(x.map((v, i) => v + (y[i] - v) * t))
}

/** темнее на долю k */
export const shade = (hex: string, k = 0.15): string => mix(hex, '#000000', k)
/** светлее на долю k */
export const tint = (hex: string, k = 0.25): string => mix(hex, '#ffffff', k)

/** полы цветного вида: тёплое дерево, светлая плитка — как на планах интерьера */
export const FLOOR_COLORS: Record<string, { color: string; pattern?: string }> = {
  laminate: { color: '#ecd8ba', pattern: 'url(#pl-c-plank)' },
  parquet: { color: '#e2c59c', pattern: 'url(#pl-c-parquet)' },
  tile: { color: '#e4eaee', pattern: 'url(#pl-c-tile)' },
  carpet: { color: '#e9e1ea' },
  concrete: { color: '#e2e0dc', pattern: 'url(#pl-c-tile)' },
  plain: { color: '#f4efe8' },
}

/** число из строки: одинаковый id — одинаковые «случайные» книги и вешалки */
export function seeded(id: string): () => number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

/** корешки книг и одежда на вешалках: приглушённая радуга */
export const SPINES = ['#c96f5b', '#e0a84f', '#6f93a8', '#7fa37a', '#a58bc2', '#d9c7a0', '#4f6a86', '#d98ba0']
