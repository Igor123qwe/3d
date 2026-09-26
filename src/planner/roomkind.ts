// Назначение комнаты по её имени — одно место для всех правил.
//
// Раньше проверки, электрика и расстановка держали по своему списку
// («Санузел» с большой буквы в одном, /санузел|душ/i в другом), и комната
// «Спальня 2» или «санузел» строчными выпадала из правил. Здесь один разбор
// без учёта регистра и с номерами; все модули спрашивают его.

export type RoomKind =
  | 'living'
  | 'bedroom'
  | 'kids'
  | 'office'
  | 'kitchen'
  | 'dining'
  | 'wet'
  | 'hall'
  | 'storage'
  | 'outdoor'
  | 'other'

const RULES: [RegExp, RoomKind][] = [
  [/кухн|столов/i, 'kitchen'],
  [/санузел|ванн|туалет|уборн|душ|с\/у/i, 'wet'],
  [/прихож|коридор|холл|тамбур/i, 'hall'],
  [/кладов|гардероб|шахт|ниш/i, 'storage'],
  [/балкон|лодж|терас|веранд/i, 'outdoor'],
  [/детск/i, 'kids'],
  [/кабинет|рабоч/i, 'office'],
  [/спальн|гостев/i, 'bedroom'],
  [/гостин|зал|студи|комнат|жил/i, 'living'],
]

/** назначение по имени; «Кухня-гостиная» — кухня (там мокрая зона и нормы кухни) */
export function roomKind(name: string): RoomKind {
  for (const [re, kind] of RULES) if (re.test(name)) return kind
  return 'other'
}

/** мокрая зона: розетки только для техники, УЗО 10 мА, свет снаружи */
export const isWet = (name: string): boolean => roomKind(name) === 'wet'
/** кухня и кухня-гостиная: столешница, техника на своих линиях, 4 розетки по норме */
export const isKitchen = (name: string): boolean => roomKind(name) === 'kitchen'
/** прихожая и коридор: щит, датчик движения, розетка на 10 м² */
export const isHall = (name: string): boolean => roomKind(name) === 'hall'
/** балкон и лоджия: не обставляется, розетки не по норме */
export const isOutdoor = (name: string): boolean => roomKind(name) === 'outdoor'
/** кладовая, гардеробная, шахта: без норм на розетки и без окна */
export const isStorage = (name: string): boolean => roomKind(name) === 'storage'
/** жилая комната: нужен естественный свет, действует норма «розетка на 4 м периметра» */
export const isLiving = (name: string): boolean => ['living', 'bedroom', 'kids', 'office', 'kitchen', 'dining'].includes(roomKind(name))
/** назначение задано разводкой — зонирование его не переназначает */
export const isFixedPurpose = (name: string): boolean => ['kitchen', 'wet', 'hall', 'outdoor'].includes(roomKind(name))
/** комнату не обставляют: балкон, кладовая, шахта */
export const isSkippedForFurnish = (name: string): boolean => ['outdoor', 'storage'].includes(roomKind(name))
