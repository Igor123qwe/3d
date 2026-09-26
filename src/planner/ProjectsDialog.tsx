// «Мои проекты»: список планов в этом браузере — открыть, переименовать,
// скопировать, удалить. Текущий проект отмечен.
import React, { useEffect, useState } from 'react'
import { Icon } from './icons'
import { fmtArea } from './geometry'
import { whenText, type ProjectMeta } from './projects'

interface Props {
  projects: ProjectMeta[]
  currentId: string | null
  onOpen: (id: string) => void
  onNew: () => void
  onRename: (id: string, name: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}

export const ProjectsDialog: React.FC<Props> = ({ projects, currentId, onOpen, onNew, onRename, onDuplicate, onDelete, onClose }) => {
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (editing) setEditing(null)
      else if (confirm) setConfirm(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, confirm, onClose])

  const commitName = () => {
    if (editing && editing.name.trim()) onRename(editing.id, editing.name.trim())
    setEditing(null)
  }

  return (
    <div className="pl-ask-backdrop" onClick={onClose}>
      <div className="pl-ask pl-projects" role="dialog" aria-modal="true" aria-labelledby="pl-projects-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="pl-projects-title">Мои проекты</h2>
        <div className="pl-ask-text">Планы хранятся в этом браузере. Чтобы перенести на другое устройство — «Сохранить план в файл» или «Ссылка для телефона».</div>
        {projects.length === 0 && <div className="pl-note">Пока пусто.</div>}
        <ul className="pl-projects-list">
          {projects.map((p) => (
            <li key={p.id} className={p.id === currentId ? 'current' : ''}>
              {editing?.id === p.id ? (
                <input
                  autoFocus
                  className="pl-projects-name"
                  value={editing.name}
                  onChange={(e) => setEditing({ id: p.id, name: e.target.value })}
                  onBlur={commitName}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') commitName()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                />
              ) : (
                <button className="pl-projects-open" onClick={() => (p.id === currentId ? onClose() : onOpen(p.id))} title={p.id === currentId ? 'Открыт сейчас' : 'Открыть'}>
                  <b>{p.name || 'План'}</b>
                  <small>
                    {p.rooms ? `${p.rooms} комн. · ${fmtArea(p.areaM2)} · ` : ''}
                    {whenText(p.updatedAt)}
                    {p.id === currentId ? ' · открыт' : ''}
                  </small>
                </button>
              )}
              <span className="pl-projects-actions">
                <button className="pl-ibtn ghost" title="Переименовать" aria-label="Переименовать" onClick={() => setEditing({ id: p.id, name: p.name })}>
                  <Icon name="pencil" size={16} />
                </button>
                <button className="pl-ibtn ghost" title="Дублировать" aria-label="Дублировать" onClick={() => onDuplicate(p.id)}>
                  <Icon name="plus" size={16} />
                </button>
                {confirm === p.id ? (
                  <button className="pl-btn danger small" onClick={() => onDelete(p.id)}>
                    Удалить?
                  </button>
                ) : (
                  <button className="pl-ibtn ghost" title="Удалить" aria-label="Удалить" onClick={() => setConfirm(p.id)}>
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        <div className="pl-ask-foot">
          <button className="pl-btn ghost" onClick={onClose}>
            Закрыть
          </button>
          <button className="pl-btn primary" onClick={onNew}>
            <Icon name="plus" size={16} /> Новый проект
          </button>
        </div>
      </div>
    </div>
  )
}
