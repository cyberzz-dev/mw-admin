import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8080'
    }
  },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@monaco-editor') || id.includes('node_modules/monaco-editor')) {
            return 'monaco'
          }
          if (
            id.includes('node_modules/antd') ||
            id.includes('node_modules/@ant-design/') ||
            id.includes('node_modules/rc-') ||
            id.includes('node_modules/@rc-component')
          ) {
            return 'antd'
          }
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) {
            return 'react'
          }
        }
      }
    }
  }
})
