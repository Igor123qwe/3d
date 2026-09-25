// Каталог мебели и оборудования с реальными размерами и зонами эргономики.
// Локальная система объекта: x — ширина (вправо), y — глубина (вниз).
// «Спинка» объекта — верхняя грань (-y), «фронт» — нижняя (+y).
import type { EditMode, ElectricPoint, Furniture, ModelRef, ProductRef } from './types'

export type CategoryKey =
  | 'bedroom'
  | 'living'
  | 'kitchen'
  | 'bath'
  | 'hall'
  | 'office'
  | 'kids'
  | 'electric'
  | 'misc'

export const CATEGORIES: { key: CategoryKey; name: string; icon: string }[] = [
  { key: 'living', name: 'Гостиная', icon: '🛋' },
  { key: 'bedroom', name: 'Спальня', icon: '🛏' },
  { key: 'kitchen', name: 'Кухня', icon: '🍳' },
  { key: 'bath', name: 'Санузел', icon: '🛁' },
  { key: 'hall', name: 'Прихожая', icon: '🚪' },
  { key: 'office', name: 'Кабинет', icon: '💻' },
  { key: 'kids', name: 'Детская', icon: '🧸' },
  { key: 'electric', name: 'Электрика', icon: '💡' },
  { key: 'misc', name: 'Разное', icon: '📦' },
]

export type GlyphKind =
  | 'bed'
  | 'sofa'
  | 'sofa-corner'
  | 'armchair'
  | 'table'
  | 'table-round'
  | 'chair'
  | 'stool'
  | 'wardrobe'
  | 'wardrobe-slide'
  | 'drawers'
  | 'desk'
  | 'counter'
  | 'sink'
  | 'stove'
  | 'fridge'
  | 'dishwasher'
  | 'washer'
  | 'toilet'
  | 'basin'
  | 'bathtub'
  | 'shower'
  | 'tv'
  | 'shelf'
  | 'rug'
  | 'plant'
  | 'crib'
  | 'radiator'
  | 'mirror'
  | 'column'
  | 'bench'
  | 'box'
  | 'outlet'
  | 'switch'
  | 'light'
  | 'spot'
  | 'lamp'
  | 'sensor'
  | 'thermostat'
  | 'curtain'
  | 'panel'

export interface Clearance {
  front?: number
  back?: number
  left?: number
  right?: number
}

export interface CatalogItem {
  type: string
  name: string
  category: CategoryKey
  w: number
  d: number
  glyph: GlyphKind
  /** свободные зоны вокруг, см */
  clearance?: Clearance
  /** типы объектов, которым разрешено стоять в зоне (стулья у стола и т.п.) */
  allowInZone?: string[]
  /** слой: 0 — ковры, 1 — мебель, 2 — символы поверх */
  z?: number
  /** магнитится спинкой к стене */
  wallSnap?: boolean
  /** условный знак фиксированного экранного размера (электрика) */
  symbol?: boolean
  /** можно ли менять размер */
  resizable?: boolean
  hint?: string
  /** высота, см (для предметов из фотокаталога) */
  h?: number
  /** фотореалистичная модель (для предметов из фотокаталога) */
  model?: ModelRef
  /** электрическая точка: подставляется при установке прибора */
  electric?: ElectricPoint
  /** товар из магазина: подставляется при установке по ссылке */
  product?: ProductRef
}

const SEATS = ['chair', 'office-chair', 'bar-stool', 'bench', 'hall-bench']

