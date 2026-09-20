import type { Plan } from './types'

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const safeName = (s: string) => (s || 'plan').replace(/[^\p{L}\p{N}_-]+/gu, '_')

export function downloadJson(plan: Plan): void {
  downloadBlob(`${safeName(plan.name)}.plan.json`, new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }))
}

export function downloadSvg(name: string, svgMarkup: string): void {
  downloadBlob(`${safeName(name)}.svg`, new Blob([svgMarkup], { type: 'image/svg+xml' }))
}

export function downloadPng(name: string, svgMarkup: string, width: number, height: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' }))
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(width)
      canvas.height = Math.ceil(height)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('no canvas'))
        return
      }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('toBlob failed'))
          return
        }
        downloadBlob(`${safeName(name)}.png`, blob)
        resolve()
      }, 'image/png')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('svg render failed'))
    }
    img.src = url
  })
}

export function readPlanFile(file: File): Promise<Plan> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      try {
        const data = JSON.parse(String(r.result)) as Plan
        if (!data || !Array.isArray(data.walls)) throw new Error('bad')
        resolve(normalizePlan(data))
      } catch {
        reject(new Error('Файл не похож на план'))
      }
    }
    r.onerror = () => reject(new Error('Не удалось прочитать файл'))
    r.readAsText(file)
  })
}

export function normalizePlan(p: Partial<Plan>): Plan {
  return {
    version: 1,
    name: typeof p.name === 'string' ? p.name : 'План',
    walls: Array.isArray(p.walls) ? p.walls : [],
    openings: Array.isArray(p.openings) ? p.openings : [],
    furniture: Array.isArray(p.furniture) ? p.furniture : [],
    rooms: Array.isArray(p.rooms) ? p.rooms : [],
    dims: Array.isArray(p.dims) ? p.dims : [],
    settings: { grid: p.settings?.grid ?? 10 },
  }
}
