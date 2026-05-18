import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:8765',
      '/rag': {
        target: 'http://localhost:5175',
        rewrite: (path) => path.replace(/^\/rag/, ''),
      },
    },
  },
})
