import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { apiDev } from './tools/vite-api'

export default defineConfig({
  plugins: [react(), apiDev()],
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
