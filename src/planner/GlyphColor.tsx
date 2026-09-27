// Цветной вид мебели сверху — как на современных планах интерьера, а не чертёж.
// Мягкие скругления, материалы вместо категорий, живые детали: подушки и плед на
// кровати, книги на полках, одежда в шкафу, листья у растений, свет у ламп.
// Локальные координаты: центр в (0, 0), спинка сверху (−d/2), фасад снизу.
import React from 'react'
import type { Furniture } from './types'
import type { CatalogItem } from './catalog'
import { accentOf, baseColorOf, MAT, seeded, shade, SPINES, tint } from './palette'

const NS = { vectorEffect: 'non-scaling-stroke' as const, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }
/** обводка — тоном темнее заливки, а не чёрная: так выглядит современный план */
const edge = (c: string, w = 0.9) => ({ stroke: c, strokeWidth: w, ...NS })

interface Props {
  item: Furniture
  cat?: CatalogItem
}

export const ColorGlyph: React.FC<Props> = ({ item, cat }) => {
  const w = item.w
  const d = item.d
  const hw = w / 2
  const hd = d / 2
  const glyph = cat?.glyph ?? 'box'
  const type = item.type
  const main = item.color || baseColorOf(type, glyph)
  const accent = accentOf(main)
  const box = (x: number, y: number, ww: number, hh: number, rx: number, fill: string, stroke = shade(fill, 0.2), extra: React.SVGProps<SVGRectElement> = {}) => (
    <rect x={x} y={y} width={Math.max(0.5, ww)} height={Math.max(0.5, hh)} rx={Math.min(rx, ww / 2, hh / 2)} fill={fill} {...edge(stroke)} {...extra} />
  )
  const rnd = seeded(item.id + type)

  switch (glyph) {
    case 'bed': {
      const frame = MAT.oak
      const two = w >= 120
      const pw = two ? (w - 26) / 2 : Math.min(w - 20, 60)
      const blanketTop = -hd + Math.min(58, d * 0.3)
      return (
        <g>
          {box(-hw, -hd, w, d, 7, frame)}
          {box(-hw, -hd, w, 11, 5, shade(frame, 0.15))}
          {box(-hw + 4, -hd + 11, w - 8, d - 15, 6, MAT.linen, '#e4dacb')}
          {two ? (
            <>
              {box(-hw + 9, -hd + 16, pw, 28, 10, MAT.pillow, '#e2d8ca')}
              {box(hw - 9 - pw, -hd + 16, pw, 28, 10, MAT.pillow, '#e2d8ca')}
              {box(-hw + 18, -hd + 34, 22, 16, 5, accent, shade(accent, 0.2), { transform: `rotate(-8 ${-hw + 29} ${-hd + 42})` })}
            </>
          ) : (
            box(-pw / 2, -hd + 16, pw, 28, 10, MAT.pillow, '#e2d8ca')
          )}
          {box(-hw + 4, blanketTop, w - 8, hd - blanketTop - 4, 6, main)}
          {box(-hw + 4, blanketTop, w - 8, 13, 5, tint(main, 0.35))}
          {/* плед в ногах — акцент */}
          {box(-hw + 4, hd - 38, w - 8, 22, 3, accent, shade(accent, 0.2), { opacity: 0.92 })}
        </g>
      )
    }
    case 'crib':
      return (
        <g>
          {box(-hw, -hd, w, d, 6, MAT.birch)}
          {box(-hw + 5, -hd + 5, w - 10, d - 10, 5, MAT.linen, '#e4dacb')}
          {box(-hw + 5, -hd + d * 0.45, w - 10, d * 0.55 - 5, 5, main)}
          {Array.from({ length: Math.max(2, Math.floor(d / 12)) }, (_, i) => {
            const y = -hd + 6 + (i * (d - 12)) / Math.max(1, Math.floor(d / 12) - 1)
            return (
              <g key={i}>
                <line x1={-hw + 1.5} y1={y} x2={-hw + 4} y2={y} {...edge(shade(MAT.birch, 0.3), 0.8)} />
                <line x1={hw - 4} y1={y} x2={hw - 1.5} y2={y} {...edge(shade(MAT.birch, 0.3), 0.8)} />
              </g>
            )
          })}
        </g>
      )
    case 'sofa':
    case 'armchair': {
      const arm = Math.min(16, w * 0.14)
      const back = Math.min(20, d * 0.24)
      const n = glyph === 'armchair' ? 1 : w >= 200 ? 3 : 2
      const cw = (w - arm * 2) / n
      return (
        <g>
          {box(-hw, -hd, w, d, 13, shade(main, 0.08))}
          {box(-hw, -hd, w, back + 5, 11, shade(main, 0.2))}
          {box(-hw, -hd, arm, d, 10, shade(main, 0.15))}
          {box(hw - arm, -hd, arm, d, 10, shade(main, 0.15))}
          {Array.from({ length: n }, (_, i) => (
            <React.Fragment key={i}>{box(-hw + arm + i * cw + 1.5, -hd + back + 1, cw - 3, d - back - 5, 8, tint(main, 0.1), shade(main, 0.18))}</React.Fragment>
          ))}
          {/* подушки — акцент */}
          {glyph === 'sofa' && (
            <>
              {box(-hw + arm + 4, -hd + back - 4, 24, 22, 6, accent, shade(accent, 0.2), { transform: `rotate(-10 ${-hw + arm + 16} ${-hd + back + 7})` })}
              {box(hw - arm - 28, -hd + back - 4, 24, 22, 6, tint(accent, 0.3), shade(accent, 0.2), { transform: `rotate(9 ${hw - arm - 16} ${-hd + back + 7})` })}
            </>
          )}
        </g>
      )
    }
    case 'sofa-corner': {
      const seat = Math.min(95, d * 0.6)
      const back = 18
      const arm = 14
      const path = `M ${-hw + 12} ${-hd} H ${hw - 12} Q ${hw} ${-hd} ${hw} ${-hd + 12} V ${hd - 12} Q ${hw} ${hd} ${hw - 12} ${hd} H ${hw - seat} V ${-hd + seat} H ${-hw + 12} Q ${-hw} ${-hd + seat} ${-hw} ${-hd + seat - 12} V ${-hd + 12} Q ${-hw} ${-hd} ${-hw + 12} ${-hd} Z`
      const long = w - seat - arm
      return (
        <g>
          <path d={path} fill={shade(main, 0.08)} {...edge(shade(main, 0.25))} />
          {box(-hw, -hd, w, back + 4, 10, shade(main, 0.2))}
          {box(hw - back - 4, -hd, back + 4, d, 10, shade(main, 0.2))}
          {box(-hw, -hd, arm, seat, 9, shade(main, 0.15))}
          {[0, 1].map((i) => (
            <React.Fragment key={i}>{box(-hw + arm + 1.5 + (i * long) / 2, -hd + back + 1, long / 2 - 3, seat - back - 5, 8, tint(main, 0.1), shade(main, 0.18))}</React.Fragment>
          ))}
          {box(hw - seat + 1.5, -hd + back + 1, seat - back - 7, seat - back - 5, 8, tint(main, 0.1), shade(main, 0.18))}
          {box(hw - seat + 1.5, -hd + seat, seat - back - 7, d - seat - 4, 8, tint(main, 0.1), shade(main, 0.18))}
          {box(hw - back - 30, -hd + back - 3, 24, 22, 6, accent, shade(accent, 0.2), { transform: `rotate(12 ${hw - back - 18} ${-hd + back + 8})` })}
        </g>
      )
    }
    case 'table': {
      const wood = type === 'coffee-table' ? MAT.walnut : main
      const grain = shade(wood, 0.1)
      return (
        <g>
          {box(-hw, -hd, w, d, 5, wood)}
          {[0.3, 0.55, 0.78].map((t, i) => (
            <path key={i} d={`M ${-hw + 5} ${-hd + d * t} q ${w * 0.25} ${-2} ${w * 0.5} 0 t ${w * 0.5 - 10} 0`} fill="none" {...edge(grain, 0.6)} opacity={0.5} />
          ))}
          {type === 'coffee-table' && (
            <>
              {box(-hw + w * 0.12, -hd + d * 0.25, w * 0.28, d * 0.5, 2, SPINES[0], shade(SPINES[0], 0.2))}
              <circle cx={hw - w * 0.22} cy={0} r={Math.min(8, d * 0.18)} fill={MAT.ceramic} {...edge('#d6d0c6')} />
              <circle cx={hw - w * 0.22} cy={0} r={Math.min(4, d * 0.09)} fill={MAT.leaves[1]} {...edge(MAT.leaves[3], 0.6)} />
            </>
          )}
        </g>
      )
    }
    case 'table-round':
      return (
        <g>
          <ellipse cx={0} cy={0} rx={hw} ry={hd} fill={main} {...edge(shade(main, 0.22))} />
          <ellipse cx={0} cy={0} rx={hw * 0.72} ry={hd * 0.72} fill="none" {...edge(shade(main, 0.1), 0.6)} opacity={0.6} />
          <circle cx={0} cy={0} r={Math.min(9, hw * 0.16)} fill={MAT.ceramic} {...edge('#d6d0c6')} />
          <circle cx={0} cy={0} r={Math.min(5, hw * 0.09)} fill={MAT.leaves[2]} {...edge(MAT.leaves[3], 0.6)} />
        </g>
      )
    case 'chair':
      return (
        <g>
          {box(-hw + 1, -hd + 7, w - 2, d - 8, 9, main)}
          <path d={`M ${-hw + 2} ${-hd + 10} Q 0 ${-hd - 3} ${hw - 2} ${-hd + 10}`} fill="none" {...edge(shade(MAT.walnut, 0.05), 3.2)} />
        </g>
      )
    case 'stool': {
      const r = Math.min(hw, hd)
      if (type === 'office-chair') {
        return (
          <g>
            {[0, 72, 144, 216, 288].map((a) => {
              const rad = ((a - 90) * Math.PI) / 180
              return <line key={a} x1={0} y1={0} x2={Math.cos(rad) * r} y2={Math.sin(rad) * r} {...edge(MAT.metal, 2)} />
            })}
            <circle cx={0} cy={2} r={r * 0.62} fill={main} {...edge(shade(main, 0.3))} />
            <path d={`M ${-r * 0.62} ${-r * 0.35} Q 0 ${-r * 0.95} ${r * 0.62} ${-r * 0.35}`} fill="none" {...edge(shade(main, 0.35), 4)} />
          </g>
        )
      }
      return (
        <g>
          <circle cx={0} cy={0} r={r} fill={type === 'bar-stool' ? MAT.oak : main} {...edge(shade(type === 'bar-stool' ? MAT.oak : main, 0.25))} />
          <circle cx={0} cy={0} r={r * 0.62} fill="none" {...edge(shade(MAT.oak, 0.2), 0.7)} opacity={0.7} />
        </g>
      )
    }
    case 'wardrobe':
    case 'wardrobe-slide': {
      // пенал кухни — не шкаф с одеждой, а белая колонна с духовкой
      if (type === 'tall-cabinet') {
        return (
          <g>
            {box(-hw, -hd, w, d, 3, '#f3f4f5', '#c7ccd1')}
            {box(-hw + 6, -hd + d * 0.35, w - 12, d * 0.4, 3, MAT.glass)}
            <line x1={-hw + 8} y1={hd - 4} x2={hw - 8} y2={hd - 4} {...edge('#9aa1a8', 1.2)} />
          </g>
        )
      }
      // шкаф для бумаг — папки корешками
      if (type === 'cabinet') {
        const n = Math.max(3, Math.floor((w - 8) / 7))
        return (
          <g>
            {box(-hw, -hd, w, d, 3, MAT.white, '#d8d1c6')}
            {Array.from({ length: n }, (_, i) => (
            <React.Fragment key={i}>{box(-hw + 4 + (i * (w - 8)) / n, -hd + 5, (w - 8) / n - 1, d - 12, 1, SPINES[i % SPINES.length], 'none')}</React.Fragment>
          ))}
          </g>
        )
      }
      // сверху видно штангу и одежду на плечиках: приглушённая радуга
      const rail = -hd + d * 0.46
      const n = Math.max(2, Math.floor((w - 10) / 6.5))
      return (
        <g>
          {box(-hw, -hd, w, d, 3, main === MAT.white ? MAT.white : main, '#d6cec2')}
          {Array.from({ length: n }, (_, i) => {
            const x = -hw + 6 + i * ((w - 12) / Math.max(1, n - 1))
            const h = d * (0.5 + rnd() * 0.12)
            return <rect key={i} x={x - 1.6} y={rail - h / 2} width={3.2} height={h} rx={1.4} fill={SPINES[Math.floor(rnd() * SPINES.length)]} opacity={0.85} />
          })}
          <line x1={-hw + 3} y1={rail} x2={hw - 3} y2={rail} {...edge('#9d9385', 0.9)} />
          {glyph === 'wardrobe-slide' ? (
            <>
              <line x1={-hw + 2} y1={hd - 3} x2={1} y2={hd - 3} {...edge('#b8ad9e', 2)} />
              <line x1={-1} y1={hd - 7} x2={hw - 2} y2={hd - 7} {...edge('#b8ad9e', 2)} />
            </>
          ) : (
            Array.from({ length: Math.max(1, Math.round(w / 50)) }, (_, i) => {
              const doors = Math.max(1, Math.round(w / 50))
              const x = -hw + ((i + 0.5) * w) / doors
              return <line key={i} x1={x - 3} y1={hd - 4} x2={x + 3} y2={hd - 4} {...edge('#8c8275', 1.4)} />
            })
          )}
        </g>
      )
    }
    case 'drawers': {
      const wood = type === 'tv-stand' ? MAT.walnut : type === 'shoe-rack' ? MAT.birch : main
      return (
        <g>
          {box(-hw, -hd, w, d, 4, wood)}
          {box(-hw + 3, -hd + 3, w - 6, d - 6, 3, tint(wood, 0.12), shade(wood, 0.1))}
          {type === 'nightstand' && (
            <>
              <circle cx={w * 0.12} cy={-d * 0.05} r={Math.min(w, d) * 0.42} fill={MAT.glow} opacity={0.35} />
              <circle cx={w * 0.12} cy={-d * 0.05} r={Math.min(w, d) * 0.22} fill="#fff4d6" {...edge('#e5cf95')} />
              {box(-hw + 5, d * 0.08, w * 0.34, d * 0.26, 1, accent)}
            </>
          )}
          {type === 'dresser' && (
            <>
              <circle cx={hw - 14} cy={0} r={7} fill={MAT.ceramic} {...edge('#d6d0c6')} />
              {[0, 72, 144, 216, 288].map((a) => (
                <ellipse key={a} cx={hw - 14} cy={-4} rx={2.2} ry={6} fill={MAT.leaves[a % 3]} transform={`rotate(${a} ${hw - 14} 0)`} />
              ))}
              {box(-hw + 8, -hd + 8, 20, d - 16, 2, SPINES[2], 'none')}
            </>
          )}
        </g>
      )
    }
    case 'desk': {
      if (type === 'vanity') {
        return (
          <g>
            {box(-hw, -hd, w, d, 5, main)}
            <ellipse cx={0} cy={-hd + 7} rx={Math.min(26, w * 0.28)} ry={5} fill="#d7e9f5" {...edge('#a8c3d6')} />
            {[-18, -10, 14].map((x, i) => (
              <circle key={x} cx={x} cy={4} r={i === 2 ? 4 : 3} fill={[accent, '#f1d3c2', '#d9e7e0'][i]} {...edge('#b9a998', 0.6)} />
            ))}
          </g>
        )
      }
      const lw = Math.min(34, w * 0.3)
      return (
        <g>
          {box(-hw, -hd, w, d, 5, main)}
          {box(-lw / 2, -hd + d * 0.22, lw, d * 0.42, 3, '#d7dbe0', '#9aa1a8')}
          {box(-lw / 2 + 2, -hd + d * 0.22, lw - 4, 4, 1, '#4b5058', 'none')}
          <circle cx={hw - 14} cy={-hd + d * 0.35} r={5} fill={accent} {...edge(shade(accent, 0.25))} />
          <circle cx={-hw + 14} cy={-hd + 12} r={6} fill={MAT.leaves[1]} {...edge(MAT.leaves[3], 0.6)} />
        </g>
      )
    }
    case 'counter':
    case 'dishwasher':
      return (
        <g>
          {box(-hw, -hd, w, d, 1.5, MAT.stone, '#cfc7bb')}
          <line x1={-hw + 1} y1={hd - 3} x2={hw - 1} y2={hd - 3} {...edge('#d7cfc3', 2)} />
          {glyph === 'dishwasher' && <line x1={-hw + 8} y1={hd - 8} x2={hw - 8} y2={hd - 8} {...edge('#b9b1a5', 1)} />}
        </g>
      )
    case 'sink':
      return (
        <g>
          {box(-hw, -hd, w, d, 1.5, MAT.stone, '#cfc7bb')}
          {box(-w * 0.34, -hd + 11, w * 0.68, d - 21, 9, MAT.steel, '#a9b2ba')}
          {box(-w * 0.34 + 4, -hd + 15, w * 0.68 - 8, d - 29, 7, tint(MAT.steel, 0.35), 'none')}
          <circle cx={0} cy={2} r={2.5} fill="#8e979f" />
          <line x1={0} y1={-hd + 4} x2={0} y2={-hd + 13} {...edge('#8e979f', 2.2)} />
        </g>
      )
    case 'stove': {
      const r = Math.min(w, d) * 0.15
      return (
        <g>
          {box(-hw, -hd, w, d, 1.5, MAT.stone, '#cfc7bb')}
          {box(-hw + 4, -hd + 4, w - 8, d - 8, 4, MAT.glass, '#1d1f23')}
          {[
            [-w / 4, -d / 4, 1],
            [w / 4, -d / 4, 0.8],
            [-w / 4, d / 4, 0.8],
            [w / 4, d / 4, 1],
          ].map(([cx, cy, k], i) => (
            <g key={i}>
              <circle cx={cx} cy={cy} r={r * k} fill="none" {...edge('#70757d', 1)} />
              {i === 0 && <circle cx={cx} cy={cy} r={r * 0.55} fill="#c2553d" opacity={0.55} />}
            </g>
          ))}
        </g>
      )
    }
    case 'fridge':
      return (
        <g>
          {box(-hw, -hd, w, d, 4, '#eef1f3', '#b9c1c8')}
          <line x1={-hw + 3} y1={-hd + d * 0.36} x2={hw - 3} y2={-hd + d * 0.36} {...edge('#c7ced4', 1)} />
          <line x1={hw - 9} y1={hd - 3} x2={hw - 9} y2={hd - 12} {...edge('#8e979f', 2)} />
        </g>
      )
    case 'washer':
      return (
        <g>
          {box(-hw, -hd, w, d, 5, MAT.ceramic, '#c6d0d7')}
          <circle cx={0} cy={3} r={Math.min(w, d) * 0.32} fill="#b9ccd9" {...edge('#8fa6b5')} />
          <circle cx={0} cy={3} r={Math.min(w, d) * 0.2} fill={tint('#b9ccd9', 0.5)} {...edge('#8fa6b5', 0.6)} />
          <circle cx={-hw + 9} cy={-hd + 7} r={2.5} fill="#8e979f" />
        </g>
      )
    case 'toilet': {
      const tank = Math.min(18, d * 0.28)
      return (
        <g>
          {box(-hw, -hd, w, tank, 4, MAT.ceramic, '#c6d0d7')}
          <ellipse cx={0} cy={tank / 2} rx={hw - 1} ry={(d - tank) / 2 - 1} fill={MAT.ceramic} {...edge('#c6d0d7')} />
          <ellipse cx={0} cy={tank / 2 + 2} rx={hw * 0.58} ry={(d - tank) * 0.28} fill={MAT.water} {...edge('#b3cddb', 0.7)} />
        </g>
      )
    }
    case 'basin':
      return (
        <g>
          {box(-hw, -hd, w, d, 4, type === 'basin-cabinet' ? MAT.oak : MAT.stone, '#cfc7bb')}
          <ellipse cx={0} cy={3} rx={w * 0.32} ry={d * 0.3} fill={MAT.ceramic} {...edge('#c6d0d7')} />
          <ellipse cx={0} cy={3} rx={w * 0.24} ry={d * 0.2} fill={MAT.water} />
          <line x1={0} y1={-hd + 3} x2={0} y2={-hd + 10} {...edge('#8e979f', 2)} />
        </g>
      )
    case 'bathtub':
      return (
        <g>
          {box(-hw, -hd, w, d, 14, MAT.ceramic, '#c6d0d7')}
          {box(-hw + 7, -hd + 7, w - 14, d - 14, 12, MAT.water, '#b3cddb')}
          <circle cx={-hw + 22} cy={0} r={3} fill="#8e979f" />
        </g>
      )
    case 'shower':
      return (
        <g>
          {box(-hw, -hd, w, d, 4, MAT.ceramic, '#c6d0d7')}
          {Array.from({ length: 3 }, (_, i) => (
            <line key={i} x1={-hw + 6} y1={-hd + ((i + 1) * d) / 4} x2={hw - 6} y2={-hd + ((i + 1) * d) / 4} {...edge('#dde6ec', 0.8)} />
          ))}
          <circle cx={0} cy={0} r={4} fill={MAT.water} {...edge('#9fb8c8')} />
          <line x1={-hw + 2} y1={hd - 2} x2={hw - 2} y2={hd - 2} {...edge('#9fc6de', 2.2)} opacity={0.8} />
        </g>
      )
    case 'tv':
      return (
        <g>
          {box(-hw, -hd, w, d, 2, MAT.glass, '#16181b')}
          <line x1={-hw + 4} y1={-hd + 1.5} x2={hw * 0.3} y2={-hd + 1.5} {...edge('#6b7079', 0.8)} />
        </g>
      )
    case 'shelf': {
      // вешалка в прихожей — пальто и куртки
      if (type === 'hanger') {
        const n = Math.max(2, Math.floor(w / 16))
        return (
          <g>
            {box(-hw, -hd, w, d, 3, MAT.birch)}
            {Array.from({ length: n }, (_, i) => (
            <React.Fragment key={i}>{box(-hw + 4 + (i * (w - 8)) / n, -hd + 3, (w - 8) / n - 3, d - 6, 5, SPINES[(i * 3) % SPINES.length], 'none', { opacity: 0.9 })}</React.Fragment>
          ))}
          </g>
        )
      }
      // стеллаж: корешки книг разной ширины
      const books: React.ReactNode[] = []
      let x = -hw + 3
      let k = 0
      while (x < hw - 5) {
        const bw = 3 + rnd() * 4
        if (rnd() < 0.12) {
          x += 6
          continue
        }
        books.push(<rect key={k++} x={x} y={-hd + 3 + rnd() * 2} width={Math.min(bw, hw - 3 - x)} height={d - 7} rx={0.8} fill={SPINES[Math.floor(rnd() * SPINES.length)]} opacity={0.9} />)
        x += bw + 0.6
      }
      return (
        <g>
          {box(-hw, -hd, w, d, 2, main)}
          {books}
        </g>
      )
    }
    case 'rug': {
      const kids = type === 'kid-rug'
      const inset = Math.min(9, Math.min(w, d) * 0.08)
      return (
        <g>
          <rect x={-hw} y={-hd} width={w} height={d} rx={4} fill={main} {...edge(shade(main, 0.12))} />
          <rect x={-hw + inset} y={-hd + inset} width={w - inset * 2} height={d - inset * 2} rx={3} fill="none" {...edge(shade(main, 0.18), 1.4)} />
          {kids
            ? [[-0.25, -0.2, SPINES[2]], [0.2, 0.15, SPINES[3]], [0.28, -0.22, SPINES[0]], [-0.18, 0.22, SPINES[4]]].map(([fx, fy, c], i) => (
                <circle key={i} cx={(fx as number) * w} cy={(fy as number) * d} r={Math.min(w, d) * 0.12} fill={c as string} opacity={0.75} />
              ))
            : Array.from({ length: 3 }, (_, i) => {
                const cx = -w * 0.25 + i * w * 0.25
                const s = Math.min(d * 0.18, w * 0.08)
                return <path key={i} d={`M ${cx} ${-s} L ${cx + s} 0 L ${cx} ${s} L ${cx - s} 0 Z`} fill={i === 1 ? accentOf(main) : tint(main, 0.35)} opacity={0.8} />
              })}
          {/* бахрома по коротким сторонам */}
          {!kids &&
            [-1, 1].map((s) =>
              Array.from({ length: Math.max(3, Math.floor(d / 8)) }, (_, i) => {
                const y = -hd + 4 + (i * (d - 8)) / Math.max(1, Math.floor(d / 8) - 1)
                return <line key={`${s}-${i}`} x1={s * hw} y1={y} x2={s * (hw + 4)} y2={y} {...edge(shade(main, 0.1), 0.7)} />
              }),
            )}
        </g>
      )
    }
    case 'plant': {
      const r = Math.min(hw, hd)
      return (
        <g>
          <circle cx={0} cy={0} r={r * 0.52} fill={MAT.pot} {...edge(shade(MAT.pot, 0.25))} />
          {Array.from({ length: 8 }, (_, i) => {
            const a = i * 45 + rnd() * 20
            return <ellipse key={i} cx={0} cy={-r * 0.48} rx={r * 0.2} ry={r * 0.5} fill={MAT.leaves[i % MAT.leaves.length]} transform={`rotate(${a})`} opacity={0.95} />
          })}
          <circle cx={0} cy={0} r={r * 0.18} fill={MAT.leaves[3]} />
        </g>
      )
    }
    case 'lamp': {
      const r = Math.min(hw, hd)
      return (
        <g>
          <circle cx={0} cy={0} r={r * 2} fill={MAT.glow} opacity={0.28} />
          <circle cx={0} cy={0} r={r * 1.35} fill={MAT.glow} opacity={0.3} />
          <circle cx={0} cy={0} r={r} fill="#fff3d1" {...edge('#e5cf95')} />
          <circle cx={0} cy={0} r={2.5} fill="#b9a36a" />
        </g>
      )
    }
    case 'radiator': {
      const n = Math.max(2, Math.round(w / 8))
      return (
        <g>
          {box(-hw, -hd, w, d, 2, '#ffffff', '#c9cfd4')}
          {Array.from({ length: n - 1 }, (_, i) => (
            <line key={i} x1={-hw + ((i + 1) * w) / n} y1={-hd + 1} x2={-hw + ((i + 1) * w) / n} y2={hd - 1} {...edge('#d5dadf', 0.8)} />
          ))}
        </g>
      )
    }
    case 'mirror':
      return (
        <g>
          {box(-hw, -hd, w, d, 1, '#d7e9f5', '#a8c3d6')}
          <line x1={-hw * 0.6} y1={hd} x2={-hw * 0.2} y2={-hd} {...edge('#ffffff', 1.2)} />
        </g>
      )
    case 'column':
      return box(-hw, -hd, w, d, 1, '#50545c', '#3c3f45')
    case 'riser': {
      // два стояка: холодная вода и канализация
      const r = Math.min(w / 4, d / 2) - 1
      return (
        <g>
          {box(-hw, -hd, w, d, 3, '#f1f5f9', '#94a3b8')}
          <circle cx={-w / 4} cy={0} r={r} fill="#93c5fd" {...edge('#3b82f6')} />
          <circle cx={w / 4} cy={0} r={r} fill="#9ca3af" {...edge('#4b5563')} />
        </g>
      )
    }
    case 'vent':
      return (
        <g>
          {box(-hw, -hd, w, d, 2, '#e2e8f0', '#94a3b8')}
          {[-0.25, 0, 0.25].map((k) => (
            <line key={k} x1={-hw + 4} y1={k * d} x2={hw - 4} y2={k * d} {...edge('#64748b', 1)} />
          ))}
        </g>
      )
    case 'bench':
      return (
        <g>
          {box(-hw, -hd, w, d, 8, main)}
          {Array.from({ length: Math.max(2, Math.floor(w / 22)) }, (_, i) => (
            <circle key={i} cx={-hw + ((i + 0.5) * w) / Math.max(2, Math.floor(w / 22))} cy={0} r={1.4} fill={shade(main, 0.3)} />
          ))}
        </g>
      )
    case 'box':
    default:
      return box(-hw, -hd, w, d, 4, main)
  }
}

/** круглые предметы: тень — эллипсом */
export const isRound = (glyph: string | undefined): boolean => glyph === 'table-round' || glyph === 'stool' || glyph === 'plant' || glyph === 'lamp'