export const CATALOG: CatalogItem[] = [
  // ---------- Гостиная ----------
  {
    type: 'sofa-3',
    name: 'Диван 3-местный',
    category: 'living',
    w: 220,
    d: 95,
    glyph: 'sofa',
    wallSnap: true,
    clearance: { front: 40 },
    allowInZone: ['coffee-table', 'rug', 'plant', 'lamp'],
    hint: 'Журнальный стол ставят в 40–45 см от дивана. До телевизора — 2–3 м для диагонали 55″.',
  },
  {
    type: 'sofa-2',
    name: 'Диван 2-местный',
    category: 'living',
    w: 170,
    d: 90,
    glyph: 'sofa',
    wallSnap: true,
    clearance: { front: 40 },
    allowInZone: ['coffee-table', 'rug', 'plant', 'lamp'],
  },
  {
    type: 'sofa-corner',
    name: 'Угловой диван',
    category: 'living',
    w: 260,
    d: 165,
    glyph: 'sofa-corner',
    wallSnap: true,
    clearance: { front: 40 },
    allowInZone: ['coffee-table', 'rug', 'plant', 'lamp'],
    hint: 'Кнопка «Отразить» меняет сторону оттоманки.',
  },
  {
    type: 'armchair',
    name: 'Кресло',
    category: 'living',
    w: 85,
    d: 85,
    glyph: 'armchair',
    clearance: { front: 40 },
    allowInZone: ['coffee-table', 'rug', 'plant', 'lamp'],
  },
  { type: 'coffee-table', name: 'Журнальный стол', category: 'living', w: 100, d: 55, glyph: 'table' },
  {
    type: 'tv',
    name: 'Телевизор 55″',
    category: 'living',
    w: 123,
    d: 8,
    glyph: 'tv',
    wallSnap: true,
    hint: 'Центр экрана — на уровне глаз сидящего (≈ 100–110 см от пола). Не напротив окна — будут блики.',
  },
  { type: 'tv-stand', name: 'ТВ-тумба', category: 'living', w: 160, d: 40, glyph: 'drawers', wallSnap: true, clearance: { front: 60 } },
  {
    type: 'dining-table',
    name: 'Стол обеденный',
    category: 'living',
    w: 140,
    d: 80,
    glyph: 'table',
    clearance: { front: 75, back: 75, left: 75, right: 75 },
    allowInZone: SEATS,
    hint: 'На человека — 60 см ширины стола. Чтобы отодвинуть стул, нужно 75–80 см от края стола до стены.',
  },
  {
    type: 'table-round',
    name: 'Стол круглый Ø110',
    category: 'living',
    w: 110,
    d: 110,
    glyph: 'table-round',
    clearance: { front: 75, back: 75, left: 75, right: 75 },
    allowInZone: SEATS,
  },
  { type: 'chair', name: 'Стул', category: 'living', w: 45, d: 50, glyph: 'chair' },
  { type: 'bookshelf', name: 'Стеллаж', category: 'living', w: 80, d: 35, glyph: 'shelf', wallSnap: true, clearance: { front: 70 } },
  { type: 'rug', name: 'Ковёр', category: 'living', w: 200, d: 140, glyph: 'rug', z: 0, hint: 'Ковёр объединяет зону: передние ножки дивана и кресел должны стоять на нём.' },
  { type: 'plant', name: 'Растение', category: 'living', w: 45, d: 45, glyph: 'plant' },
  { type: 'lamp', name: 'Торшер', category: 'living', w: 35, d: 35, glyph: 'lamp' },

  // ---------- Спальня ----------
  {
    type: 'bed-160',
    name: 'Кровать 160×200',
    category: 'bedroom',
    w: 160,
    d: 210,
    glyph: 'bed',
    wallSnap: true,
    clearance: { front: 70, left: 70, right: 70 },
    allowInZone: ['nightstand', 'rug', 'lamp', 'bench'],
    hint: 'Проходы с обеих сторон ≥ 70 см. Изголовье — к глухой стене, не под окно и не ногами к двери.',
  },
  {
    type: 'bed-180',
    name: 'Кровать 180×200',
    category: 'bedroom',
    w: 180,
    d: 210,
    glyph: 'bed',
    wallSnap: true,
    clearance: { front: 70, left: 70, right: 70 },
    allowInZone: ['nightstand', 'rug', 'lamp', 'bench'],
  },
  {
    type: 'bed-140',
    name: 'Кровать 140×200',
    category: 'bedroom',
    w: 140,
    d: 210,
    glyph: 'bed',
    wallSnap: true,
    clearance: { front: 70, left: 70, right: 70 },
    allowInZone: ['nightstand', 'rug', 'lamp', 'bench'],
  },
  {
    type: 'bed-90',
    name: 'Кровать 90×200',
    category: 'bedroom',
    w: 90,
    d: 205,
    glyph: 'bed',
    wallSnap: true,
    clearance: { front: 70, left: 70 },
    allowInZone: ['nightstand', 'rug', 'lamp'],
    hint: 'Односпальную кровать можно ставить одним боком к стене — проход нужен с одной стороны.',
  },
  { type: 'nightstand', name: 'Тумба прикроватная', category: 'bedroom', w: 45, d: 40, glyph: 'drawers', wallSnap: true },
  {
    type: 'wardrobe',
    name: 'Шкаф распашной',
    category: 'bedroom',
    w: 180,
    d: 60,
    glyph: 'wardrobe',
    wallSnap: true,
    clearance: { front: 90 },
    hint: 'Перед распашным шкафом нужно 90 см: дверца (≈ 50 см) плюс человек.',
  },
  {
    type: 'wardrobe-slide',
    name: 'Шкаф-купе',
    category: 'bedroom',
    w: 200,
    d: 65,
    glyph: 'wardrobe-slide',
    wallSnap: true,
    clearance: { front: 60 },
    hint: 'Купе экономит место: перед ним достаточно 60 см.',
  },
  { type: 'dresser', name: 'Комод', category: 'bedroom', w: 100, d: 45, glyph: 'drawers', wallSnap: true, clearance: { front: 70 } },
  { type: 'vanity', name: 'Туалетный столик', category: 'bedroom', w: 100, d: 45, glyph: 'desk', wallSnap: true, clearance: { front: 75 }, allowInZone: SEATS },
  { type: 'bench', name: 'Банкетка', category: 'bedroom', w: 90, d: 40, glyph: 'bench' },

  // ---------- Кухня ----------
  {
    type: 'counter-60',
    name: 'Тумба 60',
    category: 'kitchen',
    w: 60,
    d: 60,
    glyph: 'counter',
    wallSnap: true,
    clearance: { front: 100 },
    hint: 'Между рядами кухни — не меньше 120 см, чтобы открыть дверцы и разойтись.',
  },
  { type: 'counter-80', name: 'Тумба 80', category: 'kitchen', w: 80, d: 60, glyph: 'counter', wallSnap: true, clearance: { front: 100 } },
  { type: 'counter-100', name: 'Тумба 100', category: 'kitchen', w: 100, d: 60, glyph: 'counter', wallSnap: true, clearance: { front: 100 } },
  { type: 'counter-corner', name: 'Угловой модуль', category: 'kitchen', w: 90, d: 90, glyph: 'counter', wallSnap: true },
  {
    type: 'sink',
    name: 'Мойка',
    category: 'kitchen',
    w: 80,
    d: 60,
    glyph: 'sink',
    wallSnap: true,
    clearance: { front: 100 },
    hint: 'Между мойкой и плитой — рабочая поверхность 60–90 см. Мойку удобно ставить у окна.',
  },
  {
    type: 'stove',
    name: 'Плита / варочная',
    category: 'kitchen',
    w: 60,
    d: 60,
    glyph: 'stove',
    wallSnap: true,
    clearance: { front: 100 },
    hint: 'Не вплотную к холодильнику и не у окна (шторы, задувает пламя). По бокам — по 30–40 см столешницы.',
  },
  {
    type: 'fridge',
    name: 'Холодильник',
    category: 'kitchen',
    w: 60,
    d: 65,
    glyph: 'fridge',
    wallSnap: true,
    clearance: { front: 90 },
    hint: 'Рабочий треугольник холодильник → мойка → плита: сумма сторон 4–8 м.',
  },
  { type: 'dishwasher', name: 'Посудомойка', category: 'kitchen', w: 60, d: 60, glyph: 'dishwasher', wallSnap: true, clearance: { front: 90 }, hint: 'Ставят рядом с мойкой — короче коммуникации.' },
  { type: 'tall-cabinet', name: 'Пенал / духовой шкаф', category: 'kitchen', w: 60, d: 60, glyph: 'wardrobe', wallSnap: true, clearance: { front: 90 } },
  {
    type: 'island',
    name: 'Остров',
    category: 'kitchen',
    w: 120,
    d: 90,
    glyph: 'counter',
    clearance: { front: 100, back: 100, left: 100, right: 100 },
    allowInZone: SEATS,
    hint: 'Вокруг острова — не менее 100 см со всех сторон.',
  },
  {
    type: 'kitchen-table',
    name: 'Стол у стены',
    category: 'kitchen',
    w: 110,
    d: 70,
    glyph: 'table',
    wallSnap: true,
    clearance: { left: 75, right: 75 },
    allowInZone: SEATS,
    hint: 'Стол торцом или длинной стороной к стене экономит место: стулья только по бокам.',
  },
  { type: 'bar-stool', name: 'Барный стул', category: 'kitchen', w: 40, d: 40, glyph: 'stool' },

  // ---------- Санузел ----------
  {
    type: 'toilet',
    name: 'Унитаз',
    category: 'bath',
    w: 38,
    d: 65,
    glyph: 'toilet',
    wallSnap: true,
    clearance: { front: 60, left: 20, right: 20 },
    hint: 'Перед унитазом — 60 см свободно, по бокам — по 20–25 см. Ось унитаза не ближе 40 см к стене.',
  },
  { type: 'basin', name: 'Раковина', category: 'bath', w: 60, d: 48, glyph: 'basin', wallSnap: true, clearance: { front: 70 } },
  { type: 'basin-cabinet', name: 'Тумба с раковиной', category: 'bath', w: 80, d: 48, glyph: 'basin', wallSnap: true, clearance: { front: 70 } },
  {
    type: 'bathtub-170',
    name: 'Ванна 170×70',
    category: 'bath',
    w: 170,
    d: 75,
    glyph: 'bathtub',
    wallSnap: true,
    clearance: { front: 70 },
    hint: 'Перед ванной — 70 см, чтобы удобно входить и вытираться.',
  },
  { type: 'bathtub-150', name: 'Ванна 150×70', category: 'bath', w: 150, d: 75, glyph: 'bathtub', wallSnap: true, clearance: { front: 70 } },
  { type: 'shower-90', name: 'Душевая 90×90', category: 'bath', w: 90, d: 90, glyph: 'shower', wallSnap: true, clearance: { front: 70 } },
  { type: 'shower-120', name: 'Душевая 120×80', category: 'bath', w: 120, d: 80, glyph: 'shower', wallSnap: true, clearance: { front: 70 } },
  {
    type: 'washer',
    name: 'Стиральная машина',
    category: 'bath',
    w: 60,
    d: 60,
    glyph: 'washer',
    wallSnap: true,
    clearance: { front: 60 },
    hint: 'Люк открывается на 50–60 см — перед машиной нужен зазор.',
  },
  { type: 'towel-rail', name: 'Полотенцесушитель', category: 'bath', w: 50, d: 10, glyph: 'radiator', wallSnap: true },

  // ---------- Прихожая ----------
  { type: 'hall-wardrobe', name: 'Шкаф в прихожую', category: 'hall', w: 120, d: 50, glyph: 'wardrobe', wallSnap: true, clearance: { front: 80 } },
  { type: 'shoe-rack', name: 'Обувница', category: 'hall', w: 80, d: 30, glyph: 'drawers', wallSnap: true, clearance: { front: 60 } },
  { type: 'hall-bench', name: 'Банкетка', category: 'hall', w: 80, d: 40, glyph: 'bench', wallSnap: true },
  { type: 'mirror', name: 'Зеркало', category: 'hall', w: 60, d: 4, glyph: 'mirror', wallSnap: true },
  { type: 'hanger', name: 'Вешалка', category: 'hall', w: 80, d: 30, glyph: 'shelf', wallSnap: true, clearance: { front: 60 } },

  // ---------- Кабинет ----------
  {
    type: 'desk',
    name: 'Письменный стол',
    category: 'office',
    w: 120,
    d: 60,
    glyph: 'desk',
    wallSnap: true,
    clearance: { front: 80 },
    allowInZone: SEATS,
    hint: 'Стол ставят боком к окну: свет слева для правши. Спиной к двери сидеть некомфортно.',
  },
  { type: 'desk-160', name: 'Стол 160×70', category: 'office', w: 160, d: 70, glyph: 'desk', wallSnap: true, clearance: { front: 80 }, allowInZone: SEATS },
  { type: 'office-chair', name: 'Кресло офисное', category: 'office', w: 60, d: 60, glyph: 'stool' },
  { type: 'office-shelf', name: 'Стеллаж', category: 'office', w: 80, d: 35, glyph: 'shelf', wallSnap: true, clearance: { front: 70 } },
  { type: 'cabinet', name: 'Шкаф для бумаг', category: 'office', w: 80, d: 40, glyph: 'wardrobe', wallSnap: true, clearance: { front: 80 } },

  // ---------- Детская ----------
  { type: 'crib', name: 'Кроватка детская', category: 'kids', w: 65, d: 125, glyph: 'crib', wallSnap: true, clearance: { front: 60, left: 60 }, hint: 'Не у окна и не у батареи; розетки рядом закрыть заглушками.' },
  { type: 'kid-bed', name: 'Кровать 80×190', category: 'kids', w: 80, d: 195, glyph: 'bed', wallSnap: true, clearance: { front: 70, left: 70 }, allowInZone: ['nightstand', 'rug', 'lamp'] },
  { type: 'kid-desk', name: 'Стол детский', category: 'kids', w: 100, d: 55, glyph: 'desk', wallSnap: true, clearance: { front: 75 }, allowInZone: SEATS },
  { type: 'kid-wardrobe', name: 'Шкаф детский', category: 'kids', w: 120, d: 55, glyph: 'wardrobe', wallSnap: true, clearance: { front: 80 } },
  { type: 'toy-box', name: 'Ящик для игрушек', category: 'kids', w: 70, d: 40, glyph: 'box', wallSnap: true },
  { type: 'kid-rug', name: 'Игровой коврик', category: 'kids', w: 150, d: 120, glyph: 'rug', z: 0 },

  // ---------- Электрика ----------
  {
    type: 'outlet',
    name: 'Розетка',
    category: 'electric',
    w: 8,
    d: 4,
    glyph: 'outlet',
    wallSnap: true,
    symbol: true,
    z: 2,
    resizable: false,
    hint: 'У кровати — по 2 розетки с каждой стороны, у дивана, у рабочего стола; на кухне над столешницей — каждые 60–100 см.',
  },
  { type: 'switch', name: 'Выключатель', category: 'electric', w: 8, d: 4, glyph: 'switch', wallSnap: true, symbol: true, z: 2, resizable: false, hint: 'Со стороны ручки двери на высоте 90 см; в спальне — проходные у кровати.' },
  { type: 'light', name: 'Люстра / светильник', category: 'electric', w: 30, d: 30, glyph: 'light', symbol: true, z: 2, resizable: false, hint: 'Три сценария света: общий, рабочий (локальный) и акцентный.' },
  { type: 'spot', name: 'Спот', category: 'electric', w: 10, d: 10, glyph: 'spot', symbol: true, z: 2, resizable: false },
  { type: 'wall-lamp', name: 'Бра', category: 'electric', w: 12, d: 6, glyph: 'spot', wallSnap: true, symbol: true, z: 2, resizable: false },
  {
    type: 'motion-sensor',
    name: 'Датчик движения',
    category: 'electric',
    w: 10,
    d: 10,
    glyph: 'sensor',
    symbol: true,
    z: 2,
    resizable: false,
    hint: 'В коридоре и санузле включает свет без выключателя. Ставят на потолке или вверху стены.',
  },
  {
    type: 'leak-sensor',
    name: 'Датчик протечки',
    category: 'electric',
    w: 8,
    d: 8,
    glyph: 'sensor',
    symbol: true,
    z: 2,
    resizable: false,
    hint: 'На полу у стиральной машины, мойки и под ванной. В паре с кранами с электроприводом перекрывает воду.',
  },
  {
    type: 'thermostat',
    name: 'Термостат тёплого пола',
    category: 'electric',
    w: 10,
    d: 4,
    glyph: 'thermostat',
    wallSnap: true,
    symbol: true,
    z: 2,
    resizable: false,
    hint: 'На высоте выключателя, не над источником тепла. Датчик пола закладывают в гофре между витками кабеля.',
  },
  {
    type: 'curtain-motor',
    name: 'Электрокарниз',
    category: 'electric',
    w: 20,
    d: 6,
    glyph: 'curtain',
    wallSnap: true,
    symbol: true,
    z: 2,
    resizable: false,
    hint: 'Розетку под карниз выводят у потолка сбоку от окна, заранее: потом штробить придётся по чистовой отделке.',
  },
  {
    type: 'panel',
    name: 'Щит умного дома',
    category: 'electric',
    w: 40,
    d: 12,
    glyph: 'panel',
    wallSnap: true,
    symbol: true,
    z: 2,
    resizable: false,
    hint: 'Автоматы, УЗО и модули умного дома. Закладывайте запас модулей: реле и диммеры добавляются позже.',
  },

  // ---------- Разное ----------
  { type: 'radiator', name: 'Радиатор', category: 'misc', w: 80, d: 10, glyph: 'radiator', wallSnap: true, hint: 'Не закрывайте радиатор глухой мебелью — потери тепла до 20 %.' },
  { type: 'column', name: 'Колонна / шахта', category: 'misc', w: 40, d: 40, glyph: 'column' },
  { type: 'piano', name: 'Пианино', category: 'misc', w: 150, d: 60, glyph: 'box', wallSnap: true, clearance: { front: 90 }, allowInZone: SEATS },
  { type: 'box', name: 'Произвольный объект', category: 'misc', w: 100, d: 50, glyph: 'box', hint: 'Задайте размер и подпись в панели свойств.' },
]

