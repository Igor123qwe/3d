// Выпадающее меню в духе настольных приложений: иконка, подпись, подсказка
// с сочетанием клавиш, разделители и пункты-переключатели.
import React from 'react'
import { Icon, type IconName } from './icons'

interface DropdownProps {
  /** ширина в пикселях; по умолчанию как у обычного меню */
  width?: number
  children: React.ReactNode
  /** к какому краю шапки прижимать */
  align?: 'right' | 'left'
  /** смещение от правого края, чтобы меню вставало под своей кнопкой */
  offset?: number
}

export const Dropdown: React.FC<DropdownProps> = ({ width = 280, children, align = 'right', offset = 10 }) => (
  <div className="pl-menu" role="menu" style={{ width, [align]: offset }}>
    {children}
  </div>
)

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
