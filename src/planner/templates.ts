import type { Furniture, Opening, Plan, RoomMeta, Wall } from './types'
import { CATALOG_MAP } from './catalog'

export interface Template {
  key: string
  name: string
  desc: string
  build: () => Plan
}

const W = (id: string, ax: number, ay: number, bx: number, by: number, thickness: number): Wall => ({
  id,
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  thickness,
})

/** четыре стены по часовой: верх, право, низ, лево */
const box = (p: string, x: number, y: number, w: number, h: number, th: number): Wall[] => [
  W(`${p}-top`, x, y, x + w, y, th),
  W(`${p}-right`, x + w, y, x + w, y + h, th),
  W(`${p}-bottom`, x + w, y + h, x, y + h, th),
  W(`${p}-left`, x, y + h, x, y, th),
]

const O = (id: string, kind: Opening['kind'], wallId: string, t: number, width: number, side: 1 | -1 = 1, hinge: 'a' | 'b' = 'a'): Opening => ({
  id,
  kind,
  wallId,
  t,
  width,
  hinge,
  side,
})

let fid = 0
const F = (type: string, x: number, y: number, rot = 0, extra: Partial<Furniture> = {}): Furniture => {
  const c = CATALOG_MAP[type]
  fid += 1
  return { id: `tf${fid}`, type, x, y, w: c.w, d: c.d, rot, ...extra }
}

const R = (id: string, x: number, y: number, name: string, floor: RoomMeta['floor'] = 'laminate'): RoomMeta => ({ id, anchor: { x, y }, name, floor })

const base = (name: string, walls: Wall[], openings: Opening[], furniture: Furniture[] = [], rooms: RoomMeta[] = []): Plan => ({
  version: 1,
  name,
  walls,
  openings,
  furniture,
  rooms,
  dims: [],
  settings: { grid: 10 },
})

