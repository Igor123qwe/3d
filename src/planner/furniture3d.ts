// Параметрические 3D-модели мебели: узнаваемые формы из штатных геометрий three,
// без загрузки внешних файлов.
// Соглашения: единицы — метры; центр габарита по X и Z в нуле; низ предмета на y = 0,
// верх на y = h; «спинка» смотрит в −Z, лицевая сторона — в +Z.
import * as THREE from 'three'
import type { GlyphKind } from './catalog'

/** минимальный размер детали, чтобы не рождать вырожденную геометрию */
const EPS = 0.001
const WHITE = new THREE.Color(0xffffff)

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi))

/** доля размера: как clamp, но нижняя граница не может превысить сам размер */
const part = (size: number, k: number, lo: number, hi: number): number => clamp(size * k, Math.min(lo, size * 0.35), Math.min(hi, size * 0.45))

// ---------- материалы ----------
// Общие материалы модуля: создаются один раз и после создания не мутируются.
const MAT = {
  /** дерево — опоры, стволы */
  wood: new THREE.MeshStandardMaterial({ color: 0xb98d5c, roughness: 0.7 }),
  /** металл — ручки, ножки, смесители */
  metal: new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.3, metalness: 0.85 }),
  /** тёмный пластик — цоколи, рамы, техника */
  dark: new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.55, metalness: 0.15 }),
  /** экран телевизора, стеклокерамика плиты */
  screen: new THREE.MeshStandardMaterial({ color: 0x0d1014, roughness: 0.2, metalness: 0.2 }),
  /** стекло — душевые перегородки, люк стиральной машины */
  glass: new THREE.MeshPhysicalMaterial({ color: 0xcfe4f2, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.26, side: THREE.DoubleSide }),
  /** белая керамика — сантехника */
  ceramic: new THREE.MeshStandardMaterial({ color: 0xf6f7f5, roughness: 0.15 }),
  /** камень — кухонные столешницы */
  stone: new THREE.MeshStandardMaterial({ color: 0xd5d1c8, roughness: 0.4 }),
  /** бельё, подушки */
  linen: new THREE.MeshStandardMaterial({ color: 0xfbfaf6, roughness: 0.92 }),
  /** зеркальная поверхность */
  mirror: new THREE.MeshStandardMaterial({ color: 0xe2ecf4, roughness: 0.03, metalness: 1 }),
  /** листва растения */
  leaf: new THREE.MeshStandardMaterial({ color: 0x4e8a46, roughness: 0.85 }),
  /** земля в горшке */
  soil: new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1 }),
}

/** кэш материалов основного цвета: ключ — строка «цвет|оттенок|шероховатость» */
const tintCache = new Map<string, THREE.MeshStandardMaterial>()

/** материал основного цвета предмета: k < 1 — темнее, k > 1 — светлее */
function tint(color: THREE.Color, k = 1, roughness = 0.82): THREE.MeshStandardMaterial {
  const key = `${color.getHexString()}|${k}|${roughness}`
  const found = tintCache.get(key)
  if (found) return found
  const c = color.clone()
  if (k < 1) c.multiplyScalar(k)
  else if (k > 1) c.lerp(WHITE, Math.min(1, k - 1))
  const mat = new THREE.MeshStandardMaterial({ color: c, roughness, metalness: 0.02 })
  tintCache.set(key, mat)
  return mat
}

// ---------- примитивы ----------
/** коробка; x, y, z — координаты центра */
function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, EPS), Math.max(h, EPS), Math.max(d, EPS)), mat)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/** цилиндр с осью Y */
function cyl(rTop: number, rBot: number, h: number, seg: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(rTop, EPS), Math.max(rBot, EPS), Math.max(h, EPS), seg), mat)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/** цилиндр с осью Z (лежит «по глубине») */
function cylZ(r: number, len: number, seg: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = cyl(r, r, len, seg, mat, x, y, z)
  m.rotation.x = Math.PI / 2
  return m
}

/** цилиндр с осью X (лежит «по ширине») */
function cylX(r: number, len: number, seg: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = cyl(r, r, len, seg, mat, x, y, z)
  m.rotation.z = Math.PI / 2
  return m
}

/** сфера */
function ball(r: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(Math.max(r, EPS), 16, 12), mat)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/**
 * Скруглённый параллелепипед через ExtrudeGeometry.
 * Фаска расширяет контур наружу, поэтому плоский контур берём меньше на 2r.
 */
function roundedBoxGeom(w: number, h: number, d: number, radius: number): THREE.BufferGeometry {
  const r = Math.min(radius, Math.min(w, h, d) * 0.24)
  // слишком мелкая фаска не даст скругления, зато испортит габарит — берём обычную коробку
  if (!(r > 0.0005)) return new THREE.BoxGeometry(w, h, d)
  const sw = w - 2 * r
  const sh = h - 2 * r
  const rc = Math.min(r, sw / 2, sh / 2)
  const x0 = -sw / 2
  const y0 = -sh / 2
  const x1 = sw / 2
  const y1 = sh / 2
  const s = new THREE.Shape()
  s.moveTo(x0 + rc, y0)
  s.lineTo(x1 - rc, y0)
  s.quadraticCurveTo(x1, y0, x1, y0 + rc)
  s.lineTo(x1, y1 - rc)
  s.quadraticCurveTo(x1, y1, x1 - rc, y1)
  s.lineTo(x0 + rc, y1)
  s.quadraticCurveTo(x0, y1, x0, y1 - rc)
  s.lineTo(x0, y0 + rc)
  s.quadraticCurveTo(x0, y0, x0 + rc, y0)
  const geom = new THREE.ExtrudeGeometry(s, {
    depth: d - 2 * r,
    bevelEnabled: true,
    bevelThickness: r,
    bevelSize: r,
    bevelSegments: 3,
    curveSegments: 4,
    steps: 1,
  })
  geom.translate(0, 0, -(d - 2 * r) / 2)
  geom.computeVertexNormals()
  return geom
}

/** меш-скруглённая коробка; x, y, z — центр */
function rbox(w: number, h: number, d: number, r: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(roundedBoxGeom(Math.max(w, EPS), Math.max(h, EPS), Math.max(d, EPS), r), mat)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/** четыре ножки по углам габарита (zc — смещение центра по глубине) */
function legs(g: THREE.Group, w: number, d: number, hLeg: number, s: number, mat: THREE.Material, round = false, zc = 0): void {
  const inset = s / 2 + Math.min(0.03, Math.min(w, d) * 0.06)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * Math.max(w / 2 - inset, 0)
      const z = zc + sz * Math.max(d / 2 - inset, 0)
      g.add(round ? cyl(s / 2, s / 2, hLeg, 10, mat, x, hLeg / 2, z) : box(s, hLeg, s, mat, x, hLeg / 2, z))
    }
  }
}

