// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// без globals у vitest автоочистки DOM между тестами нет
afterEach(cleanup)
import { StartDialog, splitTemplateName } from '../src/planner/StartDialog'
import { TEMPLATES } from '../src/planner/templates'

const base = {
  open: true,
  canClose: true,
  templates: TEMPLATES,
  recent: null,
  aiEnabled: false,
  onClose: vi.fn(),
  onTemplate: vi.fn(),
  onPickFile: vi.fn(),
  onPaste: vi.fn(),
}

describe('стартовый экран', () => {
  it('показывает три пути: загрузить, шаблон, с нуля', () => {
    render(<StartDialog {...base} />)
    expect(screen.getByText('С чего начнём?')).toBeTruthy()
    expect(screen.getByText('Загрузить свой план')).toBeTruthy()
    expect(screen.getByText('Начать с шаблона')).toBeTruthy()
    expect(screen.getByText('Нарисовать самому')).toBeTruthy()
    // у каждого шаблона, кроме пустого, есть миниатюра
    expect(document.querySelectorAll('.pl-start-thumb')).toHaveLength(TEMPLATES.length - 1)
  })

  it('кнопки ведут куда обещают', () => {
    const onTemplate = vi.fn()
    const onPickFile = vi.fn()
    const onPaste = vi.fn()
    render(<StartDialog {...base} onTemplate={onTemplate} onPickFile={onPickFile} onPaste={onPaste} />)
    fireEvent.click(screen.getByText('Выбрать файл'))
    expect(onPickFile).toHaveBeenCalled()
    fireEvent.click(screen.getByText(/Вставить из буфера/))
    expect(onPaste).toHaveBeenCalled()
    fireEvent.click(screen.getByText('Пустой лист'))
    expect(onTemplate).toHaveBeenCalledWith('empty')
    fireEvent.click(screen.getByText('2-комнатная'))
    expect(onTemplate).toHaveBeenCalledWith(TEMPLATES[3].key)
  })

  it('«Продолжить» появляется только когда есть прошлый план', () => {
    const { rerender } = render(<StartDialog {...base} />)
    expect(screen.queryByText('Продолжить')).toBeNull()
    rerender(<StartDialog {...base} recent={{ name: 'Моя квартира', rooms: 3, areaM2: 41.2 }} />)
    expect(screen.getByText('Продолжить')).toBeTruthy()
    expect(screen.getByText('Моя квартира')).toBeTruthy()
    expect(screen.getByText(/3 комнаты · 41,2 м²/)).toBeTruthy()
  })

  it('Esc закрывает, если закрывать можно, и не закрывает, если нельзя', () => {
    const onClose = vi.fn()
    const { unmount } = render(<StartDialog {...base} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
    const onClose2 = vi.fn()
    render(<StartDialog {...base} canClose={false} onClose={onClose2} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose2).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Закрыть')).toBeNull()
  })

  it('текст под загрузкой честно говорит, есть ли ИИ', () => {
    const { rerender } = render(<StartDialog {...base} aiEnabled={false} />)
    expect(screen.getByText(/обводятся по линиям/)).toBeTruthy()
    rerender(<StartDialog {...base} aiEnabled />)
    expect(screen.getByText(/распознаются автоматически/)).toBeTruthy()
  })

  it('название шаблона делится на имя и площадь, чтобы дефис не рвал строку', () => {
    expect(splitTemplateName('1-комнатная 37 м²')).toEqual(['1-комнатная', '37 м²'])
    expect(splitTemplateName('Студия 32 м²')).toEqual(['Студия', '32 м²'])
    expect(splitTemplateName('Пустой лист')).toEqual(['Пустой лист', ''])
  })

  it('закрытый диалог ничего не рисует', () => {
    render(<StartDialog {...base} open={false} />)
    expect(screen.queryByText('С чего начнём?')).toBeNull()
  })
})
