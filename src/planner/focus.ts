// Клавиатура в диалоге: фокус входит в диалог при открытии, Tab ходит по
// кругу внутри него, при закрытии возвращается туда, откуда пришли.
import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * @param ref контейнер диалога
 * @param initial что взять в фокус при открытии; нет — первый элемент
 */
export function useFocusTrap(ref: RefObject<HTMLElement>, initial?: RefObject<HTMLElement>, active = true): void {
  useEffect(() => {
    const root = ref.current
    if (!root || !active) return
    const before = document.activeElement as HTMLElement | null
    const items = () => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
    const first = initial?.current ?? items()[0]
    // фокус после отрисовки: автофокус полей внутри диалога важнее
    const t = setTimeout(() => {
      if (!root.contains(document.activeElement)) first?.focus()
    }, 0)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const list = items()
      if (!list.length) return
      const i = list.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey && (i <= 0 || !root.contains(document.activeElement))) {
        e.preventDefault()
        list[list.length - 1].focus()
      } else if (!e.shiftKey && (i === list.length - 1 || !root.contains(document.activeElement))) {
        e.preventDefault()
        list[0].focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey, true)
      if (before && document.contains(before)) before.focus()
    }
  }, [ref, initial, active])
}