/** плита с прямоугольным вырезом (столешница под врезную чашу): четыре полосы вокруг дыры */
function slabWithHole(g: THREE.Group, w: number, d: number, th: number, top: number, holeW: number, holeD: number, holeZ: number, mat: THREE.Material): void {
  const y = top - th / 2
  const z0 = holeZ - holeD / 2
  const z1 = holeZ + holeD / 2
  const back = z0 + d / 2
  const front = d / 2 - z1
  g.add(box(w, th, back, mat, 0, y, -d / 2 + back / 2))
  g.add(box(w, th, front, mat, 0, y, d / 2 - front / 2))
  const sw = (w - holeW) / 2
  g.add(box(sw, th, holeD, mat, -w / 2 + sw / 2, y, holeZ))
  g.add(box(sw, th, holeD, mat, w / 2 - sw / 2, y, holeZ))
}

/** ряд вертикальных прутьев вдоль оси X */
function barsX(g: THREE.Group, x0: number, x1: number, y0: number, y1: number, z: number, r: number, mat: THREE.Material): void {
  const len = x1 - x0 - 2 * r
  if (len <= 0 || y1 <= y0) return
  const n = Math.max(2, Math.round(len / 0.075))
  for (let i = 0; i <= n; i++) g.add(cyl(r, r, y1 - y0, 8, mat, x0 + r + (len * i) / n, (y0 + y1) / 2, z))
}

/** ряд вертикальных прутьев вдоль оси Z */
function barsZ(g: THREE.Group, z0: number, z1: number, y0: number, y1: number, x: number, r: number, mat: THREE.Material): void {
  const len = z1 - z0 - 2 * r
  if (len <= 0 || y1 <= y0) return
  const n = Math.max(2, Math.round(len / 0.075))
  for (let i = 0; i <= n; i++) g.add(cyl(r, r, y1 - y0, 8, mat, x, (y0 + y1) / 2, z0 + r + (len * i) / n))
}

/** смеситель: стояк и излив, целиком укладывается в высоту fauH над уровнем top */
function faucet(g: THREE.Group, d: number, top: number, fauH: number, w: number): void {
  const r = Math.min(0.019, d * 0.06, w * 0.06)
  const z = -d / 2 + Math.max(r, Math.min(d * 0.14, 0.085))
  const riser = fauH * 0.76
  g.add(cyl(r * 0.85, r, riser, 12, MAT.metal, 0, top + riser / 2, z))
  const spout = Math.max(Math.min(fauH * 0.66, d / 2 - z - r), EPS)
  g.add(cylZ(r * 0.68, spout, 12, MAT.metal, 0, top + riser - r * 0.68, z + spout / 2))
}

// ---------- спальня ----------
/** кровать: каркас, матрас, изголовье у −Z, подушки и одеяло с отворотом */
function bed(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const hbT = part(d, 0.05, 0.04, 0.07)
  const legH = h * 0.12
  const frameH = h * 0.34
  const matH = h * 0.26
  const bodyD = d - hbT
  const bodyZ = -d / 2 + hbT + bodyD / 2
  const matTop = legH + frameH + matH
  // изголовье во всю высоту
  g.add(rbox(w, h, hbT, hbT * 0.4, tint(color, 0.82), 0, h / 2, -d / 2 + hbT / 2))
  // царга каркаса и ножки
  g.add(box(w * 0.98, frameH, bodyD, tint(color, 0.92), 0, legH + frameH / 2, bodyZ))
  legs(g, w * 0.98, bodyD, legH, part(w, 0.06, 0.05, 0.07), tint(color, 0.7), false, bodyZ)
  // матрас
  g.add(rbox(w * 0.94, matH, bodyD * 0.95, matH * 0.25, MAT.linen, 0, matTop - matH / 2, bodyZ))
  // подушки у изголовья
  const pD = bodyD * 0.17
  const pH = h * 0.1
  const pZ = -d / 2 + hbT + pD * 0.75
  const two = w >= 1.2
  const pW = two ? (w * 0.9 - 0.05) / 2 : w * 0.72
  for (const sx of two ? [-1, 1] : [0]) g.add(rbox(pW, pH, pD, pH * 0.4, MAT.linen, sx * (pW / 2 + 0.025), matTop + pH / 2, pZ))
  // одеяло с отворотом
  const dz0 = -d / 2 + hbT + pD * 1.6
  const dz1 = d / 2
  if (dz1 - dz0 > d * 0.2) {
    const dD = dz1 - dz0
    g.add(rbox(w * 0.96, h * 0.09, dD, Math.min(h * 0.03, dD * 0.2), tint(color, 1.18, 0.9), 0, matTop + h * 0.045, (dz0 + dz1) / 2))
    g.add(rbox(w * 0.96, h * 0.05, dD * 0.16, h * 0.015, MAT.linen, 0, matTop + h * 0.115, dz0 + dD * 0.08))
  }
  return g
}

/** детская кроватка: основание, матрас, угловые стойки и решётчатые бортики */
function crib(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const post = Math.min(part(Math.min(w, d), 0.07, 0.03, 0.05), h * 0.1)
  const rail = Math.min(post * 0.7, 0.035, h * 0.08)
  const barR = Math.min(post * 0.26, 0.013)
  const wood = tint(color, 0.95)
  const baseY = h * 0.34
  const xIn = Math.max(w / 2 - post, EPS)
  const zIn = Math.max(d / 2 - post, EPS)
  // угловые стойки
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(post, h, post, tint(color, 0.85), sx * (w / 2 - post / 2), h / 2, sz * (d / 2 - post / 2)))
  // дно и матрас
  g.add(box(2 * xIn, h * 0.03, 2 * zIn, tint(color, 0.8), 0, baseY - h * 0.015, 0))
  g.add(rbox(2 * xIn * 0.98, h * 0.08, 2 * zIn * 0.98, h * 0.02, MAT.linen, 0, baseY + h * 0.04, 0))
  // поручни и прутья
  const yTop = h - rail / 2
  const yBot = Math.min(baseY + h * 0.14 + rail / 2, yTop - h * 0.12)
  for (const sz of [-1, 1]) {
    const z = sz * (d / 2 - post / 2)
    g.add(box(2 * xIn, rail, rail, wood, 0, yTop, z))
    g.add(box(2 * xIn, rail, rail, wood, 0, yBot, z))
    barsX(g, -xIn, xIn, yBot + rail / 2, yTop - rail / 2, z, barR, wood)
  }
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - post / 2)
    g.add(box(rail, rail, 2 * zIn, wood, x, yTop, 0))
    g.add(box(rail, rail, 2 * zIn, wood, x, yBot, 0))
    barsZ(g, -zIn, zIn, yBot + rail / 2, yTop - rail / 2, x, barR, wood)
  }
  return g
}

