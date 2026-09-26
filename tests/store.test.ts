// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { usePlanHistory } from '../src/planner/store'
import { addWall } from '../src/planner/ops'
import { emptyPlan, type Plan } from '../src/planner/types'

const wall = (p: Plan, x: number) => addWall(p, { x, y: 0 }, { x: x + 100, y: 0 }, 20)
const setup = () => renderHook(() => usePlanHistory(() => emptyPlan()))

describe('история изменений', () => {
  it('отмена и повтор возвращают состояние', () => {
    const { result } = setup()
    expect(result.current.canUndo).toBe(false)
    act(() => result.current.apply((p) => wall(p, 0)))
    expect(result.current.plan.walls.length).toBe(1)
    expect(result.current.canUndo).toBe(true)
    act(() => result.current.undo())
    expect(result.current.plan.walls.length).toBe(0)
    expect(result.current.canRedo).toBe(true)
    act(() => result.current.redo())
    expect(result.current.plan.walls.length).toBe(1)
  })

  it('новое действие стирает отменённое будущее', () => {
    const { result } = setup()
    act(() => result.current.apply((p) => wall(p, 0)))
    act(() => result.current.undo())
    expect(result.current.canRedo).toBe(true)
    act(() => result.current.apply((p) => wall(p, 500)))
    expect(result.current.canRedo).toBe(false)
  })

  it('перетаскивание пишет в историю один шаг', () => {
    const { result } = setup()
    act(() => result.current.apply((p) => wall(p, 0)))
    act(() => result.current.preview((p) => wall(p, 200)))
    act(() => result.current.preview((p) => ({ ...p, walls: [p.walls[0], { ...p.walls[1], b: { x: 400, y: 0 } }] })))
    act(() => result.current.endPreview())
    expect(result.current.plan.walls.length).toBe(2)
    act(() => result.current.undo())
    expect(result.current.plan.walls.length).toBe(1) // один шаг отмены, а не два
  })

  it('отмена перетаскивания возвращает исходное состояние', () => {
    const { result } = setup()
    act(() => result.current.apply((p) => wall(p, 0)))
    act(() => result.current.preview((p) => wall(p, 200)))
    act(() => result.current.cancelPreview())
    expect(result.current.plan.walls.length).toBe(1)
  })

  it('тихое изменение не попадает в историю', () => {
    const { result } = setup()
    act(() => result.current.silent((p) => ({ ...p, name: 'Новое имя' })))
    expect(result.current.plan.name).toBe('Новое имя')
    expect(result.current.canUndo).toBe(false)
  })

  it('замена плана очищает историю', () => {
    const { result } = setup()
    act(() => result.current.apply((p) => wall(p, 0)))
    act(() => result.current.replace(emptyPlan()))
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
    expect(result.current.plan.walls.length).toBe(0)
  })

  it('изменение, не меняющее план, не засоряет историю', () => {
    const { result } = setup()
    act(() => result.current.apply((p) => p))
    expect(result.current.canUndo).toBe(false)
  })
})

describe('серия мелких правок', () => {
  it('стрелки: десять сдвигов — одна запись в истории, отмена возвращает к началу серии', async () => {
    const { result } = setup()
    act(() => result.current.apply((p) => wall(p, 0)))
    const before = result.current.plan
    for (let i = 0; i < 10; i++) act(() => result.current.nudge((p) => ({ ...p, walls: p.walls.map((w) => ({ ...w, a: { ...w.a, x: w.a.x + 1 } })) }), 50))
    expect(result.current.plan.walls[0].a.x).toBe(10)
    await act(() => new Promise((r) => setTimeout(r, 80)))
    act(() => result.current.undo())
    expect(result.current.plan).toBe(before)
    act(() => result.current.redo())
    expect(result.current.plan.walls[0].a.x).toBe(10)
  })

  it('правка посреди серии закрывает серию своей записью', () => {
    const { result } = setup()
    act(() => result.current.apply((p) => wall(p, 0)))
    act(() => result.current.nudge((p) => ({ ...p, walls: p.walls.map((w) => ({ ...w, a: { ...w.a, x: 5 } })) }), 1000))
    act(() => result.current.apply((p) => wall(p, 300)))
    expect(result.current.plan.walls).toHaveLength(2)
    act(() => result.current.undo())
    expect(result.current.plan.walls).toHaveLength(1)
    expect(result.current.plan.walls[0].a.x).toBe(5)
    act(() => result.current.undo())
    expect(result.current.plan.walls[0].a.x).toBe(0)
  })
})
