import { useCallback, useRef, useState } from 'react'
import type { Plan } from './types'

interface Hist {
  past: Plan[]
  present: Plan
  future: Plan[]
}

const LIMIT = 100

export interface PlanHistory {
  plan: Plan
  canUndo: boolean
  canRedo: boolean
  /** атомарное изменение с записью в историю */
  apply: (fn: (p: Plan) => Plan) => void
  /** изменение без записи в историю (перетаскивание); первый вызов запоминает исходное состояние */
  preview: (next: Plan | ((p: Plan) => Plan)) => void
  /** завершить перетаскивание — исходное состояние уходит в историю */
  endPreview: () => void
  cancelPreview: () => void
  /** тихое обновление (служебные данные), без истории */
  silent: (fn: (p: Plan) => Plan) => void
  undo: () => void
  redo: () => void
  replace: (plan: Plan) => void
}

/**
 * follow — что пересчитать после каждой правки: размеры, привязанные к
 * стенам, переезжают следом (prev — план до правки, next — после)
 */
export function usePlanHistory(initial: () => Plan, follow: (prev: Plan, next: Plan) => Plan = (_, next) => next): PlanHistory {
  const [h, setH] = useState<Hist>(() => ({ past: [], present: initial(), future: [] }))
  const presentRef = useRef(h.present)
  presentRef.current = h.present
  const dragStart = useRef<Plan | null>(null)

  const apply = useCallback((fn: (p: Plan) => Plan) => {
    setH((s) => {
      const raw = fn(s.present)
      if (raw === s.present) return s
      const next = follow(s.present, raw)
      return { past: [...s.past.slice(-LIMIT + 1), s.present], present: next, future: [] }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useCallback((next: Plan | ((p: Plan) => Plan)) => {
    if (!dragStart.current) dragStart.current = presentRef.current
    const start = dragStart.current
    // перетаскивание считается от исходного плана: от него же и следуют размеры
    setH((s) => ({ ...s, present: typeof next === 'function' ? follow(s.present, next(s.present)) : follow(start, next) }))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const endPreview = useCallback(() => {
    const start = dragStart.current
    dragStart.current = null
    if (!start) return
    setH((s) => {
      if (start === s.present) return s
      return { past: [...s.past.slice(-LIMIT + 1), start], present: s.present, future: [] }
    })
  }, [])

  const cancelPreview = useCallback(() => {
    const start = dragStart.current
    dragStart.current = null
    if (start) setH((s) => ({ ...s, present: start }))
  }, [])

  const silent = useCallback((fn: (p: Plan) => Plan) => {
    setH((s) => {
      const next = fn(s.present)
      return next === s.present ? s : { ...s, present: next }
    })
  }, [])

  const undo = useCallback(() => {
    dragStart.current = null
    setH((s) => {
      if (!s.past.length) return s
      const prev = s.past[s.past.length - 1]
      return { past: s.past.slice(0, -1), present: prev, future: [s.present, ...s.future] }
    })
  }, [])

  const redo = useCallback(() => {
    dragStart.current = null
    setH((s) => {
      if (!s.future.length) return s
      const [next, ...rest] = s.future
      return { past: [...s.past.slice(-LIMIT + 1), s.present], present: next, future: rest }
    })
  }, [])

  const replace = useCallback((plan: Plan) => {
    dragStart.current = null
    setH({ past: [], present: plan, future: [] })
  }, [])

  return {
    plan: h.present,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    apply,
    preview,
    endPreview,
    cancelPreview,
    silent,
    undo,
    redo,
    replace,
  }
}
