import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { patchReactPdf } from './vite-plugin-patch-react-pdf'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), patchReactPdf()],
  base: process.env.NODE_ENV === 'production' ? '/ChatNote/' : '/',
  server: {
    port: 5173,
    strictPort: true,
    host: true
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      onwarn(warning, warn) {
        // Use default warning handler
        warn(warning)
      },
      output: {
        manualChunks: (id: string) => {
          // Separate react and react-dom into vendor chunk
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react'
          }
          // Separate react-pdf and pdfjs-dist into their own chunk (they're large)
          if (id.includes('node_modules/react-pdf') || id.includes('node_modules/pdfjs-dist')) {
            return 'vendor-pdf'
          }
          // Other node_modules go into vendor chunk
          if (id.includes('node_modules')) {
            return 'vendor'
          }
        }
      }
    }
  },
  optimizeDeps: {
    exclude: ['react-pdf'],
    include: ['warning', 'prop-types', 'pdfjs-dist'],
    esbuildOptions: {
      // Handle CommonJS modules
      mainFields: ['module', 'main']
    }
  }
})

