import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      base: '/Thumbnails_generator_with_ai/',
      '/api': 'http://localhost:8000',
    },
  },
})
