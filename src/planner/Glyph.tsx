import React from 'react'
import type { Furniture } from './types'
import { CATALOG_MAP, CATEGORY_COLORS, type CatalogItem } from './catalog'

const S = {
  stroke: '#2f2f2f',
  strokeWidth: 1.2,
  vectorEffect: 'non-scaling-stroke' as const,
  strokeLinejoin: 'round' as const,
  strokeLinecap: 'round' as const,
}
const THIN = { ...S, strokeWidth: 0.8, stroke: '#4a4a4a' }

const darker = (hex: string, k = 0.12): string => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const v = parseInt(m[1], 16)
  const r = Math.round(((v >> 16) & 255) * (1 - k))
  const g = Math.round(((v >> 8) & 255) * (1 - k))
  const b = Math.round((v & 255) * (1 - k))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

interface Props {
  item: Furniture
  cat?: CatalogItem
  /** масштаб экрана (px/см) — для символов постоянного размера */
  zoom: number
}

/** Условное обозначение объекта в локальных координатах (центр в 0,0; спинка сверху) */
const GlyphImpl: React.FC<Props> = ({ item, cat = CATALOG_MAP[item.type], zoom }) => {
  const w = item.w
  const d = item.d
  const hw = w / 2
  const hd = d / 2
  const fill = item.color || (cat ? CATEGORY_COLORS[cat.category] : '#eee')
  const dark = darker(fill)
  const body = (rx = 3, extra: React.SVGProps<SVGRectElement> = {}) => (
    <rect x={-hw} y={-hd} width={w} height={d} rx={rx} fill={fill} {...S} {...extra} />
  )
  const glyph = cat?.glyph ?? 'box'

  switch (glyph) {
    case 'bed': {
      const two = w >= 120
      const pw = two ? (w - 30) / 2 : w - 24
      return (
        <g>
          {body(6)}
          <rect x={-hw} y={-hd} width={w} height={9} fill={dark} {...S} />
          {two ? (
            <>
              <rect x={-hw + 10} y={-hd + 15} width={pw} height={30} rx={6} fill="#fff" {...THIN} />
              <rect x={hw - 10 - pw} y={-hd + 15} width={pw} height={30} rx={6} fill="#fff" {...THIN} />
            </>
          ) : (
            <rect x={-pw / 2} y={-hd + 15} width={pw} height={30} rx={6} fill="#fff" {...THIN} />
          )}
          <path d={`M ${-hw} ${-hd + 62} L ${hw} ${-hd + 62} L ${hw} ${-hd + 70} Q ${hw - 20} ${-hd + 66} ${hw - 40} ${-hd + 70} L ${-hw} ${-hd + 70}`} fill={dark} {...THIN} />
        </g>
      )
    }
    case 'sofa':
    case 'armchair': {
      const arm = 14
      const back = 16
      const cushions = glyph === 'armchair' ? 1 : w >= 200 ? 3 : 2
      const cw = (w - arm * 2) / cushions
      return (
        <g>
          {body(10)}
          <rect x={-hw} y={-hd} width={w} height={back} rx={6} fill={dark} {...S} />
          <rect x={-hw} y={-hd} width={arm} height={d} rx={6} fill={dark} {...S} />
          <rect x={hw - arm} y={-hd} width={arm} height={d} rx={6} fill={dark} {...S} />
          {Array.from({ length: cushions - 1 }, (_, i) => (
            <line key={i} x1={-hw + arm + cw * (i + 1)} y1={-hd + back} x2={-hw + arm + cw * (i + 1)} y2={hd} {...THIN} />
          ))}
        </g>
      )
    }
    case 'sofa-corner': {
      const seat = 95
      const arm = 14
      const back = 16
      return (
        <g>
          <path
            d={`M ${-hw} ${-hd} H ${hw} V ${hd} H ${hw - seat} V ${-hd + seat} H ${-hw} Z`}
            fill={fill}
            {...S}
          />
          <rect x={-hw} y={-hd} width={w} height={back} fill={dark} {...S} />
          <rect x={hw - back} y={-hd} width={back} height={d} fill={dark} {...S} />
          <rect x={-hw} y={-hd} width={arm} height={seat} fill={dark} {...S} />
          <line x1={-hw + (w - seat) / 2} y1={-hd + back} x2={-hw + (w - seat) / 2} y2={-hd + seat} {...THIN} />
          <line x1={hw - seat} y1={-hd + seat} x2={hw - back} y2={-hd + seat} {...THIN} />
        </g>
      )
    }
    case 'table':
      return body(4)
    case 'table-round':
      return <ellipse cx={0} cy={0} rx={hw} ry={hd} fill={fill} {...S} />
    case 'chair':
      return (
        <g>
          <rect x={-hw} y={-hd + 7} width={w} height={d - 7} rx={5} fill={fill} {...S} />
          <rect x={-hw} y={-hd} width={w} height={8} rx={3} fill={dark} {...S} />
        </g>
      )
    case 'stool':
      return (
        <g>
          <ellipse cx={0} cy={0} rx={hw} ry={hd} fill={fill} {...S} />
          <ellipse cx={0} cy={0} rx={hw * 0.55} ry={hd * 0.55} fill="none" {...THIN} />
        </g>
      )
    case 'wardrobe': {
      const doors = Math.max(1, Math.round(w / 50))
      return (
        <g>
          {body(1)}
          {Array.from({ length: doors - 1 }, (_, i) => (
            <line key={i} x1={-hw + ((i + 1) * w) / doors} y1={-hd} x2={-hw + ((i + 1) * w) / doors} y2={hd} {...THIN} />
          ))}
          <line x1={-hw} y1={-hd} x2={hw} y2={hd} {...THIN} strokeDasharray="4 3" />
          <line x1={-hw} y1={hd - 5} x2={hw} y2={hd - 5} {...THIN} />
        </g>
      )
    }
    case 'wardrobe-slide':
      return (
        <g>
          {body(1)}
          <line x1={-hw} y1={-hd} x2={hw} y2={hd} {...THIN} strokeDasharray="4 3" />
          <line x1={-hw + 2} y1={hd - 4} x2={2} y2={hd - 4} {...S} />
          <line x1={-2} y1={hd - 8} x2={hw - 2} y2={hd - 8} {...S} />
        </g>
      )
    case 'drawers':
      return (
        <g>
          {body(2)}
          <rect x={-hw + 4} y={-hd + 4} width={w - 8} height={d - 8} rx={1} fill="none" {...THIN} />
          <line x1={-Math.min(12, hw / 2)} y1={hd - 4} x2={Math.min(12, hw / 2)} y2={hd - 4} {...S} />
        </g>
      )
    case 'desk':
      return (
        <g>
          {body(2)}
          <rect x={-Math.min(28, hw * 0.4)} y={-hd + 6} width={Math.min(56, w * 0.8)} height={4} fill="#333" {...THIN} />
        </g>
      )
    case 'counter':
      return (
        <g>
          {body(0)}
          <line x1={-hw} y1={-hd + 3} x2={hw} y2={-hd + 3} {...THIN} />
        </g>
      )
    case 'sink':
      return (
        <g>
          {body(0)}
          <line x1={-hw} y1={-hd + 3} x2={hw} y2={-hd + 3} {...THIN} />
          <rect x={-w * 0.3} y={-hd + 12} width={w * 0.6} height={d - 22} rx={5} fill="#fff" {...S} />
          <circle cx={0} cy={-hd + 8} r={3} fill="#666" {...THIN} />
        </g>
      )
    case 'stove': {
      const r = Math.min(w, d) * 0.15
      return (
        <g>
          {body(0)}
          {[
            [-w / 4, -d / 4],
            [w / 4, -d / 4],
            [-w / 4, d / 4],
            [w / 4, d / 4],
          ].map(([cx, cy], i) => (
            <g key={i}>
              <circle cx={cx} cy={cy} r={r} fill="none" {...S} />
              <circle cx={cx} cy={cy} r={r * 0.4} fill="none" {...THIN} />
            </g>
          ))}
        </g>
      )
    }
    case 'fridge':
      return (
        <g>
          {body(2)}
          <line x1={-hw} y1={hd - 4} x2={hw} y2={hd - 4} {...THIN} />
          <line x1={-hw + 6} y1={-hd + 6} x2={hw - 6} y2={hd - 8} {...THIN} />
          <line x1={hw - 6} y1={-hd + 6} x2={-hw + 6} y2={hd - 8} {...THIN} />
        </g>
      )
    case 'dishwasher':
      return (
        <g>
          {body(1)}
          <rect x={-hw + 6} y={-hd + 6} width={w - 12} height={d - 12} rx={1} fill="none" {...THIN} />
          <line x1={-hw} y1={hd - 4} x2={hw} y2={hd - 4} {...THIN} />
        </g>
      )
    case 'washer':
      return (
        <g>
          {body(1)}
          <circle cx={0} cy={2} r={Math.min(w, d) * 0.32} fill="#fff" {...S} />
          <circle cx={0} cy={2} r={Math.min(w, d) * 0.2} fill="none" {...THIN} />
        </g>
      )
    case 'toilet': {
      const tank = 18
      return (
        <g>
          <rect x={-hw} y={-hd} width={w} height={tank} rx={3} fill={dark} {...S} />
          <ellipse cx={0} cy={tank / 2} rx={hw - 1} ry={(d - tank) / 2 - 1} fill={fill} {...S} />
          <ellipse cx={0} cy={tank / 2} rx={hw * 0.6} ry={(d - tank) * 0.3} fill="#fff" {...THIN} />
        </g>
      )
    }
    case 'basin':
      return (
        <g>
          {body(2)}
          <ellipse cx={0} cy={3} rx={w * 0.3} ry={d * 0.3} fill="#fff" {...S} />
          <circle cx={0} cy={-hd + 7} r={3} fill="#666" {...THIN} />
        </g>
      )
    case 'bathtub':
      return (
        <g>
          {body(12)}
          <rect x={-hw + 8} y={-hd + 8} width={w - 16} height={d - 16} rx={10} fill="#fff" {...S} />
          <circle cx={-hw + 24} cy={0} r={4} fill="none" {...THIN} />
        </g>
      )
    case 'shower':
      return (
        <g>
          {body(2)}
          <rect x={-hw + 6} y={-hd + 6} width={w - 12} height={d - 12} fill="#fff" {...THIN} />
          <line x1={-hw + 6} y1={-hd + 6} x2={hw - 6} y2={hd - 6} {...THIN} />
          <line x1={hw - 6} y1={-hd + 6} x2={-hw + 6} y2={hd - 6} {...THIN} />
          <circle cx={0} cy={0} r={4} fill="#fff" {...S} />
        </g>
      )
    case 'tv':
      return <rect x={-hw} y={-hd} width={w} height={d} rx={1} fill="#222" {...S} />
    case 'shelf': {
      const n = Math.max(1, Math.round(w / 40))
      return (
        <g>
          {body(1)}
          {Array.from({ length: n - 1 }, (_, i) => (
            <line key={i} x1={-hw + ((i + 1) * w) / n} y1={-hd} x2={-hw + ((i + 1) * w) / n} y2={hd} {...THIN} />
          ))}
        </g>
      )
    }
    case 'rug':
      return <rect x={-hw} y={-hd} width={w} height={d} rx={2} fill={item.color || '#d9c9b4'} fillOpacity={0.55} {...S} strokeDasharray="6 4" />
    case 'plant':
      return (
        <g>
          <circle cx={0} cy={0} r={hw} fill="#cfe4cf" {...S} />
          <circle cx={0} cy={0} r={hw * 0.55} fill="#a7cba7" {...THIN} />
          <circle cx={0} cy={0} r={hw * 0.2} fill="#7fb07f" {...THIN} />
        </g>
      )
    case 'lamp':
      return (
        <g>
          <circle cx={0} cy={0} r={hw} fill="#fff6d5" {...S} />
          <circle cx={0} cy={0} r={3} fill="#333" />
        </g>
      )
    case 'crib':
      return (
        <g>
          {body(4)}
          <rect x={-hw + 6} y={-hd + 6} width={w - 12} height={d - 12} rx={3} fill="#fff" {...THIN} />
          <line x1={-hw} y1={-hd} x2={-hw} y2={hd} {...S} strokeDasharray="3 3" />
          <line x1={hw} y1={-hd} x2={hw} y2={hd} {...S} strokeDasharray="3 3" />
        </g>
      )
    case 'radiator': {
      const n = Math.max(2, Math.round(w / 8))
      return (
        <g>
          {body(1, { fill: '#fff' })}
          {Array.from({ length: n - 1 }, (_, i) => (
            <line key={i} x1={-hw + ((i + 1) * w) / n} y1={-hd} x2={-hw + ((i + 1) * w) / n} y2={hd} {...THIN} />
          ))}
        </g>
      )
    }
    case 'mirror':
      return (
        <g>
          {body(0, { fill: '#cde5f5' })}
          <line x1={-hw} y1={hd} x2={hw} y2={-hd} {...THIN} />
        </g>
      )
    case 'column':
      return <rect x={-hw} y={-hd} width={w} height={d} fill="#4a4a4a" {...S} />
    case 'bench':
      return body(7)
    case 'outlet':
      return (
        <g transform={`scale(${1 / zoom})`}>
          <line x1={-8} y1={0} x2={8} y2={0} {...S} />
          <path d="M -7 0 A 7 7 0 0 0 7 0" fill="#fff" {...S} />
          <line x1={0} y1={0} x2={0} y2={-6} {...S} />
        </g>
      )
    case 'switch':
      return (
        <g transform={`scale(${1 / zoom})`}>
          <line x1={-8} y1={0} x2={8} y2={0} {...S} />
          <circle cx={0} cy={5} r={4.5} fill="#fff" {...S} />
          <line x1={3} y1={2} x2={9} y2={-5} {...S} />
          <line x1={7} y1={-5} x2={10} y2={-2} {...S} />
        </g>
      )
    case 'light':
      return (
        <g transform={`scale(${1 / zoom})`}>
          <circle cx={0} cy={0} r={9} fill="#fff8dc" {...S} />
          <line x1={-6.4} y1={-6.4} x2={6.4} y2={6.4} {...S} />
          <line x1={6.4} y1={-6.4} x2={-6.4} y2={6.4} {...S} />
        </g>
      )
    case 'spot':
      return (
        <g transform={`scale(${1 / zoom})`}>
          <circle cx={0} cy={0} r={5.5} fill="#fff" {...S} />
          <circle cx={0} cy={0} r={1.8} fill="#333" />
        </g>
      )
    case 'sensor':
      return (
        <g transform={`scale(${1 / zoom})`}>
          <circle cx={0} cy={0} r={6} fill="#fff" {...S} />
          <path d="M -3.2 2.4 A 4 4 0 0 1 3.2 2.4" fill="none" {...S} />
          <path d="M -5.4 4.6 A 7 7 0 0 1 5.4 4.6" fill="none" {...THIN} />
          <circle cx={0} cy={-1.5} r={1.4} fill="#333" />
        </g>
      )
    case 'thermostat':
      return (
        <g transform={`scale(${1 / zoom})`}>
          <rect x={-6} y={-6} width={12} height={12} rx={2.5} fill="#fff" {...S} />
          <circle cx={0} cy={0} r={3.2} fill="none" {...S} />
          <line x1={0} y1={0} x2={0} y2={-3.2} {...S} />
          <line x1={0} y1={0} x2={2.4} y2={1.6} {...THIN} />
        </g>
      )
    case 'curtain':
      return (
        <g transform={`scale(${1 / zoom})`}>
          <line x1={-10} y1={-3} x2={10} y2={-3} {...S} />
          <path d="M -8 -3 q 2 5 0 9 M -4 -3 q 2 5 0 9 M 0 -3 q 2 5 0 9" fill="none" {...THIN} />
          <path d="M 5 2 l 5 0 l -1.6 -1.8 M 10 2 l -1.6 1.8" fill="none" {...S} />
        </g>
      )
    case 'panel':
      return (
        <g transform={`scale(${1 / zoom})`}>
          <rect x={-11} y={-7} width={22} height={14} rx={1.5} fill="#fff" {...S} />
          <line x1={-11} y1={-2} x2={11} y2={-2} {...THIN} />
          {[-8, -4, 0, 4, 8].map((x) => (
            <line key={x} x1={x} y1={-6} x2={x} y2={-3} {...THIN} />
          ))}
          <line x1={-8} y1={3} x2={8} y2={3} {...THIN} />
        </g>
      )
    case 'box':
    default:
      return body(2)
  }
}

/** значок зависит только от предмета и масштаба: сотни предметов не перерисовываются на каждое движение */
export const Glyph = React.memo(GlyphImpl)
