// Configure PDF.js worker before any PDF operations
// This must run before react-pdf imports pdfjs

import * as pdfjsDist from 'pdfjs-dist'

if (typeof window !== 'undefined') {
  // Use CDN in development, local file in production
  const isDev = import.meta.env.DEV
  let workerSrc: string
  
  if (isDev) {
    // In development, use CDN to avoid Vite module processing issues
    workerSrc = 'https://unpkg.com/pdfjs-dist@5.4.394/build/pdf.worker.min.mjs'
  } else {
    // In production, use local file from public folder
    const basePath = import.meta.env.BASE_URL || '/'
    const normalizedBasePath = basePath.endsWith('/') ? basePath : `${basePath}/`
    workerSrc = `${normalizedBasePath}pdf.worker.min.js`
  }
  
  // Set up worker configuration function
  const setWorkerSrc = (target: any) => {
    try {
      if (target) {
        if (!target.GlobalWorkerOptions) {
          target.GlobalWorkerOptions = { workerSrc }
        } else {
          // Try to set workerSrc, but it might be read-only
          try {
            target.GlobalWorkerOptions.workerSrc = workerSrc
          } catch (e) {
            // If workerSrc is read-only, try to replace the whole object
            try {
              Object.defineProperty(target, 'GlobalWorkerOptions', {
                value: { workerSrc },
                writable: true,
                configurable: true
              })
            } catch (e2) {
              // If that fails, continue - we'll use window fallback
            }
          }
        }
      }
    } catch (e) {
      // Silently continue
    }
  }
  
  // Set up window.pdfjsLib early as a global fallback
  // This is checked by pdfjs-dist and react-pdf as a fallback
  if (!(window as any).pdfjsLib) {
    (window as any).pdfjsLib = {}
  }
  if (!(window as any).pdfjsLib.GlobalWorkerOptions) {
    (window as any).pdfjsLib.GlobalWorkerOptions = { workerSrc }
  } else {
    (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc
  }
  
  // Also set up window.pdfjs for react-pdf compatibility
  if (typeof (window as any).pdfjs === 'undefined') {
    (window as any).pdfjs = {}
  }
  if (!(window as any).pdfjs.GlobalWorkerOptions) {
    (window as any).pdfjs.GlobalWorkerOptions = { workerSrc }
  } else {
    (window as any).pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
  }
  
  // Configure pdfjs-dist directly
  const pdfjsAny = pdfjsDist as any
  setWorkerSrc(pdfjsAny)
  
  // Try default export
  if (pdfjsAny.default) {
    setWorkerSrc(pdfjsAny.default)
  }
  
  // Also try to set it on any existing GlobalWorkerOptions that might be imported
  // This handles cases where pdfjs-dist has already been partially initialized
  if ((pdfjsAny as any).GlobalWorkerOptions) {
    try {
      (pdfjsAny as any).GlobalWorkerOptions.workerSrc = workerSrc
    } catch (e) {
      // Continue if it fails
    }
  }
}

