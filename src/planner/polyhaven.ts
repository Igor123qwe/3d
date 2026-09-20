// Каталог фотореалистичных 3D-моделей Poly Haven (лицензия CC0) и ссылки на свои GLB.
import type { ModelRef } from './types'

export const PH_API = 'https://api.polyhaven.com'
export const PH_LICENSE = 'Poly Haven · CC0'
export const phThumb = (id: string, w = 320, h = 240): string => `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=${w}&height=${h}`
export const phPage = (id: string): string => `https://polyhaven.com/a/${id}`

export interface PhAsset {
  id: string
  name: string
  categories: string[]
  tags: string[]
  /** размеры из каталога, см: ширина, глубина, высота */
  dims: { w: number; d: number; h: number } | null
  downloads: number
  thumb: string
}

const jsonCache = new Map<string, Promise<unknown>>()
function getJson<T>(url: string): Promise<T> {
  let p = jsonCache.get(url) as Promise<T> | undefined
  if (!p) {
    p = fetch(url, { mode: 'cors' }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<T>
    })
    p.catch(() => jsonCache.delete(url))
    jsonCache.set(url, p)
  }
  return p
}

/** размеры модели (Poly Haven хранит в миллиметрах, но подстрахуемся) */
export function phDimsCm(dims: unknown): { w: number; d: number; h: number } | null {
  if (!Array.isArray(dims) || dims.length < 3) return null
  const [x, y, z] = dims.map((v) => Number(v))
  if (![x, y, z].every((v) => Number.isFinite(v) && v > 0)) return null
  const max = Math.max(x, y, z)
  const k = max > 60 ? 0.1 : max < 10 ? 100 : 1 // мм → см, м → см, иначе см
  const r = (v: number) => Math.max(2, Math.round(v * k))
  return { w: r(x), d: r(y), h: r(z) }
}

export async function phCategories(): Promise<{ name: string; count: number }[]> {
  const data = await getJson<Record<string, number>>(`${PH_API}/categories/models`)
  return Object.entries(data)
    .filter(([name]) => name !== 'all')
    .map(([name, count]) => ({ name, count: Number(count) || 0 }))
    .sort((a, b) => b.count - a.count)
}

interface PhRaw {
  name?: string
  categories?: string[]
  tags?: string[]
  dimensions?: unknown
  download_count?: number
}

export async function phAssets(category?: string): Promise<PhAsset[]> {
  const url = `${PH_API}/assets?t=models${category ? `&c=${encodeURIComponent(category)}` : ''}`
  const data = await getJson<Record<string, PhRaw>>(url)
  return Object.entries(data)
    .map(([id, a]) => ({
      id,
      name: a.name || id,
      categories: a.categories ?? [],
      tags: a.tags ?? [],
      dims: phDimsCm(a.dimensions),
      downloads: a.download_count ?? 0,
      thumb: phThumb(id),
    }))
    .sort((a, b) => b.downloads - a.downloads)
}

export async function phInfo(id: string): Promise<PhRaw> {
  return getJson<PhRaw>(`${PH_API}/info/${encodeURIComponent(id)}`)
}

interface PhFileEntry {
  url: string
  include?: Record<string, { url: string }>
}

/** ссылка на glTF модели в минимальном разрешении и карта её текстур */
export async function phModelUrl(id: string): Promise<{ url: string; include: Record<string, string> } | null> {
  const files = await getJson<Record<string, unknown>>(`${PH_API}/files/${encodeURIComponent(id)}`)
  const gltf = files.gltf as Record<string, { gltf?: PhFileEntry }> | undefined
  if (!gltf) return null
  const order = ['1k', '2k', '4k', '8k']
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : 50)
  const keys = Object.keys(gltf).sort((a, b) => rank(a) - rank(b))
  for (const k of keys) {
    const entry = gltf[k]?.gltf
    if (entry?.url) {
      const include: Record<string, string> = {}
      for (const [rel, v] of Object.entries(entry.include ?? {})) if (v?.url) include[rel] = v.url
      return { url: entry.url, include }
    }
  }
  return null
}

const TYPE_RULES: [RegExp, string][] = [
  [/coffee.?table|side.?table/i, 'coffee-table'],
  [/dining.?table|kitchen.?table|table/i, 'dining-table'],
  [/office.?chair|desk.?chair/i, 'office-chair'],
  [/arm.?chair|lounge.?chair/i, 'armchair'],
  [/bar.?stool/i, 'bar-stool'],
  [/stool/i, 'chair'],
  [/chair|seat/i, 'chair'],
  [/couch|sofa/i, 'sofa-3'],
  [/bed(?!side)/i, 'bed-160'],
  [/night.?stand|bedside/i, 'nightstand'],
  [/wardrobe|closet|armoire/i, 'wardrobe'],
  [/book.?shelf|shelf|shelving|bookcase/i, 'bookshelf'],
  [/dresser|drawer|sideboard|chest|commode|cabinet|cupboard/i, 'dresser'],
  [/desk/i, 'desk'],
  [/fridge|refrigerator|freezer/i, 'fridge'],
  [/oven|stove|cooker|hob/i, 'stove'],
  [/dish.?washer/i, 'dishwasher'],
  [/wash(ing)?.?machine|laundry/i, 'washer'],
  [/kitchen.?sink|sink/i, 'sink'],
  [/toilet|wc/i, 'toilet'],
  [/bath.?tub|bath/i, 'bathtub-170'],
  [/shower/i, 'shower-90'],
  [/basin|wash.?stand/i, 'basin'],
  [/television|tv|monitor|screen/i, 'tv'],
  [/floor.?lamp|standing.?lamp/i, 'lamp'],
  [/lamp|light|chandelier|pendant/i, 'lamp'],
  [/plant|tree|flower|pot/i, 'plant'],
  [/rug|carpet/i, 'rug'],
  [/piano/i, 'piano'],
  [/bench/i, 'bench'],
  [/mirror/i, 'mirror'],
  [/radiator|heater/i, 'radiator'],
]

/** к какому типу планировщика отнести модель (по имени, тегам и категориям) */
export function guessType(a: { name: string; tags: string[]; categories: string[] }): string {
  const hay = [a.name, ...a.tags, ...a.categories].join(' ')
  for (const [re, type] of TYPE_RULES) if (re.test(hay)) return type
  return 'box'
}

export function modelRefFromAsset(a: PhAsset): ModelRef {
  return { provider: 'polyhaven', id: a.id, name: a.name, thumb: a.thumb, license: PH_LICENSE }
}

export function modelRefFromUrl(url: string): ModelRef {
  const name = decodeURIComponent(url.split('/').pop() || 'Модель').replace(/\.(glb|gltf)$/i, '')
  return { provider: 'url', id: url, name }
}

export const modelKey = (ref: ModelRef): string => `${ref.provider}:${ref.id}`
