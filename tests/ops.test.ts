import { describe, expect, it } from 'vitest'
import {
  addDim,
  addFurniture,
  addOpening,
  addRect,
  addWall,
  cleanupWalls,
  deleteSelection,
  duplicateFurniture,
  isEmptyPlan,
  moveNodes,
  nudgeFurniture,
  rotateFurniture,
  setWallLength,
  updateFurniture,
  updateRoomMeta,
} from '../src/planner/ops'
import { CATALOG_MAP } from '../src/planner/catalog'
import { buildRooms } from '../src/planner/rooms'
import { emptyPlan, type Plan } from '../src/planner/types'
import { dist } from '../src/planner/geometry'

const rect = (): Plan => addRect(emptyPlan(), { x: 0, y: 0 }, { x: 600, y: 400 }, 20)

describe('стены', () => {
  it('прямоугольник — четыре стены', () => {
    expect(rect().walls.length).toBe(4)
  })

  it('повторный прямоугольник не дублирует стены', () => {
    const p = addRect(rect(), { x: 0, y: 0 }, { x: 600, y: 400 }, 20)
    expect(p.walls.length).toBe(4)
  })

  it('слишком маленький прямоугольник игнорируется', () => {
    expect(addRect(emptyPlan(), { x: 0, y: 0 }, { x: 5, y: 5 }, 20).walls.length).toBe(0)
  })

  it('стена нулевой длины не добавляется', () => {
    expect(addWall(emptyPlan(), { x: 10, y: 10 }, { x: 10, y: 10 }, 20).walls.length).toBe(0)
  })

  it('сдвиг узла тянет обе смежные стены', () => {
    const p = rect()
    const moved = moveNodes(p, [{ from: { x: 600, y: 0 }, to: { x: 700, y: 0 } }])
    const touching = moved.walls.filter((w) => w.a.x === 700 || w.b.x === 700)
    expect(touching.length).toBe(2)
  })

  it('задание длины стены двигает её конец', () => {
    const p = rect()
    const top = p.walls.find((w) => w.a.y === 0 && w.b.y === 0)!
    const after = setWallLength(p, top.id, 800)
    const updated = after.walls.find((w) => w.id === top.id)!
    expect(Math.round(dist(updated.a, updated.b))).toBe(800)
  })

  it('удаление стены разрывает комнату', () => {
    const p = rect()
    expect(buildRooms(p).rooms.length).toBe(1)
    const after = deleteSelection(p, { kind: 'wall', id: p.walls[0].id })
    expect(buildRooms(after).rooms.length).toBe(0)
  })
})

describe('проёмы', () => {
  it('проём привязывается к стене и получает сторону открывания', () => {
    const p = rect()
    const rooms = buildRooms(p).rooms
    const top = p.walls.find((w) => w.a.y === 0 && w.b.y === 0)!
    const { plan, id } = addOpening(p, 'door', top.id, 0.5, 90, rooms)
    expect(id).toBeTruthy()
    const op = plan.openings.find((o) => o.id === id)!
    expect(op.wallId).toBe(top.id)
    expect([1, -1]).toContain(op.side)
  })

  it('проём на несуществующей стене не создаётся', () => {
    const { id } = addOpening(rect(), 'door', 'нет-такой', 0.5, 90, [])
    expect(id).toBe('')
  })

  it('удаление стены убирает её проёмы', () => {
    const p = rect()
    const top = p.walls.find((w) => w.a.y === 0 && w.b.y === 0)!
    const withDoor = addOpening(p, 'door', top.id, 0.5, 90, buildRooms(p).rooms).plan
    const after = deleteSelection(withDoor, { kind: 'wall', id: top.id })
    expect(after.openings.length).toBe(0)
  })

  it('проём прижимается внутрь стены при укорачивании', () => {
    const p = rect()
    const top = p.walls.find((w) => w.a.y === 0 && w.b.y === 0)!
    const withDoor = addOpening(p, 'door', top.id, 0.95, 90, buildRooms(p).rooms).plan
    const shortened = cleanupWalls(setWallLength(withDoor, top.id, 200))
    const op = shortened.openings[0]
    expect(op.t * 200).toBeLessThanOrEqual(200 - op.width / 2 + 0.01)
  })

  it('стена короче проёма — проём удаляется', () => {
    const p = rect()
    const top = p.walls.find((w) => w.a.y === 0 && w.b.y === 0)!
    const withDoor = addOpening(p, 'door', top.id, 0.5, 90, buildRooms(p).rooms).plan
    const tiny = cleanupWalls(setWallLength(withDoor, top.id, 50))
    expect(tiny.openings.length).toBe(0)
  })
})

describe('мебель', () => {
  const withSofa = () => addFurniture(rect(), CATALOG_MAP['sofa-3'], 300, 200, 0)

  it('добавление берёт размеры из каталога', () => {
    const { plan, id } = withSofa()
    const f = plan.furniture.find((x) => x.id === id)!
    expect(f.w).toBe(CATALOG_MAP['sofa-3'].w)
    expect(f.d).toBe(CATALOG_MAP['sofa-3'].d)
  })

  it('поворот нормализуется к 0..360', () => {
    const { plan, id } = withSofa()
    expect(rotateFurniture(plan, id, -90).furniture[0].rot).toBe(270)
    expect(rotateFurniture(rotateFurniture(plan, id, 180), id, 270).furniture[0].rot).toBe(90)
  })

  it('дублирование ставит копию вдоль ширины', () => {
    const { plan, id } = withSofa()
    const r = duplicateFurniture(plan, id)
    expect(r.plan.furniture.length).toBe(2)
    const [a, b] = r.plan.furniture
    expect(Math.round(b.x - a.x)).toBe(a.w + 10)
  })

  it('сдвиг стрелками', () => {
    const { plan, id } = withSofa()
    const moved = nudgeFurniture(plan, id, -10, 5)
    expect(moved.furniture[0].x).toBe(290)
    expect(moved.furniture[0].y).toBe(205)
  })

  it('удаление предмета', () => {
    const { plan, id } = withSofa()
    expect(deleteSelection(plan, { kind: 'furniture', id }).furniture.length).toBe(0)
  })

  it('обновление не трогает другие предметы', () => {
    const first = withSofa()
    const second = addFurniture(first.plan, CATALOG_MAP.chair, 100, 100, 0)
    const after = updateFurniture(second.plan, first.id, { w: 500 })
    expect(after.furniture.find((f) => f.id === second.id)!.w).toBe(CATALOG_MAP.chair.w)
  })
})

describe('прочее', () => {
  it('переименование комнаты', () => {
    const p = rect()
    const { metas } = buildRooms(p)
    const withMeta: Plan = { ...p, rooms: metas }
    const after = updateRoomMeta(withMeta, metas[0].id, { name: 'Кабинет' })
    expect(after.rooms[0].name).toBe('Кабинет')
  })

  it('размерная линия добавляется и удаляется', () => {
    const p = addDim(emptyPlan(), { x: 0, y: 0 }, { x: 100, y: 0 })
    expect(p.dims.length).toBe(1)
    expect(deleteSelection(p, { kind: 'dim', id: p.dims[0].id }).dims.length).toBe(0)
  })

  it('пустой план распознаётся', () => {
    expect(isEmptyPlan(emptyPlan())).toBe(true)
    expect(isEmptyPlan(rect())).toBe(false)
  })
})
