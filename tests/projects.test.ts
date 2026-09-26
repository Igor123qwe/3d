// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createProject, currentProjectId, deleteProject, duplicateProject, listProjects, loadProject, renameProject, saveProject, whenText } from '../src/planner/projects'
import { emptyPlan } from '../src/planner/types'

describe('мои проекты', () => {
  beforeEach(() => localStorage.clear())

  it('старый одиночный план становится первым проектом и открывается', () => {
    localStorage.setItem('boop.planner.plan.v1', JSON.stringify({ ...emptyPlan('Старый'), walls: [] }))
    const list = listProjects()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Старый')
    expect(currentProjectId()).toBe(list[0].id)
    expect(loadProject(list[0].id)?.name).toBe('Старый')
    expect(localStorage.getItem('boop.planner.plan.v1')).toBeNull()
  })

  it('создать, сохранить, переименовать, скопировать, удалить — список и текущий проект в порядке', () => {
    const a = createProject(emptyPlan('А'))
    const b = createProject(emptyPlan('Б'), { rooms: 2, areaM2: 40.26 })
    expect(listProjects().map((p) => p.name)).toEqual(['Б', 'А'])
    expect(currentProjectId()).toBe(b)
    expect(listProjects()[0].areaM2).toBe(40.3)
    saveProject(a, { ...emptyPlan('А2'), settings: { grid: 25 } }, { rooms: 1, areaM2: 10 })
    expect(listProjects()[0].id).toBe(a)
    expect(loadProject(a)?.settings.grid).toBe(25)
    renameProject(b, 'Дача')
    expect(loadProject(b)?.name).toBe('Дача')
    expect(listProjects().find((p) => p.id === b)?.name).toBe('Дача')
    const c = duplicateProject(b)!
    expect(loadProject(c)?.name).toBe('Дача (копия)')
    expect(currentProjectId()).toBe(c)
    deleteProject(c)
    expect(listProjects().map((p) => p.id).includes(c)).toBe(false)
    expect(currentProjectId()).not.toBe(c)
    deleteProject(a)
    deleteProject(b)
    expect(listProjects()).toEqual([])
    expect(currentProjectId()).toBeNull()
  })

  it('битый проект в хранилище не ломает список', () => {
    const a = createProject(emptyPlan('А'))
    localStorage.setItem(`boop.planner.project.${a}`, '{мусор')
    expect(loadProject(a)).toBeNull()
    expect(listProjects()).toHaveLength(1)
  })

  it('«когда» по-человечески', () => {
    const now = Date.parse('2026-09-26T12:00:00Z')
    expect(whenText(now - 20_000, now)).toBe('только что')
    expect(whenText(now - 5 * 60_000, now)).toBe('5 мин назад')
    expect(whenText(now - 3 * 3_600_000, now)).toBe('3 ч назад')
    expect(whenText(now - 26 * 3_600_000, now)).toBe('вчера')
  })
})
