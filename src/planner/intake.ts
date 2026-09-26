// Приём файлов отовсюду: перетаскивание на окно, вставка из буфера обмена,
// выбор файла. Один вход — одна логика: картинка становится подложкой,
// JSON — планом. Так работают Floorplanner и RoomSketcher: план можно
// просто бросить на холст, а скриншот — вставить по Ctrl+V.
import { useCallback, useEffect, useRef, useState } from 'react'

export type IntakeKind = 'image' | 'plan' | 'unknown'

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i
const PLAN_EXT = /\.json$/i

/** Что это за файл — по типу, а если его нет, по расширению */
export function classifyFile(file: { type?: string; name?: string }): IntakeKind {
  const type = (file.type || '').toLowerCase()
  const name = file.name || ''
  if (type.startsWith('image/')) return 'image'
  if (type === 'application/json' || type === 'text/json') return 'plan'
  if (IMAGE_EXT.test(name)) return 'image'
  if (PLAN_EXT.test(name)) return 'plan'
  return 'unknown'
}

/** Похож ли вставленный текст на план — чтобы Ctrl+V с JSON тоже работал */
export function looksLikePlanJson(text: string): boolean {
  const t = text.trim()
  if (!t.startsWith('{') || t.length < 20) return false
  try {
    const d = JSON.parse(t) as { walls?: unknown }
    return Array.isArray(d.walls)
  } catch {
    return false
  }
}

/** Из перетаскивания или буфера: сначала файлы, потом картинки среди items */
export function filesFromTransfer(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return []
  const out: File[] = []
  if (dt.files?.length) out.push(...Array.from(dt.files))
  if (!out.length && dt.items) {
    for (const it of Array.from(dt.items)) {
      if (it.kind !== 'file') continue
      const f = it.getAsFile()
      if (f) out.push(f)
    }
  }
  return out
}

/** Заголовки таких элементов вводят текст — вставку и горячие клавиши им не перехватываем */
export const isEditable = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  // isContentEditable у некоторых окружений не задан вовсе — сравниваем строго
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
}

export interface IntakeHandlers {
  onImage: (file: File) => void | Promise<void>
  onPlanFile: (file: File) => void | Promise<void>
  onPlanText?: (text: string) => void | Promise<void>
  /** в буфере ни картинки, ни плана — сказать об этом, а не молчать */
  onNothing?: () => void
  onError: (message: string) => void
}

export interface Intake {
  /** над окном тащат файл — пора показать оверлей «отпустите здесь» */
  dragging: boolean
  /** пропустить набор файлов через ту же логику, что и перетаскивание */
  takeFiles: (files: File[] | FileList) => Promise<void>
  /** прочитать буфер обмена по кнопке; нужен жест пользователя и HTTPS */
  pasteFromClipboard: () => Promise<void>
}

/**
 * Глобальные перетаскивание и вставка.
 * Слушатели висят на window: файл можно бросить куда угодно, не целясь в холст.
 */
export function useFileIntake(h: IntakeHandlers, enabled = true): Intake {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const handlers = useRef(h)
  handlers.current = h

  const takeFiles = useCallback(async (list: File[] | FileList) => {
    const files = Array.from(list)
    if (!files.length) return
    // берём первый подходящий: план и картинку сразу не смешиваем
    const plan = files.find((f) => classifyFile(f) === 'plan')
    const image = files.find((f) => classifyFile(f) === 'image')
    try {
      if (plan) await handlers.current.onPlanFile(plan)
      else if (image) await handlers.current.onImage(image)
      else handlers.current.onError('Нужна картинка плана (PNG, JPG) или файл плана (JSON)')
    } catch (e) {
      handlers.current.onError((e as Error).message)
    }
  }, [])

  const pasteFromClipboard = useCallback(async () => {
    const clip = navigator.clipboard as Clipboard & { read?: () => Promise<ClipboardItem[]> }
    try {
      if (clip?.read) {
        const items = await clip.read()
        for (const item of items) {
          const type = item.types.find((t) => t.startsWith('image/'))
          if (type) {
            const blob = await item.getType(type)
            await takeFiles([new File([blob], `буфер.${type.split('/')[1] || 'png'}`, { type })])
            return
          }
        }
      }
      const text = clip?.readText ? await clip.readText() : ''
      if (text && looksLikePlanJson(text) && handlers.current.onPlanText) {
        await handlers.current.onPlanText(text)
        return
      }
      handlers.current.onError('В буфере нет картинки. Скопируйте скриншот плана и попробуйте снова, или нажмите Ctrl+V прямо на плане')
    } catch {
      handlers.current.onError('Браузер не дал доступ к буферу. Нажмите Ctrl+V прямо на плане')
    }
  }, [takeFiles])

  useEffect(() => {
    if (!enabled) return
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current++
      setDragging(true)
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setDragging(false)
      void takeFiles(filesFromTransfer(e.dataTransfer))
    }
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return
      const files = filesFromTransfer(e.clipboardData)
      if (files.length) {
        e.preventDefault()
        void takeFiles(files)
        return
      }
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (text && looksLikePlanJson(text) && handlers.current.onPlanText) {
        e.preventDefault()
        void handlers.current.onPlanText(text)
      } else handlers.current.onNothing?.()
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('paste', onPaste)
    }
  }, [enabled, takeFiles])

  return { dragging, takeFiles, pasteFromClipboard }
}
