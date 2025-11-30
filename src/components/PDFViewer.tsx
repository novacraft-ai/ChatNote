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
import { analytics } from '../services/analyticsService'
import { getRecentPDFsFromCache, prefetchRecentPDFs } from '../utils/pdfHistoryCache'
import chatNoteIcon from '../assets/chatnote-logo.svg'

interface PDFViewerProps {
  file: File | null
  onFileUpload: (file: File) => void
  onTextSelection: (text: string, pageNumber?: number, textYPosition?: number) => void
  layout?: 'floating' | 'split'
  onPageChange?: (pageNumber: number) => void
  onTotalPagesChange?: (totalPages: number) => void
  showKnowledgeNotes?: boolean
  knowledgeNotes?: KnowledgeNote[]
  onScrollToPage?: (pageNumber: number) => void
  onNoteClick?: (note: KnowledgeNote) => void
  pdfContentRef?: React.RefObject<HTMLDivElement>
  onAddAnnotation?: (annotation: TextBoxAnnotation) => void
  initialAnnotations?: Annotation[]
  onAnnotationsChange?: (annotations: Annotation[]) => void
  isLoadingPdf?: boolean
  onLoadingComplete?: () => void
  isSavingSession?: boolean
  onNewSession?: () => void
  onToggleLayout?: () => void
  isDriveAuthorized?: boolean
  onSelectRecentPdf?: (pdfId: string) => void
}