export const TEMPLATES: Template[] = [
  {
    key: 'empty',
    name: 'Пустой лист',
    desc: 'Начните со стен: инструмент «Комната» рисует прямоугольник, «Стена» — по точкам.',
    build: () => base('Новая квартира', [], []),
  },
  {
    key: 'studio',
    name: 'Студия 32 м²',
    desc: 'Одно пространство: спальная зона, кухня вдоль стены, диван у санузла.',
    build: () => {
      fid = 0
      // наружный контур 700×520 по осям, стены 40 см → внутри 660×480
      const walls = [...box('o', 0, 0, 700, 520, 40), W('p1', 480, 0, 480, 230, 10), W('p2', 480, 230, 700, 230, 10)]
      const openings = [
        O('d-entry', 'door', 'o-right', 450 / 520, 90, 1, 'a'),
        O('d-bath', 'door', 'p1', 150 / 230, 70, 1, 'a'),
        O('w-side', 'window', 'o-left', (520 - 330) / 520, 210),
      ]
      const furniture = [
        // спальная зона
        F('bed-160', 170, 125, 0),
        F('nightstand', 42.5, 40, 0),
        F('nightstand', 272.5, 40, 0),
        F('wardrobe', 400, 50, 0, { w: 150 }),
        // кухня вдоль нижней стены
        F('fridge', 50, 467.5, 180),
        F('counter-60', 110, 470, 180),
        F('sink', 180, 470, 180),
        F('counter-60', 250, 470, 180),
        F('stove', 310, 470, 180),
        F('counter-80', 380, 470, 180),
        // обеденная зона
        F('kitchen-table', 362.5, 270, 0, { w: 75, d: 140, label: 'Стол обеденный' }),
        F('chair', 300, 270, 270),
        F('chair', 425, 270, 90),
        // гостиная зона
        F('sofa-2', 590, 280, 0),
        F('coffee-table', 590, 370, 0),
        F('rug', 580, 400, 0),
        F('tv', 590, 496, 180),
        // санузел
        F('basin', 525, 44, 0),
        F('toilet', 647.5, 80, 90),
        F('shower-120', 545, 185, 180),
        F('washer', 650, 195, 180),
        // электрика
        F('light', 350, 300, 0),
        F('light', 590, 120, 0),
        F('outlet', 42.5, 24, 0),
        F('outlet', 272.5, 24, 0),
        F('outlet', 180, 496, 180),
        F('outlet', 320, 496, 180),
        F('switch', 660, 380, 90),
      ]
      const rooms = [R('r-main', 380, 410, 'Кухня-гостиная', 'laminate'), R('r-bath', 600, 130, 'Санузел', 'tile')]
      return base('Студия', walls, openings, furniture, rooms)
    },
  },
  {
    key: 'one-room',
    name: '1-комнатная 37 м²',
    desc: 'Комната, кухня, прихожая и санузел — классическая планировка.',
    build: () => {
      fid = 0
      // 760×560 по осям, стены 40 → внутри 720×520
      const walls = [...box('o', 0, 0, 760, 560, 40), W('p1', 420, 0, 420, 560, 10), W('p2', 420, 300, 760, 300, 10), W('p3', 560, 300, 560, 560, 10)]
      const openings = [
        O('d-entry', 'door', 'o-bottom', (760 - 490) / 760, 90, 1, 'a'),
        O('d-living', 'door', 'p1', 250 / 560, 80, 1, 'a'),
        O('d-kitchen', 'door', 'p2', 50 / 340, 80, -1, 'a'),
        O('d-bath', 'door', 'p3', 80 / 260, 70, 1, 'a'),
        O('w-living', 'window', 'o-left', 0.75, 180),
        O('w-kitchen', 'window', 'o-top', 593 / 760, 140),
      ]
      const furniture = [
        // комната
        F('bed-160', 170, 125, 0),
        F('nightstand', 62.5, 40, 0),
        F('nightstand', 277.5, 40, 0),
        F('wardrobe', 120, 510, 180, { w: 160 }),
        F('sofa-2', 350, 380, 90),
        F('coffee-table', 250, 380, 90),
        F('rug', 270, 380, 90),
        F('tv', 24, 380, 270),
        F('light', 200, 300, 0),
        F('outlet', 62.5, 24, 0),
        F('outlet', 277.5, 24, 0),
        F('outlet', 24, 330, 270),
        // кухня
        F('fridge', 455, 52.5, 0),
        F('counter-60', 515, 50, 0),
        F('sink', 580, 50, 0, { w: 70 }),
        F('counter-60', 645, 50, 0),
        F('stove', 705, 50, 0),
        F('kitchen-table', 615, 260, 180, { w: 100 }),
        F('chair', 537, 260, 270),
        F('chair', 692, 260, 90),
        F('light', 590, 180, 0),
        F('outlet', 540, 24, 0),
        F('outlet', 700, 24, 0),
        // прихожая
        F('hall-wardrobe', 450, 380, 270),
        F('mirror', 427, 480, 270),
        F('switch', 545, 520, 90),
        F('light', 490, 420, 0),
        // санузел
        F('basin', 595, 329, 0),
        F('toilet', 707.5, 375, 90),
        F('bathtub-170', 652.5, 502.5, 180),
        F('light', 650, 420, 0),
      ]
      const rooms = [
        R('r-living', 300, 260, 'Гостиная', 'parquet'),
        R('r-kitchen', 580, 150, 'Кухня', 'tile'),
        R('r-hall', 490, 470, 'Прихожая', 'tile'),
        R('r-bath', 640, 400, 'Санузел', 'tile'),
      ]
      return base('Однушка', walls, openings, furniture, rooms)
    },
  },
  {
    key: 'two-room',
    name: '2-комнатная 55 м²',
    desc: 'Спальня, гостиная, кухня, санузел, кладовая и прихожая с коридором.',
    build: () => {
      fid = 0
      // 940×660 по осям, стены 40 → внутри 900×620
      const walls = [
        ...box('o', 0, 0, 940, 660, 40),
        W('p1', 400, 0, 400, 660, 10),
        W('p2', 0, 330, 400, 330, 10),
        W('p3', 540, 0, 540, 505, 10),
        W('p4', 540, 300, 940, 300, 10),
        W('p5', 760, 300, 760, 505, 10),
        W('p6', 540, 505, 940, 505, 10),
      ]
      const openings = [
        O('d-entry', 'door', 'o-bottom', (940 - 740) / 940, 90, 1, 'b'),
        O('d-bed', 'door', 'p1', 230 / 660, 80, 1, 'a'),
        O('d-living', 'door', 'p1', 420 / 660, 80, 1, 'a'),
        O('d-kitchen', 'door', 'p3', 180 / 505, 80, -1, 'a'),
        O('d-bath', 'door', 'p6', 110 / 400, 70, 1, 'a'),
        O('d-store', 'door', 'p6', 280 / 400, 70, 1, 'a'),
        O('w-bed', 'window', 'o-top', 200 / 940, 150),
        O('w-living', 'window', 'o-left', 0.25, 180),
        O('w-kitchen', 'window', 'o-top', 740 / 940, 140),
      ]
      const furniture = [
        // спальня
        F('wardrobe-slide', 52.5, 170, 270),
        F('bed-160', 235, 220, 180),
        F('nightstand', 127.5, 305, 180),
        F('nightstand', 342.5, 305, 180),
        F('light', 235, 120, 0),
        F('outlet', 127.5, 321, 180),
        F('outlet', 342.5, 321, 180),
        F('switch', 396, 300, 90),
        // гостиная
        F('sofa-3', 200, 592.5, 180),
        F('coffee-table', 200, 470, 0),
        F('rug', 200, 470, 0),
        F('tv', 200, 339, 0),
        F('bookshelf', 340, 352.5, 0),
        F('plant', 45, 610, 0),
        F('light', 200, 420, 0),
        F('outlet', 200, 338, 0),
        F('outlet', 100, 636, 180),
        // кухня
        F('fridge', 575, 52.5, 0),
        F('counter-60', 635, 50, 0),
        F('sink', 705, 50, 0),
        F('counter-60', 775, 50, 0),
        F('stove', 835, 50, 0),
        F('counter-60', 892.5, 50, 0, { w: 55 }),
        F('kitchen-table', 740, 260, 180),
        F('chair', 647, 260, 270),
        F('chair', 833, 260, 90),
        F('light', 740, 170, 0),
        F('outlet', 640, 24, 0),
        F('outlet', 780, 24, 0),
        // санузел
        F('basin', 580, 329, 0),
        F('toilet', 716, 337.5, 0),
        F('bathtub-150', 620, 460.5, 180),
        F('washer', 725, 470, 180),
        F('light', 650, 400, 0),
        // прихожая и коридор
        F('hall-wardrobe', 895, 575, 90),
        F('shoe-rack', 640, 625, 180),
        F('mirror', 407, 560, 270),
        F('switch', 900, 636, 180),
        F('light', 470, 250, 0),
        F('light', 700, 580, 0),
      ]
      const rooms = [
        R('r-bed', 300, 60, 'Спальня', 'laminate'),
        R('r-living', 340, 520, 'Гостиная', 'parquet'),
        R('r-kitchen', 690, 130, 'Кухня', 'tile'),
        R('r-bath', 650, 380, 'Санузел', 'tile'),
        R('r-store', 842, 400, 'Кладовая', 'plain'),
        R('r-hall', 640, 580, 'Прихожая', 'tile'),
      ]
      return base('Двушка', walls, openings, furniture, rooms)
    },
  },
]

export const TEMPLATE_MAP: Record<string, Template> = Object.fromEntries(TEMPLATES.map((t) => [t.key, t]))
