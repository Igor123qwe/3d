import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { apiDev } from './tools/vite-api'

/** версия — коммит, с которого запущен сервер или собрана сборка; «+» — есть несохранённые правки */
function appVersion(): string {
  try {
    const git = (args: string) => execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    return `${git('rev-parse --short HEAD')}${git('status --porcelain') ? '+' : ''}`
  } catch {
    return 'без git'
  }
}

export default defineConfig({
  plugins: [react(), apiDev()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  server: {
    port: 5173,
  },
  base: process.env.BASE_PATH || '/',
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        planner: 'planner.html',
      },
    },
  },
})
