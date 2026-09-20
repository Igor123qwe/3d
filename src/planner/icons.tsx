// Векторные иконки интерфейса.
//
// Раньше инструменты и меню рисовались символами юникода (⬚ ╱ ▭ ☰): в разных
// шрифтах они выглядят по-разному, а на Windows часть вовсе заменяется квадратами.
// Здесь — единый набор линейных иконок 20×20 в одном стиле, как у современных
// планировщиков. Все пути нарисованы в сетке 24×24 и масштабируются.
import React from 'react'

export type IconName =
  | 'select'
  | 'wall'
  | 'room'
  | 'door'
  | 'window'
  | 'doorway'
  | 'dimension'
  | 'ruler'
  | 'calibrate'
  | 'furniture'
  | 'ortho'
  | 'zones'
  | 'undo'
  | 'redo'
  | 'zoomIn'
  | 'zoomOut'
  | 'fit'
  | 'upload'
  | 'image'
  | 'file'
  | 'save'
  | 'download'
  | 'clipboard'
  | 'plus'
  | 'template'
  | 'layers'
  | 'settings'
  | 'help'
  | 'check'
  | 'cube'
  | 'close'
  | 'sparkles'
  | 'link'
  | 'bolt'
  | 'list'
  | 'grid'
  | 'arrowLeft'
  | 'chevronDown'
  | 'phone'
  | 'trash'
  | 'pencil'
  | 'history'
  | 'search'

const PATHS: Record<IconName, React.ReactNode> = {
  select: <path d="M5 3l14 8-6 2-3 6z" />,
  wall: (
    <>
      <path d="M4 20V4h16" />
      <path d="M8 20V8M12 20v-8M16 20V8M20 8H8" />
    </>
  ),
  room: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M4 12h16M12 4v8" />
    </>
  ),
  door: (
    <>
      <path d="M4 20h16" />
      <path d="M6 20V6" />
      <path d="M6 6a12 12 0 0 1 12 12" strokeDasharray="2 3" />
      <path d="M18 20v-2" />
    </>
  ),
  window: (
    <>
      <rect x="3" y="7" width="18" height="10" rx="1" />
      <path d="M3 12h18M12 7v10" />
    </>
  ),
  doorway: (
    <>
      <path d="M3 20h5M16 20h5" />
      <path d="M8 20V8a4 4 0 0 1 8 0v12" />
    </>
  ),
  dimension: (
    <>
      <path d="M3 12h18" />
      <path d="M6 9l-3 3 3 3M18 9l3 3-3 3" />
      <path d="M3 5v14M21 5v14" strokeOpacity="0.5" />
    </>
  ),
  ruler: (
    <>
      <rect x="2" y="9" width="20" height="6" rx="1" transform="rotate(-45 12 12)" />
      <path d="M9 15l1.5-1.5M12 12l1.5-1.5M15 9l1.5-1.5" />
    </>
  ),
  calibrate: (
    <>
      <path d="M4 20L20 4" />
      <path d="M4 20h6M4 20v-6" />
      <path d="M20 4h-6M20 4v6" />
    </>
  ),
  furniture: (
    <>
      <path d="M4 14v-3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3" />
      <rect x="2" y="13" width="20" height="5" rx="1.5" />
      <path d="M5 18v2M19 18v2" />
    </>
  ),
  ortho: (
    <>
      <path d="M5 4v15h15" />
      <path d="M5 19l10-10" strokeDasharray="2 3" />
    </>
  ),
  zones: (
    <>
      <rect x="8" y="8" width="8" height="8" rx="1" />
      <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 3" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </>
  ),
  redo: (
    <>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H10a6 6 0 0 0 0 12h3" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.5-4.5M8 11h6M11 8v6" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.5-4.5M8 11h6" />
    </>
  ),
  fit: (
    <>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 16l-5-5-8 8" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </>
  ),
  save: (
    <>
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M8 3v5h7V3M8 21v-6h8v6" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v12M7 11l5 5 5-5" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </>
  ),
  clipboard: (
    <>
      <rect x="6" y="5" width="12" height="16" rx="2" />
      <path d="M9 5V3h6v2M9 11h6M9 15h4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  template: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 10h18M10 10v11" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5M3 17l9 5 9-5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l3 3 5-6" />
    </>
  ),
  cube: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  sparkles: (
    <>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  grid: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </>
  ),
  arrowLeft: <path d="M19 12H5M11 18l-6-6 6-6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  phone: (
    <>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20l4-1 11-11-3-3L5 16z" />
      <path d="M13 8l3 3" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5M12 8v4l3 2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.5-4.5" />
    </>
  ),
}

interface IconProps {
  name: IconName
  size?: number
  className?: string
  /** толщина линии; у крупных пиктограмм на стартовом экране она тоньше */
  stroke?: number
}

export const Icon: React.FC<IconProps> = ({ name, size = 20, className, stroke = 1.75 }) => (
  <svg
    className={className ? `pl-icon ${className}` : 'pl-icon'}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {PATHS[name]}
  </svg>
)

export const ICON_NAMES = Object.keys(PATHS) as IconName[]