export const CATALOG_MAP: Record<string, CatalogItem> = Object.fromEntries(CATALOG.map((c) => [c.type, c]))

/** точка электрики — розетка, выключатель, светильник, датчик, щит */
export const isElectricItem = (f: Pick<Furniture, 'type' | 'electric'>): boolean => !!f.electric || CATALOG_MAP[f.type]?.category === 'electric'

/** в каком режиме правится предмет */
export const itemMode = (f: Pick<Furniture, 'type' | 'electric'>): EditMode => (isElectricItem(f) ? 'electric' : 'furnish')

export const FLOORS: { key: import('./types').FloorKey; name: string; color: string }[] = [
  { key: 'laminate', name: 'Ламинат', color: '#efe3cf' },
  { key: 'parquet', name: 'Паркет', color: '#e6cfa8' },
  { key: 'tile', name: 'Плитка', color: '#e3eaee' },
  { key: 'carpet', name: 'Ковролин', color: '#e8e2ee' },
  { key: 'concrete', name: 'Бетон / камень', color: '#dcdcdc' },
  { key: 'plain', name: 'Без покрытия', color: '#f7f7f5' },
]

export const ROOM_NAMES = ['Гостиная', 'Спальня', 'Кухня', 'Кухня-гостиная', 'Детская', 'Кабинет', 'Прихожая', 'Коридор', 'Санузел', 'Ванная', 'Гардеробная', 'Балкон', 'Лоджия', 'Кладовая']

