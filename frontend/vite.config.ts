import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy /api to the backend in dev so the app is same-origin (no CORS friction).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
