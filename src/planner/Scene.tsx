import React, { useMemo } from 'react'
import type { DimensionLine, Layers, LengthUnit, Opening, Plan, Pt, Room, Selection, Wall } from './types'
import { CATALOG_MAP, FLOORS } from './catalog'
import { Glyph } from './Glyph'
import { add, angleDeg, bboxOf, dist, fmtArea, fmtLen, mid, mul, norm, obbCorners, perp, pointInPoly, sub } from './geometry'
import { openingGeom, zonesOf, type CheckResult } from './checks'
import { wallsAtNode } from './snapping'

export const ACCENT = '#2563eb'
export const WALL_FILL = '#33363d'
const NS = { vectorEffect: 'non-scaling-stroke' as const }

export function wallPolygon(w: Wall, walls: Wall[]): Pt[] {
  const dir = norm(sub(w.b, w.a))
  const n = perp(dir)
  const hw = w.thickness / 2
  const ext = (p: Pt) => wallsAtNode(walls, p).filter((o) => o.id !== w.id).reduce((m, o) => Math.max(m, o.thickness / 2), 0)
  const a = sub(w.a, mul(dir, ext(w.a)))
  const b = add(w.b, mul(dir, ext(w.b)))
  return [add(a, mul(n, hw)), add(b, mul(n, hw)), sub(b, mul(n, hw)), sub(a, mul(n, hw))]
}

export const ptsAttr = (pts: Pt[]): string => pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')

export function sortedFurniture(plan: Plan) {
  return plan.furniture
    .map((f, i) => ({ f, i, cat: CATALOG_MAP[f.type], z: CATALOG_MAP[f.type]?.z ?? 1 }))
    .sort((a, b) => a.z - b.z || a.i - b.i)
}

interface DimProps {
  a: Pt
  b: Pt
  offset: number
  zoom: number
  unit: LengthUnit
  selected?: boolean
  muted?: boolean
}

export const DimLine: React.FC<DimProps> = ({ a, b, offset, zoom, unit, selected, muted }) => {
  const L = dist(a, b)
  if (L < 1) return null
  const dir = norm(sub(b, a))
  const n = perp(dir)
  const s = Math.sign(offset) || 1
  const a2 = add(a, mul(n, offset))
  const b2 = add(b, mul(n, offset))
  const ext = 6 / zoom
  const tick = 5 / zoom
  const td = norm(add(dir, mul(n, s)))
  let ang = angleDeg(a, b)
  if (ang > 90 || ang <= -90) ang += 180
  const m = add(mid(a2, b2), mul(n, s * (9 / zoom)))
  const color = selected ? ACCENT : muted ? '#9aa0a6' : '#4b5563'
  return (
    <g stroke={color} fill="none" {...NS} strokeWidth={1}>
      <line x1={a.x + n.x * s * 3} y1={a.y + n.y * s * 3} x2={a2.x + n.x * s * ext} y2={a2.y + n.y * s * ext} />
      <line x1={b.x + n.x * s * 3} y1={b.y + n.y * s * 3} x2={b2.x + n.x * s * ext} y2={b2.y + n.y * s * ext} />
      <line x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y} />
      <line x1={a2.x - td.x * tick} y1={a2.y - td.y * tick} x2={a2.x + td.x * tick} y2={a2.y + td.y * tick} strokeWidth={1.4} />
      <line x1={b2.x - td.x * tick} y1={b2.y - td.y * tick} x2={b2.x + td.x * tick} y2={b2.y + td.y * tick} strokeWidth={1.4} />
      <text
        transform={`translate(${m.x} ${m.y}) rotate(${ang})`}
        fontSize={11 / zoom}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color}
        stroke="#fff"
        strokeWidth={3 / zoom}
        paintOrder="stroke"
        fontFamily="system-ui, sans-serif"
      >
        {fmtLen(L, unit)}
      </text>
    </g>
  )
}

interface OpeningViewProps {
  op: Opening
  wall: Wall
  selected: boolean
  bad: boolean
  zoom: number
}

