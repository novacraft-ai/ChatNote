/**
 * Utility function to extract text from PDF file
 * Uses pdfjs-dist to extract text from all pages
 */

// Use dynamic import to avoid issues with pdfjs-dist module resolution
let pdfjsLib: any

async function getPdfjsLib() {
  if (!pdfjsLib) {
    // Try to get pdfjs from window first (set up by pdfjs-setup.ts)
    if (typeof window !== 'undefined' && (window as any).pdfjsLib) {
      pdfjsLib = (window as any).pdfjsLib
    } else {
      // Fallback: import pdfjs-dist
      const pdfjsModule = await import('pdfjs-dist')
      pdfjsLib = pdfjsModule.default || pdfjsModule
    }
    
    // Configure worker if not already set
    if (typeof window !== 'undefined' && pdfjsLib && !pdfjsLib.GlobalWorkerOptions?.workerSrc) {
      const isDev = import.meta.env.DEV
      let workerSrc: string
      
      if (isDev) {
        workerSrc = 'https://unpkg.com/pdfjs-dist@5.4.394/build/pdf.worker.min.mjs'
      } else {
        const basePath = import.meta.env.BASE_URL || '/'
        const normalizedBasePath = basePath.endsWith('/') ? basePath : `${basePath}/`
        workerSrc = `${normalizedBasePath}pdf.worker.min.js`
      }
      
      if (pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc
      } else {
        pdfjsLib.GlobalWorkerOptions = { workerSrc }
      }
    }
  }
  return pdfjsLib
}

/**
 * Extract all text from a PDF file
 * @param file - The PDF file to extract text from
 * @returns Promise that resolves to the extracted text
 */
export async function extractTextFromPDF(file: File): Promise<string> {
  try {
    const pdfjs = await getPdfjsLib()
    const arrayBuffer = await file.arrayBuffer()
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer })
    const pdf = await loadingTask.promise
    
    const numPages = pdf.numPages
    const textPromises: Promise<string>[] = []
    
    // Extract text from each page
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum)
      const textContent = await page.getTextContent()
      
      // Combine all text items from the page
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ')
      
      textPromises.push(Promise.resolve(pageText))
    }
    
    // Wait for all pages to be processed
    const pageTexts = await Promise.all(textPromises)
    
    // Combine all pages with page separators
    const fullText = pageTexts
      .map((text, index) => {
        const pageNum = index + 1
        return `--- Page ${pageNum} ---\n${text}`
      })
      .join('\n\n')
    
    return fullText
  } catch (error) {
    console.error('Error extracting text from PDF:', error)
    throw new Error('Failed to extract text from PDF. The PDF may be corrupted or password-protected.')
  }
}

