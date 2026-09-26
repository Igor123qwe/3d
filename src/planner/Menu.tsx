// Выпадающее меню в духе настольных приложений: иконка, подпись, подсказка
// с сочетанием клавиш, разделители и пункты-переключатели.
import React, { useEffect, useRef } from 'react'
import { Icon, type IconName } from './icons'

interface DropdownProps {
  /** ширина в пикселях; по умолчанию как у обычного меню */
  width?: number
  children: React.ReactNode
  /** к какому краю шапки прижимать */
  align?: 'right' | 'left'
  /** смещение от правого края, чтобы меню вставало под своей кнопкой */
  offset?: number
  /** Esc — закрыть; фокус возвращается на кнопку, которая открыла меню */
  onClose?: () => void
}

/** Меню ходит с клавиатуры: ↑ ↓ по пунктам, Home/End, Esc — закрыть */
export const Dropdown: React.FC<DropdownProps> = ({ width = 280, children, align = 'right', offset = 10, onClose }) => {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = box.current
    if (!root) return
    const opener = document.activeElement as HTMLElement | null
    const items = () => [...root.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])')]
    const t = setTimeout(() => items()[0]?.focus(), 0)
    const onKey = (e: KeyboardEvent) => {
      const list = items()
      const i = list.indexOf(document.activeElement as HTMLElement)
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose?.()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!list.length) return
        const step = e.key === 'ArrowDown' ? 1 : -1
        list[(i + step + list.length) % list.length].focus()
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault()
        list[e.key === 'Home' ? 0 : list.length - 1]?.focus()
      }
    }
    root.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      root.removeEventListener('keydown', onKey)
      if (opener && document.contains(opener) && root.contains(document.activeElement)) opener.focus()
    }
  }, [onClose])
  return (
    <div ref={box} className="pl-menu" role="menu" style={{ width, [align]: offset }}>
      {children}
    </div>
  )
}

export const MenuGroup: React.FC<{ title: string }> = ({ title }) => <div className="pl-menu-title">{title}</div>

export const MenuSep: React.FC = () => <div className="pl-menu-sep" role="separator" />

interface MenuItemProps {
  icon?: IconName
  label: React.ReactNode
  /** подсказка справа: сочетание клавиш или пояснение */
  hint?: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  /** пункт-переключатель: показываем галочку вместо иконки */
  checked?: boolean
  /** пункт, который открывает подменю или диалог: многоточие уже в подписи, стрелка не нужна */
  accent?: boolean
}

export const MenuItem: React.FC<MenuItemProps> = ({ icon, label, hint, onSelect, disabled, danger, checked, accent }) => (
  <button
    type="button"
    role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
    aria-checked={checked}
    className={`pl-menu-item${danger ? ' danger' : ''}${accent ? ' accent' : ''}${checked ? ' checked' : ''}`}
    onClick={onSelect}
    disabled={disabled}
  >
    <span className="pl-menu-icon">
      {checked !== undefined ? <span className={`pl-menu-check${checked ? ' on' : ''}`} /> : icon ? <Icon name={icon} size={18} /> : null}
    </span>
    <span className="pl-menu-label">{label}</span>
    {hint && <kbd className="pl-menu-hint">{hint}</kbd>}
  </button>
)

/** Ряд переключателей внутри меню: единицы, шаг сетки */
export const MenuChoice = <T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}): React.ReactElement => (
  <div className="pl-menu-choice" role="radiogroup">
    {options.map((o) => (
      <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} className={`pl-chip${o.value === value ? ' active' : ''}`} onClick={() => onChange(o.value)}>
        {o.label}
      </button>
    ))}
  </div>
)