const OpeningView: React.FC<OpeningViewProps> = ({ op, wall, selected, bad, zoom }) => {
  const g = openingGeom(op, wall)
  const s0 = add(g.center, mul(g.dir, -g.hw))
  const s1 = add(g.center, mul(g.dir, g.hw))
  const half = g.th / 2 + 0.6
  const cut = [add(s0, mul(g.n, half)), add(s1, mul(g.n, half)), sub(s1, mul(g.n, half)), sub(s0, mul(g.n, half))]
  const jamb = (p: Pt) => (
    <line x1={p.x + g.n.x * half} y1={p.y + g.n.y * half} x2={p.x - g.n.x * half} y2={p.y - g.n.y * half} stroke="#2f2f2f" strokeWidth={1.2} {...NS} />
  )
  const stroke = selected ? ACCENT : '#2f2f2f'
  return (
    <g>
      <polygon points={ptsAttr(cut)} fill="#fff" stroke="none" />
      {op.kind === 'window' && (
        <g>
          <line x1={s0.x + g.n.x * (g.th / 2)} y1={s0.y + g.n.y * (g.th / 2)} x2={s1.x + g.n.x * (g.th / 2)} y2={s1.y + g.n.y * (g.th / 2)} stroke={stroke} strokeWidth={1.2} {...NS} />
          <line x1={s0.x - g.n.x * (g.th / 2)} y1={s0.y - g.n.y * (g.th / 2)} x2={s1.x - g.n.x * (g.th / 2)} y2={s1.y - g.n.y * (g.th / 2)} stroke={stroke} strokeWidth={1.2} {...NS} />
          <line x1={s0.x} y1={s0.y} x2={s1.x} y2={s1.y} stroke={selected ? ACCENT : '#3b82f6'} strokeWidth={2} {...NS} />
          {jamb(s0)}
          {jamb(s1)}
        </g>
      )}
      {op.kind === 'door' && (
        <g>
          {jamb(s0)}
          {jamb(s1)}
          <polyline points={ptsAttr(g.swing.slice(1))} fill="none" stroke={bad ? '#dc2626' : selected ? ACCENT : '#8a8f98'} strokeWidth={bad ? 1.4 : 0.9} strokeDasharray={bad ? undefined : '3 3'} {...NS} />
          <line x1={g.hinge.x} y1={g.hinge.y} x2={g.leafEnd.x} y2={g.leafEnd.y} stroke={stroke} strokeWidth={2} {...NS} />
        </g>
      )}
      {op.kind === 'doorway' && (
        <g>
          {jamb(s0)}
          {jamb(s1)}
          <line x1={s0.x} y1={s0.y} x2={s1.x} y2={s1.y} stroke={stroke} strokeWidth={0.8} strokeDasharray="4 4" {...NS} />
        </g>
      )}
      {selected && <polygon points={ptsAttr(cut)} fill="rgba(37,99,235,0.15)" stroke={ACCENT} strokeWidth={1.2} {...NS} />}
    </g>
  )
}

export interface SceneProps {
  plan: Plan
  rooms: Room[]
  check: CheckResult
  layers: Layers
  unit: LengthUnit
  zoom: number
  selection?: Selection
  hover?: Selection
  badItems?: Set<string>
  /** виды сверху фотореалистичных моделей: id предмета → data URL */
  photos?: Record<string, string>
}