// ---------- мягкая мебель ----------
/** диван / кресло: спинка у −Z, два подлокотника, подушки сиденья и спинки */
function sofa(w: number, d: number, h: number, color: THREE.Color, seats: number): THREE.Group {
  const g = new THREE.Group()
  const legH = part(h, 0.12, 0.05, 0.11)
  const armW = part(w, 0.11, 0.08, 0.2)
  const backD = part(d, 0.2, 0.08, 0.22)
  const seatTop = h * 0.47
  const cushH = h * 0.16
  const baseTop = seatTop - cushH
  const seatD = d - backD
  const seatZ = -d / 2 + backD + seatD / 2
  const innerW = Math.max(w - 2 * armW, w * 0.2)
  const backCushH = Math.min(h * 0.3, h - seatTop - h * 0.02)
  // спинка
  g.add(rbox(w, h - legH, backD, backD * 0.28, tint(color), 0, legH + (h - legH) / 2, -d / 2 + backD / 2))
  // подлокотники
  const armH = legH + (h - legH) * 0.62
  for (const sx of [-1, 1]) g.add(rbox(armW, armH - legH, d, armW * 0.35, tint(color, 0.94), sx * (w / 2 - armW / 2), legH + (armH - legH) / 2, 0))
  // основание сиденья
  g.add(box(innerW, baseTop - legH, seatD, tint(color, 0.88), 0, legH + (baseTop - legH) / 2, seatZ))
  // подушки сиденья и спинки
  const n = Math.max(1, Math.round(seats))
  const gap = Math.min(0.02, innerW * 0.04)
  const cw = (innerW - gap * (n + 1)) / n
  for (let i = 0; i < n; i++) {
    const x = -innerW / 2 + gap + cw / 2 + i * (cw + gap)
    g.add(rbox(cw, cushH, seatD * 0.95, Math.min(cushH, cw, seatD) * 0.28, tint(color, 1.1), x, baseTop + cushH / 2, seatZ))
    g.add(rbox(cw, backCushH, backD * 0.62, Math.min(backCushH, cw, backD * 0.62) * 0.28, tint(color, 1.04), x, seatTop + backCushH / 2, -d / 2 + backD * 1.3))
  }
  legs(g, w, d, legH, part(w, 0.04, 0.03, 0.05), MAT.dark, true)
  return g
}

/** угловой диван: основная часть вдоль −Z и оттоманка со стороны +X */
function sofaCorner(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const legH = part(h, 0.12, 0.05, 0.11)
  const armW = part(w, 0.07, 0.07, 0.16)
  const backD = part(d, 0.14, 0.08, 0.2)
  const seatTop = h * 0.47
  const cushH = h * 0.16
  const baseTop = seatTop - cushH
  const mainD = clamp(d * 0.58, backD + d * 0.1, d * 0.85)
  const xL = -w / 2 + armW
  const xR = w / 2 - armW
  const ottoW = clamp(w * 0.38, w * 0.2, (xR - xL) * 0.6)
  const zB = -d / 2 + backD
  const zM = -d / 2 + mainD
  const backCushH = Math.min(h * 0.3, h - seatTop - h * 0.02)
  // спинка во всю ширину
  g.add(rbox(w, h - legH, backD, backD * 0.28, tint(color), 0, legH + (h - legH) / 2, -d / 2 + backD / 2))
  // левый подлокотник — высокий, вдоль основной части
  const armH = legH + (h - legH) * 0.62
  g.add(rbox(armW, armH - legH, mainD, armW * 0.35, tint(color, 0.94), -w / 2 + armW / 2, legH + (armH - legH) / 2, -d / 2 + mainD / 2))
  // правый подлокотник — низкий, во всю глубину (вдоль оттоманки)
  const armLow = legH + (h - legH) * 0.42
  g.add(rbox(armW, armLow - legH, d, armW * 0.35, tint(color, 0.94), w / 2 - armW / 2, legH + (armLow - legH) / 2, 0))
  // основания основной части и оттоманки
  g.add(box(xR - xL, baseTop - legH, mainD - backD, tint(color, 0.88), (xL + xR) / 2, legH + (baseTop - legH) / 2, (zB + zM) / 2))
  g.add(box(ottoW, baseTop - legH, d - mainD, tint(color, 0.88), xR - ottoW / 2, legH + (baseTop - legH) / 2, (zM + d / 2) / 2))
  // подушки основной части
  const mainW = Math.max(xR - xL - ottoW, w * 0.1)
  const n = mainW > 1.3 ? 3 : 2
  const gap = Math.min(0.02, mainW * 0.04)
  const cw = (mainW - gap * (n + 1)) / n
  for (let i = 0; i < n; i++) {
    const x = xL + gap + cw / 2 + i * (cw + gap)
    g.add(rbox(cw, cushH, mainD - backD - gap, Math.min(cushH, cw) * 0.28, tint(color, 1.1), x, baseTop + cushH / 2, (zB + zM) / 2))
    g.add(rbox(cw, backCushH, backD * 0.62, Math.min(backCushH, cw, backD * 0.62) * 0.28, tint(color, 1.04), x, seatTop + backCushH / 2, -d / 2 + backD * 1.3))
  }
  // подушка оттоманки
  g.add(rbox(ottoW - gap * 2, cushH, d - backD - gap * 2, Math.min(cushH, ottoW) * 0.28, tint(color, 1.1), xR - ottoW / 2, baseTop + cushH / 2, (zB + d / 2) / 2))
  legs(g, w, d, legH, part(w, 0.03, 0.03, 0.05), MAT.dark, true)
  return g
}

// ---------- столы и сиденья ----------
/** стол / письменный стол: столешница и четыре ножки по углам */
function table(w: number, d: number, h: number, color: THREE.Color, desk: boolean): THREE.Group {
  const g = new THREE.Group()
  const topH = part(h, 0.06, 0.028, 0.055)
  g.add(rbox(w, topH, d, topH * 0.3, tint(color), 0, h - topH / 2, 0))
  const legS = part(Math.min(w, d), 0.08, 0.04, 0.08)
  legs(g, w, d, h - topH, legS, tint(color, 0.78))
  // царги под столешницей
  const skirtH = part(h, 0.07, 0.03, 0.07)
  const skirtY = h - topH - skirtH / 2
  for (const sz of [-1, 1]) g.add(box(w * 0.86, skirtH, d * 0.06, tint(color, 0.86), 0, skirtY, sz * (d / 2 - d * 0.09)))
  if (desk) {
    // фальшпанель у −Z
    const pt = Math.min(0.018, d * 0.2)
    const pH = Math.min(h * 0.32, h - topH - skirtH)
    if (pH > h * 0.05) g.add(box(w * 0.82, pH, pt, tint(color, 0.9), 0, h - topH - pH / 2, -d / 2 + d * 0.12 + pt / 2))
  }
  return g
}

/** круглый стол: столешница на центральной опоре с основанием */
function tableRound(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const r = Math.min(w, d) / 2
  const topH = part(h, 0.05, 0.025, 0.05)
  const baseH = part(h, 0.05, 0.02, 0.055)
  const skirtH = part(h, 0.05, 0.02, 0.05)
  const stemH = Math.max(h * 0.2, h - topH - baseH - skirtH)
  g.add(cyl(r, r, topH, 40, tint(color), 0, h - topH / 2, 0))
  g.add(cyl(r * 0.88, r * 0.88, skirtH, 32, tint(color, 0.9), 0, h - topH - skirtH / 2, 0))
  g.add(cyl(r * 0.12, r * 0.16, stemH, 20, tint(color, 0.8), 0, baseH + stemH / 2, 0))
  g.add(cyl(r * 0.44, r * 0.52, baseH, 32, tint(color, 0.78), 0, baseH / 2, 0))
  return g
}

