import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const SERVER = 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/ws': { target: SERVER, ws: true },
      '/avatars': { target: SERVER },
    },
  },
})
