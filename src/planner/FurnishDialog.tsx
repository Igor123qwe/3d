// Диалог «Расставить мебель с ИИ»: пожелания своими словами, вся квартира
// или одна комната, заменить стоящую мебель или дополнить. После прогона —
// отчёт по комнатам: что поставлено, что отброшено проверкой и почему.
import React, { useEffect, useRef, useState } from 'react'
import { ROOM_PURPOSES } from './aicontract'
import { friendlyAiError } from './ai'
import { useFocusTrap } from './focus'
import type { FurnishOptions, FurnishReport } from './furnish'

const LS_WISHES = 'boop.planner.wishes'

/** быстрые добавки к пожеланиям: щелчок дописывает фразу */
const WISH_CHIPS = [
  'двое взрослых и ребёнок',
  'рабочее место на двоих',
  'много хранения',
  'гости остаются ночевать',
  'обеденный стол на 6 человек',
  'кровать 160 × 200',
  'минимум мебели, больше места',
  'кошка или собака',
  'стиль — скандинавский',
]

interface Props {
  rooms: { id: string; name: string; area: number }[]
  initialScope: 'all' | string
  aiEnabled: boolean
  /** почему ИИ выключен — как сообщил сервер */
  aiHint?: string
  onRun: (o: FurnishOptions, progress: (text: string) => void) => Promise<FurnishReport | null>
  onClose: () => void
  /** «Отменить» в отчёте: убрать расстановку одной отменой */
  onUndo?: () => void
}

/** выбор модели запоминается: тщательно — сильная, быстро — дешёвая */
const LS_QUALITY = 'boop.planner.furnishQuality'
const readQuality = (): 'fast' | 'best' => {
  try {
    return localStorage.getItem(LS_QUALITY) === 'fast' ? 'fast' : 'best'
  } catch {
    return 'best'
  }
}

const readWishes = () => {
  try {
    return localStorage.getItem(LS_WISHES) ?? ''
  } catch {
    return ''
  }
}