/** стул: сиденье, спинка у −Z, четыре ножки */
function chair(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const seatTop = clamp(h * 0.5, h * 0.2, h * 0.7)
  const seatH = part(h, 0.05, 0.025, 0.055)
  const legS = part(Math.min(w, d), 0.1, 0.028, 0.05)
  legs(g, w * 0.94, d * 0.94, seatTop - seatH, legS, tint(color, 0.78))
  g.add(rbox(w * 0.94, seatH, d * 0.94, seatH * 0.3, tint(color), 0, seatTop - seatH / 2, 0))
  // спинка: две стойки и верхняя панель
  const backT = part(d, 0.07, 0.022, 0.04)
  const backH = h - seatTop
  const zB = -d / 2 + d * 0.05 + backT / 2
  for (const sx of [-1, 1]) g.add(box(legS, backH, backT, tint(color, 0.85), sx * (w * 0.47 - legS / 2), seatTop + backH / 2, zB))
  g.add(rbox(w * 0.9, backH * 0.42, backT, Math.min(backT, backH * 0.42) * 0.35, tint(color, 0.92), 0, h - backH * 0.21, zB))
  return g
}

/** табурет: круглое сиденье, четыре ножки и подножка-кольцо */
function stool(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const r = Math.min(w, d) / 2
  const seatH = part(h, 0.09, 0.035, 0.08)
  const legH = h - seatH
  const legR = Math.min(part(r, 0.09, 0.012, 0.028), h * 0.2)
  g.add(cyl(r, r * 0.95, seatH, 28, tint(color), 0, h - seatH / 2, 0))
  const rl = r * 0.7
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(legR * 0.8, legR, legH, 10, MAT.metal, (sx * rl) / Math.SQRT2, legH / 2, (sz * rl) / Math.SQRT2))
  // подножка — кольцо
  if (legH > h * 0.5) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.66, legR * 0.6, 8, 24), MAT.metal)
    ring.rotation.x = Math.PI / 2
    ring.position.y = h * 0.3
    ring.castShadow = true
    ring.receiveShadow = true
    g.add(ring)
  }
  return g
}

/** банкетка: сиденье и две опоры-щеки */
function bench(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const seatH = part(h, 0.14, 0.05, 0.1)
  g.add(rbox(w, seatH, d, seatH * 0.3, tint(color, 1.06), 0, h - seatH / 2, 0))
  const legT = part(d, 0.12, 0.028, 0.055)
  g.add(box(w * 0.6, part(h, 0.05, 0.02, 0.04), legT, tint(color, 0.8), 0, (h - seatH) * 0.32, 0))
  for (const sx of [-1, 1]) g.add(box(legT, h - seatH, d * 0.82, tint(color, 0.8), sx * Math.max(w / 2 - w * 0.1 - legT / 2, 0), (h - seatH) / 2, 0))
  return g
}

// ---------- корпусная мебель ----------
/** шкаф: цоколь, корпус, два-три фасада на +Z с вертикальными ручками */
function wardrobe(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const hr = part(d, 0.028, 0.008, 0.013)
  const fd = part(d, 0.05, 0.014, 0.024)
  const dc = Math.max(d * 0.5, d - fd - 2 * hr)
  const plinth = part(h, 0.04, 0.04, 0.09)
  g.add(box(w * 0.96, plinth, dc * 0.9, MAT.dark, 0, plinth / 2, -d / 2 + dc * 0.45))
  g.add(box(w, h - plinth, dc, tint(color, 0.9), 0, plinth + (h - plinth) / 2, -d / 2 + dc / 2))
  const n = w > 1.2 ? 3 : 2
  const gap = Math.min(0.008, w * 0.02, h * 0.02)
  const fw = (w - gap * (n + 1)) / n
  const fh = h - plinth - gap * 2
  const fz = d / 2 - 2 * hr - fd / 2
  for (let i = 0; i < n; i++) {
    const fx = -w / 2 + gap + fw / 2 + i * (fw + gap)
    g.add(box(fw, fh, fd, tint(color), fx, plinth + gap + fh / 2, fz))
    // ручка ближе к середине шкафа
    const side = i === n - 1 ? -1 : 1
    const off = Math.max(part(fw, 0.12, 0.03, 0.06), hr)
    g.add(cyl(hr, hr, fh * 0.28, 10, MAT.metal, fx + side * (fw / 2 - off), plinth + gap + fh * 0.5, d / 2 - hr))
  }
  return g
}

/** шкаф-купе: корпус и две раздвижные створки внахлёст */
function wardrobeSlide(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const fd = part(d, 0.05, 0.014, 0.024)
  const dc = Math.max(d * 0.5, d - 2 * fd)
  const plinth = part(h, 0.04, 0.04, 0.09)
  const rt = Math.min(0.018, h * 0.02)
  g.add(box(w * 0.96, plinth, dc * 0.9, MAT.dark, 0, plinth / 2, -d / 2 + dc * 0.45))
  g.add(box(w, h - plinth, dc, tint(color, 0.9), 0, plinth + (h - plinth) / 2, -d / 2 + dc / 2))
  const fh = h - plinth - rt * 2
  const fw = w * 0.53
  const fy = plinth + rt + fh / 2
  // задняя (левая) и передняя (правая) створки перекрываются в середине
  g.add(box(fw, fh, fd, tint(color, 0.96), -w / 2 + fw / 2, fy, d / 2 - fd * 1.5))
  g.add(box(fw, fh, fd, tint(color), w / 2 - fw / 2, fy, d / 2 - fd / 2))
  // вертикальные ручки-профили по ведущим кромкам
  const ph = part(w, 0.02, 0.012, 0.03)
  g.add(box(ph, fh, fd * 0.6, MAT.metal, -w / 2 + fw - ph, fy, d / 2 - fd * 1.2))
  g.add(box(ph, fh, fd * 0.6, MAT.metal, w / 2 - fw + ph, fy, d / 2 - fd * 0.3))
  // направляющие
  g.add(box(w, rt, d * 0.16, MAT.metal, 0, h - rt / 2, d / 2 - d * 0.08))
  g.add(box(w, rt * 0.8, d * 0.16, MAT.metal, 0, plinth + rt * 0.4, d / 2 - d * 0.08))
  return g
}

/** комод: цоколь, корпус и ящики с горизонтальными ручками */
function drawers(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const hr = part(d, 0.03, 0.008, 0.013)
  const fd = part(d, 0.06, 0.014, 0.024)
  const dc = Math.max(d * 0.5, d - fd - 2 * hr)
  const plinth = part(h, 0.07, 0.04, 0.09)
  g.add(box(w * 0.94, plinth, dc * 0.9, MAT.dark, 0, plinth / 2, -d / 2 + dc * 0.45))
  g.add(box(w, h - plinth, dc, tint(color, 0.9), 0, plinth + (h - plinth) / 2, -d / 2 + dc / 2))
  const n = h > 0.9 ? 4 : 3
  const gap = Math.min(0.008, h * 0.015, w * 0.02)
  const fh = (h - plinth - gap * (n + 1)) / n
  const fz = d / 2 - 2 * hr - fd / 2
  for (let i = 0; i < n; i++) {
    const fy = plinth + gap + fh / 2 + i * (fh + gap)
    g.add(box(w - gap * 2, fh, fd, tint(color), 0, fy, fz))
    g.add(cylX(Math.min(hr, fh * 0.3), w * 0.34, 10, MAT.metal, 0, fy, d / 2 - hr))
  }
  return g
}

