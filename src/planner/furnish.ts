// Расстановка мебели с ИИ по пожеланиям: вся квартира или одна комната.
//
// Вся квартира — два шага. Сначала короткий вопрос «какой комнате какое
// назначение» с учётом пожеланий («двое взрослых и ребёнок, нужен кабинет»),
// потом по вопросу на комнату: назначение, пожелания, остальные комнаты и то,
// что уже стоит. Каждый ответ проходит ту же проверку геометрией (vetLayout),
// что и раньше: предмет вне комнаты, на двери или поверх другого не ставится.
// Всё складывается в один план — одна правка в истории, Ctrl+Z убирает разом.
import type { AiCost, LayoutAsk, LayoutResult, ZonesAsk, ZonesResult } from './ai'
import type { Plan, Room } from './types'
import { CATALOG, CATALOG_MAP, isElectricItem } from './catalog'
import { applyLayout, catalogForRoom, layoutSummary, vetLayout } from './autolayout'
import { updateRoomMeta } from './ops'
import { isFixedPurpose, isSkippedForFurnish } from './roomkind'
import { lerp, pointInPoly } from './geometry'

export interface FurnishOptions {
  /** 'all' — вся квартира, иначе id комнаты */
  scope: 'all' | string
  wishes: string
  /** убрать мебель, что уже стоит в обставляемых комнатах */
  replace: boolean
  /** переименовать комнаты по назначению из зонирования */
  rename: boolean
  /** назначение одной комнаты, если его задали руками */
  purpose?: string
}

export interface FurnishDeps {
  zones: (ask: ZonesAsk) => Promise<ZonesResult>
  layout: (ask: LayoutAsk) => Promise<LayoutResult>
  onProgress?: (text: string) => void
  /** сколько комнат спрашивать одновременно */
  concurrency?: number
}

export interface FurnishRoomReport {
  id: string
  name: string
  purpose: string
  placed: number
  rejected: number
  summary: string
  why?: string
  error?: string
}

export interface FurnishReport {
  plan: Plan
  rooms: FurnishRoomReport[]
  costs: AiCost[]
  /** зонирование не удалось — назначения взяты из имён комнат */
  zoningFailed?: string
}

/** комнаты, которые не обставляют: балкон, лоджия, кладовая и совсем маленькие */
export const furnishable = (r: Room) => r.area >= 1.5 && !isSkippedForFurnish(r.meta.name)

const inRoom = (r: Room) => (f: { x: number; y: number }) => pointInPoly({ x: f.x, y: f.y }, r.polygon)

function bbox(r: Room): [number, number] {
  const xs = r.inner.map((p) => p.x)
  const ys = r.inner.map((p) => p.y)
  return [Math.round(Math.max(...xs) - Math.min(...xs)), Math.round(Math.max(...ys) - Math.min(...ys))]
}

/** двери и окна, выходящие в комнату: центр проёма у её контура */
function openingsNear(plan: Plan, r: Room) {
  return plan.openings.flatMap((op) => {
    const wall = plan.walls.find((w) => w.id === op.wallId)
    if (!wall) return []
    const c = lerp(wall.a, wall.b, op.t)
    const near = r.polygon.some((p, i) => {
      const q = r.polygon[(i + 1) % r.polygon.length]
      const L2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2
      const t = L2 ? Math.max(0, Math.min(1, ((c.x - p.x) * (q.x - p.x) + (c.y - p.y) * (q.y - p.y)) / L2)) : 0
      return Math.hypot(c.x - (p.x + (q.x - p.x) * t), c.y - (p.y + (q.y - p.y) * t)) < wall.thickness / 2 + 2
    })
    return near ? [{ kind: op.kind, x: c.x, y: c.y, width: op.width }] : []
  })
}

/** запускать задачи не больше n разом, порядок ответов — как у задач */
async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}

