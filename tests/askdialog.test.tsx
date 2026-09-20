// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AskDialog } from '../src/planner/AskDialog'

afterEach(cleanup)

const options = [
  { key: 'new', label: 'Новый проект по схеме', hint: 'текущий закроется', primary: true },
  { key: 'underlay', label: 'Подложить под текущий план' },
]

describe('вопрос с вариантами', () => {
  it('показывает заголовок, пояснение и варианты; главный вариант в фокусе', () => {
    render(<AskDialog title="Схема получена" text="В проекте уже есть 2 комнаты." options={options} onPick={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Схема получена')).toBeTruthy()
    expect(screen.getByText('В проекте уже есть 2 комнаты.')).toBeTruthy()
    expect(screen.getByText('текущий закроется')).toBeTruthy()
    expect(document.activeElement?.textContent).toContain('Новый проект по схеме')
  })

  it('клик по варианту отдаёт его ключ', () => {
    const onPick = vi.fn()
    render(<AskDialog title="?" options={options} onPick={onPick} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByText('Подложить под текущий план'))
    expect(onPick).toHaveBeenCalledWith('underlay')
  })

  it('Esc, кнопка «Отмена» и клик по фону отменяют; клик внутри — нет', () => {
    const onCancel = vi.fn()
    render(<AskDialog title="?" options={options} onPick={vi.fn()} onCancel={onCancel} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Отмена'))
    expect(onCancel).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onCancel).toHaveBeenCalledTimes(2)
    fireEvent.click(document.querySelector('.pl-ask-backdrop')!)
    expect(onCancel).toHaveBeenCalledTimes(3)
  })
})
