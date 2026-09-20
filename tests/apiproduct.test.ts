import { describe, expect, it } from 'vitest'
import { checkShopUrl, mergeProduct } from '../api/product'
import type { ProductInfo } from '../src/planner/products'

const base: ProductInfo = { url: 'https://shop.example/x', name: 'Товар', source: 'ничего не найдено' }

describe('защита от запросов во внутреннюю сеть', () => {
  it('пропускает обычные адреса магазинов', () => {
    expect(checkShopUrl('https://www.dns-shop.ru/product/123/').hostname).toBe('www.dns-shop.ru')
    expect(checkShopUrl(' http://example.com/a?b=1 ').hostname).toBe('example.com')
  })

  it('не пускает на localhost и внутренние имена', () => {
    for (const bad of ['http://localhost/x', 'http://router.local/', 'https://api.internal/v1', 'http://sklad/']) {
      expect(() => checkShopUrl(bad), bad).toThrow(/недоступен/)
    }
  })

  it('не пускает на внутренние адреса', () => {
    for (const bad of [
      'http://127.0.0.1:8080/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://172.16.4.4/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
    ]) {
      expect(() => checkShopUrl(bad), bad).toThrow(/недоступен/)
    }
  })

  it('пропускает внешние адреса, похожие на внутренние только началом', () => {
    expect(checkShopUrl('http://172.32.0.1/').hostname).toBe('172.32.0.1')
    expect(checkShopUrl('http://11.0.0.1/').hostname).toBe('11.0.0.1')
  })

  it('не пускает другие схемы', () => {
    for (const bad of ['file:///etc/passwd', 'ftp://example.com/x', 'javascript:alert(1)']) {
      expect(() => checkShopUrl(bad), bad).toThrow()
    }
  })

  it('на мусор отвечает понятно', () => {
    expect(() => checkShopUrl('просто текст')).toThrow(/ссылка вида https/)
  })
})

describe('склейка данных разметки и модели', () => {
  it('разметке верят больше, чем модели', () => {
    const parsed: ProductInfo = { ...base, name: 'Холодильник BOSCH KGN39', price: 89990, source: 'разметка страницы' }
    const merged = mergeProduct(parsed, { name: 'Какой-то холодильник', price: 1, width: 60, depth: 66, height: 203 })
    expect(merged.name).toBe('Холодильник BOSCH KGN39')
    expect(merged.price).toBe(89990)
    // габаритов в разметке не было — их берём у модели
    expect(merged.dims).toEqual({ w: 60, d: 66, h: 203 })
    expect(merged.source).toMatch(/разметка страницы \+ ИИ/)
  })

  it('неполные габариты от модели не берутся вовсе', () => {
    const merged = mergeProduct({ ...base, source: 'текст страницы' }, { name: 'Шкаф', width: 120 })
    expect(merged.dims).toBeUndefined()
  })

  it('модель заполняет пустое название', () => {
    const merged = mergeProduct(base, { name: 'Диван «Осло»', width: 220, depth: 95, height: 85 })
    expect(merged.name).toBe('Диван «Осло»')
    expect(merged.source).toMatch(/ИИ по тексту страницы/)
  })

  it('фото с подозрительным адресом не берётся', () => {
    const merged = mergeProduct(base, { name: 'Стол', photo: 'javascript:alert(1)' })
    expect(merged.photo).toBeUndefined()
  })
})
