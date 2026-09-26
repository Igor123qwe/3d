import { describe, expect, it } from 'vitest'
import { friendlyAiError, shortModel } from '../src/planner/ai'

describe('ошибки ИИ по-человечески', () => {
  it('перебор моделей: по каждой — что случилось, а не «запрос отменён»', () => {
    const msg = 'ни одна модель не справилась. anthropic/claude-sonnet-5: не ответила за 180 с; openai/gpt-5-mini: роутер отказал (400); deepseek/deepseek-v4-flash: This operation was aborted'
    expect(friendlyAiError(msg)).toBe('ни одна модель не ответила: claude-sonnet-5 — не ответила за 180 с; gpt-5-mini — роутер отказал (400); deepseek-v4-flash — оборвалось')
  })
  it('различает, почему модель не справилась: думала, оборвалась, молчала, ответила текстом', () => {
    const msg =
      'ни одна модель не справилась. openai/gpt-5-mini: всё ушло в рассуждения: не хватило 6000 токенов на ответ; anthropic/claude-sonnet-5: ответ оборвался: не хватило 6000 токенов; a/b: пустой ответ; c/d: ответила текстом, а не JSON; e/f: в ответе нет списка предметов'
    expect(friendlyAiError(msg)).toBe(
      'ни одна модель не ответила: gpt-5-mini — думала слишком долго и не успела ответить; claude-sonnet-5 — ответ оборвался на полуслове; b — прислала пустой ответ; d — ответила текстом вместо данных; f — не дала ни одного предмета',
    )
  })
  it('прочее — как было', () => {
    expect(friendlyAiError('Failed to fetch')).toBe('нет связи с сервером ИИ')
    expect(friendlyAiError('The user aborted a request.')).toBe('запрос отменён')
    expect(shortModel('anthropic/claude-sonnet-5')).toBe('claude-sonnet-5')
  })
})
