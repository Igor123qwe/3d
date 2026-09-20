// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { classifyFile, filesFromTransfer, isEditable, looksLikePlanJson } from '../src/planner/intake'

describe('что за файл принесли', () => {
  it('картинку узнаёт по типу', () => {
    expect(classifyFile({ type: 'image/png', name: 'a.png' })).toBe('image')
    expect(classifyFile({ type: 'image/webp', name: 'без-расширения' })).toBe('image')
  })

  it('картинку узнаёт по расширению, когда типа нет — так бывает при перетаскивании из некоторых программ', () => {
    expect(classifyFile({ type: '', name: 'план БТИ.JPG' })).toBe('image')
    expect(classifyFile({ type: '', name: 'photo.heic' })).toBe('image')
  })

  it('план узнаёт по типу и по расширению', () => {
    expect(classifyFile({ type: 'application/json', name: 'x' })).toBe('plan')
    expect(classifyFile({ type: '', name: 'квартира.json' })).toBe('plan')
  })

  it('остальное — не наше', () => {
    expect(classifyFile({ type: 'application/pdf', name: 'plan.pdf' })).toBe('unknown')
    expect(classifyFile({ type: 'text/plain', name: 'notes.txt' })).toBe('unknown')
    expect(classifyFile({})).toBe('unknown')
  })
})

describe('вставленный текст похож на план', () => {
  it('да, если это JSON со списком стен', () => {
    expect(looksLikePlanJson('{"version":1,"name":"x","walls":[],"openings":[]}')).toBe(true)
    expect(looksLikePlanJson('  \n{"walls":[{"id":"w"}],"furniture":[]}  ')).toBe(true)
  })

  it('нет для обычного текста, коротких строк и JSON без стен', () => {
    expect(looksLikePlanJson('привет, вот план квартиры')).toBe(false)
    expect(looksLikePlanJson('{"a":1}')).toBe(false)
    expect(looksLikePlanJson('{"walls":"нет","name":"длинная строка без списка"}')).toBe(false)
    expect(looksLikePlanJson('{"walls":[')).toBe(false)
  })
})

describe('файлы из перетаскивания и буфера', () => {
  // в jsdom нет DataTransfer, поэтому подсовываем объект той же формы
  const fake = (files: File[], items: File[] = []) =>
    ({
      files,
      items: items.map((f) => ({ kind: 'file', getAsFile: () => f })),
    }) as unknown as DataTransfer

  it('берёт файлы из files', () => {
    const f = new File(['x'], 'a.png', { type: 'image/png' })
    const got = filesFromTransfer(fake([f]))
    expect(got).toHaveLength(1)
    expect(got[0].name).toBe('a.png')
  })

  it('если files пуст — достаёт из items: так отдаёт буфер обмена', () => {
    const f = new File(['x'], 'shot.png', { type: 'image/png' })
    expect(filesFromTransfer(fake([], [f])).map((x) => x.name)).toEqual(['shot.png'])
  })

  it('пустой буфер — пустой список, без исключений', () => {
    expect(filesFromTransfer(null)).toEqual([])
    expect(filesFromTransfer(undefined)).toEqual([])
    expect(filesFromTransfer(fake([]))).toEqual([])
  })
})

describe('где не перехватывать вставку и горячие клавиши', () => {
  it('поля ввода — их дело', () => {
    for (const tag of ['input', 'textarea', 'select']) expect(isEditable(document.createElement(tag))).toBe(true)
    const div = document.createElement('div')
    expect(isEditable(div)).toBe(false)
    expect(isEditable(null)).toBe(false)
  })
})