/** стеллаж: боковины, задняя стенка, полки */
function shelf(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const t = Math.min(part(Math.min(w, d), 0.06, 0.016, 0.03), h * 0.1)
  const back = part(d, 0.05, 0.008, 0.016)
  const innerW = Math.max(w - 2 * t, w * 0.2)
  for (const sx of [-1, 1]) g.add(box(t, h, d, tint(color, 0.9), sx * (w / 2 - t / 2), h / 2, 0))
  g.add(box(innerW, t, d, tint(color), 0, h - t / 2, 0))
  g.add(box(innerW, t, d, tint(color), 0, t / 2, 0))
  g.add(box(innerW, h - 2 * t, back, tint(color, 0.76), 0, h / 2, -d / 2 + back / 2))
  const shelfD = Math.max(d - back - d * 0.02, d * 0.5)
  const n = clamp(Math.round((h - 2 * t) / 0.36), 2, 5)
  for (let i = 1; i <= n; i++) {
    const y = t + ((h - 2 * t) * i) / (n + 1)
    g.add(box(innerW, t * 0.8, shelfD, tint(color), 0, y, -d / 2 + back + shelfD / 2))
  }
  return g
}

// ---------- кухня ----------
interface BaseInfo {
  /** Y низа фасада */
  y0: number
  /** Y верха фасада */
  y1: number
  /** Z центра фасада */
  fz: number
  /** толщина фасада */
  fd: number
  /** радиус ручки (она выходит ровно на переднюю грань габарита) */
  hr: number
}

/** корпус кухонной тумбы: цоколь с нишей, короб и столешница чуть шире короба */
function kitchenBase(g: THREE.Group, w: number, d: number, top: number, color: THREE.Color, topMat: THREE.Material): BaseInfo {
  const plinth = part(top, 0.12, 0.05, 0.12)
  const ct = part(top, 0.045, 0.026, 0.045)
  const hr = part(d, 0.022, 0.008, 0.012)
  const fd = part(d, 0.035, 0.014, 0.022)
  const dc = Math.max(d * 0.5, d - fd - 2 * hr)
  const y1 = top - ct
  // цоколь утоплен — «ниша» под ноги
  g.add(box(w * 0.98, plinth, dc * 0.78, MAT.dark, 0, plinth / 2, -d / 2 + dc * 0.39))
  // короб
  g.add(box(w * 0.98, Math.max(y1 - plinth, EPS), dc, tint(color, 0.9), 0, (plinth + y1) / 2, -d / 2 + dc / 2))
  // столешница — чуть шире короба
  g.add(box(w, ct, d, topMat, 0, top - ct / 2, 0))
  const inset = Math.min(0.006, top * 0.02)
  return { y0: plinth + inset, y1: y1 - inset, fz: d / 2 - 2 * hr - fd / 2, fd, hr }
}

/** горизонтальная ручка-рейлинг на фасаде */
function pullH(g: THREE.Group, x: number, y: number, d: number, len: number, hr: number): void {
  g.add(cylX(hr, len, 10, MAT.metal, x, y, d / 2 - hr))
}

/** кухонная тумба: корпус, столешница и один-два фасада */
function counter(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const b = kitchenBase(g, w, d, h, color, MAT.stone)
  const n = w > 0.7 ? 2 : 1
  const gap = Math.min(0.008, w * 0.02)
  const fw = (w - gap * (n + 1)) / n
  const fh = Math.max(b.y1 - b.y0 - gap, EPS)
  for (let i = 0; i < n; i++) {
    const fx = -w / 2 + gap + fw / 2 + i * (fw + gap)
    g.add(box(fw, fh, b.fd, tint(color), fx, b.y0 + fh / 2, b.fz))
    pullH(g, fx, b.y0 + fh - part(fh, 0.1, 0.04, 0.08), d, fw * 0.5, Math.min(b.hr, fh * 0.2))
  }
  return g
}

/** мойка: тумба, врезанная чаша в столешнице и смеситель */
function sink(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  // верх опущен: место над столешницей занимает смеситель
  const fauH = part(h, 0.17, 0.09, 0.24)
  const top = h - fauH
  const ct = part(top, 0.045, 0.026, 0.045)
  const hr = part(d, 0.022, 0.008, 0.012)
  const fd = part(d, 0.035, 0.014, 0.022)
  const plinth = part(top, 0.12, 0.05, 0.12)
  const dc = Math.max(d * 0.5, d - fd - 2 * hr)
  const y1 = top - ct
  g.add(box(w * 0.98, plinth, dc * 0.78, MAT.dark, 0, plinth / 2, -d / 2 + dc * 0.39))
  g.add(box(w * 0.98, Math.max(y1 - plinth, EPS), dc, tint(color, 0.9), 0, (plinth + y1) / 2, -d / 2 + dc / 2))
  // столешница с вырезом и врезанная чаша
  const holeW = Math.min(w * 0.62, 0.5)
  const holeD = Math.min(d * 0.5, 0.4)
  const holeZ = d * 0.06
  slabWithHole(g, w, d, ct, top, holeW, holeD, holeZ, MAT.stone)
  const bowlH = Math.min(0.14, Math.max(y1 - plinth, EPS) * 0.6)
  g.add(box(holeW * 0.98, bowlH, holeD * 0.98, MAT.metal, 0, top - ct - bowlH / 2 + ct * 0.1, holeZ))
  // фасад тумбы
  const fh = Math.max(y1 - plinth - Math.min(0.012, top * 0.03), EPS)
  g.add(box(w * 0.98, fh, fd, tint(color), 0, plinth + (y1 - plinth - fh) / 2 + fh / 2, d / 2 - 2 * hr - fd / 2))
  pullH(g, 0, plinth + fh - part(fh, 0.1, 0.04, 0.08), d, w * 0.4, Math.min(hr, fh * 0.2))
  faucet(g, d, top, fauH, w)
  return g
}

