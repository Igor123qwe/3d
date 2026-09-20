// Стартовый экран «С чего начнём?».
//
// У Floorplanner, RoomSketcher и HomeByMe первый экран — не пустой холст с меню
// «Файл», а понятный выбор: загрузить свой план, взять шаблон, нарисовать с нуля
// или продолжить прошлый. Здесь то же самое. Загрузка плана — главное действие,
// поэтому её карточка самая большая и принимает файл перетаскиванием.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Layers, Plan } from './types'
import type { Template } from './templates'
import { buildRooms } from './rooms'
import { runChecks } from './checks'
import { Scene, planBounds } from './Scene'
import { fmtArea } from './geometry'
import { Icon } from './icons'

/** слои для миниатюры: только стены, полы и мебель, без подписей и размеров */
const THUMB_LAYERS: Layers = { grid: false, underlay: false, rooms: true, furniture: true, electric: false, dims: false, ergo: false, labels: false }

export interface RecentPlan {
  name: string
  rooms: number
  areaM2: number
}

interface Props {
  open: boolean
  /** есть что показывать за диалогом — можно закрыть крестиком и Esc */
  canClose: boolean
  templates: Template[]
  recent: RecentPlan | null
  aiEnabled: boolean
  onClose: () => void
  onTemplate: (key: string) => void
  onPickFile: () => void
  onPaste: () => void
}

/** «1-комнатная 37 м²» → название и площадь отдельными строками, чтобы дефис не ломал строку посередине */
export function splitTemplateName(name: string): [string, string] {
  const m = /^(.*?)\s+(\d+(?:[.,]\d+)?\s*м²)$/.exec(name)
  return m ? [m[1], m[2]] : [name, '']
}

/** Миниатюра шаблона: настоящий план, отрисованный той же сценой, что и холст */
const Thumb: React.FC<{ plan: Plan }> = ({ plan }) => {
  const view = useMemo(() => {
    const { rooms } = buildRooms(plan)
    const check = runChecks(plan, rooms)
    const b = planBounds(plan)
    return { rooms, check, b }
  }, [plan])
  if (!view.b) return <div className="pl-start-thumb empty" />
  const pad = 40
  const w = view.b.maxX - view.b.minX + pad * 2
  const h = view.b.maxY - view.b.minY + pad * 2
  return (
    <svg className="pl-start-thumb" viewBox={`${view.b.minX - pad} ${view.b.minY - pad} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <Scene plan={plan} rooms={view.rooms} check={view.check} layers={THUMB_LAYERS} unit="cm" zoom={0.25} />
    </svg>
  )
}

export const StartDialog: React.FC<Props> = ({ open, canClose, templates, recent, aiEnabled, onClose, onTemplate, onPickFile, onPaste }) => {
  const [over, setOver] = useState(false)
  const zoneRef = useRef<HTMLDivElement>(null)
  // шаблоны строим один раз: их геометрия не меняется
  const built = useMemo(() => templates.filter((t) => t.key !== 'empty').map((t) => ({ t, plan: t.build() })), [templates])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && canClose) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, canClose, onClose])

  if (!open) return null

  return (
    <div className="pl-start-backdrop" onClick={canClose ? onClose : undefined}>
      <div className="pl-start" role="dialog" aria-modal="true" aria-labelledby="pl-start-title" onClick={(e) => e.stopPropagation()}>
        <header className="pl-start-head">
          <div>
            <h1 id="pl-start-title">С чего начнём?</h1>
            <p>Загрузите план квартиры, возьмите шаблон или нарисуйте с нуля. Всё сохраняется в браузере само.</p>
          </div>
          {canClose && (
            <button className="pl-ibtn ghost" onClick={onClose} aria-label="Закрыть" title="Закрыть (Esc)">
              <Icon name="close" />
            </button>
          )}
        </header>

        <div className="pl-start-grid">
          {/* главный сценарий: свой план */}
          <section
            ref={zoneRef}
            className={`pl-start-card primary${over ? ' over' : ''}`}
            onDragEnter={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
            }}
            onDragLeave={(e) => {
              if (!zoneRef.current?.contains(e.relatedTarget as Node)) setOver(false)
            }}
            onDrop={(e) => {
              // сам файл принимает общий приёмник на окне: у него один путь для
              // всех способов загрузки. Здесь только гасим подсветку зоны.
              e.preventDefault()
              setOver(false)
            }}
          >
            <div className="pl-start-drop">
              <Icon name="upload" size={40} stroke={1.4} />
              <h2>Загрузить свой план</h2>
              <p>Перетащите сюда скриншот или фото плана — из БТИ, от застройщика, с сайта объявления. Подойдёт и сохранённый файл плана.</p>
              <div className="pl-start-actions">
                <button className="pl-btn primary" onClick={onPickFile}>
                  <Icon name="image" size={18} /> Выбрать файл
                </button>
                <button className="pl-btn" onClick={onPaste} title="Скопируйте скриншот и нажмите здесь или Ctrl+V">
                  <Icon name="clipboard" size={18} /> Вставить из буфера
                  <kbd>Ctrl+V</kbd>
                </button>
              </div>
              <p className="pl-start-note">
                {aiEnabled
                  ? 'Стены, двери, окна и подписи комнат распознаются автоматически, масштаб встанет по размерам с плана.'
                  : 'Стены обводятся по линиям картинки, масштаб задаётся по одному известному размеру.'}
              </p>
            </div>
          </section>

          {/* шаблоны с настоящими миниатюрами */}
          <section className="pl-start-card">
            <h2>
              <Icon name="template" size={18} /> Начать с шаблона
            </h2>
            <div className="pl-start-templates">
              {built.map(({ t, plan }) => (
                <button key={t.key} className="pl-start-template" onClick={() => onTemplate(t.key)} title={t.desc}>
                  <Thumb plan={plan} />
                  <span className="pl-start-template-name">{splitTemplateName(t.name)[0]}</span>
                  <span className="pl-start-template-area">{splitTemplateName(t.name)[1]}</span>
                </button>
              ))}
            </div>
          </section>

          {/* с нуля */}
          <section className="pl-start-card">
            <h2>
              <Icon name="pencil" size={18} /> Нарисовать самому
            </h2>
            <p>Инструмент «Комната» тянет прямоугольник, «Стена» ведёт по точкам. Двери и окна прилипают к стенам.</p>
            <button className="pl-btn" onClick={() => onTemplate('empty')}>
              <Icon name="plus" size={18} /> Пустой лист
            </button>
          </section>

          {/* продолжить прошлый */}
          {recent && (
            <section className="pl-start-card">
              <h2>
                <Icon name="history" size={18} /> Продолжить
              </h2>
              <p>
                <b>{recent.name}</b>
                <br />
                {recent.rooms ? `${recent.rooms} ${recent.rooms === 1 ? 'комната' : recent.rooms < 5 ? 'комнаты' : 'комнат'} · ${fmtArea(recent.areaM2)}` : 'Пустой план'}
              </p>
              <button className="pl-btn" onClick={onClose}>
                <Icon name="arrowLeft" size={18} /> Открыть последний план
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
