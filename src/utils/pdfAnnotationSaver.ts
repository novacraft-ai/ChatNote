/**
 * Utility to save PDF with annotations
 * Uses pdf-lib to merge annotations into PDF
 */

import { Annotation, TextBoxAnnotation, ImageAnnotation } from '../types/annotations'

let pdfLib: any
let fontkitModule: any = null
let fontkitLoaded = false

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

async function getFontkit() {
  if (!fontkitLoaded) {
    fontkitLoaded = true // Mark as attempted to prevent multiple loads
    try {
      const fontkitImport = await import('@pdf-lib/fontkit')
      // Handle both default export and named export
      // fontkit can be exported as default or as a named export
      if (fontkitImport.default) {
        fontkitModule = fontkitImport.default
      } else if (typeof fontkitImport === 'function') {
        fontkitModule = fontkitImport
      } else {
        // Try to find the fontkit object in the import
        fontkitModule = fontkitImport
      }
      
      // Verify fontkit has the required methods
      if (fontkitModule && typeof fontkitModule.create === 'function') {
        return fontkitModule
      } else {
        console.warn('Fontkit module loaded but does not have create method')
        return null
      }
    } catch (error) {
      console.warn('Failed to load fontkit, falling back to standard fonts:', error)
      return null
    }
  }
  return fontkitModule
}

/**
 * Load a Unicode-compatible font from CDN
 */
