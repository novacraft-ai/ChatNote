/**
 * Utility to save PDF with annotations
 * Uses pdf-lib to merge annotations into PDF
 */

import { Annotation, TextBoxAnnotation, ImageAnnotation } from '../types/annotations'

let pdfLib: any

async function getPdfLib() {
  if (!pdfLib) {
    try {
      pdfLib = await import('pdf-lib')
    } catch (error) {
      console.error('Failed to load pdf-lib:', error)
      throw new Error('PDF library not available. Please install pdf-lib.')
    }
  }
  return pdfLib
}

/**
 * Save PDF with annotations
 * @param originalPdfFile - The original PDF file
 * @param annotations - Array of annotations to add
 * @param pageDimensions - Map of page number to dimensions (width, height)
 * @returns Promise that resolves to a Blob of the annotated PDF
 */
export async function saveAnnotatedPDF(
  originalPdfFile: File,
  annotations: Annotation[],
  pageDimensions: Map<number, { width: number; height: number }>
): Promise<Blob> {
  try {
    const { PDFDocument, rgb, degrees } = await getPdfLib()
    
    // Load the original PDF
    const pdfBytes = await originalPdfFile.arrayBuffer()
    const pdfDoc = await PDFDocument.load(pdfBytes)
    
    // Get all pages
    const pages = pdfDoc.getPages()
    
    // Process annotations for each page
    for (const annotation of annotations) {
      const page = pages[annotation.pageNumber - 1]
      if (!page) continue
      
      const pageDims = pageDimensions.get(annotation.pageNumber)
      if (!pageDims) continue
      
      const { width: pageWidth, height: pageHeight } = pageDims
      
      // Convert relative coordinates (0-1) to PDF coordinates
      const pdfX = annotation.x * pageWidth
      const pdfY = pageHeight - (annotation.y + annotation.height) * pageHeight // PDF Y is bottom-up
      const pdfWidth = annotation.width * pageWidth
      const pdfHeight = annotation.height * pageHeight
      
      if (annotation.type === 'textbox') {
        const textAnnotation = annotation as TextBoxAnnotation
        
        // Parse color hex to RGB
        const color = hexToRgb(textAnnotation.color) || { r: 0, g: 0, b: 0 }
        
        // Add text with rotation
        page.drawText(textAnnotation.text, {
          x: pdfX,
          y: pdfY,
          size: textAnnotation.fontSize,
          color: rgb(color.r / 255, color.g / 255, color.b / 255),
          rotate: degrees(textAnnotation.rotation),
        })
      } else if (annotation.type === 'image') {
        const imageAnnotation = annotation as ImageAnnotation
        
        // Load image from data URL
        const imageBytes = await fetch(imageAnnotation.imageData).then((res) => res.arrayBuffer())
        let image
        
        // Determine image type and embed
        if (imageAnnotation.imageData.startsWith('data:image/png')) {
          image = await pdfDoc.embedPng(imageBytes)
        } else {
          image = await pdfDoc.embedJpg(imageBytes)
        }
        
        // Calculate image dimensions maintaining aspect ratio
        const imageAspectRatio = imageAnnotation.imageWidth / imageAnnotation.imageHeight
        let drawWidth = pdfWidth
        let drawHeight = pdfHeight
        
        if (pdfWidth / pdfHeight > imageAspectRatio) {
          drawWidth = pdfHeight * imageAspectRatio
        } else {
          drawHeight = pdfWidth / imageAspectRatio
        }
        
        // Center the image in the annotation bounds
        const centerX = pdfX + pdfWidth / 2
        const centerY = pdfY + pdfHeight / 2
        const drawX = centerX - drawWidth / 2
        const drawY = centerY - drawHeight / 2
        
        // Draw image with rotation
        page.drawImage(image, {
          x: drawX,
          y: drawY,
          width: drawWidth,
          height: drawHeight,
          rotate: degrees(imageAnnotation.rotation),
        })
      }
    }
    
    // Save the PDF
    const pdfBytesModified = await pdfDoc.save()
    return new Blob([pdfBytesModified], { type: 'application/pdf' })
  } catch (error) {
    console.error('Error saving annotated PDF:', error)
    throw new Error('Failed to save annotated PDF')
  }
}

/**
 * Convert hex color to RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null
}

/**
 * Download PDF blob as file
 */
export function downloadPDF(blob: Blob, filename: string = 'annotated.pdf') {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