/** высота объекта и высота его низа над полом, см — для 3D и AR */
const HEIGHTS: Record<string, [number, number?]> = {
  'sofa-3': [85],
  'sofa-2': [85],
  'sofa-corner': [85],
  armchair: [85],
  'coffee-table': [45],
  tv: [70, 100],
  'tv-stand': [45],
  'dining-table': [75],
  'table-round': [75],
  chair: [90],
  bookshelf: [180],
  rug: [1],
  plant: [110],
  lamp: [150],
  'bed-160': [55],
  'bed-180': [55],
  'bed-140': [55],
  'bed-90': [55],
  nightstand: [55],
  wardrobe: [220],
  'wardrobe-slide': [230],
  dresser: [85],
  vanity: [75],
  bench: [45],
  'counter-60': [90],
  'counter-80': [90],
  'counter-100': [90],
  'counter-corner': [90],
  sink: [90],
  stove: [90],
  fridge: [185],
  dishwasher: [85],
  'tall-cabinet': [210],
  island: [90],
  'kitchen-table': [75],
  'bar-stool': [75],
  toilet: [80],
  basin: [85],
  'basin-cabinet': [85],
  'bathtub-170': [60],
  'bathtub-150': [60],
  'shower-90': [200],
  'shower-120': [200],
  washer: [85],
  'towel-rail': [60, 90],
  'hall-wardrobe': [220],
  'shoe-rack': [50],
  'hall-bench': [45],
  mirror: [90, 90],
  hanger: [40, 150],
  desk: [75],
  'desk-160': [75],
  'office-chair': [100],
  'office-shelf': [180],
  cabinet: [120],
  crib: [90],
  'kid-bed': [50],
  'kid-desk': [70],
  'kid-wardrobe': [190],
  'toy-box': [45],
  'kid-rug': [1],
  'motion-sensor': [8, 220],
  'leak-sensor': [4, 2],
  thermostat: [10, 90],
  'curtain-motor': [8, 250],
  panel: [50, 140],
  outlet: [8, 30],
  switch: [8, 90],
  light: [40, 230],
  spot: [4, 266],
  'wall-lamp': [20, 170],
  radiator: [60, 15],
  column: [270],
  piano: [130],
  box: [80],
}

/** размеры объекта в 3D: ширина, глубина, высота и высота низа, см */
export function dims3d(f: { type: string; w: number; d: number; h?: number }): { w: number; d: number; h: number; elev: number } {
  const [h, elev] = HEIGHTS[f.type] ?? [80, 0]
  return { w: f.w, d: f.d, h: f.h ?? h, elev: elev ?? 0 }
}

export const CATEGORY_COLORS: Record<CategoryKey, string> = {
  living: '#e6edf7',
  bedroom: '#f5e9d8',
  kitchen: '#e6f3e8',
  bath: '#e0f1f7',
  hall: '#efe9f6',
  office: '#fdf1dc',
  kids: '#fbe7ee',
  electric: '#ffffff',
  misc: '#ececec',
}