/** плита: тумба-духовка, стеклокерамика и четыре конфорки */
function stove(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const burn = Math.min(0.008, h * 0.02)
  const b = kitchenBase(g, w, d, h - burn, color, MAT.screen)
  // конфорки
  const rb = Math.min(w, d) * 0.17
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(rb, rb, burn * 2, 24, MAT.dark, sx * w * 0.24, h - burn, sz * d * 0.22))
  // фасад духовки с окном и ручкой
  const fh = Math.max(b.y1 - b.y0 - Math.min(0.01, h * 0.02), EPS)
  const ovenH = fh * 0.72
  g.add(box(w * 0.97, ovenH, b.fd, MAT.dark, 0, b.y0 + ovenH / 2, b.fz))
  g.add(box(w * 0.8, ovenH * 0.62, b.fd * 0.5, MAT.screen, 0, b.y0 + ovenH * 0.45, d / 2 - 2 * b.hr - b.fd * 0.25))
  pullH(g, 0, b.y0 + ovenH + (fh - ovenH) * 0.45, d, w * 0.84, Math.min(b.hr * 1.3, (fh - ovenH) * 0.35))
  // панель с ручками управления
  const pH = fh - ovenH - b.hr * 3
  if (pH > h * 0.02) {
    g.add(box(w * 0.97, pH, b.fd, tint(color, 0.85), 0, b.y1 - pH / 2, b.fz))
    const kr = Math.min(pH * 0.3, 0.018, w * 0.04)
    for (let i = 0; i < 4; i++) g.add(cylZ(kr, b.hr * 2, 10, MAT.metal, -w * 0.3 + i * w * 0.2, b.y1 - pH / 2, d / 2 - b.hr))
  }
  return g
}

/** посудомоечная машина: тумба со сплошным фасадом и длинной ручкой */
function dishwasher(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const b = kitchenBase(g, w, d, h, color, MAT.stone)
  const fh = Math.max(b.y1 - b.y0 - Math.min(0.01, h * 0.02), EPS)
  g.add(box(w * 0.98, fh, b.fd, tint(color, 1.05), 0, b.y0 + fh / 2, b.fz))
  // панель управления и длинная ручка сверху фасада
  g.add(box(w * 0.98, fh * 0.1, b.fd * 0.6, MAT.dark, 0, b.y0 + fh * 0.94, b.fz + b.fd * 0.2))
  pullH(g, 0, b.y0 + fh * 0.85, d, w * 0.88, Math.min(b.hr * 1.2, fh * 0.1))
  return g
}

/** холодильник: корпус, две двери и вертикальные ручки */
function fridge(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const hr = part(d, 0.022, 0.009, 0.014)
  const fd = part(d, 0.06, 0.02, 0.04)
  const dc = Math.max(d * 0.5, d - fd - 2 * hr)
  const plinth = part(h, 0.03, 0.03, 0.06)
  g.add(box(w * 0.94, plinth, dc * 0.9, MAT.dark, 0, plinth / 2, -d / 2 + dc * 0.45))
  g.add(box(w, h - plinth, dc, tint(color, 0.88), 0, plinth + (h - plinth) / 2, -d / 2 + dc / 2))
  const gap = Math.min(0.01, h * 0.01)
  const doorsH = h - plinth - gap * 3
  const upH = doorsH * 0.62
  const loH = doorsH - upH
  const fz = d / 2 - 2 * hr - fd / 2
  const yLo = plinth + gap + loH / 2
  const yUp = plinth + gap * 2 + loH + upH / 2
  g.add(box(w * 0.99, loH, fd, tint(color, 1.06), 0, yLo, fz))
  g.add(box(w * 0.99, upH, fd, tint(color, 1.06), 0, yUp, fz))
  // вертикальные ручки со стороны +X
  const hx = w / 2 - Math.max(part(w, 0.12, 0.04, 0.08), hr)
  g.add(cyl(hr, hr, loH * 0.5, 10, MAT.metal, hx, yLo + loH * 0.2, d / 2 - hr))
  g.add(cyl(hr, hr, upH * 0.45, 10, MAT.metal, hx, yUp - upH * 0.25, d / 2 - hr))
  return g
}

/** стиральная машина: корпус, фасад, круглый люк на +Z, панель и лоток */
function washer(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const fd = part(d, 0.05, 0.015, 0.03)
  const dc = d - fd
  g.add(box(w, h, dc, tint(color, 1.08), 0, h / 2, -d / 2 + dc / 2))
  g.add(box(w * 0.99, h * 0.94, fd, tint(color, 1.14), 0, h * 0.47, d / 2 - fd / 2))
  // люк
  const r = Math.min(w * 0.36, h * 0.3)
  const cy = h * 0.44
  g.add(cylZ(r, fd * 1.2, 28, MAT.dark, 0, cy, d / 2 - fd * 0.6))
  g.add(cylZ(r * 0.74, fd * 0.8, 28, MAT.glass, 0, cy, d / 2 - fd * 0.5))
  // панель управления и лоток для порошка
  g.add(box(w * 0.5, h * 0.09, fd * 0.7, MAT.dark, w * 0.2, h * 0.87, d / 2 - fd * 0.35))
  g.add(box(w * 0.3, h * 0.09, fd * 0.7, MAT.metal, -w * 0.28, h * 0.87, d / 2 - fd * 0.35))
  return g
}

// ---------- санузел ----------
/** унитаз: бачок у −Z и чаша (LatheGeometry) с сиденьем */
function toilet(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const tankD = clamp(d * 0.24, Math.min(0.1, d * 0.3), Math.min(0.22, d * 0.34))
  const btn = Math.min(0.012, h * 0.03)
  const tankH = h * 0.44
  // бачок с кнопкой слива
  g.add(rbox(w * 0.88, tankH, tankD, Math.min(tankD, tankH, w * 0.88) * 0.2, MAT.ceramic, 0, h - btn - tankH / 2, -d / 2 + tankD / 2))
  const br = Math.min(w * 0.1, tankD * 0.35)
  g.add(cyl(br, br, btn * 2, 16, MAT.metal, 0, h - btn, -d / 2 + tankD / 2))
  // чаша: профиль вращения, сплющенный по Z в овал
  const bowlH = h * 0.52
  const rB = Math.min(w, d * 0.62) / 2
  const zk = (d * 0.64) / (2 * rB)
  const pts = [
    new THREE.Vector2(rB * 0.34, 0),
    new THREE.Vector2(rB * 0.3, bowlH * 0.14),
    new THREE.Vector2(rB * 0.42, bowlH * 0.42),
    new THREE.Vector2(rB * 0.78, bowlH * 0.72),
    new THREE.Vector2(rB * 0.97, bowlH * 0.92),
    new THREE.Vector2(rB, bowlH),
    new THREE.Vector2(rB * 0.8, bowlH),
  ]
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), MAT.ceramic)
  bowl.castShadow = true
  bowl.receiveShadow = true
  // сиденье-кольцо
  const seatT = Math.min(rB * 0.15, (h - bowlH) * 0.4)
  const seat = new THREE.Mesh(new THREE.TorusGeometry(rB - seatT, seatT, 8, 28), tint(color, 1.3, 0.35))
  seat.rotation.x = Math.PI / 2
  seat.position.y = bowlH + seatT
  seat.castShadow = true
  seat.receiveShadow = true
  const holder = new THREE.Group()
  holder.add(bowl)
  holder.add(seat)
  holder.scale.z = zk
  holder.position.z = d / 2 - rB * zk
  g.add(holder)
  // перемычка от бачка к чаше
  const brZ = -d / 2 + tankD
  g.add(box(w * 0.42, bowlH * 0.42, d * 0.16, MAT.ceramic, 0, bowlH * 0.3, brZ + d * 0.08))
  return g
}

