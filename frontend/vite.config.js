import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const frontendRoot = path.dirname(fileURLToPath(import.meta.url))
const reactPackage = path.join(frontendRoot, 'node_modules/react')
const apiProxyTarget = process.env.API_PROXY_TARGET || 'http://localhost:3000'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: 'react/jsx-dev-runtime', replacement: path.join(reactPackage, 'jsx-dev-runtime.js') },
      { find: 'react/jsx-runtime', replacement: path.join(reactPackage, 'jsx-runtime.js') },
      { find: 'react', replacement: path.join(reactPackage, 'index.js') },
    ],
  },
  server: {
    fs: {
      allow: ['..'],
    },
    ...(process.env.CHOKIDAR_USEPOLLING === 'true' ? { watch: { usePolling: true } } : {}),
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
})