export const FurnishDialog: React.FC<Props> = ({ rooms, initialScope, aiEnabled, aiHint, onRun, onClose, onUndo }) => {
  const [scope, setScope] = useState<'all' | string>(initialScope)
  const [wishes, setWishes] = useState(readWishes)
  const [replace, setReplace] = useState(false)
  const [rename, setRename] = useState(true)
  const [quality, setQualityRaw] = useState<'fast' | 'best'>(readQuality)
  const setQuality = (q: 'fast' | 'best') => {
    setQualityRaw(q)
    try {
      localStorage.setItem(LS_QUALITY, q)
    } catch {
      /* без хранилища выбор просто не запомнится */
    }
  }
  const room = rooms.find((r) => r.id === scope)
  const [purpose, setPurpose] = useState(room?.name ?? '')
  const [busy, setBusy] = useState('')
  const [report, setReport] = useState<FurnishReport | null>(null)
  const [error, setError] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  const box = useRef<HTMLDivElement>(null)
  useFocusTrap(box, area)

  useEffect(() => {
    area.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  useEffect(() => setPurpose(rooms.find((r) => r.id === scope)?.name ?? ''), [scope]) // eslint-disable-line react-hooks/exhaustive-deps

  const addWish = (w: string) => setWishes((cur) => (cur.trim() ? `${cur.trim().replace(/[.,;]$/, '')}, ${w}` : w))

  const run = async () => {
    try {
      localStorage.setItem(LS_WISHES, wishes)
    } catch {
      /* не страшно */
    }
    setError('')
    setBusy('Отправляю…')
    try {
      const rep = await onRun({ scope, wishes, replace, rename, purpose: scope === 'all' ? undefined : purpose, quality }, setBusy)
      setReport(rep)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const placed = report?.rooms.reduce((s, r) => s + r.placed, 0) ?? 0
  // все комнаты упали с одной и той же ошибкой — это сбой сервера, а не «проверка отбросила»
  const commonError = report && report.rooms.length > 0 && report.rooms.every((r) => r.error) && new Set(report.rooms.map((r) => r.error)).size === 1 ? friendlyAiError(report.rooms[0].error!) : null
  return (
    <div className="pl-ask-backdrop" onClick={() => !busy && onClose()}>
      <div ref={box} className="pl-ask pl-furnish" role="dialog" aria-modal="true" aria-labelledby="pl-furnish-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="pl-furnish-title">✨ Расставить мебель с ИИ</h2>
        {report ? (
          <>
            <p>{placed ? `Поставлено предметов: ${placed}. Всё легло одной правкой — кнопка «Отменить» или Ctrl+Z уберёт разом.` : commonError ? `Ничего не встало: ${commonError}. Попробуйте ещё раз.` : 'Ничего не встало: проверка отбросила всё предложенное.'}</p>
            {placed > 0 && placed <= 2 && <p className="pl-furnish-warn">Встало совсем мало — модель предложила слишком мало или почти всё не прошло проверку. Посмотрите план и, если не нравится, отмените.</p>}
            {report.zoningFailed && <p className="pl-furnish-warn">Назначения комнат подобрать не вышло ({report.zoningFailed}) — обставлено по их именам.</p>}
            <ul className="pl-furnish-report">
              {report.rooms.map((r) => (
                <li key={r.id}>
                  <b>{r.purpose}</b>
                  {/* «Спальня» для «Спальня (5ж)» — не переименование: номер БТИ остаётся */}
                  {!r.name.toLowerCase().startsWith(r.purpose.toLowerCase()) && <span className="pl-furnish-was"> (была «{r.name}»)</span>}
                  {r.error ? !commonError && <div className="pl-furnish-warn">Не вышло: {friendlyAiError(r.error)}</div> : <div>{r.summary}</div>}
                  {r.why && <small>{r.why}</small>}
                  {r.idea && <small className="pl-furnish-idea">Замысел: {r.idea}</small>}
                </li>
              ))}
            </ul>
            <div className="pl-ask-foot">
              {placed > 0 && onUndo && (
                <button
                  className="pl-btn ghost"
                  onClick={() => {
                    onUndo()
                    onClose()
                  }}
                >
                  Отменить расстановку
                </button>
              )}
              <button className="pl-btn primary" onClick={onClose} autoFocus>
                Оставить
              </button>
            </div>
          </>
        ) : (
          <>
            {!aiEnabled && <p className="pl-furnish-warn">{aiHint || 'ИИ не подключён на этом сервере — расставить можно вручную из каталога.'}</p>}
            <div className="pl-furnish-row">
              <span>Где</span>
              <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={!!busy}>
                <option value="all">Вся квартира</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.area.toFixed(1)} м²
                  </option>
                ))}
              </select>
            </div>
            {scope !== 'all' && (
              <div className="pl-furnish-row">
                <span>Назначение</span>
                <input list="pl-purposes" value={purpose} onChange={(e) => setPurpose(e.target.value)} disabled={!!busy} placeholder="Спальня, детская, кабинет…" />
                <datalist id="pl-purposes">
                  {ROOM_PURPOSES.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>
            )}
            <label className="pl-furnish-label" htmlFor="pl-wishes">
              Пожелания своими словами
            </label>
            <textarea
              id="pl-wishes"
              ref={area}
              rows={4}
              maxLength={1000}
              value={wishes}
              disabled={!!busy}
              onChange={(e) => setWishes(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void run()
                // Esc должен закрывать диалог и из поля: слушатель окна событие не получит
                if (e.key === 'Escape' && !busy) onClose()
              }}
              placeholder="Например: живём вдвоём, работаем из дома — нужны два рабочих места; хочется много хранения и диван для гостей"
            />
            <div className="pl-chips">
              {WISH_CHIPS.map((w) => (
                <button key={w} className="pl-chip" onClick={() => addWish(w)} disabled={!!busy}>
                  + {w}
                </button>
              ))}
            </div>
            <div className="pl-furnish-row">
              <span className="pl-furnish-label">Как расставлять</span>
              <div className="pl-segment" role="radiogroup" aria-label="Модель для расстановки">
                <button role="radio" aria-checked={quality === 'best'} className={quality === 'best' ? 'active' : ''} onClick={() => setQuality('best')} disabled={!!busy} title="Сильная модель продумывает зоны, проходы и свет. Около 3–4 ₽ за комнату">
                  Тщательно
                </button>
                <button role="radio" aria-checked={quality === 'fast'} className={quality === 'fast' ? 'active' : ''} onClick={() => setQuality('fast')} disabled={!!busy} title="Дешёвая быстрая модель: копейки за комнату, но думает меньше">
                  Быстро
                </button>
              </div>
            </div>
            <p className="pl-furnish-note">{quality === 'best' ? 'Сильная модель: сначала продумывает замысел комнаты, потом расставляет. Около 3–4 ₽ за комнату, до пары минут.' : 'Дешёвая модель: быстро и почти бесплатно, но продумывает меньше.'}</p>
            <label className="pl-furnish-check">
              <input type="checkbox" checked={replace} onChange={() => setReplace((v) => !v)} disabled={!!busy} />
              <span>Убрать мебель, что уже стоит (иначе ИИ дополнит расстановку и не тронет её). Электрика остаётся</span>
            </label>
            {scope === 'all' && (
              <label className="pl-furnish-check">
                <input type="checkbox" checked={rename} onChange={() => setRename((v) => !v)} disabled={!!busy} />
                <span>Переименовать комнаты по назначению (кухню, санузел и прихожую ИИ не трогает)</span>
              </label>
            )}
            <p className="pl-furnish-note">
              {scope === 'all' ? 'Сначала ИИ решит, какой комнате какое назначение по вашим пожеланиям, потом обставит каждую. ' : ''}
              Каждый предмет проверяется геометрией: вне комнаты, на пути двери или поверх другого — не ставится.
            </p>
            {error && <p className="pl-furnish-warn">{friendlyAiError(error)}</p>}
            <div className="pl-ask-foot">
              {busy && <span className="pl-furnish-busy">{busy}</span>}
              <button className="pl-btn ghost" onClick={onClose} disabled={!!busy}>
                Отмена
              </button>
              <button className="pl-btn primary" onClick={() => void run()} disabled={!!busy || !aiEnabled || (scope !== 'all' && !purpose.trim())}>
                ✨ Расставить
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
