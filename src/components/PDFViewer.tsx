import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import './PDFViewer.css'
import AnnotationLayer from './AnnotationLayer'
import AnnotationToolbar from './AnnotationToolbar'
import KnowledgeNoteConnections from './KnowledgeNoteConnections'
import { Annotation, ImageAnnotation, TextBoxAnnotation, HighlightAnnotation, COMMON_COLORS } from '../types/annotations'
import { saveAnnotatedPDF, downloadPDF } from '../utils/pdfAnnotationSaver'
import { KnowledgeNote } from '../types/knowledgeNotes'

interface PDFViewerProps {
  file: File | null
  onFileUpload: (file: File) => void
  onTextSelection: (text: string, pageNumber?: number, textYPosition?: number) => void
  layout?: 'floating' | 'split'
  onPageChange?: (pageNumber: number) => void
  onTotalPagesChange?: (totalPages: number) => void
  showKnowledgeNotes?: boolean
  onToggleKnowledgeNotes?: () => void
  knowledgeNotes?: KnowledgeNote[]
  onScrollToPage?: (pageNumber: number) => void
  onNoteClick?: (note: KnowledgeNote) => void
  pdfContentRef?: React.RefObject<HTMLDivElement> // Pass ref for scroll sync
  onAddAnnotation?: (annotation: TextBoxAnnotation) => void // Callback to add annotation programmatically
  initialAnnotations?: Annotation[] // Initial annotations when loading from history
  onAnnotationsChange?: (annotations: Annotation[]) => void // Callback when annotations change
  isLoadingPdf?: boolean // Loading state when loading PDF from history
  onLoadingComplete?: () => void // Callback when PDF loading is complete
  isSavingSession?: boolean // Saving state when starting new session
  onNewSession?: () => void // Callback to start new session
}

