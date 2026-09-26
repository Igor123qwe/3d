// Несколько проектов в одном браузере.
//
// Раньше в localStorage жил один план под ключом boop.planner.plan.v1, и
// «Новый…» затирал его. Теперь есть список проектов: у каждого свой ключ,
// в списке — имя, дата и краткая сводка. Старый одиночный план при первом
// запуске становится первым проектом.
import type { Plan } from './types'
import { normalizePlan } from './exporters'

export interface ProjectMeta {
  id: string
  name: string
  /** когда сохраняли в последний раз, мс */
  updatedAt: number
  rooms: number
  areaM2: number
}

const LEGACY = 'boop.planner.plan.v1'
const INDEX = 'boop.planner.projects.v1'
const CURRENT = 'boop.planner.current.v1'
const key = (id: string) => `boop.planner.project.${id}`

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k: string, v: string): boolean => {
  try {
    localStorage.setItem(k, v)
    return true
  } catch {
    return false
  }
}
const remove = (k: string) => {
  try {
    localStorage.removeItem(k)
  } catch {
    /* пусто */
  }
}

export const newProjectId = (): string => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** список проектов, свежие сверху */
export function listProjects(): ProjectMeta[] {
  migrateLegacy()
  try {
    const raw = read(INDEX)
    const list = raw ? (JSON.parse(raw) as ProjectMeta[]) : []
    return Array.isArray(list) ? list.filter((p) => p && typeof p.id === 'string').sort((a, b) => b.updatedAt - a.updatedAt) : []
  } catch {
    return []
  }
}

function writeIndex(list: ProjectMeta[]): void {
  write(INDEX, JSON.stringify(list))
}

/** старый одиночный план → первый проект; повторный вызов ничего не делает */
export function migrateLegacy(): void {
  const raw = read(LEGACY)
  if (!raw) return
  const id = newProjectId()
  if (!write(key(id), raw)) return
  let meta: ProjectMeta = { id, name: 'План', updatedAt: Date.now(), rooms: 0, areaM2: 0 }
  try {
    const p = JSON.parse(raw) as Partial<Plan>
    meta = { ...meta, name: typeof p.name === 'string' ? p.name : 'План' }
  } catch {
    /* сводка пустая, план всё равно открывается */
  }
  const list = (() => {
    try {
      const cur = read(INDEX)
      return cur ? (JSON.parse(cur) as ProjectMeta[]) : []
    } catch {
      return []
    }
  })()
  writeIndex([meta, ...list])
  write(CURRENT, id)
  remove(LEGACY)
}

export function currentProjectId(): string | null {
  migrateLegacy()
  const id = read(CURRENT)
  return id && read(key(id)) ? id : (listProjects()[0]?.id ?? null)
}

export function setCurrentProject(id: string): void {
  write(CURRENT, id)
}

export function loadProject(id: string): Plan | null {
  const raw = read(key(id))
  if (!raw) return null
  try {
    return normalizePlan(JSON.parse(raw))
  } catch {
    return null
  }
}

/**
 * Сохранить план проекта и обновить строку в списке. Исходное фото подложки
 * может не поместиться — тогда сохраняем без него. false — не поместился и так
 */
export function saveProject(id: string, plan: Plan, summary: { rooms: number; areaM2: number }): boolean {
  let ok = write(key(id), JSON.stringify(plan))
  if (!ok && plan.underlay?.original) ok = write(key(id), JSON.stringify({ ...plan, underlay: { ...plan.underlay, original: undefined } }))
  if (!ok) return false
  const meta: ProjectMeta = { id, name: plan.name || 'План', updatedAt: Date.now(), rooms: summary.rooms, areaM2: Math.round(summary.areaM2 * 10) / 10 }
  const list = listProjects().filter((p) => p.id !== id)
  writeIndex([meta, ...list])
  write(CURRENT, id)
  return true
}

/** новый проект из плана; становится текущим */
export function createProject(plan: Plan, summary: { rooms: number; areaM2: number } = { rooms: 0, areaM2: 0 }): string {
  const id = newProjectId()
  saveProject(id, plan, summary)
  return id
}

export function deleteProject(id: string): void {
  remove(key(id))
  writeIndex(listProjects().filter((p) => p.id !== id))
  if (read(CURRENT) === id) {
    const next = listProjects()[0]
    if (next) write(CURRENT, next.id)
    else remove(CURRENT)
  }
}

export function renameProject(id: string, name: string): void {
  const plan = loadProject(id)
  if (!plan) return
  write(key(id), JSON.stringify({ ...plan, name }))
  writeIndex(listProjects().map((p) => (p.id === id ? { ...p, name } : p)))
}

/** копия проекта с новым именем; становится текущей */
export function duplicateProject(id: string): string | null {
  const plan = loadProject(id)
  const meta = listProjects().find((p) => p.id === id)
  if (!plan || !meta) return null
  return createProject({ ...plan, name: `${plan.name} (копия)` }, { rooms: meta.rooms, areaM2: meta.areaM2 })
}

/** «5 минут назад», «вчера», «12 сентября» */
export function whenText(ms: number, now = Date.now()): string {
  const d = now - ms
  const min = Math.round(d / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} ч назад`
  const days = Math.round(h / 24)
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} дн назад`
  return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}