export async function furnish(plan: Plan, rooms: Room[], o: FurnishOptions, deps: FurnishDeps): Promise<FurnishReport> {
  const targets = o.scope === 'all' ? rooms.filter(furnishable) : rooms.filter((r) => r.meta.id === o.scope)
  if (!targets.length) throw new Error(o.scope === 'all' ? 'Нет комнат, которые можно обставить' : 'Комната не найдена')
  const costs: AiCost[] = []
  const wishes = o.wishes.trim()

  // 1. назначение комнат
  const purpose = new Map<string, { purpose: string; why?: string }>()
  for (const r of rooms) purpose.set(r.meta.id, { purpose: r.meta.name })
  let zoningFailed: string | undefined
  if (o.scope !== 'all') {
    if (o.purpose?.trim()) purpose.set(o.scope, { purpose: o.purpose.trim() })
  } else if (rooms.length >= 2 && wishes) {
    deps.onProgress?.('Решаю, какой комнате какое назначение…')
    const ids = rooms.map((_, i) => `r${i + 1}`)
    try {
      const z = await deps.zones({
        wishes,
        rooms: rooms.map((r, i) => {
          const ops = openingsNear(plan, r)
          return { id: ids[i], name: r.meta.name, areaM2: Math.round(r.area * 10) / 10, size: bbox(r), windows: ops.filter((x) => x.kind === 'window').length, doors: ops.filter((x) => x.kind !== 'window').length }
        }),
      })
      costs.push(z.ai)
      for (const zone of z.rooms) {
        const r = rooms[ids.indexOf(zone.id)]
        // кухню и санузел не переназначаем, даже если модель предложила
        if (r && !isFixedPurpose(r.meta.name)) purpose.set(r.meta.id, { purpose: zone.purpose, why: zone.why })
      }
    } catch (e) {
      zoningFailed = (e as Error).message
    }
  }

  // 2. расстановка по комнатам
  const apartment = rooms.map((r) => ({ room: r.meta.name, purpose: purpose.get(r.meta.id)?.purpose, areaM2: Math.round(r.area * 10) / 10 }))
  let done = 0
  const answers = await pool(targets, deps.concurrency ?? 3, async (r) => {
    const p = purpose.get(r.meta.id)!.purpose
    const existing = o.replace
      ? []
      : plan.furniture
          .filter((f) => !isElectricItem(f) && inRoom(r)(f))
          .map((f) => ({ type: f.type, name: CATALOG_MAP[f.type]?.name ?? f.type, x: f.x, y: f.y, w: f.w, d: f.d, rot: f.rot }))
    // Модели — чистовой контур (внутренние грани стен) в своей системе: от угла
    // комнаты, без многометровых смещений плана БТИ. По осям стен она ставила
    // шкаф «вплотную» — на полстены внутрь; в больших числах путалась
    const ox = Math.min(...r.inner.map((q) => q.x))
    const oy = Math.min(...r.inner.map((q) => q.y))
    const loc = <T extends { x: number; y: number }>(q: T): T => ({ ...q, x: Math.round(q.x - ox), y: Math.round(q.y - oy) })
    try {
      const res = await deps.layout({
        polygon: (r.inner.length >= 3 ? r.inner : r.polygon).map((q) => loc({ x: q.x, y: q.y })),
        openings: openingsNear(plan, r).map(loc),
        room: r.meta.name,
        purpose: p,
        areaM2: r.area,
        catalog: catalogForRoom(p, CATALOG),
        wishes: wishes || undefined,
        apartment,
        existing: existing.length ? existing.map(loc) : undefined,
      })
      // ответ — обратно в координаты плана
      return { ok: true as const, res: { ...res, items: res.items.map((it) => ({ ...it, x: it.x + ox, y: it.y + oy })) } }
    } catch (e) {
      return { ok: false as const, error: (e as Error).message }
    } finally {
      done++
      deps.onProgress?.(`Расставляю мебель: готово ${done} из ${targets.length}`)
    }
  })

  // 3. проверка геометрией и сборка плана: по порядку, чтобы соседние комнаты видели друг друга
  let acc = plan
  const report: FurnishRoomReport[] = []
  targets.forEach((r, i) => {
    const a = answers[i]
    const p = purpose.get(r.meta.id)!
    const base = { id: r.meta.id, name: r.meta.name, purpose: p.purpose, why: p.why }
    if (!a.ok) {
      report.push({ ...base, placed: 0, rejected: 0, summary: '', error: a.error })
      return
    }
    costs.push(a.res.ai)
    if (o.replace) acc = { ...acc, furniture: acc.furniture.filter((f) => isElectricItem(f) || !inRoom(r)(f)) }
    const checks = vetLayout(a.res.items, r, acc, { purpose: p.purpose })
    acc = applyLayout(acc, checks)
    const placed = checks.filter((c) => c.ok).length
    report.push({ ...base, placed, rejected: checks.length - placed, summary: layoutSummary(checks) })
    // имя меняем только если в комнате что-то встало: пустая «Детская» вводит в заблуждение
    if (o.rename && o.scope === 'all' && placed > 0 && p.purpose !== r.meta.name && !isFixedPurpose(r.meta.name)) acc = updateRoomMeta(acc, r.meta.id, { name: p.purpose })
  })
  return { plan: acc, rooms: report, costs, zoningFailed }
}
