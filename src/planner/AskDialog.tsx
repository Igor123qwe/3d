// Вопрос с вариантами вместо window.confirm: у каждого варианта своя подпись,
// видно, что произойдёт, и есть способ передумать. Так спрашивают Floorplanner
// и HomeByMe, когда новый файл может затереть открытый проект.
import React, { useEffect, useRef } from 'react'
import { Icon, type IconName } from './icons'

export interface AskOption {
  key: string
  label: string
  hint?: string
  icon?: IconName
  /** главный вариант: получает фокус и выделен рамкой */
  primary?: boolean
}

interface Props {
  title: string
  text?: React.ReactNode
  options: AskOption[]
  cancelLabel?: string
  onPick: (key: string) => void
  onCancel: () => void
}

export const AskDialog: React.FC<Props> = ({ title, text, options, cancelLabel = 'Отмена', onPick, onCancel }) => {
  const primary = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    primary.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const primaryIndex = Math.max(0, options.findIndex((o) => o.primary))
  return (
    <div className="pl-ask-backdrop" onClick={onCancel}>
      <div className="pl-ask" role="dialog" aria-modal="true" aria-labelledby="pl-ask-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="pl-ask-title">{title}</h2>
        {text && <p>{text}</p>}
        <div className="pl-ask-options">
          {options.map((o, i) => (
            <button key={o.key} ref={i === primaryIndex ? primary : undefined} className={`pl-ask-option ${o.primary ? 'primary' : ''}`} onClick={() => onPick(o.key)}>
              {o.icon && <Icon name={o.icon} size={20} />}
              <span>
                <b>{o.label}</b>
                {o.hint && <small>{o.hint}</small>}
              </span>
            </button>
          ))}
        </div>
        <div className="pl-ask-foot">
          <button className="pl-btn ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