async function loadUnicodeFont(): Promise<ArrayBuffer | null> {
  try {
    // Try multiple CDN sources in order of preference
    const cdnUrls = [
      // Try unpkg first (same CDN used for pdfjs-dist, should work)
      'https://unpkg.com/@fontsource/noto-sans@5/files/noto-sans-all-400-normal.woff2',
      // Try direct GitHub raw (may have CORS but worth trying)
      'https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans-Regular.ttf',
      // Try alternative: use a smaller font from a reliable source
      'https://fonts.googleapis.com/css2?family=Noto+Sans&display=swap', // This won't work directly, skip
    ]
    
    // Also try loading from local public folder
    const basePath = import.meta.env.BASE_URL || '/'
    const normalizedBasePath = basePath.endsWith('/') ? basePath : `${basePath}/`
    const localFontUrl = `${normalizedBasePath}NotoSans-Regular.ttf`
    
    // Try local file first (no CORS issues)
    try {
      const localResponse = await fetch(localFontUrl)
      if (localResponse.ok) {
        const localArrayBuffer = await localResponse.arrayBuffer()
        if (localArrayBuffer.byteLength > 1000) {
          const localUint8Array = new Uint8Array(localArrayBuffer)
          const isTTF = localUint8Array.length >= 4 && 
            localUint8Array[0] === 0x00 && localUint8Array[1] === 0x01 && 
            localUint8Array[2] === 0x00 && localUint8Array[3] === 0x00
          if (isTTF) {
            return localArrayBuffer
          }
        }
      }
    } catch (localError) {
      // Continue to CDN sources if local font fails
    }
    
    // Try CDN URLs
    for (const url of cdnUrls) {
      // Skip CSS URLs (they won't work directly)
      if (url.includes('fonts.googleapis.com/css')) continue
      
      try {
        const response = await fetch(url, {
          mode: 'cors',
          cache: 'default'
        })
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer()
          // Check if we got actual font data (not HTML error page)
          if (arrayBuffer.byteLength > 1000) {
            const uint8Array = new Uint8Array(arrayBuffer)
            // Verify it's a font file (check for TTF signature)
            const isTTF = uint8Array.length >= 4 && 
              uint8Array[0] === 0x00 && uint8Array[1] === 0x01 && 
              uint8Array[2] === 0x00 && uint8Array[3] === 0x00
            const isWOFF = uint8Array.length >= 4 &&
              uint8Array[0] === 0x77 && uint8Array[1] === 0x4F && 
              uint8Array[2] === 0x46 && uint8Array[3] === 0x46
            const isWOFF2 = uint8Array.length >= 4 &&
              uint8Array[0] === 0x77 && uint8Array[1] === 0x4F && 
              uint8Array[2] === 0x46 && uint8Array[3] === 0x32
              
            if (isTTF || isWOFF || isWOFF2) {
              return arrayBuffer
            } else {
              continue
            }
          }
        }
      } catch (e) {
        continue
      }
    }
    
    console.warn('All font loading methods failed. To enable Unicode support, please download NotoSans-Regular.ttf and place it in the public/ folder.')
    return null
  } catch (error) {
    console.warn('Failed to load Unicode font:', error)
    return null
  }
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
    const pdfLibModule = await getPdfLib()
    const { PDFDocument, rgb, degrees, StandardFonts } = pdfLibModule
    
    // Verify StandardFonts is available
    if (!StandardFonts) {
      throw new Error('StandardFonts not available from pdf-lib')
    }
    
    // Load the original PDF
    const pdfBytes = await originalPdfFile.arrayBuffer()
    const pdfDoc = await PDFDocument.load(pdfBytes)
    
    // Try to embed a Unicode-compatible font
    // Font is embedded once per document and reused for all annotations
    let font: any = null
    
    try {
      // Try to load and embed a Unicode font
      const fontkitModule = await getFontkit()
      if (fontkitModule) {
        // Register fontkit only once per document (can be called multiple times safely)
        try {
          pdfDoc.registerFontkit(fontkitModule)
        } catch (registerError: any) {
          // If already registered, this will throw - that's okay, continue
          if (!registerError.message || !registerError.message.includes('already registered')) {
            console.warn('Failed to register fontkit:', registerError)
          }
        }
        
        // Load font bytes once
        const fontBytes = await loadUnicodeFont()
        if (fontBytes) {
          // Validate font file format before embedding
          const uint8Array = new Uint8Array(fontBytes)
          
          // Check for TTF signature (0x00010000)
          const isTTF = uint8Array.length >= 4 && 
            uint8Array[0] === 0x00 && uint8Array[1] === 0x01 && uint8Array[2] === 0x00 && uint8Array[3] === 0x00
          
          // Check for OTF signature ('OTTO')
          const isOTF = uint8Array.length >= 4 &&
            uint8Array[0] === 0x4F && uint8Array[1] === 0x54 && uint8Array[2] === 0x54 && uint8Array[3] === 0x4F
          
          // Check for TTC signature ('ttcf')
          const isTTC = uint8Array.length >= 4 &&
            uint8Array[0] === 0x74 && uint8Array[1] === 0x74 && uint8Array[2] === 0x63 && uint8Array[3] === 0x66
          
          // Check for WOFF/WOFF2 (fontkit doesn't support these directly)
          const isWOFF = uint8Array.length >= 4 &&
            uint8Array[0] === 0x77 && uint8Array[1] === 0x4F && uint8Array[2] === 0x46 && uint8Array[3] === 0x46
          const isWOFF2 = uint8Array.length >= 4 &&
            uint8Array[0] === 0x77 && uint8Array[1] === 0x4F && uint8Array[2] === 0x46 && uint8Array[3] === 0x32
          
          if (isWOFF || isWOFF2) {
            console.warn('Font file is WOFF/WOFF2 format, fontkit requires TTF/OTF. Font will not be embedded.')
            // Don't try to download - just fall through to standard font
          } else if (isTTF || isOTF || isTTC) {
            // Embed font once - this font will be used for all text annotations
            font = await pdfDoc.embedFont(fontBytes)
          } else {
            console.warn(`Invalid font format. File size: ${uint8Array.length} bytes`)
            // Fall through to standard font
          }
        }
      }
    } catch (unicodeFontError) {
      console.warn('Failed to embed Unicode font, falling back to standard font:', unicodeFontError)
    }
    
    // Fallback to standard font if Unicode font failed
    if (!font) {
      const fontName = StandardFonts.Helvetica || StandardFonts.TimesRoman
      if (!fontName) {
        throw new Error('No standard font available')
      }
      font = await pdfDoc.embedFont(fontName)
      console.log('Using standard font (limited Unicode support)')
    }
    
    // Verify font is valid
    if (!font) {
      throw new Error('Failed to embed font')
    }
    
    // Get all pages
    const pages = pdfDoc.getPages()
    
    // Process annotations for each page
    for (const annotation of annotations) {
      const page = pages[annotation.pageNumber - 1]
      if (!page) continue
      
      // Get actual PDF page size from pdf-lib (this is the true base size)
      // Removed unused: const pdfPageSize = page.getSize()
      // Removed unused: const pdfPageWidth = pdfPageSize.width
      // Removed unused: const pdfPageHeight = pdfPageSize.height
      
      const pageDims = pageDimensions.get(annotation.pageNumber)
      if (!pageDims) continue
      const { width: pageWidth, height: pageHeight } = pageDims
      
      // Calculate normalized coordinates for PDF-lib
      // Web uses top-left origin, PDF uses bottom-left origin
      let pdfWidth = annotation.width * pageWidth
      let pdfHeight = annotation.height * pageHeight
      
      // For text boxes, recalculate height based on actual content at base scale (1.0)
      // This ensures the saved height matches the content, regardless of zoom level when created
      // The recalculation will be done in the text box rendering section below
      
      if (annotation.type === 'textbox') {
        const textAnnotation = annotation as TextBoxAnnotation
        
        // Parse color hex to RGB
        const color = hexToRgb(textAnnotation.color) || { r: 0, g: 0, b: 0 }
        
        // Calculate X position for text
        // In web preview:
        // - annotation.x is the left edge of the text box container
        // - Container has padding: 4px (scaled by zoom, but we use base dimensions here)
        // - Text is horizontally centered in the container (justify-content: center, text-align: center)
        // - The text content is centered within the container width
        
        // Convert web coordinates to PDF
        const webLeftX = annotation.x * pageWidth // Left edge of container in points
        
        // Calculate Y position for text
        // annotation.y is the top of the text box container (web coordinate: top-left origin)
        // PDF coordinate system: bottom-left origin
        // drawText uses the baseline of the text, not the top
        
        // In web preview:
        // - annotation.y is the top of the text box container
        // - Container has padding: 4px (scaled by zoom, but we use base dimensions here)
        // - Text is vertically centered in the container (align-items: center)
        // - The baseline is approximately at: top + padding + (height - padding*2) / 2 + fontBaselineOffset
        
        // Convert web top coordinate to PDF
        const webTopY = annotation.y * pageHeight // Top of text box in web coordinates (points)
        let webBottomY = (annotation.y + annotation.height) * pageHeight // Bottom of text box (will be recalculated for text boxes)
        
        // Padding constant (used throughout text box rendering)
        const padding = 4 // Base padding in points (matches web preview)
        const contentWidth = pdfWidth - (padding * 2) // Available width for text (accounting for padding)
        
        // NOTE: Text positioning will be calculated AFTER we determine the number of lines
        // and recalculate the height based on actual content. This ensures the text is
        // positioned correctly relative to the actual content height, not the stored height.
        
        // Draw text with Unicode support
        // If we successfully embedded a Unicode font, all characters should be supported
        // Handle multi-line text by splitting on newlines
        // Also handle Windows line endings (\r\n) and Mac line endings (\r)
        const rawText = (textAnnotation.text || '').trimEnd() // Remove trailing whitespace/newlines
        
        // Split on any combination of line endings - use a more explicit regex
        // This handles: \r\n (Windows), \n (Unix), \r (old Mac)
        // Note: split() will create an empty string at the end if text ends with newline
        const explicitLines = rawText.split(/\r\n|\r|\n/)
        
        // Filter out null/undefined but keep empty strings (they represent blank lines in the middle)
        let validLines = explicitLines.filter(line => line !== null && line !== undefined)
        
        // Remove trailing empty lines (caused by trailing newlines before trimEnd)
        // This ensures we only draw the lines the user actually sees
        while (validLines.length > 0 && validLines[validLines.length - 1].length === 0) {
          validLines.pop()
        }
        
        // If we removed all lines (text was only newlines), restore one empty line
        if (validLines.length === 0) {
          validLines = ['']
        }
        
        // If text doesn't have explicit newlines, check if it needs word-wrapping
        // This handles auto-wrapped text in the UI
        if (validLines.length === 1 && font && typeof font.widthOfTextAtSize === 'function') {
          const singleLine = validLines[0]
          const maxWidth = contentWidth // Available width for text (accounting for padding)
          
          // Check if text fits in one line
          let textWidth: number
          try {
            textWidth = font.widthOfTextAtSize(singleLine, textAnnotation.fontSize)
          } catch (error) {
            textWidth = singleLine.length * textAnnotation.fontSize * 0.5
          }
          
          // If text is wider than available width, wrap it
          if (textWidth > maxWidth) {
            const wrappedLines: string[] = []
            const words = singleLine.split(/(\s+)/) // Split on whitespace but keep it
            let currentLine = ''
            
            for (let i = 0; i < words.length; i++) {
              const word = words[i]
              const testLine = currentLine + word
              
              let testWidth: number
              try {
                testWidth = font.widthOfTextAtSize(testLine, textAnnotation.fontSize)
              } catch (error) {
                testWidth = testLine.length * textAnnotation.fontSize * 0.5
              }
              
              if (testWidth <= maxWidth || currentLine === '') {
                // Word fits or it's the first word (force it even if too long)
                currentLine = testLine
              } else {
                // Word doesn't fit, start a new line
                if (currentLine.trim()) {
                  wrappedLines.push(currentLine.trim())
                }
                currentLine = word
              }
            }
            
            // Add the last line
            if (currentLine.trim()) {
              wrappedLines.push(currentLine.trim())
            }
            
            if (wrappedLines.length > 1) {
              validLines = wrappedLines
            }
          }
        }
        
        // Use exact line-height from CSS: line-height: 1.2
        // This matches the UI exactly (AnnotationLayer.css line 48)
        const lineHeight = textAnnotation.fontSize * 1.2
        
        // Recalculate the actual required height based on content at base scale (1.0)
        // This ensures the saved height matches the content, regardless of zoom level when created
        // Height = (number of lines - 1) * lineHeight + fontSize (for the first line's full height)
        // Plus padding (4px top + 4px bottom = 8px total)
        // padding is already declared above
        const actualContentHeight = validLines.length > 0 
          ? (validLines.length - 1) * lineHeight + textAnnotation.fontSize + (padding * 2)
          : textAnnotation.fontSize + (padding * 2)
        
        // Update pdfHeight to match actual content height
        pdfHeight = actualContentHeight
        
        // Recalculate webBottomY based on the new pdfHeight
        // webTopY remains the same (based on annotation.y), but webBottomY needs to be updated
        const recalculatedWebBottomY = webTopY + pdfHeight
        
        // Update webBottomY for use in PDF coordinate calculations
        webBottomY = recalculatedWebBottomY
        
        // NOW recalculate text positioning based on the updated height
        // Convert to PDF coordinate system (flip Y axis)
        const pdfBottomY = pageHeight - webBottomY // Bottom of text box in PDF coordinates (updated)
        const pdfTopY = pageHeight - webTopY // Top of text box in PDF coordinates
        
        // Calculate text baseline position
        // The text is vertically centered in the container (align-items: center in CSS)
        // In CSS, text is centered using flexbox align-items: center
        // This centers the text content box, not the baseline
        // For PDF, we need to position the baseline correctly
        const textBoxHeight = pdfTopY - pdfBottomY // This now uses the recalculated height
        const textCenterY = pdfBottomY + textBoxHeight / 2 // Vertical center of text box
        
        // For single-line text, the baseline should be at the center
        // For multi-line text, we'll calculate the middle line's baseline
        // The baseline is typically about 0.8 * fontSize from the top of the text
        // But since we're centering, we need to account for the font's natural baseline
        // For most fonts, the baseline is approximately 0.75-0.8 * fontSize from the top
        // We'll use the center directly and adjust for multi-line
        const pdfY = textCenterY // Start with center, will adjust for multi-line
        
        // Ensure Y is within page bounds
        const minY = textAnnotation.fontSize * 0.2 // Keep some margin from top
        const maxY = pageHeight - textAnnotation.fontSize * 0.2 // Keep some margin from bottom
        const finalPdfY = Math.max(minY, Math.min(maxY, pdfY))
        
        // Check if we have multiple lines (even if some are empty)
        // Also check if the raw text contains newline characters (even if split results in 1 line)
        const isMultiLine = validLines.length > 1 || rawText.includes('\n') || rawText.includes('\r')
        
        // Always use multi-line rendering if we have multiple lines or newline characters
        if (isMultiLine && validLines.length > 0) {
          // Multi-line text handling
          try {
            // Calculate total height needed for all lines
            // In CSS, line-height: 1.2 means each line takes up 1.2 * fontSize in height
            // The spacing between baselines is lineHeight
            // For N lines, we need (N-1) * lineHeight spacing between baselines
            const totalHeight = (validLines.length - 1) * lineHeight
            
            // For multi-line text, center the entire block vertically
            // finalPdfY is the baseline for a single centered line
            // For N lines, we want the middle line's baseline at finalPdfY
            // In PDF coordinates (Y increases upward):
            // - Top line baseline Y = finalPdfY + (totalHeight / 2)
            // - Each subsequent line baseline is lineHeight below (subtract lineHeight)
            const topLineY = finalPdfY + (totalHeight / 2)
            
            // Draw each line separately
            validLines.forEach((line, lineIndex) => {
              // Calculate Y position for this line
              // First line is at topLineY, each subsequent line is lineHeight below
              const lineY = topLineY - (lineIndex * lineHeight)
              
              // Calculate X position for this line (center each line)
              let lineTextWidth: number
              try {
                if (font && typeof font.widthOfTextAtSize === 'function') {
                  lineTextWidth = font.widthOfTextAtSize(line, textAnnotation.fontSize)
                } else {
                  lineTextWidth = line.length * textAnnotation.fontSize * 0.5
                }
              } catch (error) {
                lineTextWidth = line.length * textAnnotation.fontSize * 0.5
              }
              
              const contentCenterX = webLeftX + padding + contentWidth / 2
              let linePdfX = contentCenterX - lineTextWidth / 2
              
              // Ensure text doesn't go outside container bounds
              const minX = webLeftX + padding
              const maxX = webLeftX + pdfWidth - lineTextWidth - padding
              linePdfX = Math.max(minX, Math.min(maxX, linePdfX))
              
              // Draw the line
              // For empty lines, we still draw them to preserve spacing (they represent intentional blank lines)
              // But we use a space character so something is drawn at that position
              const textToDraw = line.length > 0 ? line : ' ' // Use space for empty lines
              page.drawText(textToDraw, {
                x: linePdfX,
                y: lineY,
                size: textAnnotation.fontSize,
                color: rgb(color.r / 255, color.g / 255, color.b / 255),
                rotate: degrees(textAnnotation.rotation),
                font: font,
              })
            })
          } catch (encodingError: any) {
            // If we're using a standard font and Unicode characters fail,
            // we need to handle this gracefully
            if (encodingError.message && encodingError.message.includes('cannot encode')) {
              // Try to replace unsupported Unicode characters with placeholders
              console.warn('Unicode character encoding failed, replacing unsupported characters:', encodingError.message)
              
              // Process each line separately with Unicode replacement
              const safeLines = validLines.map(line =>
                line.split('')
                  .map(char => {
                    // Replace non-ASCII characters that can't be encoded
                    if (char.charCodeAt(0) > 255) {
                      return '?' // Replace with question mark
                    }
                    return char
                  })
                  .join('')
              )
              
              // Calculate total height needed for all lines
              const totalHeight = (safeLines.length - 1) * lineHeight
              const topLineY = finalPdfY + (totalHeight / 2)
              
              // Try again with safe text, drawing each line
              try {
                safeLines.forEach((safeLine, lineIndex) => {
                  // Calculate Y position for this line
                  const lineY = topLineY - (lineIndex * lineHeight)
                  
                  let lineTextWidth: number
                  try {
                    if (font && typeof font.widthOfTextAtSize === 'function') {
                      lineTextWidth = font.widthOfTextAtSize(safeLine, textAnnotation.fontSize)
                    } else {
                      lineTextWidth = safeLine.length * textAnnotation.fontSize * 0.5
                    }
                  } catch (error) {
                    lineTextWidth = safeLine.length * textAnnotation.fontSize * 0.5
                  }
                  
                  const contentCenterX = webLeftX + padding + contentWidth / 2
                  let linePdfX = contentCenterX - lineTextWidth / 2
                  
                  const minX = webLeftX + padding
                  const maxX = webLeftX + pdfWidth - lineTextWidth - padding
                  linePdfX = Math.max(minX, Math.min(maxX, linePdfX))
                  
                  page.drawText(safeLine, {
                    x: linePdfX,
                    y: lineY,
                    size: textAnnotation.fontSize,
                    color: rgb(color.r / 255, color.g / 255, color.b / 255),
                    rotate: degrees(textAnnotation.rotation),
                    font: font,
                  })
                })
                console.log('Drew text with Unicode characters replaced')
              } catch (retryError) {
                console.error('Failed to draw text even after replacing Unicode characters:', retryError)
                // Skip this annotation to prevent PDF save failure
                continue
              }
            } else {
              // Re-throw if it's a different error
              throw encodingError
            }
          }
        } else {
          // Single line text - use original logic
          // Calculate text width for centering
          let actualTextWidth: number
          try {
            if (font && typeof font.widthOfTextAtSize === 'function') {
              actualTextWidth = font.widthOfTextAtSize(textAnnotation.text, textAnnotation.fontSize)
            } else {
              actualTextWidth = textAnnotation.text.length * textAnnotation.fontSize * 0.5
            }
          } catch (error) {
            actualTextWidth = textAnnotation.text.length * textAnnotation.fontSize * 0.5
          }
          
          // Center the text
          const contentCenterX = webLeftX + padding + contentWidth / 2
          let pdfX = contentCenterX - actualTextWidth / 2
          
          // Ensure text doesn't go outside container bounds
          const minX = webLeftX + padding
          const maxX = webLeftX + pdfWidth - actualTextWidth - padding
          pdfX = Math.max(minX, Math.min(maxX, pdfX))
          
        try {
          page.drawText(textAnnotation.text, {
            x: pdfX,
            y: finalPdfY,
            size: textAnnotation.fontSize,
            color: rgb(color.r / 255, color.g / 255, color.b / 255),
            rotate: degrees(textAnnotation.rotation),
            font: font,
          })
        } catch (encodingError: any) {
          // If we're using a standard font and Unicode characters fail,
          // we need to handle this gracefully
          if (encodingError.message && encodingError.message.includes('cannot encode')) {
            // Try to replace unsupported Unicode characters with placeholders
            console.warn('Unicode character encoding failed, replacing unsupported characters:', encodingError.message)
            const safeText = textAnnotation.text
              .split('')
              .map(char => {
                // Replace non-ASCII characters that can't be encoded
                if (char.charCodeAt(0) > 255) {
                  return '?' // Replace with question mark
                }
                return char
              })
              .join('')
            
            // Try again with safe text
            try {
              page.drawText(safeText, {
                x: pdfX,
                y: finalPdfY,
                size: textAnnotation.fontSize,
                color: rgb(color.r / 255, color.g / 255, color.b / 255),
                rotate: degrees(textAnnotation.rotation),
                font: font,
              })
              console.log('Drew text with Unicode characters replaced')
            } catch (retryError) {
              console.error('Failed to draw text even after replacing Unicode characters:', retryError)
              // Skip this annotation to prevent PDF save failure
              continue
            }
          } else {
            // Re-throw if it's a different error
            throw encodingError
            }
          }
        }
      } else if (annotation.type === 'image') {
        const imageAnnotation = annotation as ImageAnnotation
        
        // Load image from data URL
        const imageBytes = await fetch(imageAnnotation.imageData).then((res) => res.arrayBuffer())
        let image
        
        // Determine image type and embed
        // pdf-lib only supports PNG and JPEG formats
        if (imageAnnotation.imageData.startsWith('data:image/png')) {
          image = await pdfDoc.embedPng(imageBytes)
        } else if (imageAnnotation.imageData.startsWith('data:image/jpeg') || 
                   imageAnnotation.imageData.startsWith('data:image/jpg')) {
          image = await pdfDoc.embedJpg(imageBytes)
        } else {
          // For any other format (SVG, WebP, etc.), this shouldn't happen
          // as we convert them to PNG during upload, but handle it just in case
          console.error('Unsupported image format for PDF embedding:', imageAnnotation.imageData.substring(0, 30))
          throw new Error('Unsupported image format. Only PNG and JPEG are supported for PDF embedding.')
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
        
        // Calculate X position for image
        // In web preview:
        // - annotation.x is the left edge where the image container should be positioned
        // - The container width is set to actualImageWidth (the rendered image size)
        // - The image fills the container (100% width/height with object-fit: contain)
        // - So the image left edge is at annotation.x
        
        // In web: container is positioned at annotation.x with width = actualImageWidth
        // So the image left edge is at annotation.x
        const webLeftX = annotation.x * pageWidth // Left edge of image in points (matches web preview)
        const drawX = webLeftX // Position image at the same left edge as in web preview
        
        // Calculate Y position for image
        // annotation.y is the top of the image box (web coordinate: top-left origin)
        // PDF coordinate system: bottom-left origin
        // drawImage uses bottom-left corner (x, y) where y is the bottom of the image
        
        const webBottomY = (annotation.y + annotation.height) * pageHeight // Bottom of image box in web coordinates
        
        // Convert to PDF coordinate system (flip Y axis)
        const pdfBottomY = pageHeight - webBottomY // Bottom of image box in PDF coordinates
        
        // drawImage uses bottom-left corner
        // The image should be positioned so its bottom-left is at pdfBottomY
        // But we need to account for the actual rendered image size (drawHeight) vs container size (pdfHeight)
        // Since the image is centered in the container, we calculate the bottom position
        const imageBottomY = pdfBottomY + (pdfHeight - drawHeight) / 2
        const drawY = imageBottomY // Bottom-left corner for drawImage
        
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

