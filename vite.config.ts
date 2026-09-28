import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/ui/',
  server: {
    proxy: Object.fromEntries(
      ['/browse', '/cache-status', '/config', '/queue', '/register', '/trigger', '/ftp', '/disc-info'].map(path => [
        path,
        { target: process.env.GODSEND_DEV_BACKEND || 'http://10.77.15.115:8080', changeOrigin: true },
      ]),
    ),
  },
})