export const Scene: React.FC<SceneProps> = ({ plan, rooms, check, layers, unit, zoom, selection = null, hover = null, badItems, photos }) => {
  const wallPolys = useMemo(() => plan.walls.map((w) => ({ w, poly: wallPolygon(w, plan.walls) })), [plan.walls])
  const wallMap = useMemo(() => new Map(plan.walls.map((w) => [w.id, w])), [plan.walls])
  const furniture = useMemo(() => sortedFurniture(plan), [plan])
  const outer = useMemo(() => (wallPolys.length ? bboxOf(wallPolys.flatMap((p) => p.poly)) : null), [wallPolys])
  const selId = selection?.id
  const floorColor = (key: string) => FLOORS.find((f) => f.key === key)?.color ?? '#f5f5f5'

  const visible = furniture.filter((x) => {
    const isElectric = x.cat?.category === 'electric'
    return isElectric ? layers.electric : layers.furniture
  })
  const rugs = visible.filter((x) => x.z === 0)
  const rest = visible.filter((x) => x.z !== 0)

  const renderItem = (x: (typeof furniture)[number]) => {
    const f = x.f
    const isSel = selection?.kind === 'furniture' && selId === f.id
    const isHover = hover?.kind === 'furniture' && hover.id === f.id
    const showLabel = layers.labels && !x.cat?.symbol && Math.min(f.w, f.d) * zoom > 26 && f.w * zoom > 44
    const name = f.label || x.cat?.name || f.type
    const fs = Math.min(10 / zoom, f.w / Math.max(6, name.length * 0.62))
    const photo = photos?.[f.id]
    return (
      <g key={f.id} transform={`translate(${f.x} ${f.y}) rotate(${f.rot})`} opacity={isHover && !isSel ? 0.85 : 1}>
        <g transform={f.flip ? 'scale(-1 1)' : undefined}>
          {photo ? (
            <g>
              <image href={photo} x={-f.w / 2} y={-f.d / 2} width={f.w} height={f.d} preserveAspectRatio="none" />
              <rect x={-f.w / 2} y={-f.d / 2} width={f.w} height={f.d} fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth={0.8} {...NS} />
            </g>
          ) : (
            <Glyph item={f} cat={x.cat} zoom={zoom} />
          )}
        </g>
        {showLabel && !photo && (
          <text
            fontSize={fs}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#333"
            fontFamily="system-ui, sans-serif"
            transform={f.rot > 90 && f.rot <= 270 ? 'rotate(180)' : undefined}
            pointerEvents="none"
          >
            {name}
          </text>
        )}
      </g>
    )
  }

  const zoneLayer = (x: (typeof furniture)[number]) => {
    const isSel = selection?.kind === 'furniture' && selId === x.f.id
    if (!layers.ergo && !isSel) return null
    const zones = zonesOf(x.f, x.cat)
    if (!zones.length) return null
    return (
      <g key={`z-${x.f.id}`}>
        {zones.map((z) => {
          const bad = check.badZones.has(`${x.f.id}:${z.side}`)
          return (
            <polygon
              key={z.side}
              points={ptsAttr(z.poly)}
              fill={bad ? 'rgba(220,38,38,0.16)' : 'rgba(37,99,235,0.09)'}
              stroke={bad ? '#dc2626' : ACCENT}
              strokeWidth={0.8}
              strokeDasharray="3 3"
              {...NS}
            />
          )
        })}
      </g>
    )
  }

  return (
    <g fontFamily="system-ui, sans-serif">
      <defs>
        <pattern id="pl-tile" width={30} height={30} patternUnits="userSpaceOnUse">
          <path d="M 30 0 L 0 0 0 30" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth={0.8} />
        </pattern>
        <pattern id="pl-plank" width={120} height={20} patternUnits="userSpaceOnUse">
          <path d="M 0 20 H 120 M 60 0 V 20" fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth={0.8} />
        </pattern>
        <pattern id="pl-parquet" width={40} height={40} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M 0 0 H 40 M 0 20 H 40 M 20 0 V 40" fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth={0.8} />
        </pattern>
      </defs>

      {/* подложка — под всем чертежом */}
      {layers.underlay && plan.underlay?.visible && (
        <image
          href={plan.underlay.src}
          x={plan.underlay.x}
          y={plan.underlay.y}
          width={plan.underlay.px.w * plan.underlay.scale}
          height={plan.underlay.px.h * plan.underlay.scale}
          opacity={plan.underlay.opacity}
          preserveAspectRatio="none"
          pointerEvents="none"
        />
      )}

      {/* полы комнат */}
      {layers.rooms &&
        rooms.map((r) => {
          const isSel = selection?.kind === 'room' && selId === r.meta.id
          const pattern = r.meta.floor === 'tile' ? 'url(#pl-tile)' : r.meta.floor === 'laminate' ? 'url(#pl-plank)' : r.meta.floor === 'parquet' ? 'url(#pl-parquet)' : null
          return (
            <g key={r.meta.id}>
              <polygon points={ptsAttr(r.inner)} fill={floorColor(r.meta.floor)} stroke="none" />
              {pattern && <polygon points={ptsAttr(r.inner)} fill={pattern} stroke="none" />}
              {isSel && <polygon points={ptsAttr(r.inner)} fill="rgba(37,99,235,0.08)" stroke={ACCENT} strokeWidth={1.5} strokeDasharray="6 4" {...NS} />}
            </g>
          )
        })}

      {/* рабочий треугольник кухни */}
      {layers.ergo && check.triangle && (
        <g>
          <polygon points={ptsAttr(check.triangle.pts)} fill="none" stroke={check.triangle.ok ? '#16a34a' : '#dc2626'} strokeWidth={1.2} strokeDasharray="6 4" {...NS} />
          {check.triangle.pts.map((p, i) => {
            const q = check.triangle!.pts[(i + 1) % 3]
            const m = mid(p, q)
            return (
              <text key={i} x={m.x} y={m.y} fontSize={10 / zoom} textAnchor="middle" fill={check.triangle!.ok ? '#15803d' : '#b91c1c'} stroke="#fff" strokeWidth={3 / zoom} paintOrder="stroke">
                {(check.triangle!.sides[i] / 100).toFixed(1)} м
              </text>
            )
          })}
        </g>
      )}

      {/* зоны эргономики */}
      {rest.map(zoneLayer)}

      {/* ковры */}
      {rugs.map(renderItem)}

      {/* стены */}
      {wallPolys.map(({ w, poly }) => {
        const isSel = selection?.kind === 'wall' && selId === w.id
        const isHover = hover?.kind === 'wall' && hover.id === w.id
        return <polygon key={w.id} points={ptsAttr(poly)} fill={isSel ? ACCENT : isHover ? '#4b5563' : WALL_FILL} stroke="none" />
      })}

      {/* проёмы */}
      {plan.openings.map((op) => {
        const wall = wallMap.get(op.wallId)
        if (!wall) return null
        return <OpeningView key={op.id} op={op} wall={wall} zoom={zoom} selected={selection?.kind === 'opening' && selId === op.id} bad={check.badDoors.has(op.id)} />
      })}

      {/* мебель и электрика */}
      {rest.map(renderItem)}

      {/* контуры проблемных объектов */}
      {badItems &&
        rest
          .filter((x) => badItems.has(x.f.id))
          .map((x) => <polygon key={`bad-${x.f.id}`} points={ptsAttr(obbCorners(x.f.x, x.f.y, x.f.w, x.f.d, x.f.rot))} fill="none" stroke="#dc2626" strokeWidth={1.4} {...NS} />)}

      {/* подписи комнат */}
      {layers.rooms &&
        rooms.map((r) => {
          const small = r.area < 2.5
          const fs = (small ? 10 : 13) / zoom
          return (
            <g key={`lbl-${r.meta.id}`} pointerEvents="none">
              <text x={r.meta.anchor.x} y={r.meta.anchor.y - fs * 0.35} fontSize={fs} fontWeight={600} textAnchor="middle" fill="#1f2937" stroke="#fff" strokeWidth={3 / zoom} paintOrder="stroke">
                {r.meta.name}
              </text>
              <text x={r.meta.anchor.x} y={r.meta.anchor.y + fs * 0.85} fontSize={fs * 0.85} textAnchor="middle" fill="#4b5563" stroke="#fff" strokeWidth={3 / zoom} paintOrder="stroke">
                {fmtArea(r.area)}
              </text>
            </g>
          )
        })}

      {/* размеры */}
      {layers.dims && (
        <g>
          {/* Размеры комнат в чистоте — по внутренним граням стен, внутри
              комнаты, как на плане БТИ: их и сверяют с планом. Длина по оси
              стены у перегородки на полстены длиннее и только путает */}
          {rooms.flatMap((r) =>
            r.inner.map((a, i) => {
              const b = r.inner[(i + 1) % r.inner.length]
              const L = dist(a, b)
              if (L < 30) return null
              const n = perp(norm(sub(b, a)))
              const m = mid(a, b)
              const s = pointInPoly(add(m, mul(n, 4)), r.inner) ? 1 : -1
              const p = add(m, mul(n, s * (9 / zoom)))
              let ang = angleDeg(a, b)
              if (ang > 90 || ang <= -90) ang += 180
              return (
                <text key={`rl-${r.meta.id}-${i}`} transform={`translate(${p.x} ${p.y}) rotate(${ang})`} fontSize={9.5 / zoom} textAnchor="middle" dominantBaseline="middle" fill="#6b7280" stroke="#fff" strokeWidth={2.5 / zoom} paintOrder="stroke">
                  {fmtLen(L, unit)}
                </text>
              )
            }),
          )}
          {/* стены вне комнат — по оси */}
          {plan.walls.map((w) => {
            const L = dist(w.a, w.b)
            if (L < 50) return null
            const dir = norm(sub(w.b, w.a))
            const n = perp(dir)
            const m = mid(w.a, w.b)
            const inside = (s: number) => rooms.some((r) => pointInPoly(add(m, mul(n, s * (w.thickness / 2 + 15))), r.polygon))
            if (inside(1) || inside(-1)) return null
            const p = add(m, mul(n, w.thickness / 2 + 12 / zoom))
            let ang = angleDeg(w.a, w.b)
            if (ang > 90 || ang <= -90) ang += 180
            return (
              <text key={`wl-${w.id}`} transform={`translate(${p.x} ${p.y}) rotate(${ang})`} fontSize={9.5 / zoom} textAnchor="middle" dominantBaseline="middle" fill="#6b7280" stroke="#fff" strokeWidth={2.5 / zoom} paintOrder="stroke">
                {fmtLen(L, unit)}
              </text>
            )
          })}
          {outer && outer.maxX - outer.minX > 50 && (
            <g>
              <DimLine a={{ x: outer.minX, y: outer.minY }} b={{ x: outer.maxX, y: outer.minY }} offset={-55} zoom={zoom} unit={unit} />
              <DimLine a={{ x: outer.minX, y: outer.maxY }} b={{ x: outer.minX, y: outer.minY }} offset={-55} zoom={zoom} unit={unit} />
            </g>
          )}
          {plan.dims.map((d: DimensionLine) => (
            <DimLine key={d.id} a={d.a} b={d.b} offset={d.offset} zoom={zoom} unit={unit} selected={selection?.kind === 'dim' && selId === d.id} />
          ))}
        </g>
      )}

      {/* контур выбранной мебели */}
      {selection?.kind === 'furniture' &&
        (() => {
          const f = plan.furniture.find((x) => x.id === selId)
          if (!f) return null
          const cat = CATALOG_MAP[f.type]
          if (cat?.symbol) {
            return <circle cx={f.x} cy={f.y} r={14 / zoom} fill="none" stroke={ACCENT} strokeWidth={1.2} strokeDasharray="3 2" {...NS} />
          }
          return <polygon points={ptsAttr(obbCorners(f.x, f.y, f.w, f.d, f.rot))} fill="none" stroke={ACCENT} strokeWidth={1.4} strokeDasharray="5 3" {...NS} />
        })()}
    </g>
  )
}

/** Габариты содержимого плана (см) */
export function planBounds(plan: Plan): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const pts: Pt[] = []
  for (const w of plan.walls) pts.push(...wallPolygon(w, plan.walls))
  for (const f of plan.furniture) pts.push(...obbCorners(f.x, f.y, f.w, f.d, f.rot))
  for (const d of plan.dims) pts.push(d.a, d.b)
  const u = plan.underlay
  if (u?.visible) {
    pts.push({ x: u.x, y: u.y }, { x: u.x + u.px.w * u.scale, y: u.y + u.px.h * u.scale })
  }
  if (!pts.length) return null
  return bboxOf(pts)
}
