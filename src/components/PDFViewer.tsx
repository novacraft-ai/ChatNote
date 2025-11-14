import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import './PDFViewer.css'

interface PDFViewerProps {
  file: File | null
  onFileUpload: (file: File) => void
  onTextSelection: (text: string) => void
  layout?: 'floating' | 'split'
}

function PDFViewer({ file, onFileUpload, onTextSelection, layout = 'floating' }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0)
  const [pageNumber, setPageNumber] = useState<number>(1)
  const [scale, setScale] = useState<number>(1.0)
  const [isEditingZoom, setIsEditingZoom] = useState<boolean>(false)
  const [zoomInputValue, setZoomInputValue] = useState<string>('100')
  const zoomInputRef = useRef<HTMLInputElement>(null)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const pdfContentRef = useRef<HTMLDivElement>(null)
  const pdfViewerRef = useRef<HTMLDivElement>(null)
  const isScrollingRef = useRef(false)
  const pageDimensionsRef = useRef<Map<number, { width: number; height: number }>>(new Map())

  const fileUrl = useMemo(() => {
    if (!file) return null
    return URL.createObjectURL(file)
  }, [file])

  useEffect(() => {
    return () => {
      if (fileUrl) {
        URL.revokeObjectURL(fileUrl)
      }
    }
  }, [fileUrl])

  const documentOptions = useMemo(
    () => {
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
      
      // Ensure worker is set on pdfjs before Document tries to use it
      if (pdfjs.GlobalWorkerOptions) {
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
      }
      
      return {
        workerSrc,
        cMapUrl: 'https://unpkg.com/pdfjs-dist@5.4.394/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: 'https://unpkg.com/pdfjs-dist@5.4.394/standard_fonts/',
      }
    },
    []
  )

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages)
    setPageNumber(1)
    pageRefs.current.clear()
    pageDimensionsRef.current.clear()
  }

  const onPageLoadSuccess = (pageData: { pageNumber: number; page: any }) => {
    // Only store dimensions once per page (base dimensions at scale 1.0)
    // onLoadSuccess may be called multiple times when scale changes, so check if already stored
    if (pageDimensionsRef.current.has(pageData.pageNumber)) {
      return
    }
    
    // react-pdf Page onLoadSuccess provides the page object
    // We need to get the base dimensions (at scale 1.0)
    try {
      const page = pageData.page
      let baseWidth: number
      let baseHeight: number
      
      // Try to get viewport dimensions (base size at scale 1.0)
      if (page.viewport) {
        baseWidth = page.viewport.width
        baseHeight = page.viewport.height
      } else {
        // Fallback: divide current dimensions by scale to get base dimensions
        baseWidth = page.width / scale
        baseHeight = page.height / scale
      }
      
      pageDimensionsRef.current.set(pageData.pageNumber, {
        width: baseWidth,
        height: baseHeight,
      })
    } catch (error) {
      console.warn('Error getting page dimensions:', error)
      // Fallback: use current dimensions divided by scale
      const page = pageData.page
      pageDimensionsRef.current.set(pageData.pageNumber, {
        width: page.width / scale,
        height: page.height / scale,
      })
    }
  }

  // Detect which page is currently visible when scrolling
  useEffect(() => {
    if (!pdfContentRef.current || numPages === 0) return

    let scrollTimeout: NodeJS.Timeout | null = null
    let isProcessing = false

    const handleScroll = () => {
      if (isScrollingRef.current || isProcessing) return

      // Throttle scroll events for better performance
      if (scrollTimeout) return
      
      isProcessing = true
      scrollTimeout = setTimeout(() => {
        scrollTimeout = null
        isProcessing = false
      }, 100)

      const container = pdfContentRef.current
      if (!container) {
        isProcessing = false
        return
      }

      const containerRect = container.getBoundingClientRect()
      const containerTop = containerRect.top
      const containerHeight = containerRect.height
      const viewportCenter = containerTop + containerHeight / 2

      // If at the very top (within 100px), always return page 1
      const scrollTop = container.scrollTop
      if (scrollTop < 100) {
        setPageNumber((prevPage) => {
          if (prevPage !== 1) {
            return 1
          }
          return prevPage
        })
        return
      }

      // Find the page with the most visible area in the viewport
      let bestPage = 1
      let maxVisibleArea = 0

      for (let i = 1; i <= numPages; i++) {
        const pageElement = pageRefs.current.get(i)
        if (pageElement) {
          const pageRect = pageElement.getBoundingClientRect()
          const containerRect = container.getBoundingClientRect()
          
          // Calculate intersection between page and viewport
          const visibleTop = Math.max(containerRect.top, pageRect.top)
          const visibleBottom = Math.min(containerRect.bottom, pageRect.bottom)
          const visibleHeight = Math.max(0, visibleBottom - visibleTop)

          // If this page has more visible area, it's the best candidate
          if (visibleHeight > maxVisibleArea) {
            maxVisibleArea = visibleHeight
            bestPage = i
          }
        }
      }

      // Fallback: if no page has significant visible area, use closest center
      if (maxVisibleArea < containerHeight * 0.1) {
        let closestPage = 1
        let closestDistance = Infinity

        for (let i = 1; i <= numPages; i++) {
          const pageElement = pageRefs.current.get(i)
          if (pageElement) {
            const pageRect = pageElement.getBoundingClientRect()
            const pageCenter = pageRect.top + pageRect.height / 2
            const distance = Math.abs(pageCenter - viewportCenter)

            if (distance < closestDistance) {
              closestDistance = distance
              closestPage = i
            }
          }
        }
        bestPage = closestPage
      }

      setPageNumber((prevPage) => {
        if (bestPage !== prevPage) {
          return bestPage
        }
        return prevPage
      })
    }

    const container = pdfContentRef.current
    container?.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      if (scrollTimeout) {
        clearTimeout(scrollTimeout)
      }
      container?.removeEventListener('scroll', handleScroll)
    }
  }, [numPages])

  const onDocumentLoadError = (error: Error) => {
    console.error('PDF load error:', error)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile && selectedFile.type === 'application/pdf') {
      onFileUpload(selectedFile)
    }
  }

  const scrollToPage = useCallback((page: number) => {
    const pageElement = pageRefs.current.get(page)
    if (pageElement && pdfContentRef.current) {
      isScrollingRef.current = true
      setPageNumber(page)
      pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
      // Keep the flag true longer to prevent scroll detection from interfering
      setTimeout(() => {
        isScrollingRef.current = false
      }, 1500)
    }
  }, [])

  const goToPrevPage = () => {
    const newPage = Math.max(1, pageNumber - 1)
    scrollToPage(newPage)
  }

  const goToNextPage = () => {
    const newPage = Math.min(numPages, pageNumber + 1)
    scrollToPage(newPage)
  }

  const handleZoomIn = () => {
    const newScale = Math.min(scale + 0.2, 5.0)
    setScale(newScale)
    setZoomInputValue(Math.round(newScale * 100).toString())
  }

  const handleZoomOut = () => {
    const newScale = Math.max(scale - 0.2, 0.25)
    setScale(newScale)
    setZoomInputValue(Math.round(newScale * 100).toString())
  }

  // Update zoom input value when scale changes (from other sources like fit width/height)
  useEffect(() => {
    if (!isEditingZoom) {
      setZoomInputValue(Math.round(scale * 100).toString())
    }
  }, [scale, isEditingZoom])

  const handleZoomInputClick = () => {
    setIsEditingZoom(true)
    setZoomInputValue(Math.round(scale * 100).toString())
  }

  const handleZoomInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value
    
    // Remove all non-digit characters (no decimals, no negatives, no letters, no symbols)
    value = value.replace(/[^0-9]/g, '')
    
    // Prevent empty string (allow user to clear, but we'll validate on blur/enter)
    // Remove leading zeros (e.g., "007" -> "7", but keep "0" if it's just "0")
    if (value.length > 1 && value.startsWith('0')) {
      value = value.replace(/^0+/, '') || '0'
    }
    
    // Limit to reasonable maximum (prevent extremely large numbers)
    if (value.length > 3) {
      value = value.slice(0, 3)
    }
    
    setZoomInputValue(value)
  }

  const handleZoomInputBlur = () => {
    applyZoomInput()
  }

  const handleZoomInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      applyZoomInput()
    } else if (e.key === 'Escape') {
      setIsEditingZoom(false)
      setZoomInputValue(Math.round(scale * 100).toString())
      zoomInputRef.current?.blur()
    } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Tab') {
      // Allow navigation and deletion keys
      return
    } else if (e.key === '-' || e.key === '+' || e.key === '.' || e.key === ',' || e.key === 'e' || e.key === 'E') {
      // Prevent negative, decimal, scientific notation
      e.preventDefault()
    } else if (!/[0-9]/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      // Prevent non-digit characters (except Ctrl/Cmd combinations for copy/paste)
      e.preventDefault()
    }
  }

  const handleZoomInputPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    // Get pasted text
    const pastedText = e.clipboardData.getData('text')
    
    // Extract only digits from pasted text
    const digitsOnly = pastedText.replace(/[^0-9]/g, '')
    
    if (digitsOnly) {
      // Remove leading zeros
      const cleanedValue = digitsOnly.replace(/^0+/, '') || '0'
      
      // Limit to 3 digits
      const limitedValue = cleanedValue.slice(0, 3)
      
      setZoomInputValue(limitedValue)
      
      // Auto-apply if the value is valid
      if (limitedValue && limitedValue !== '0') {
        const numericValue = parseInt(limitedValue, 10)
        if (!isNaN(numericValue) && numericValue > 0) {
          const clampedValue = Math.max(25, Math.min(500, numericValue))
          const newScale = clampedValue / 100
          setScale(newScale)
          setZoomInputValue(clampedValue.toString())
          setIsEditingZoom(false)
        }
      }
    }
  }

  const applyZoomInput = () => {
    // Handle empty input
    if (zoomInputValue.trim() === '' || zoomInputValue === '0') {
      // Reset to current scale if empty or zero
      setZoomInputValue(Math.round(scale * 100).toString())
      setIsEditingZoom(false)
      return
    }
    
    // Parse as integer (no decimals allowed)
    const numericValue = parseInt(zoomInputValue, 10)
    
    // Validate: must be a valid positive integer
    if (isNaN(numericValue) || numericValue <= 0) {
      // Invalid input - reset to current scale
      setZoomInputValue(Math.round(scale * 100).toString())
      setIsEditingZoom(false)
      return
    }
    
    // Clamp to valid range (25-500)
    const clampedValue = Math.max(25, Math.min(500, numericValue))
    
    // Convert percentage to scale (e.g., 100% = 1.0, 200% = 2.0)
    const newScale = clampedValue / 100
    setScale(newScale)
    
    // Update input value to show clamped result (in case user entered out-of-range value)
    setZoomInputValue(clampedValue.toString())
    setIsEditingZoom(false)
  }

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingZoom && zoomInputRef.current) {
      zoomInputRef.current.focus()
      zoomInputRef.current.select()
    }
  }, [isEditingZoom])

  const handleFitWidth = () => {
    if (!pdfViewerRef.current || pageDimensionsRef.current.size === 0) return

    const viewerRect = pdfViewerRef.current.getBoundingClientRect()
    // In split mode, use the viewer width; in float mode, use window width
    let availableWidth: number
    if (layout === 'split') {
      // In split mode, the PDF viewer takes up the remaining space after the chat panel
      availableWidth = viewerRect.width - 40 // Account for padding (20px on each side)
    } else {
      // In float mode, use the full window width
      availableWidth = window.innerWidth - 40 // Account for padding
    }
    
    // Get the first page dimensions (assuming all pages have similar dimensions)
    const firstPageDims = pageDimensionsRef.current.get(1)
    if (!firstPageDims) return

    // Calculate scale to fit width
    const newScale = availableWidth / firstPageDims.width
    const clampedScale = Math.max(0.1, Math.min(newScale, 5.0)) // Clamp between 0.1 and 5.0
    setScale(clampedScale)
    setZoomInputValue(Math.round(clampedScale * 100).toString())
  }

  const handleFitHeight = () => {
    if (!pdfViewerRef.current || pageDimensionsRef.current.size === 0) return

    const viewerRect = pdfViewerRef.current.getBoundingClientRect()
    const availableHeight = viewerRect.height - 100 // Account for controls (top + bottom)
    
    // Get the current page dimensions
    const currentPageDims = pageDimensionsRef.current.get(pageNumber)
    if (!currentPageDims) return

    // Calculate scale to fit height
    const newScale = availableHeight / currentPageDims.height
    const clampedScale = Math.max(0.1, Math.min(newScale, 5.0))
    setScale(clampedScale)
    setZoomInputValue(Math.round(clampedScale * 100).toString())
  }

  const handleTextSelection = useCallback(() => {
    const selection = window.getSelection()
    if (selection && selection.toString().trim()) {
      const text = selection.toString().trim()
      onTextSelection(text)
    } else {
      // Clear selection when user clicks elsewhere or deselects
      onTextSelection('')
    }
  }, [onTextSelection])

  // Handle clicks to clear selection when clicking outside selected text
  const handleClick = useCallback(() => {
    // Small delay to allow text selection to complete first
    setTimeout(() => {
      const selection = window.getSelection()
      if (!selection || !selection.toString().trim()) {
        onTextSelection('')
      }
    }, 10)
  }, [onTextSelection])

  if (!file) {
    return (
      <div className={`pdf-viewer-empty ${layout === 'floating' ? 'float-layout' : ''}`}>
        <div className="upload-container">
          <label htmlFor="pdf-upload" className="upload-button">
            Upload PDF
          </label>
          <input
            id="pdf-upload"
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="pdf-viewer" ref={pdfViewerRef}>
      <div className="pdf-controls-top">
        <div className="zoom-controls">
          <button onClick={handleFitWidth} className="control-button fit-button" title="Fit to width">
            ↔
          </button>
          <button onClick={handleFitHeight} className="control-button fit-button" title="Fit to height">
            ↕
          </button>
          <button onClick={handleZoomOut} className="control-button">
            −
          </button>
          {isEditingZoom ? (
            <input
              ref={zoomInputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={zoomInputValue}
              onChange={handleZoomInputChange}
              onBlur={handleZoomInputBlur}
              onKeyDown={handleZoomInputKeyDown}
              onPaste={handleZoomInputPaste}
              className="zoom-input"
            />
          ) : (
            <span 
              className="zoom-level" 
              onClick={handleZoomInputClick}
              title="Click to edit zoom level"
            >
              {Math.round(scale * 100)}%
            </span>
          )}
          <button onClick={handleZoomIn} className="control-button">
            +
          </button>
        </div>
      </div>
      <div
        ref={pdfContentRef}
        className="pdf-content"
        onMouseUp={handleTextSelection}
        onKeyUp={handleTextSelection}
        onClick={handleClick}
      >
        <Document
          file={fileUrl || file}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={<div className="loading">Loading PDF...</div>}
          error={
            <div className="error">
              Failed to load PDF. Please check the console for details.
              <br />
              <small>Worker: {pdfjs.GlobalWorkerOptions?.workerSrc || 'Not set'}</small>
            </div>
          }
          noData={<div className="loading">No PDF file selected</div>}
          options={documentOptions}
        >
          {Array.from(new Array(numPages), (_, index) => {
            const pageNum = index + 1
            return (
              <div
                key={`page-wrapper-${pageNum}`}
                ref={(el) => {
                  if (el) {
                    pageRefs.current.set(pageNum, el)
                  } else {
                    pageRefs.current.delete(pageNum)
                  }
                }}
                className="pdf-page-wrapper"
              >
                <Page
                  key={`page_${pageNum}`}
                  pageNumber={pageNum}
                  scale={scale}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                  onLoadSuccess={(page) => onPageLoadSuccess({ pageNumber: pageNum, page })}
                />
              </div>
            )
          })}
        </Document>
      </div>
      <div className="pdf-controls-bottom">
        <button
          onClick={goToPrevPage}
          disabled={pageNumber <= 1}
          className="nav-button"
        >
          Previous
        </button>
        <span className="page-info">
          Page {pageNumber} of {numPages}
        </span>
        <button
          onClick={goToNextPage}
          disabled={pageNumber >= numPages}
          className="nav-button"
        >
          Next
        </button>
      </div>
    </div>
  )
}

export default PDFViewer

