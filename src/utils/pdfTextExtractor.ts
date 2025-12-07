/**
 * Utility function to extract structured text from PDF file
 * Uses pdfjs-dist to extract text, headings, and figure-like captions from all pages
 */

import type { PDFExtractionResult, PDFPageBlock, PDFFigure } from '../types/pdf'

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
      const standardFontDataUrl = 'https://unpkg.com/pdfjs-dist@5.4.394/standard_fonts/'
      
      if (isDev) {
        workerSrc = 'https://unpkg.com/pdfjs-dist@5.4.394/build/pdf.worker.min.mjs'
      } else {
        const basePath = import.meta.env.BASE_URL || '/'
        const normalizedBasePath = basePath.endsWith('/') ? basePath : `${basePath}/`
        workerSrc = `${normalizedBasePath}pdf.worker.min.js`
      }
      
      if (pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc
        pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = standardFontDataUrl
      } else {
        pdfjsLib.GlobalWorkerOptions = { workerSrc, standardFontDataUrl }
      }
    }
  }
  return pdfjsLib
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function detectHeadingLevel(line: string): number | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  if (trimmed.length > 140) return null

  const numbered = trimmed.match(/^(\d+(\.\d+)+|\d+)[)\s.-]+/)
  if (numbered) {
    const segments = numbered[1].split('.').length
    return Math.min(segments + 1, 4)
  }

  if (/^(chapter|section|appendix)\b/i.test(trimmed)) {
    return 2
  }

  const letters = trimmed.replace(/[^a-zA-Z]/g, '')
  if (letters.length > 0) {
    const uppercaseRatio = letters.replace(/[^A-Z]/g, '').length / letters.length
    if (uppercaseRatio > 0.65 && trimmed.length >= 4) {
      return 2
    }
  }

  if (/[:：]$/.test(trimmed)) {
    return 3
  }

  return null
}

function isFigureCaption(line: string): boolean {
  return /^(figure|fig\.?|table)\s+[\w.-]+/i.test(line.trim())
}

function buildPageBlocks(rawLines: string[], pageNumber: number): { blocks: PDFPageBlock[]; figures: PDFFigure[] } {
  const blocks: PDFPageBlock[] = []
  const figures: PDFFigure[] = []
  let paragraphBuffer = ''

  const flushParagraph = () => {
    const text = paragraphBuffer.trim()
    if (text) {
      blocks.push({ type: 'paragraph', text })
    }
    paragraphBuffer = ''
  }

  rawLines.forEach((rawLine) => {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      return
    }

    const headingLevel = detectHeadingLevel(line)
    if (headingLevel) {
      flushParagraph()
      blocks.push({ type: 'heading', text: line, level: headingLevel })
      return
    }

    if (isFigureCaption(line)) {
      flushParagraph()
      const labelMatch = line.match(/^(figure|fig\.?|table)\s+([\w.-]+)/i)
      const label = labelMatch ? `${labelMatch[1]} ${labelMatch[2]}` : `Figure ${figures.length + 1}`
      const contextBlock = [...blocks].reverse().find(block => block.type === 'paragraph')
      figures.push({
        id: `p${pageNumber}-fig${figures.length + 1}`,
        label,
        pageNumber,
        caption: line,
        altText: normalizeWhitespace(line),
        context: contextBlock?.text
      })
      return
    }

    paragraphBuffer += (paragraphBuffer ? ' ' : '') + line
    if (paragraphBuffer.length > 800) {
      flushParagraph()
    }
  })

  flushParagraph()
  return { blocks, figures }
}

async function renderPagePreview(page: any, scale: number = 0.6): Promise<string | undefined> {
  if (typeof document === 'undefined') return undefined
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return undefined
  canvas.height = viewport.height
  canvas.width = viewport.width

  await page.render({ canvasContext: context, viewport }).promise
  return canvas.toDataURL('image/png')
}

/**
 * Extract text, headings, and figure captions from a PDF file
 * @param file - The PDF file to extract text from
 */
export async function extractTextFromPDF(file: File): Promise<PDFExtractionResult> {
  try {
    const pdfjs = await getPdfjsLib()
    const arrayBuffer = await file.arrayBuffer()
    
    // Add standardFontDataUrl to prevent warnings
    const loadingTask = pdfjs.getDocument({
      data: arrayBuffer,
      standardFontDataUrl: 'https://unpkg.com/pdfjs-dist@5.4.394/standard_fonts/'
    })
    const pdf = await loadingTask.promise
    
    const numPages = pdf.numPages
    const pageData: Array<Promise<{ text: string; number: number; blocks: PDFPageBlock[]; figures: PDFFigure[]; pageImageDataUrl?: string }>> = []
    
    // Extract text from each page
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum)
      const textContent = await page.getTextContent()
      const pageItems = textContent.items as Array<{ str: string; hasEOL?: boolean }>
      const pageText = pageItems
        .map(item => {
          const text = item.str || ''
          return item.hasEOL ? `${text}\n` : `${text} `
        })
        .join('')
        .replace(/\s+\n/g, '\n')
        .replace(/\n{2,}/g, '\n')
      
      const rawLines = pageText
        .split(/\n+/)
        .map(line => line.trim())
        .filter(Boolean)
      const { blocks, figures } = buildPageBlocks(rawLines, pageNum)

      // Render full page image and figure previews
      let pageImageDataUrl: string | undefined
      try {
        pageImageDataUrl = await renderPagePreview(page, 1.0) // Full scale for better vision model input
      } catch (imageError) {
        console.warn(`Failed to render page image for page ${pageNum}:`, imageError)
      }

      if (figures.length > 0) {
        try {
          const preview = await renderPagePreview(page, 0.6) // Lower scale for figure preview thumbnails
          if (preview) {
            figures.forEach(fig => {
              fig.previewDataUrl = preview
              if (!fig.altText) {
                fig.altText = fig.caption
              }
            })
          }
        } catch (previewError) {
          console.warn('Failed to render page preview for figure context', previewError)
        }
      }
      
      pageData.push(Promise.resolve({
        text: pageText.trim(),
        number: pageNum,
        blocks,
        figures,
        pageImageDataUrl
      }))
    }
    
    const resolvedPages = await Promise.all(pageData)
    
    const fullText = resolvedPages
      .map(({ text, number }) => `--- Page ${number} ---\n${text}`)
      .join('\n\n')
    
    return {
      fullText,
      fileName: file.name,
      pages: resolvedPages.map(({ text, number, blocks, figures, pageImageDataUrl }) => ({
        pageNumber: number,
        text,
        blocks,
        figures,
        pageImageDataUrl
      }))
    }
  } catch (error) {
    console.error('Error extracting text from PDF:', error)
    throw new Error('Failed to extract text from PDF. The PDF may be corrupted or password-protected.')
  }
}
