import { describe, expect, it } from 'vitest'
import { isFixedPurpose, isHall, isKitchen, isLiving, isOutdoor, isSkippedForFurnish, isStorage, isWet, roomKind } from '../src/planner/roomkind'

describe('назначение комнаты по имени', () => {
  it('регистр и номера не мешают', () => {
    expect(roomKind('Спальня 2')).toBe('bedroom')
    expect(roomKind('санузел')).toBe('wet')
    expect(roomKind('С/у совмещённый')).toBe('wet')
    expect(roomKind('Кухня-гостиная')).toBe('kitchen')
    expect(roomKind('Помещение 3')).toBe('other')
  })

  it('жилые комнаты требуют окна, кладовые и санузлы — нет', () => {
    expect(['Гостиная', 'Спальня 2', 'детская', 'Кабинет', 'Кухня'].every(isLiving)).toBe(true)
    expect(['Кладовая', 'Санузел', 'Прихожая', 'Лоджия', 'Помещение 3'].some(isLiving)).toBe(false)
  })

  it('мокрая, кухня, прихожая, кладовая, балкон', () => {
    expect(isWet('Ванная')).toBe(true)
    expect(isKitchen('кухня')).toBe(true)
    expect(isHall('Коридор 2')).toBe(true)
    expect(isStorage('Гардеробная')).toBe(true)
    expect(isOutdoor('Балкон')).toBe(true)
  })

  it('зонирование не переназначает кухню и санузел; балкон и кладовую не обставляют', () => {
    expect(isFixedPurpose('Кухня')).toBe(true)
    expect(isFixedPurpose('Спальня')).toBe(false)
    expect(isSkippedForFurnish('Лоджия')).toBe(true)
    expect(isSkippedForFurnish('Гостиная')).toBe(false)
  })
})