/** раковина: чаша с врезным углублением, пьедестал и смеситель */
function basin(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const fauH = part(h, 0.2, 0.1, 0.26)
  const top = h - fauH
  const rim = part(h, 0.05, 0.03, 0.06)
  const holeW = w * 0.62
  const holeD = d * 0.5
  const holeZ = d * 0.06
  // корпус чаши: борт с вырезом и днище
  g.add(rbox(w, rim * 0.5, d, Math.min(w, d, rim * 0.5) * 0.2, MAT.ceramic, 0, top - rim - rim * 0.25, 0))
  slabWithHole(g, w, d, rim, top, holeW, holeD, holeZ, MAT.ceramic)
  // углубление
  const bowlH = Math.min(rim * 1.6, top * 0.4)
  g.add(box(holeW * 0.98, bowlH, holeD * 0.98, tint(color, 1.35, 0.3), 0, top - rim - bowlH / 2 + rim * 0.1, holeZ))
  const dr = Math.min(0.018, holeW * 0.2, holeD * 0.2)
  g.add(cyl(dr, dr, Math.min(0.006, bowlH * 0.2), 12, MAT.metal, 0, top - rim - bowlH + bowlH * 0.1, holeZ))
  // пьедестал
  const pedH = top - rim * 1.5
  if (pedH > h * 0.05) {
    const pr = Math.min(w, d) * 0.16
    g.add(cyl(pr * 1.15, pr * 1.35, pedH, 20, MAT.ceramic, 0, pedH / 2, -d * 0.04))
  }
  faucet(g, d, top, fauH, w)
  return g
}

/** ванна: борта, внутренняя вставка другого цвета и слив */
function bathtub(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const t = part(Math.min(w, d), 0.07, 0.04, 0.09)
  const floorH = part(h, 0.16, 0.05, 0.14)
  const body = tint(color, 1.1)
  const wallH = h - floorH
  // основание и четыре борта
  g.add(box(w, floorH, d, body, 0, floorH / 2, 0))
  for (const sz of [-1, 1]) g.add(box(w, wallH, t, body, 0, floorH + wallH / 2, sz * (d / 2 - t / 2)))
  for (const sx of [-1, 1]) g.add(box(t, wallH, d - 2 * t, body, sx * (w / 2 - t / 2), floorH + wallH / 2, 0))
  // вставка другого цвета — дно чаши
  const inW = Math.max(w - 2 * t, w * 0.2)
  const inD = Math.max(d - 2 * t, d * 0.2)
  const inH = wallH * 0.24
  g.add(rbox(inW, inH, inD, Math.min(t, inH, inW, inD) * 0.4, MAT.ceramic, 0, floorH + inH / 2, 0))
  // слив и перелив
  const dr = Math.min(0.026, w * 0.06, d * 0.1)
  g.add(cyl(dr, dr, Math.min(0.008, inH * 0.4), 16, MAT.metal, w / 2 - t - Math.min(0.09, w * 0.1), floorH + inH, 0))
  const orr = Math.min(0.02, t * 0.4, d * 0.1, wallH * 0.2)
  g.add(cylX(orr, t, 12, MAT.metal, w / 2 - t / 2, floorH + wallH * 0.72, 0))
  return g
}

/** душевая: поддон, задние стенки, стеклянные перегородки и лейка */
function shower(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const tray = part(h, 0.07, 0.05, 0.14)
  const t = part(Math.min(w, d), 0.035, 0.02, 0.035)
  const gt = Math.min(0.012, Math.min(w, d) * 0.04)
  const wallH = h - tray
  g.add(rbox(w, tray, d, Math.min(w, d, tray) * 0.24, MAT.ceramic, 0, tray / 2, 0))
  const dr = Math.min(0.05, w * 0.12, d * 0.12)
  g.add(cyl(dr, dr, Math.min(0.008, tray * 0.2), 20, MAT.metal, 0, tray - Math.min(0.004, tray * 0.1), 0))
  // глухие стенки у −Z и −X
  g.add(box(w, wallH, t, tint(color, 1.12, 0.35), 0, tray + wallH / 2, -d / 2 + t / 2))
  g.add(box(t, wallH, d - t, tint(color, 1.12, 0.35), -w / 2 + t / 2, tray + wallH / 2, t / 2))
  // стеклянные стенки у +Z и +X
  const gh = wallH * 0.92
  g.add(box(w - t, gh, gt, MAT.glass, t / 2, tray + gh / 2, d / 2 - gt / 2))
  g.add(box(gt, gh, d - t - gt, MAT.glass, w / 2 - gt / 2, tray + gh / 2, -d / 2 + t + (d - t - gt) / 2))
  g.add(box(gt * 2, gh, gt * 2, MAT.metal, w / 2 - gt, tray + gh / 2, d / 2 - gt))
  // лейка на стене −Z
  const hr = Math.min(0.055, w * 0.12, d * 0.14)
  const px = -w * 0.28
  const pz = -d / 2 + t + Math.min(0.02, d * 0.05)
  const armLen = Math.max(Math.min(0.16, d * 0.3, d / 2 - pz - hr), EPS)
  g.add(cyl(Math.min(0.013, hr * 0.3), Math.min(0.013, hr * 0.3), wallH * 0.52, 12, MAT.metal, px, tray + wallH * 0.3, pz))
  g.add(cylZ(Math.min(0.012, hr * 0.3), armLen, 12, MAT.metal, px, tray + wallH * 0.86, pz + armLen / 2))
  g.add(cyl(hr, hr * 0.85, Math.min(0.022, wallH * 0.1), 20, MAT.metal, px, tray + wallH * 0.82, pz + armLen))
  return g
}

// ---------- прочее ----------
/** телевизор: тонкая рама, тёмный экран на +Z, подставка */
function tv(w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group()
  const standH = part(h, 0.16, 0.05, 0.18)
  const panelH = h - standH
  const pd = clamp(d * 0.35, Math.min(0.018, d * 0.3), d * 0.45)
  const pz = -d / 2 + pd / 2
  g.add(box(w, panelH, pd, MAT.dark, 0, standH + panelH / 2, pz))
  const bez = Math.min(0.018, w * 0.02, panelH * 0.04)
  g.add(box(w - 2 * bez, panelH - 2 * bez, pd * 0.2, MAT.screen, 0, standH + panelH / 2, pz + pd * 0.5))
  // подставка
  g.add(box(w * 0.34, standH * 0.2, d * 0.72, MAT.dark, 0, standH * 0.1, 0))
  g.add(box(w * 0.11, standH * 0.8, d * 0.34, MAT.dark, 0, standH * 0.6, 0))
  return g
}

/** ковёр: очень тонкая плита у пола (только принимает тень) */
function rug(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const total = Math.min(h, 0.014)
  const r = Math.min(w, d) * 0.02
  const base = rbox(w, total * 0.62, d, r, tint(color, 1, 0.95), 0, total * 0.31, 0)
  const border = rbox(w * 0.9, total * 0.38, d * 0.86, r, tint(color, 0.82, 0.95), 0, total * 0.81, 0)
  for (const m of [base, border]) {
    m.castShadow = false
    m.receiveShadow = true
    g.add(m)
  }
  return g
}

