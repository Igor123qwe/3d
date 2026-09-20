declare global {
  interface Window {
    Telegram?: {
      WebApp: any
    }
  }
}

export interface TelegramWebApp {
  initData: string
  initDataUnsafe: any
  colorScheme: 'light' | 'dark'
  themeParams: any
  expand: () => void
  ready: () => void
  close: () => void
  MainButton: {
    text: string
    isVisible: boolean
    show: () => void
    hide: () => void
    setText: (text: string) => void
    onClick: (cb: () => void) => void
    offClick: (cb: () => void) => void
  }
}

export const getTelegramWebApp = (): TelegramWebApp | null => {
  if (typeof window === 'undefined') return null
  const tg = window.Telegram?.WebApp
  return tg ?? null
}
