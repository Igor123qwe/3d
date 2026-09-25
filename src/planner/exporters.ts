import type { DimRef, Plan } from './types'

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const safeName = (s: string) => (s || 'plan').replace(/[^\p{L}\p{N}_-]+/gu, '_')

export function downloadJson(plan: Plan): void {
  downloadBlob(`${safeName(plan.name)}.plan.json`, new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }))
}

export function downloadSvg(name: string, svgMarkup: string): void {
  downloadBlob(`${safeName(name)}.svg`, new Blob([svgMarkup], { type: 'image/svg+xml' }))
}

export function downloadPng(name: string, svgMarkup: string, width: number, height: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' }))
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(width)
      canvas.height = Math.ceil(height)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('no canvas'))
        return
      }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('toBlob failed'))
          return
        }
        downloadBlob(`${safeName(name)}.png`, blob)
        resolve()
      }, 'image/png')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('svg render failed'))
    }
    img.src = url
  })
}

export function readPlanFile(file: File): Promise<Plan> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      try {
        const data = JSON.parse(String(r.result)) as Plan
        if (!data || !Array.isArray(data.walls)) throw new Error('bad')
        resolve(normalizePlan(data))
      } catch {
        reject(new Error('Файл не похож на план'))
      }
    }
    r.onerror = () => reject(new Error('Не удалось прочитать файл'))
    r.readAsText(file)
  })
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const pt = (v: unknown): { x: number; y: number } | null => {
  const p = v as { x?: unknown; y?: unknown } | null
  if (!p || typeof p !== 'object') return null
  const x = num(p.x, NaN)
  const y = num(p.y, NaN)
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}
const list = <T,>(v: unknown, map: (item: unknown, i: number) => T | null): T[] =>
  Array.isArray(v) ? v.map(map).filter((x): x is T => x !== null) : []

/** План приходит из файла или из ссылки, поэтому проверяем каждую запись:
 *  нечисловые координаты и нулевые габариты ломают геометрию и рендер. */
export function normalizePlan(p: Partial<Plan>): Plan {
  const walls = list(p.walls, (raw, i) => {
    const w = raw as Partial<Plan['walls'][number]>
    const a = pt(w?.a)
    const b = pt(w?.b)
    if (!a || !b) return null
    const wall: Plan['walls'][number] = { id: typeof w.id === 'string' ? w.id : `w${i}`, a, b, thickness: Math.max(1, num(w.thickness, 10)) }
    // замок переживает перезагрузку и файл проекта
    if (w.locked === true) wall.locked = true
    return wall
  })
  const wallIds = new Set(walls.map((w) => w.id))
  return {
    version: 1,
    name: typeof p.name === 'string' ? p.name : 'План',
    walls,
    openings: list(p.openings, (raw, i) => {
      const o = raw as Partial<Plan['openings'][number]>
      if (!o || !wallIds.has(String(o.wallId))) return null
      const kind = o.kind === 'window' || o.kind === 'doorway' ? o.kind : 'door'
      return {
        id: typeof o.id === 'string' ? o.id : `o${i}`,
        kind,
        wallId: String(o.wallId),
        t: Math.min(1, Math.max(0, num(o.t, 0.5))),
        width: Math.max(1, num(o.width, 80)),
        hinge: o.hinge === 'b' ? 'b' : 'a',
        side: o.side === -1 ? -1 : 1,
      }
    }),
    furniture: list(p.furniture, (raw, i) => {
      const f = raw as Partial<Plan['furniture'][number]>
      if (!f || typeof f.type !== 'string') return null
      const c = pt(f)
      if (!c) return null
      return {
        ...f,
        id: typeof f.id === 'string' ? f.id : `f${i}`,
        type: f.type,
        x: c.x,
        y: c.y,
        w: Math.max(1, num(f.w, 50)),
        d: Math.max(1, num(f.d, 50)),
        rot: num(f.rot, 0),
      }
    }),
    rooms: list(p.rooms, (raw, i) => {
      const r = raw as Partial<Plan['rooms'][number]>
      const anchor = pt(r?.anchor)
      if (!r || !anchor) return null
      return {
        id: typeof r.id === 'string' ? r.id : `r${i}`,
        anchor,
        name: typeof r.name === 'string' ? r.name : 'Комната',
        floor: r.floor ?? 'laminate',
      }
    }),
    dims: list(p.dims, (raw, i) => {
      const d = raw as Partial<Plan['dims'][number]>
      const a = pt(d?.a)
      const b = pt(d?.b)
      if (!a || !b) return null
      const dim: Plan['dims'][number] = { id: typeof d.id === 'string' ? d.id : `d${i}`, a, b, offset: num(d.offset, 30) }
      // привязка к стене — только к той, что есть в плане
      const ref = (r: unknown): DimRef | undefined => {
        const x = r as Partial<DimRef> | undefined
        if (!x || typeof x.wallId !== 'string' || !wallIds.has(x.wallId)) return undefined
        const side = x.side === 1 || x.side === -1 ? x.side : 0
        return x.end === 'a' || x.end === 'b' ? { wallId: x.wallId, side, end: x.end } : { wallId: x.wallId, side }
      }
      const aRef = ref(d.aRef)
      const bRef = ref(d.bRef)
      if (aRef) dim.aRef = aRef
      if (bRef) dim.bRef = bRef
      return dim
    }),
    settings: { grid: Math.max(1, num(p.settings?.grid, 10)) },
    ...(underlayOf(p.underlay) ? { underlay: underlayOf(p.underlay)! } : {}),
  }
}

function underlayOf(v: unknown): Plan['underlay'] | null {
  const u = v as Partial<NonNullable<Plan['underlay']>> | null
  if (!u || typeof u.src !== 'string' || !u.src) return null
  const w = num(u.px?.w, 0)
  const h = num(u.px?.h, 0)
  if (!(w > 0) || !(h > 0)) return null
  return {
    src: u.src,
    px: { w, h },
    x: num(u.x, 0),
    y: num(u.y, 0),
    scale: Math.max(0.01, num(u.scale, 1)),
    opacity: Math.min(1, Math.max(0.05, num(u.opacity, 0.55))),
    visible: u.visible !== false,
    locked: !!u.locked,
  }
}