/** растение: горшок, земля, ствол и крона из сфер */
function plant(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const r = Math.min(w, d) / 2
  const potH = part(h, 0.26, 0.06, h * 0.4)
  g.add(cyl(r * 0.62, r * 0.46, potH, 24, tint(color, 0.9, 0.65), 0, potH / 2, 0))
  g.add(cyl(r * 0.6, r * 0.6, Math.min(0.014, potH * 0.2), 20, MAT.soil, 0, potH - Math.min(0.007, potH * 0.1), 0))
  const stemH = Math.max(h * 0.12, h * 0.34 - potH)
  g.add(cyl(r * 0.05, r * 0.08, stemH, 8, MAT.wood, 0, potH + stemH / 2, 0))
  // крона из нескольких сфер
  const crownH = h - potH - stemH * 0.4
  const rc = Math.min(r * 0.62, crownH * 0.4, h * 0.3)
  g.add(ball(rc, MAT.leaf, 0, h - rc, 0))
  g.add(ball(rc * 0.72, MAT.leaf, r * 0.36, h - rc * 2, 0))
  g.add(ball(rc * 0.68, MAT.leaf, -r * 0.36, h - rc * 1.8, r * 0.1))
  g.add(ball(rc * 0.66, MAT.leaf, 0, h - rc * 2.2, -r * 0.32))
  g.add(ball(rc * 0.6, MAT.leaf, r * 0.1, h - rc * 2.4, r * 0.34))
  return g
}

/** радиатор: ряд тонких вертикальных секций и два коллектора */
function radiator(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const mat = tint(color, 1.2, 0.5)
  const n = clamp(Math.round(w / 0.055), 3, 40)
  const pitch = w / n
  const secW = Math.min(0.04, pitch * 0.62)
  for (let i = 0; i < n; i++) g.add(box(secW, h, d * 0.86, mat, -w / 2 + pitch * (i + 0.5), h / 2, 0))
  const rr = Math.min(d * 0.5, h * 0.06)
  g.add(cylX(rr, w, 12, mat, 0, h * 0.12, 0))
  g.add(cylX(rr, w, 12, mat, 0, h * 0.88, 0))
  return g
}

/** зеркало: рама из четырёх планок и зеркальная поверхность на +Z */
function mirror(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const fr = part(Math.min(w, h), 0.06, 0.02, 0.06)
  const frame = tint(color, 0.8)
  for (const sy of [0, 1]) g.add(box(w, fr, d, frame, 0, sy ? h - fr / 2 : fr / 2, 0))
  for (const sx of [-1, 1]) g.add(box(fr, h - 2 * fr, d, frame, sx * (w / 2 - fr / 2), h / 2, 0))
  g.add(box(w - 2 * fr, h - 2 * fr, d * 0.3, MAT.mirror, 0, h / 2, d / 2 - d * 0.18))
  return g
}

/** колонна: квадратные база и капитель, круглый ствол */
function column(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const r = Math.min(w, d) / 2
  const cap = part(h, 0.035, 0.025, 0.09)
  for (const sy of [0, 1]) g.add(box(2 * r, cap, 2 * r, tint(color, 0.88), 0, sy ? h - cap / 2 : cap / 2, 0))
  g.add(cyl(r * 0.84, r * 0.9, h - 2 * cap, 28, tint(color), 0, h / 2, 0))
  return g
}

/** коробка: скруглённый параллелепипед с крышкой */
function crate(w: number, d: number, h: number, color: THREE.Color): THREE.Group {
  const g = new THREE.Group()
  const r = Math.min(w, d, h) * 0.1
  const lid = h * 0.14
  g.add(rbox(w, h - lid, d, r, tint(color), 0, (h - lid) / 2, 0))
  g.add(rbox(w, lid, d, Math.min(r, lid * 0.4), tint(color, 0.82), 0, h - lid / 2, 0))
  return g
}

/**
 * Параметрическая модель предмета.
 * @param glyph вид предмета из каталога
 * @param w ширина, м (вдоль локальной оси X)
 * @param d глубина, м (вдоль локальной оси Z)
 * @param h высота, м (вдоль оси Y)
 * @param color основной цвет
 * @returns объект или null, если для этого вида модели нет
 */
export function buildFurnitureMesh(glyph: GlyphKind, w: number, d: number, h: number, color: THREE.Color): THREE.Object3D | null {
  if (!(w > 0) || !(d > 0) || !(h > 0)) return null
  let g: THREE.Group | null = null
  switch (glyph) {
    case 'bed':
      g = bed(w, d, h, color)
      break
    case 'sofa':
      g = sofa(w, d, h, color, w >= 2 ? 3 : 2)
      break
    case 'sofa-corner':
      g = sofaCorner(w, d, h, color)
      break
    case 'armchair':
      g = sofa(w, d, h, color, 1)
      break
    case 'table':
      g = table(w, d, h, color, false)
      break
    case 'desk':
      g = table(w, d, h, color, true)
      break
    case 'table-round':
      g = tableRound(w, d, h, color)
      break
    case 'chair':
      g = chair(w, d, h, color)
      break
    case 'stool':
      g = stool(w, d, h, color)
      break
    case 'bench':
      g = bench(w, d, h, color)
      break
    case 'wardrobe':
      g = wardrobe(w, d, h, color)
      break
    case 'wardrobe-slide':
      g = wardrobeSlide(w, d, h, color)
      break
    case 'drawers':
      g = drawers(w, d, h, color)
      break
    case 'shelf':
      g = shelf(w, d, h, color)
      break
    case 'counter':
      g = counter(w, d, h, color)
      break
    case 'sink':
      g = sink(w, d, h, color)
      break
    case 'stove':
      g = stove(w, d, h, color)
      break
    case 'dishwasher':
      g = dishwasher(w, d, h, color)
      break
    case 'fridge':
      g = fridge(w, d, h, color)
      break
    case 'washer':
      g = washer(w, d, h, color)
      break
    case 'toilet':
      g = toilet(w, d, h, color)
      break
    case 'basin':
      g = basin(w, d, h, color)
      break
    case 'bathtub':
      g = bathtub(w, d, h, color)
      break
    case 'shower':
      g = shower(w, d, h, color)
      break
    case 'tv':
      g = tv(w, d, h)
      break
    case 'rug':
      g = rug(w, d, h, color)
      break
    case 'plant':
      g = plant(w, d, h, color)
      break
    case 'crib':
      g = crib(w, d, h, color)
      break
    case 'radiator':
      g = radiator(w, d, h, color)
      break
    case 'mirror':
      g = mirror(w, d, h, color)
      break
    case 'column':
      g = column(w, d, h, color)
      break
    case 'box':
      g = crate(w, d, h, color)
      break
    // электрика и светильники рисуются отдельно
    case 'outlet':
    case 'switch':
    case 'light':
    case 'spot':
    case 'lamp':
      return null
    default:
      return null
  }
  g.name = `furniture:${glyph}`
  return g
}
