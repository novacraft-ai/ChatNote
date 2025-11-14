import type { Plugin } from 'vite'

export function patchReactPdf(): Plugin {
  return {
    name: 'patch-react-pdf',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('react-pdf') && id.includes('index')) {
        // Only modify the workerSrc property, don't try to reassign GlobalWorkerOptions
        // Use import.meta.env.BASE_URL which Vite will replace at build time
        const patchedCode = code.replace(
          /pdfjs\.GlobalWorkerOptions\.workerSrc\s*=\s*['"]pdf\.worker\.(js|mjs)['"];?/g,
          `pdfjs.GlobalWorkerOptions.workerSrc = (() => {
            const basePath = import.meta.env.BASE_URL || '/';
            return basePath.endsWith('/') ? basePath + 'pdf.worker.min.js' : basePath + '/pdf.worker.min.js';
          })()`
        )
        
        if (patchedCode !== code) {
          return {
            code: patchedCode,
            map: null
          }
        }
      }
      return null
    }
  }
}

