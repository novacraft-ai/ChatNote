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
    chunkSizeWarningLimit: 2000, // Increased to accommodate large PDF libraries (react-pdf, pdfjs-dist)
    rollupOptions: {
      onwarn(warning, warn) {
        // Suppress eval warnings from onnxruntime-web (trusted dependency)
        if (warning.code === 'EVAL' && warning.id?.includes('onnxruntime-web')) {
          return
        }
        // Use default warning handler for other warnings
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

