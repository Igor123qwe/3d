// Передача плана по ссылке: сжатый JSON в хэше URL (для открытия AR на телефоне)
import type { Plan } from './types'
import { normalizePlan } from './exporters'

const b64url = (bytes: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromB64url = (s: string): Uint8Array => {
  const b = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b.length % 4 ? '='.repeat(4 - (b.length % 4)) : ''
  const bin = atob(b + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function encodePlan(plan: Plan): Promise<string> {
  // картинка подложки весит сотни килобайт — в ссылку она не поместится
  const { underlay: _underlay, ...light } = plan
  const data = new TextEncoder().encode(JSON.stringify(light))
  if (typeof CompressionStream !== 'undefined') {
    try {
      const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))
      const buf = new Uint8Array(await new Response(stream).arrayBuffer())
      return `z.${b64url(buf)}`
    } catch {
      /* fallthrough */
    }
  }
  return `j.${b64url(data)}`
}

export async function decodePlan(encoded: string): Promise<Plan | null> {
  try {
    const [kind, payload] = encoded.split('.', 2)
    if (!payload) return null
    let bytes = fromB64url(payload)
    if (kind === 'z') {
      const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      bytes = new Uint8Array(await new Response(stream).arrayBuffer())
    }
    const json = JSON.parse(new TextDecoder().decode(bytes)) as Partial<Plan>
    if (!Array.isArray(json.walls)) return null
    return normalizePlan(json)
  } catch {
    return null
  }
}

export type ShareMode = '2d' | '3d' | 'ar'

/** адрес страницы планировщика с учётом подпапки развёртывания (GitHub Pages и т. п.) */
export function plannerUrl(): string {
  const base = (import.meta.env?.BASE_URL ?? '/').replace(/\/+$/, '')
  return new URL(`${base}/planner.html`, location.href).href
}

/** ссылка на отдельную страницу планировщика с планом внутри */
export async function planShareUrl(plan: Plan, mode: ShareMode): Promise<string> {
  const encoded = await encodePlan(plan)
  return `${plannerUrl()}#mode=${mode}&plan=${encoded}`
}

export function parseHash(hash: string): { mode?: ShareMode; plan?: string } {
  const h = hash.startsWith('#') ? hash.slice(1) : hash
  const out: { mode?: ShareMode; plan?: string } = {}
  for (const part of h.split('&')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i)
    const v = part.slice(i + 1)
    if (k === 'mode' && (v === '2d' || v === '3d' || v === 'ar')) out.mode = v
    if (k === 'plan') out.plan = v
  }
  return out
}
