// Выпрямить готовый чертёж. Снимок под углом разбирается как есть — по нему
// выверены двери, закутки и короба в стенах, а пересчёт картинки размывает
// тонкие черты. Выпрямляется результат: концы стен переводятся тем же
// преобразованием, что и картинка («По 4 углам» сам находит углы по точкам
// схода стен), и почти соосные стены сводятся на одну прямую. Так верхняя
// стена, которую каждая комната видела на своей высоте, становится одной.
import type { Pt, Wall } from './types'

const key = (p: Pt) => `${Math.round(p.x * 2)}:${Math.round(p.y * 2)}`

/**
 * Перевести стены через map и выровнять: горизонтальные — строго
 * горизонтальны, вертикальные — строго вертикальны; прямые, что после
 * перевода разошлись меньше чем на tolCm, — одна прямая. Общие концы стен
 * остаются общими, конец стены, упёртой в середину другой (Т-стык), встаёт
 * на её линию. Косые стены только переводятся.
 */
export function rectifyWalls(walls: Wall[], map: (p: Pt) => Pt, tolCm = 6): Wall[] {
  if (!walls.length) return walls
  const nodes = new Map<string, { orig: Pt; at: Pt; x?: number; y?: number }>()
  const node = (p: Pt) => {
    const k = key(p)
    let n = nodes.get(k)
    if (!n) nodes.set(k, (n = { orig: p, at: map(p) }))
    return n
  }
  const kind = walls.map((w) => {
    const dx = Math.abs(w.b.x - w.a.x)
    const dy = Math.abs(w.b.y - w.a.y)
    // косая — больше 3° от оси
    return dy <= 0.05 * dx ? 'h' : dx <= 0.05 * dy ? 'v' : 'd'
  })
  // линии после перевода: средняя по концам, вес — длина
  const lines = walls.map((w, i) => {
    const a = node(w.a).at
    const b = node(w.b).at
    const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)
    return { i, kind: kind[i], at: kind[i] === 'h' ? (a.y + b.y) / 2 : (a.x + b.x) / 2, len }
  })
  // соосные — одна прямая: жадные кучки по возрастанию координаты
  const snapped = new Map<number, number>()
  for (const k of ['h', 'v'] as const) {
    const list = lines.filter((l) => l.kind === k).sort((p, q) => p.at - q.at)
    let group: typeof list = []
    const flush = () => {
      if (!group.length) return
      const total = group.reduce((s, l) => s + l.len, 0) || 1
      const at = group.reduce((s, l) => s + l.at * l.len, 0) / total
      for (const l of group) snapped.set(l.i, at)
      group = []
    }
    for (const l of list) {
      if (group.length && l.at - group[group.length - 1].at > tolCm) flush()
      group.push(l)
    }
    flush()
  }
  // концы: горизонтальная стена задаёт y своих концов, вертикальная — x
  walls.forEach((w, i) => {
    const v = snapped.get(i)
    if (v === undefined) return
    for (const p of [w.a, w.b]) {
      const n = node(p)
      if (kind[i] === 'h' && n.y === undefined) n.y = v
      if (kind[i] === 'v' && n.x === undefined) n.x = v
    }
  })
  // Т-стык: конец, лежащий на середине поперечной стены, встаёт на её линию
  for (const n of nodes.values()) {
    walls.forEach((w, i) => {
      const v = snapped.get(i)
      if (v === undefined) return
      if (kind[i] === 'v' && n.x === undefined) {
        const y1 = Math.min(w.a.y, w.b.y)
        const y2 = Math.max(w.a.y, w.b.y)
        if (Math.abs(n.orig.x - w.a.x) < 1.5 && n.orig.y > y1 - 1 && n.orig.y < y2 + 1) n.x = v
      }
      if (kind[i] === 'h' && n.y === undefined) {
        const x1 = Math.min(w.a.x, w.b.x)
        const x2 = Math.max(w.a.x, w.b.x)
        if (Math.abs(n.orig.y - w.a.y) < 1.5 && n.orig.x > x1 - 1 && n.orig.x < x2 + 1) n.y = v
      }
    })
  }
  const place = (p: Pt): Pt => {
    const n = node(p)
    return { x: n.x ?? n.at.x, y: n.y ?? n.at.y }
  }
  return walls.map((w) => ({ ...w, a: place(w.a), b: place(w.b) })).filter((w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) >= 1)
}