function PDFViewer({
  file,
  onFileUpload,
  onTextSelection,
  layout = 'floating',
  onPageChange,
  onTotalPagesChange,
  showKnowledgeNotes = true,
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
  onToggleLayout,
  isDriveAuthorized,
  onSelectRecentPdf,
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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile && selectedFile.type === 'application/pdf') {
      onFileUpload(selectedFile)
      
      // Track PDF upload - create document first, then track the event
      const fileSizeMb = selectedFile.size / (1024 * 1024)
      const documentId = analytics.generateDocumentId()
      analytics.setCurrentDocument(documentId)
      
      // Create document record first (required for foreign key)
      await analytics.createDocument(documentId, fileSizeMb)
      
      // Then track the upload event
      await analytics.trackPDFUpload(fileSizeMb, documentId)
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
    if (pageDimensionsRef.current.size === 0) return

    // Prefer using the actual PDF content container's usable width. Subtract
    // padding, potential vertical scrollbar, and a small safety margin to
    // avoid 1px overflows that create a horizontal scrollbar.
    let availableWidth: number | null = null
    if (pdfContentRef.current) {
      const el = pdfContentRef.current
      const style = getComputedStyle(el)
      const padLeft = parseFloat(style.paddingLeft || '0') || 0
      const padRight = parseFloat(style.paddingRight || '0') || 0

      // clientWidth includes padding; compute inner content width by
      // subtracting paddings so we know how much width a centered page can use.
      availableWidth = el.clientWidth - padLeft - padRight

      // If there's a vertical scrollbar, subtract estimated scrollbar width
      if (el.scrollHeight > el.clientHeight) {
        availableWidth -= 12 // typical scrollbar width
      }

      // Safety margin to avoid off-by-one/rounding overflow
      availableWidth = Math.max(0, availableWidth - 4)
    } else if (pdfViewerRef.current) {
      const viewerRect = pdfViewerRef.current.getBoundingClientRect()
      availableWidth = Math.max(0, viewerRect.width - 40)
    }

    if (!availableWidth || availableWidth <= 0) return

    // Get the first page dimensions (assuming all pages have similar dimensions)
    const firstPageDims = pageDimensionsRef.current.get(1)
    if (!firstPageDims) return

    // Calculate scale to fit width based on the content container
    // Calculate scale to fit width. Use a tiny shrink factor to ensure the
    // rendered canvas doesn't exceed the container due to fractional pixels.
    const newScale = (availableWidth / firstPageDims.width) * 0.999
    const clampedScale = Math.max(0.1, Math.min(newScale, 5.0)) // Clamp between 0.1 and 5.0
    setScale(clampedScale)
    setZoomInputValue(Math.round(clampedScale * 100).toString())
  }

  const handleFitHeight = () => {
    if (!pdfViewerRef.current || pageDimensionsRef.current.size === 0) return

    const viewerRect = pdfViewerRef.current.getBoundingClientRect()

    // Also account for AnnotationToolbar if present
    let annotationToolbarHeight = 0
    const annotationToolbar = pdfViewerRef.current.querySelector('.annotation-toolbar')
    if (annotationToolbar) {
      annotationToolbarHeight = annotationToolbar.getBoundingClientRect().height
    }

    // Calculate available height: viewer height minus toolbar
    const availableHeight = viewerRect.height - annotationToolbarHeight

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
      target.closest('.floating-textbox-toolbar') !== null ||
      target.closest('.color-swatch') !== null ||
      target.classList.contains('textbox-controls') ||
      target.classList.contains('textbox-font-size-input') ||
      target.classList.contains('textbox-color-button') ||
      target.classList.contains('textbox-color-picker') ||
      target.classList.contains('floating-textbox-toolbar') ||
      target.classList.contains('color-swatch')

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
    
    // Track annotation addition
    let toolName: 'highlight' | 'text' | 'image' = 'text'
    if (annotation.type === 'highlight') {
      toolName = 'highlight'
    } else if (annotation.type === 'image') {
      toolName = 'image'
    } else if (annotation.type === 'textbox') {
      toolName = 'text'
    }
    analytics.trackAnnotationAdded(toolName)
    
    // Update document to mark it has annotations
    const currentDocId = analytics.getCurrentDocumentId()
    if (currentDocId) {
      analytics.updateDocument(currentDocId, { has_annotations: true })
    }
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
      let changed = false
      const updated = prev.map((ann) => {
        if (ann.id !== annotation.id) return ann
        // Start with provided annotation and possibly recalc height
        if (annotation.type === 'textbox') {
          const textAnnotation = annotation as TextBoxAnnotation
          const pageDims = pageDimensionsRef.current.get(textAnnotation.pageNumber)
          if (pageDims) {
            const finalHeight = calculateTextBoxHeight(textAnnotation, pageDims, scale)
            // Only create a new object if height or other props changed meaningfully
            if (
              Math.abs((ann.height || 0) - finalHeight) > 0.0001 ||
              Math.abs((ann.x || 0) - (textAnnotation.x || 0)) > 0.0001 ||
              Math.abs((ann.y || 0) - (textAnnotation.y || 0)) > 0.0001 ||
              Math.abs((ann.width || 0) - (textAnnotation.width || 0)) > 0.0001 ||
              Math.abs((ann.rotation || 0) - (textAnnotation.rotation || 0)) > 0.0001 ||
              (
                ann.type === 'textbox' && (
                  ((ann as TextBoxAnnotation).text !== textAnnotation.text) ||
                  ((ann as TextBoxAnnotation).color !== textAnnotation.color) ||
                  ((ann as TextBoxAnnotation).fontSize !== textAnnotation.fontSize)
                )
              )
            ) {
              changed = true
              return { ...textAnnotation, height: finalHeight }
            }
            return ann
          }
        }
        // For non-textbox or no page dims, compare shallowly and update only if different
        if (
          Math.abs((ann.x || 0) - (annotation.x || 0)) > 0.0001 ||
          Math.abs((ann.y || 0) - (annotation.y || 0)) > 0.0001 ||
          Math.abs((ann.width || 0) - (annotation.width || 0)) > 0.0001 ||
          Math.abs((ann.height || 0) - (annotation.height || 0)) > 0.0001 ||
          Math.abs((ann.rotation || 0) - (annotation.rotation || 0)) > 0.0001 ||
          (('color' in ann) && ('color' in annotation) && (ann as any).color !== (annotation as any).color)
        ) {
          changed = true
          return annotation
        }
        return ann
      })
      return changed ? updated : prev
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
    if (!file) return

    try {
      if (annotations.length === 0) {
        // No annotations: allow downloading original PDF file as-is
        const filename = file.name
        downloadPDF(file, filename)

        // Track PDF export (no annotations)
        await analytics.trackPDFExport(false)

        const currentDocId = analytics.getCurrentDocumentId()
        if (currentDocId) {
          await analytics.updateDocument(currentDocId, { has_export: true })
        }
        return
      }

      // There are annotations: generate annotated PDF
      const blob = await saveAnnotatedPDF(file, annotations, pageDimensionsRef.current)
      const filename = file.name.replace('.pdf', '_annotated.pdf')
      downloadPDF(blob, filename)

      // Track PDF export
      await analytics.trackPDFExport(true)

      // Update document to mark that it has been exported
      const currentDocId = analytics.getCurrentDocumentId()
      if (currentDocId) {
        await analytics.updateDocument(currentDocId, { has_export: true })
      }
    } catch (error) {
      console.error('Error saving PDF:', error)
      alert('Failed to save annotated PDF. Please check the console for details.')
    }
  }, [file, annotations])

  // Listen to NavBar events (add window-level listeners so toolbar controls in NavBar work)
  useEffect(() => {
    const handlePdfNewSessionEvent = () => {
      if (onNewSession) onNewSession()
    }
    const handlePdfDownloadEvent = () => {
      handleDownload()
    }

    window.addEventListener('pdf-new-session', handlePdfNewSessionEvent)
    window.addEventListener('pdf-download', handlePdfDownloadEvent)
    return () => {
      window.removeEventListener('pdf-new-session', handlePdfNewSessionEvent)
      window.removeEventListener('pdf-download', handlePdfDownloadEvent)
    }
  }, [onNewSession, handleDownload])

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

  // Recent PDFs state + background prefetch (stale-while-revalidate)
  const [recentPdfsState, setRecentPdfsState] = useState<any[]>(() => getRecentPDFsFromCache(3))

  useEffect(() => {
    let mounted = true
    if (isDriveAuthorized) {
      prefetchRecentPDFs(3)
        .then((fresh) => {
          if (!mounted) return
          if (fresh && fresh.length > 0) setRecentPdfsState(fresh)
        })
        .catch(() => {
          // Ignore background prefetch errors
        })
    }
    return () => {
      mounted = false
    }
  }, [isDriveAuthorized])

  if (!file && !isLoadingPdf) {
    // Only show recent PDFs if user isDriveAuthorized
    // Props are now destructured above
    // Use shared utility to get recent PDFs
    // Note: component-level state will handle background prefetch updates
    const recentPdfs = recentPdfsState

    return (
      <div className={`pdf-viewer-empty ${layout === 'floating' ? 'float-layout' : ''}`}>  
        <div className="start-page-content">
          <img src={chatNoteIcon} alt="ChatNote Logo" className="start-logo" />
          <div className="upload-container">
            <label htmlFor="pdf-upload" className="upload-button modern-upload">
              <span className="upload-icon" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19V6M5 12l7-7 7 7" /><rect x="3" y="19" width="18" height="2" rx="1" /></svg>
              </span>
              <span>Upload PDF</span>
            </label>
            <input
              id="pdf-upload"
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </div>
          {isDriveAuthorized && recentPdfs.length > 0 && (
            <div className="recent-pdf-suggestions">
              <div className="suggestions-title">Recent PDFs</div>
              <div className="suggestions-list">
                {recentPdfs.map((pdf: any, idx: number) => (
                  <button
                    key={pdf.pdfId || idx}
                    className="suggestion-card"
                    onClick={() => onSelectRecentPdf && onSelectRecentPdf(pdf.pdfId)}
                  >
                    <span className="suggestion-icon" aria-hidden="true">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                    </span>
                    <span className="suggestion-name">{pdf.displayName || pdf.originalFileName}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // selectedAnnotation removed - annotation controls are handled in AnnotationLayer (floating toolbar)

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
        
        onToggleLayout={onToggleLayout}
        onClearAll={() => {
          setAnnotations([])
          setSelectedAnnotationId(null)
        }}
        // PDF controls
        pageNumber={pageNumber}
        numPages={numPages}
        onPrevPage={goToPrevPage}
        onNextPage={goToNextPage}
        scale={scale}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitWidth={handleFitWidth}
        onFitHeight={handleFitHeight}
        layout={layout}
        onZoomInputClick={handleZoomInputClick}
        isEditingZoom={isEditingZoom}
        zoomInputValue={zoomInputValue}
        onZoomInputChange={handleZoomInputChange}
        onZoomInputBlur={handleZoomInputBlur}
        onZoomInputKeyDown={handleZoomInputKeyDown}
        onZoomInputPaste={handleZoomInputPaste}
        zoomInputRef={zoomInputRef}
        // removed passing selectedAnnotation and onAnnotationUpdate since textbox controls are now floating
      />
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
    </div>
  )
}

export default PDFViewer