// Font size input wrapper component that allows empty input
const FontSizeInputWrapper: React.FC<{
  selectedAnnotation: TextBoxAnnotation
  onUpdate: (annotation: TextBoxAnnotation) => void
}> = ({ selectedAnnotation, onUpdate }) => {
  const [inputValue, setInputValue] = useState<string>(selectedAnnotation.fontSize.toString())
  // Store the original font size to restore on blur if input is empty
  const originalFontSizeRef = useRef<number>(selectedAnnotation.fontSize)

  // Update input value and original font size when annotation changes (e.g., when switching annotations)
  useEffect(() => {
    originalFontSizeRef.current = selectedAnnotation.fontSize
    setInputValue(selectedAnnotation.fontSize.toString())
  }, [selectedAnnotation.id, selectedAnnotation.fontSize])

  return (
    <div
      className="textbox-controls"
      onClick={(e) => {
        // Prevent clicks on controls from triggering text editing mode
        // But allow native input behavior (like spinner arrows)
        const target = e.target as HTMLElement
        if (!target.closest('input[type="number"]')) {
          e.stopPropagation()
        }
      }}
      onMouseDown={(e) => {
        // Prevent mousedown on controls from triggering text editing mode
        // But allow native input behavior (like spinner arrows)
        const target = e.target as HTMLElement
        if (!target.closest('input[type="number"]')) {
          e.stopPropagation()
        }
      }}
    >
      <div className="textbox-control-group">
        <label className="textbox-control-label">Font Size:</label>
        <div className="font-size-input-wrapper">
          <button
            type="button"
            className="font-size-arrow-button font-size-arrow-left"
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              const currentSize = parseInt(inputValue, 10) || originalFontSizeRef.current
              const newSize = Math.max(1, currentSize - 1)
              setInputValue(newSize.toString())
              const updatedAnnotation = {
                ...selectedAnnotation,
                fontSize: newSize,
              } as TextBoxAnnotation
              onUpdate(updatedAnnotation)
              originalFontSizeRef.current = newSize
            }}
            onMouseDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
            }}
            title="Decrease font size"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          <input
            type="number"
            min="1"
            max="200"
            value={inputValue}
            onChange={(e) => {
              const inputValue = e.target.value
              setInputValue(inputValue) // Allow empty input

              // Only update annotation when there's a valid value
              if (inputValue === '' || inputValue === '-') {
                return // Don't update, just allow the input to be empty or negative sign
              }

              const newSize = parseInt(inputValue, 10)
              if (!isNaN(newSize) && newSize > 0) {
                const clampedSize = Math.max(1, Math.min(200, newSize))
                // Update the annotation with new font size
                const updatedAnnotation = {
                  ...selectedAnnotation,
                  fontSize: clampedSize,
                } as TextBoxAnnotation
                onUpdate(updatedAnnotation)
                originalFontSizeRef.current = clampedSize
              }
            }}
            onBlur={(e) => {
              const currentValue = e.target.value.trim()
              // Restore original value if input is empty or invalid on blur
              if (currentValue === '' || currentValue === '-' || isNaN(parseInt(currentValue, 10)) || parseInt(currentValue, 10) <= 0) {
                // Restore to the original font size (not the current annotation value, which might have been changed)
                setInputValue(originalFontSizeRef.current.toString())
              } else {
                // Ensure the displayed value matches the annotation value (in case of clamping)
                const parsedValue = parseInt(currentValue, 10)
                const clampedSize = Math.max(1, Math.min(200, parsedValue))
                if (clampedSize !== parsedValue) {
                  setInputValue(clampedSize.toString())
                }
                originalFontSizeRef.current = clampedSize
              }
            }}
            onMouseDown={(e) => {
              e.stopPropagation()
            }}
            onClick={(e) => {
              e.stopPropagation()
            }}
            onFocus={(e) => {
              e.stopPropagation()
            }}
            onWheel={(e) => {
              // Prevent scrolling from changing the value when focused
              e.stopPropagation()
            }}
            className="textbox-font-size-input"
          />
          <button
            type="button"
            className="font-size-arrow-button font-size-arrow-right"
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              const currentSize = parseInt(inputValue, 10) || originalFontSizeRef.current
              const newSize = Math.min(200, currentSize + 1)
              setInputValue(newSize.toString())
              const updatedAnnotation = {
                ...selectedAnnotation,
                fontSize: newSize,
              } as TextBoxAnnotation
              onUpdate(updatedAnnotation)
              originalFontSizeRef.current = newSize
            }}
            onMouseDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
            }}
            title="Increase font size"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      </div>
      <div className="textbox-control-group">
        <label className="textbox-control-label">Color:</label>
        <div className="textbox-color-picker">
          {COMMON_COLORS.map((color) => (
            <button
              key={color}
              className={`textbox-color-button ${selectedAnnotation.color === color ? 'active' : ''}`}
              style={{ backgroundColor: color }}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onUpdate({
                  ...selectedAnnotation,
                  color,
                })
              }}
              onMouseDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
              }}
              onFocus={(e) => {
                e.stopPropagation()
              }}
              title={color}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function PDFViewer({
  file,
  onFileUpload,
  onTextSelection,
  layout = 'floating',
  onPageChange,
  onTotalPagesChange,
  showKnowledgeNotes = true,
  onToggleKnowledgeNotes,
  knowledgeNotes = [],
  onScrollToPage,
  onNoteClick,
  onAddAnnotation,
  initialAnnotations = [],
  onAnnotationsChange,
  isLoadingPdf = false,
  onLoadingComplete,
  isSavingSession = false,
  onNewSession,
}: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0)
  const [pageNumber, setPageNumber] = useState<number>(1)
  const [scale, setScale] = useState<number>(1.0)
  const [isEditingZoom, setIsEditingZoom] = useState<boolean>(false)
  const [zoomInputValue, setZoomInputValue] = useState<string>('100')
  const zoomInputRef = useRef<HTMLInputElement>(null)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const pdfContentRef = useRef<HTMLDivElement>(null)
  const pdfViewerRef = useRef<HTMLDivElement>(null)
  const pdfControlsTopRef = useRef<HTMLDivElement>(null)
  const pdfControlsBottomRef = useRef<HTMLDivElement>(null)
  const isScrollingRef = useRef(false)
  const pageDimensionsRef = useRef<Map<number, { width: number; height: number }>>(new Map())

  // Annotation state - initialize with initialAnnotations if provided
  const [annotations, setAnnotations] = useState<Annotation[]>(initialAnnotations)
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const [annotationMode, setAnnotationMode] = useState<'textbox' | 'image' | 'select' | null>(null)
  const [currentSelection, setCurrentSelection] = useState<{ text: string; pageNumber: number; rect: DOMRect; pageElement: HTMLElement } | null>(null)
  const [highlightedSelectionId, setHighlightedSelectionId] = useState<string | null>(null)
  const [showColorPicker, setShowColorPicker] = useState<boolean>(false)
  const [highlightColor, setHighlightColor] = useState<string>('#ffeb3b')
  const [isDragOver, setIsDragOver] = useState(false)
  const prevAnnotationsRef = useRef<Annotation[]>(initialAnnotations)
  const onAnnotationsChangeRef = useRef(onAnnotationsChange)

  // Keep callback ref up to date
  useEffect(() => {
    onAnnotationsChangeRef.current = onAnnotationsChange
  }, [onAnnotationsChange])

  // Sync initialAnnotations when they change (e.g., when loading from history)
  // Only sync if it's a real external change, not an echo of our own update
  useEffect(() => {
    // Use ref to get current annotations without adding to dependencies
    const currentAnnotations = prevAnnotationsRef.current
    
    // Compare lengths and IDs to detect if this is truly different data
    const isDifferent = initialAnnotations.length !== currentAnnotations.length ||
      initialAnnotations.some((annot, i) => annot.id !== currentAnnotations[i]?.id)
    
    if (initialAnnotations && initialAnnotations.length > 0 && isDifferent) {
      setAnnotations(initialAnnotations)
      prevAnnotationsRef.current = initialAnnotations
    } else if (file && initialAnnotations.length === 0 && currentAnnotations.length > 0) {
      // Clear annotations when new file is loaded (not from history)
      setAnnotations([])
      prevAnnotationsRef.current = []
      setSelectedAnnotationId(null)
    } else if (!file && currentAnnotations.length > 0) {
      // Clear annotations when file is removed
      setAnnotations([])
      prevAnnotationsRef.current = []
      setSelectedAnnotationId(null)
    }
  }, [initialAnnotations, file])

  // Notify parent when annotations change (only when they actually change)
  useEffect(() => {
    // Only call callback if annotations actually changed (not just a re-render)
    const annotationsChanged = JSON.stringify(prevAnnotationsRef.current) !== JSON.stringify(annotations)
    if (annotationsChanged && onAnnotationsChangeRef.current) {
      prevAnnotationsRef.current = annotations
      onAnnotationsChangeRef.current(annotations)
    }
  }, [annotations])

  // Suppress harmless TextLayer cancellation warnings (happens during zoom/scale changes)
  useEffect(() => {
    const originalWarn = console.warn
    const originalError = console.error

    // Suppress warnings
    console.warn = (...args: any[]) => {
      // Filter out TextLayer task cancelled warnings - they're harmless
      const message = args.join(' ')
      if (
        message.includes('TextLayer task cancelled') ||
        message.includes('AbortException') ||
        args.some(arg => typeof arg === 'string' && (arg.includes('TextLayer task cancelled') || arg.includes('AbortException')))
      ) {
        return
      }
      originalWarn.apply(console, args)
    }

    // Suppress errors (these warnings sometimes come through console.error)
    console.error = (...args: any[]) => {
      const message = args.join(' ')
      // Filter out TextLayer task cancelled errors - they're harmless
      if (
        message.includes('TextLayer task cancelled') ||
        (message.includes('AbortException') && message.includes('TextLayer'))
      ) {
        return
      }
      originalError.apply(console, args)
    }

    return () => {
      console.warn = originalWarn
      console.error = originalError
    }
  }, [])

  const fileUrl = useMemo(() => {
    if (!file) return null
    return URL.createObjectURL(file)
  }, [file])

  // Clean up blob URL only when component unmounts or file changes
  // Store previous URL to revoke when new file is loaded
  const prevFileUrlRef = useRef<string | null>(null)
  
  useEffect(() => {
    // Revoke previous blob URL when a new one is created
    if (prevFileUrlRef.current && prevFileUrlRef.current !== fileUrl) {
      URL.revokeObjectURL(prevFileUrlRef.current)
    }
    prevFileUrlRef.current = fileUrl
    
    // Clean up on unmount
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
      const standardFontDataUrl = 'https://unpkg.com/pdfjs-dist@5.4.394/standard_fonts/'

      if (isDev) {
        // In development, use CDN to avoid Vite module processing issues
        workerSrc = 'https://unpkg.com/pdfjs-dist@5.4.394/build/pdf.worker.min.mjs'
      } else {
        // In production, use local file from public folder
        const basePath = import.meta.env.BASE_URL || '/'
        const normalizedBasePath = basePath.endsWith('/') ? basePath : `${basePath}/`
        workerSrc = `${normalizedBasePath}pdf.worker.min.js`
      }

      // Ensure worker and standardFontDataUrl are set on pdfjs before Document tries to use it
      if (pdfjs.GlobalWorkerOptions) {
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
          // Set standardFontDataUrl on GlobalWorkerOptions for the worker thread
          // TypeScript doesn't recognize this property, but it's needed by PDF.js worker
          ; (pdfjs.GlobalWorkerOptions as any).standardFontDataUrl = standardFontDataUrl
      }

      return {
        workerSrc,
        cMapUrl: 'https://unpkg.com/pdfjs-dist@5.4.394/cmaps/',
        cMapPacked: true,
        standardFontDataUrl,
        // Set verbosity to suppress warnings (0 = errors only, 1 = warnings, 2 = infos)
        verbosity: 0,
      }
    },
    []
  )

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages)
    onTotalPagesChange?.(numPages)
    const initialPage = 1
    setPageNumber(initialPage)
    // Use setTimeout to avoid calling onPageChange during render
    setTimeout(() => {
      onPageChange?.(initialPage)
    }, 0)
    pageRefs.current.clear()
    pageDimensionsRef.current.clear()
    // Don't clear annotations here - they're managed by initialAnnotations prop
    // If initialAnnotations is empty, annotations will be empty anyway

    // Notify parent that PDF loading is complete
    if (onLoadingComplete) {
      // Small delay to ensure PDF is rendered
      setTimeout(() => {
        onLoadingComplete()
      }, 300)
    }
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
      const baseWidth = page.width / scale
      const baseHeight = page.height / scale

      pageDimensionsRef.current.set(pageData.pageNumber, {
        width: baseWidth,
        height: baseHeight,
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
            // Use setTimeout to avoid calling onPageChange during render
            setTimeout(() => {
              onPageChange?.(1)
            }, 0)
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
          // Use setTimeout to avoid calling onPageChange during render
          setTimeout(() => {
            onPageChange?.(bestPage)
          }, 0)
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
  }, [numPages, onPageChange])

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
      onPageChange?.(page)
      pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
      // Keep the flag true longer to prevent scroll detection from interfering
      setTimeout(() => {
        isScrollingRef.current = false
      }, 1500)
    }
  }, [onPageChange])

  // Expose scrollToPage, pdfContentRef, and viewer height to parent for knowledge notes navigation
  useEffect(() => {
    if (onScrollToPage) {
      // Store the scroll function so App can call it
      ; (window as any).__pdfScrollToPage = scrollToPage
    }
    // Expose pdfContentRef for scroll sync
    if (pdfContentRef.current) {
      ; (window as any).__pdfContentRef = pdfContentRef.current
    }
    // Expose viewer height
    if (pdfViewerRef.current) {
      ; (window as any).__pdfViewerHeight = pdfViewerRef.current.clientHeight
    }
    return () => {
      delete (window as any).__pdfScrollToPage
      delete (window as any).__pdfContentRef
      delete (window as any).__pdfViewerHeight
    }
  }, [scrollToPage, onScrollToPage, numPages, scale])

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
    // In split mode, use the viewer width; in float mode, use viewer width (which accounts for knowledge notes)
    let availableWidth: number
    if (layout === 'split') {
      // In split mode, the PDF viewer takes up the remaining space after the chat panel
      availableWidth = viewerRect.width - 40 // Account for padding (20px on each side)
    } else {
      // In float mode, use the actual PDF viewer width (which is reduced when knowledge notes are visible)
      // The viewerRect.width already accounts for the knowledge notes panel if it's visible
      availableWidth = viewerRect.width - 40 // Account for padding (20px on each side)
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

    // Get actual heights of control bars
    let topControlsHeight = 0
    let bottomControlsHeight = 0

    if (pdfControlsTopRef.current) {
      topControlsHeight = pdfControlsTopRef.current.getBoundingClientRect().height
    }

    if (pdfControlsBottomRef.current) {
      bottomControlsHeight = pdfControlsBottomRef.current.getBoundingClientRect().height
    }

    // Also account for AnnotationToolbar if present
    let annotationToolbarHeight = 0
    const annotationToolbar = pdfViewerRef.current.querySelector('.annotation-toolbar')
    if (annotationToolbar) {
      annotationToolbarHeight = annotationToolbar.getBoundingClientRect().height
    }

    // Calculate available height: viewer height minus all control bars
    const availableHeight = viewerRect.height - topControlsHeight - bottomControlsHeight - annotationToolbarHeight

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

      // Calculate the Y position of selected text
      let textYPosition: number | undefined
      let selectedPageNumber: number | undefined

      if (selection.rangeCount > 0 && pdfContentRef.current) {
        const range = selection.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        const containerRect = pdfContentRef.current.getBoundingClientRect()
        const selectionTop = rect.top - containerRect.top + pdfContentRef.current.scrollTop

        // Find the page that contains this selection
        for (let i = 1; i <= numPages; i++) {
          const pageElement = pageRefs.current.get(i)
          if (pageElement) {
            const pageTop = pageElement.offsetTop
            const pageHeight = pageElement.offsetHeight
            const pageBottom = pageTop + pageHeight

            if (selectionTop >= pageTop && selectionTop <= pageBottom) {
              selectedPageNumber = i
              // Calculate relative Y position within the page (0-1)
              const relativeY = (selectionTop - pageTop) / pageHeight
              textYPosition = Math.max(0, Math.min(1, relativeY))

              // Store selection info for highlight button
              setCurrentSelection({
                text,
                pageNumber: i,
                rect,
                pageElement
              })

              // Check if this selection already has a highlight
              const existingHighlight = annotations.find(
                ann => ann.type === 'highlight' &&
                  ann.pageNumber === i &&
                  Math.abs(ann.x - Math.max(0, Math.min(1, (rect.left - pageElement.getBoundingClientRect().left) / pageElement.offsetWidth))) < 0.01 &&
                  Math.abs(ann.y - Math.max(0, Math.min(1, relativeY))) < 0.01
              )
              setHighlightedSelectionId(existingHighlight?.id || null)
              break
            }
          }
        }
      }

      onTextSelection(text, selectedPageNumber, textYPosition)
    } else {
      // Clear selection when user clicks elsewhere or deselects
      onTextSelection('', undefined, undefined)
      setCurrentSelection(null)
      setHighlightedSelectionId(null)
      setShowColorPicker(false)
    }
  }, [onTextSelection, numPages, annotations])

  // Handle clicks to clear selection when clicking outside selected text
  // Also handles text box creation when in textbox mode
  const handleClick = useCallback((e: React.MouseEvent) => {
    // Check if click was on controls - if so, don't process this click
    const target = e.target as HTMLElement
    const isControlClick =
      target.closest('.textbox-controls') !== null ||
      target.closest('.textbox-font-size-input') !== null ||
      target.closest('.textbox-color-button') !== null ||
      target.closest('.textbox-color-picker') !== null ||
      target.classList.contains('textbox-controls') ||
      target.classList.contains('textbox-font-size-input') ||
      target.classList.contains('textbox-color-button') ||
      target.classList.contains('textbox-color-picker')

    if (isControlClick) {
      return // Don't process clicks on controls
    }

    // Check if click was on an annotation (annotation layer or its children)
    const isAnnotationClick =
      target.closest('.annotation') !== null ||
      target.closest('.annotation-layer') !== null ||
      target.closest('.resize-handle') !== null ||
      target.closest('.rotate-handle') !== null ||
      target.closest('.delete-button') !== null ||
      target.classList.contains('annotation') ||
      target.classList.contains('annotation-layer') ||
      target.classList.contains('resize-handle') ||
      target.classList.contains('rotate-handle') ||
      target.classList.contains('delete-button')

    // Small delay to allow text selection to complete first
    setTimeout(() => {
      const selection = window.getSelection()
      const hasTextSelection = selection && selection.toString().trim().length > 0

      if (!hasTextSelection) {
        onTextSelection('')
      }

      // Deselect annotation if clicking outside annotations and not selecting text
      // This works for all modes (select, textbox, image) to allow deselection after moving/resizing
      if (!isAnnotationClick && !hasTextSelection) {
        setSelectedAnnotationId(null)
      }

      // Handle text box creation when in textbox mode
      // This is now handled here since annotation layer has pointer-events: none
      if (annotationMode === 'textbox' && !isAnnotationClick && !hasTextSelection) {
        // Find which page was clicked
        const pdfContent = pdfContentRef.current
        if (!pdfContent) return

        // Find the page that contains this click
        let targetPage = pageNumber
        let relativeX = 0.5
        let relativeY = 0.5

        for (let i = 1; i <= numPages; i++) {
          const pageElement = pageRefs.current.get(i)
          if (pageElement) {
            const pageRect = pageElement.getBoundingClientRect()
            const containerRect = pdfContent.getBoundingClientRect()
            if (containerRect) {
              const pageRelativeX = e.clientX - pageRect.left
              const pageRelativeY = e.clientY - pageRect.top

              if (
                pageRelativeX >= 0 &&
                pageRelativeX <= pageRect.width &&
                pageRelativeY >= 0 &&
                pageRelativeY <= pageRect.height
              ) {
                targetPage = i
                const pageDims = pageDimensionsRef.current.get(i)
                if (pageDims) {
                  // Calculate the actual rendered scale from the page rect dimensions
                  // This is more accurate than using the scale state variable
                  const actualScaleX = pageRect.width / pageDims.width
                  const actualScaleY = pageRect.height / pageDims.height

                  // Use the actual rendered scale to calculate relative coordinates
                  // This ensures relative coordinates are always based on the actual rendered size
                  // NOT the scale state variable, which might not match the actual rendered size
                  relativeX = pageRelativeX / (pageDims.width * actualScaleX)
                  relativeY = pageRelativeY / (pageDims.height * actualScaleY)
                }
                break
              }
            }
          }
        }

        // Create text box annotation
        const pageDims = pageDimensionsRef.current.get(targetPage)
        if (pageDims) {
          // Constrain coordinates to page bounds
          const constrainedX = Math.max(0, Math.min(1 - 0.2, relativeX - 0.1))
          const constrainedY = Math.max(0, Math.min(1 - 0.1, relativeY - 0.05))

          const newAnnotation: TextBoxAnnotation = {
            id: `textbox-${Date.now()}`,
            type: 'textbox',
            pageNumber: targetPage,
            x: constrainedX,
            y: constrainedY,
            width: 0.2, // Default width 20% of page
            height: 0.1, // Default height 10% of page
            rotation: 0,
            text: 'Text',
            fontSize: 16,
            color: COMMON_COLORS[0],
          }

          // Use setAnnotations directly to avoid dependency issues
          setAnnotations((prev) => [...prev, newAnnotation])
          setSelectedAnnotationId(newAnnotation.id)
          // Switch back to select mode after creating text box
          setAnnotationMode('select')
        }
      }
    }, 100)
  }, [onTextSelection, annotationMode, pageNumber, numPages, scale, setSelectedAnnotationId, setAnnotationMode, setAnnotations])

  // Annotation handlers
  const handleAnnotationCreate = useCallback((annotation: Annotation) => {
    setAnnotations((prev) => [...prev, annotation])
    setSelectedAnnotationId(annotation.id)
  }, [])

  // Expose function to add annotation programmatically
  useEffect(() => {
    if (onAddAnnotation) {
      // Store the callback in a ref so it can be called from outside
      ; (window as any).__addPDFAnnotation = (annotation: TextBoxAnnotation) => {
        setAnnotations((prev) => [...prev, annotation])
        setSelectedAnnotationId(annotation.id)
        // Scroll to the page if needed
        if (annotation.pageNumber && onScrollToPage) {
          onScrollToPage(annotation.pageNumber)
        }
      }
    }
    return () => {
      delete (window as any).__addPDFAnnotation
    }
  }, [onAddAnnotation, onScrollToPage])

  // Helper function to calculate text box height
  const calculateTextBoxHeight = useCallback((textAnnotation: TextBoxAnnotation, pageDims: { width: number; height: number }, currentScale: number): number => {
    const pixelWidth = textAnnotation.width * pageDims.width * currentScale
    const tempDiv = document.createElement('div')
    tempDiv.style.position = 'absolute'
    tempDiv.style.visibility = 'hidden'
    tempDiv.style.width = `${pixelWidth}px`
    tempDiv.style.fontSize = `${textAnnotation.fontSize * currentScale}px`
    tempDiv.style.fontFamily = 'inherit'
    tempDiv.style.whiteSpace = 'pre-wrap'
    tempDiv.style.wordWrap = 'break-word'
    tempDiv.style.overflowWrap = 'break-word'
    tempDiv.style.padding = `${4 * currentScale}px`
    tempDiv.style.boxSizing = 'border-box'
    tempDiv.style.lineHeight = '1.2'
    tempDiv.textContent = textAnnotation.text || 'Text'
    document.body.appendChild(tempDiv)
    const requiredHeight = tempDiv.scrollHeight
    document.body.removeChild(tempDiv)

    const requiredRelativeHeight = requiredHeight / (pageDims.height * currentScale)
    return Math.max(0.01, Math.min(1, requiredRelativeHeight))
  }, [])

  const handleAnnotationUpdate = useCallback((annotation: Annotation) => {
    setAnnotations((prev) => {
      // First, update the annotation
      const updated = prev.map((ann) => (ann.id === annotation.id ? annotation : ann))

      // If updating a text box, recalculate height based on current content and font size
      if (annotation.type === 'textbox') {
        const textAnnotation = annotation as TextBoxAnnotation
        // Find the page dimensions for this annotation
        const pageDims = pageDimensionsRef.current.get(textAnnotation.pageNumber)
        if (pageDims) {
          const finalHeight = calculateTextBoxHeight(textAnnotation, pageDims, scale)

          // Update the annotation with new height, preserving all other properties
          return updated.map((ann) =>
            ann.id === annotation.id
              ? { ...textAnnotation, height: finalHeight }
              : ann
          )
        }
      }
      return updated
    })
  }, [scale, calculateTextBoxHeight])

  // Recalculate text box heights when zoom changes
  useEffect(() => {
    setAnnotations((prev) => {
      return prev.map((ann) => {
        if (ann.type === 'textbox') {
          const textAnnotation = ann as TextBoxAnnotation
          const pageDims = pageDimensionsRef.current.get(textAnnotation.pageNumber)
          if (pageDims) {
            const finalHeight = calculateTextBoxHeight(textAnnotation, pageDims, scale)
            return { ...textAnnotation, height: finalHeight }
          }
        }
        return ann
      })
    })
  }, [scale, calculateTextBoxHeight])

  const handleAnnotationDelete = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((ann) => ann.id !== id))
    if (selectedAnnotationId === id) {
      setSelectedAnnotationId(null)
    }
  }, [selectedAnnotationId])

  const handleImageUpload = useCallback(
    async (imageFile: File) => {
      if (!file) return

      // Get current page dimensions
      const currentPageDims = pageDimensionsRef.current.get(pageNumber)
      if (!currentPageDims) return

      // Convert image to data URL
      const reader = new FileReader()
      reader.onload = (e) => {
        const imageData = e.target?.result as string
        const img = new Image()
        img.onload = () => {
          // Convert to PNG if it's SVG or other non-standard format
          // pdf-lib only supports PNG and JPEG
          const needsConversion = !imageData.startsWith('data:image/png') && 
                                  !imageData.startsWith('data:image/jpeg') && 
                                  !imageData.startsWith('data:image/jpg')
          
          let finalImageData = imageData
          
          if (needsConversion) {
            // Create a canvas to convert the image to PNG
            const canvas = document.createElement('canvas')
            canvas.width = img.width
            canvas.height = img.height
            const ctx = canvas.getContext('2d')
            
            if (ctx) {
              // Draw image on canvas
              ctx.drawImage(img, 0, 0)
              // Convert to PNG data URL
              finalImageData = canvas.toDataURL('image/png')
            }
          }
          
          // Calculate default size (20% of page width, maintain aspect ratio)
          const defaultWidth = 0.2
          const aspectRatio = img.width / img.height
          const defaultHeight = defaultWidth / aspectRatio

          // Center on page
          const x = 0.4
          const y = 0.4

          const newAnnotation: ImageAnnotation = {
            id: `image-${Date.now()}`,
            type: 'image',
            pageNumber,
            x,
            y,
            width: defaultWidth,
            height: defaultHeight,
            rotation: 0,
            imageData: finalImageData,
            imageWidth: img.width,
            imageHeight: img.height,
          }

          handleAnnotationCreate(newAnnotation)
          // Automatically switch back to select mode after creating image
          setAnnotationMode('select')
        }
        img.src = imageData
      }
      reader.readAsDataURL(imageFile)
    },
    [file, pageNumber, handleAnnotationCreate, setAnnotationMode]
  )

  //Handle highlight button click - toggle highlight on/off for selected text
  const handleHighlightClick = useCallback(() => {
    if (!currentSelection) return // Do nothing if no text selected

    const { pageNumber, rect, pageElement } = currentSelection

    // Check if selection already has a highlight
    if (highlightedSelectionId) {
      // Remove existing highlight and hide color picker
      setAnnotations(prev => prev.filter(ann => ann.id !== highlightedSelectionId))
      setHighlightedSelectionId(null)
      setShowColorPicker(false)
    } else {
      // Add new highlight and show color picker
      const pageWidth = pageElement.offsetWidth
      const pageHeight = pageElement.offsetHeight
      const pageRect = pageElement.getBoundingClientRect()

      // Calculate relative coordinates (0-1)
      const relX = (rect.left - pageRect.left) / pageWidth
      const relY = (rect.top - pageRect.top) / pageHeight
      const relWidth = rect.width / pageWidth
      const relHeight = rect.height / pageHeight

      // Create new highlight annotation
      const newHighlight: HighlightAnnotation = {
        id: crypto.randomUUID(),
        type: 'highlight',
        pageNumber,
        x: Math.max(0, Math.min(1, relX)),
        y: Math.max(0, Math.min(1, relY)),
        width: Math.max(0.01, Math.min(1, relWidth)),
        height: Math.max(0.01, Math.min(1, relHeight)),
        rotation: 0,
        color: highlightColor,
        opacity: 0.4
      }

      setAnnotations(prev => [...prev, newHighlight])
      setHighlightedSelectionId(newHighlight.id)
      setShowColorPicker(true)
    }
  }, [currentSelection, highlightedSelectionId, highlightColor])

  // Handle highlight color change - update existing highlight's color
  const handleHighlightColorChange = useCallback((color: string) => {
    setHighlightColor(color)

    // If there's an active highlight, update its color
    if (highlightedSelectionId) {
      setAnnotations(prev => prev.map(ann =>
        ann.id === highlightedSelectionId && ann.type === 'highlight'
          ? { ...ann, color }
          : ann
      ))
    }
  }, [highlightedSelectionId])

  const handleDownload = useCallback(async () => {
    if (!file || annotations.length === 0) {
      alert('No annotations to save')
      return
    }

    try {
      const blob = await saveAnnotatedPDF(file, annotations, pageDimensionsRef.current)
      const filename = file.name.replace('.pdf', '_annotated.pdf')
      downloadPDF(blob, filename)
    } catch (error) {
      console.error('Error saving PDF:', error)
      alert('Failed to save annotated PDF. Please check the console for details.')
    }
  }, [file, annotations])

  // Handle drag and drop for images
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set drag over to false if we're leaving the pdf-content area
    if (!pdfContentRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const files = Array.from(e.dataTransfer.files)
      const imageFiles = files.filter((file) => file.type.startsWith('image/'))

      if (imageFiles.length === 0) return

      // Get drop position relative to PDF content
      const rect = pdfContentRef.current?.getBoundingClientRect()
      if (!rect) return

      // Find which page the drop occurred on
      let targetPage = pageNumber
      let relativeX = 0.5
      let relativeY = 0.5

      // Try to find the page that contains the drop point
      for (let i = 1; i <= numPages; i++) {
        const pageElement = pageRefs.current.get(i)
        if (pageElement) {
          const pageRect = pageElement.getBoundingClientRect()
          const containerRect = pdfContentRef.current?.getBoundingClientRect()
          if (containerRect) {
            const pageRelativeX = e.clientX - pageRect.left
            const pageRelativeY = e.clientY - pageRect.top

            if (
              pageRelativeX >= 0 &&
              pageRelativeX <= pageRect.width &&
              pageRelativeY >= 0 &&
              pageRelativeY <= pageRect.height
            ) {
              targetPage = i
              const pageDims = pageDimensionsRef.current.get(i)
              if (pageDims) {
                relativeX = pageRelativeX / (pageDims.width * scale)
                relativeY = pageRelativeY / (pageDims.height * scale)
              }
              break
            }
          }
        }
      }

      // Process each dropped image
      for (const imageFile of imageFiles) {
        const reader = new FileReader()
        reader.onload = (event) => {
          const imageData = event.target?.result as string
          const img = new Image()
          img.onload = () => {
            const pageDims = pageDimensionsRef.current.get(targetPage)
            if (!pageDims) return

            // Calculate default size (20% of page width, maintain aspect ratio)
            const defaultWidth = 0.2
            const aspectRatio = img.width / img.height
            const defaultHeight = defaultWidth / aspectRatio

            // Use drop position, but constrain to page bounds
            const constrainedX = Math.max(0, Math.min(1 - defaultWidth, relativeX - defaultWidth / 2))
            const constrainedY = Math.max(0, Math.min(1 - defaultHeight, relativeY - defaultHeight / 2))

            const newAnnotation: ImageAnnotation = {
              id: `image-${Date.now()}-${Math.random()}`,
              type: 'image',
              pageNumber: targetPage,
              x: constrainedX,
              y: constrainedY,
              width: defaultWidth,
              height: defaultHeight,
              rotation: 0,
              imageData,
              imageWidth: img.width,
              imageHeight: img.height,
            }

            handleAnnotationCreate(newAnnotation)
          }
          img.src = imageData
        }
        reader.readAsDataURL(imageFile)
      }
    },
    [pageNumber, numPages, scale, handleAnnotationCreate]
  )

  if (!file && !isLoadingPdf) {
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

  const selectedAnnotation = annotations.find((ann) => ann.id === selectedAnnotationId) || null

  return (
    <div className={`pdf-viewer ${isSavingSession ? 'saving-session' : ''}`} ref={pdfViewerRef}>
      {isLoadingPdf && (
        <div className="pdf-loading-overlay">
          <div className="pdf-loading-spinner">
            <div className="spinner"></div>
            <p>Loading PDF...</p>
          </div>
        </div>
      )}
      {isSavingSession && (
        <div className="pdf-saving-overlay">
          <div className="pdf-saving-content">
            <div className="saving-spinner"></div>
            <p>Saving PDF...</p>
            <p className="saving-subtitle">Preparing for new session</p>
          </div>
        </div>
      )}
      <AnnotationToolbar
        mode={annotationMode}
        onModeChange={setAnnotationMode}
        highlightColor={highlightColor}
        onHighlightColorChange={handleHighlightColorChange}
        onHighlightClick={handleHighlightClick}
        hasTextSelection={!!currentSelection}
        isHighlightActive={!!highlightedSelectionId}
        showColorPicker={showColorPicker}
        onImageUpload={handleImageUpload}
        onDownload={handleDownload}
        onNewSession={onNewSession}
        onClearAll={() => {
          setAnnotations([])
          setSelectedAnnotationId(null)
        }}
      />
      <div className="pdf-controls-top" ref={pdfControlsTopRef}>
        {selectedAnnotation && selectedAnnotation.type === 'textbox' && (
          <FontSizeInputWrapper
            selectedAnnotation={selectedAnnotation as TextBoxAnnotation}
            onUpdate={handleAnnotationUpdate}
          />
        )}
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
          {onToggleKnowledgeNotes && (
            <button
              onClick={onToggleKnowledgeNotes}
              className="control-button knowledge-notes-toggle"
              title={showKnowledgeNotes ? 'Hide knowledge notes' : 'Show knowledge notes'}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div
        ref={pdfContentRef}
        className={`pdf-content ${isDragOver ? 'drag-over' : ''}`}
        onMouseUp={handleTextSelection}
        onKeyUp={handleTextSelection}
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(e) => {
          setIsDragOver(false)
          handleDrop(e)
        }}
      >
        {file && (
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
              const pageDims = pageDimensionsRef.current.get(pageNum)
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
                  style={{ position: 'relative' }}
                >
                  <Page
                    key={`page_${pageNum}`}
                    pageNumber={pageNum}
                    scale={scale}
                    renderTextLayer={true}
                    renderAnnotationLayer={true}
                    onLoadSuccess={(page) => onPageLoadSuccess({ pageNumber: pageNum, page })}
                  />
                  {pageDims && (
                    <>
                      <AnnotationLayer
                        pageNumber={pageNum}
                        pageWidth={pageDims.width}
                        pageHeight={pageDims.height}
                        scale={scale}
                        annotations={annotations}
                        selectedAnnotationId={selectedAnnotationId}
                        onAnnotationUpdate={handleAnnotationUpdate}
                        onAnnotationDelete={handleAnnotationDelete}
                        onAnnotationSelect={setSelectedAnnotationId}
                        mode={annotationMode}
                      />
                      {showKnowledgeNotes && (
                        <KnowledgeNoteConnections
                          pageNumber={pageNum}
                          pageWidth={pageDims.width}
                          pageHeight={pageDims.height}
                          scale={scale}
                          knowledgeNotes={knowledgeNotes}
                          showKnowledgeNotes={showKnowledgeNotes}
                          layout={layout}
                          onNoteClick={onNoteClick}
                        />
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </Document>
        )}
      </div>
      <div className="pdf-controls-bottom" ref={pdfControlsBottomRef}>
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

