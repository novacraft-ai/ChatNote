import React, { useRef, useState, useEffect } from 'react'
import './AnnotationToolbar.css'

interface AnnotationToolbarProps {
  mode: 'textbox' | 'image' | 'select' | null
  onModeChange: (mode: 'textbox' | 'image' | 'select' | null) => void
  highlightColor?: string
  onHighlightColorChange?: (color: string) => void
  onHighlightClick?: () => void
  hasTextSelection?: boolean
  isHighlightActive?: boolean
  showColorPicker?: boolean
  onImageUpload: (file: File) => void
  layout?: 'floating' | 'split'
  onToggleLayout?: () => void
  showLayoutToggle?: boolean
  onClearAll?: () => void
  // PDF controls
  pageNumber?: number
  numPages?: number
  onPrevPage?: () => void
  onNextPage?: () => void
  scale?: number
  onZoomIn?: () => void
  onZoomOut?: () => void
  onFitWidth?: () => void
  onFitHeight?: () => void
  onZoomInputClick?: () => void
  isEditingZoom?: boolean
  zoomInputValue?: string
  onZoomInputChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  onZoomInputBlur?: () => void
  onZoomInputKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onZoomInputPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void
  zoomInputRef?: React.RefObject<HTMLInputElement>
  // removed textbox-specific props - use floating toolbar instead
}

const AnnotationToolbar: React.FC<AnnotationToolbarProps> = ({
  mode,
  onModeChange,
  highlightColor = '#ffeb3b', // Default yellow
  onHighlightColorChange,
  onHighlightClick,
  hasTextSelection = false,
  isHighlightActive = false,
  showColorPicker = false,
  onImageUpload,
  layout,
  onToggleLayout,
  showLayoutToggle = true,
  
  onClearAll,
  // PDF controls
  pageNumber,
  numPages,
  onPrevPage,
  onNextPage,
  scale,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onFitHeight,
  
  onZoomInputClick,
  isEditingZoom,
  zoomInputValue,
  onZoomInputChange,
  onZoomInputBlur,
  onZoomInputKeyDown,
  onZoomInputPaste,
  zoomInputRef,
  // selectedAnnotation and onAnnotationUpdate were removed (textbox controls moved to floating toolbar)
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isConfirmingClear, setIsConfirmingClear] = useState(false)
  const [showMobileTools, setShowMobileTools] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 720 : false
  )
  const clearTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const highlightColors = [
    '#ffeb3b', // Yellow
    '#8bc34a', // Green
    '#03a9f4', // Blue
    '#e91e63', // Pink
    '#9c27b0', // Purple
  ]

  // Reset confirmation state when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isConfirmingClear) {
        const target = e.target as HTMLElement
        if (!target.closest('.clear-button')) {
          setIsConfirmingClear(false)
          if (clearTimeoutRef.current) {
            clearTimeout(clearTimeoutRef.current)
            clearTimeoutRef.current = null
          }
        }
      }
    }

    if (isConfirmingClear) {
      document.addEventListener('click', handleClickOutside)
      return () => {
        document.removeEventListener('click', handleClickOutside)
      }
    }
  }, [isConfirmingClear])

  // Ensure tools collapse when viewport grows beyond mobile breakpoint
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleResize = () => {
      const isMobile = window.innerWidth <= 720
      setIsMobileViewport(isMobile)
      if (!isMobile && showMobileTools) {
        setShowMobileTools(false)
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [showMobileTools])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type.startsWith('image/')) {
      onImageUpload(file)
      // Reset mode after successful upload
      onModeChange(null)
    } else {
      // No file selected (user cancelled) - reset mode to remove active state
      onModeChange(null)
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleClearClick = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent click from bubbling to document
    if (isConfirmingClear) {
      // Second click - actually clear
      if (onClearAll) {
        onClearAll()
      }
      setIsConfirmingClear(false)
      if (clearTimeoutRef.current) {
        clearTimeout(clearTimeoutRef.current)
        clearTimeoutRef.current = null
      }
    } else {
      // First click - show confirmation state
      setIsConfirmingClear(true)
      // Reset after 3 seconds if user doesn't click again
      clearTimeoutRef.current = setTimeout(() => {
        setIsConfirmingClear(false)
        clearTimeoutRef.current = null
      }, 3000)
    }
  }


  return (
    <div className="annotation-toolbar">

      <div className="toolbar-left">
        {isMobileViewport && (
          <button
            type="button"
            className={`toolbar-button mobile-tools-toggle ${showMobileTools ? 'active' : ''}`}
            onClick={() => setShowMobileTools(prev => !prev)}
            aria-pressed={showMobileTools}
            aria-expanded={showMobileTools}
            aria-label={showMobileTools ? 'Hide annotation tools' : 'Show annotation tools'}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M3 17.25V21H6.75L17.81 9.94L14.06 6.19L3 17.25Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M14.06 6.19L17.31 2.94C17.7 2.55 18.33 2.55 18.72 2.94L21.06 5.28C21.45 5.67 21.45 6.3 21.06 6.69L17.81 9.94"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        {/* Annotation tools */}
        <div className={`toolbar-section annotation-tools ${isMobileViewport && showMobileTools ? 'mobile-visible' : ''}`}>
        <button
          className={`toolbar-button ${isHighlightActive ? 'active' : ''}`}
          onClick={onHighlightClick}
          disabled={!hasTextSelection}
          title={hasTextSelection ? (isHighlightActive ? "Remove highlight" : "Highlight text") : "Select text to highlight"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l-6 6v3h9l3-3" />
            <path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
          </svg>
        </button>
        <button
          className={`toolbar-button ${mode === 'textbox' ? 'active' : ''}`}
          onClick={() => onModeChange('textbox')}
          title="Add text box"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7V4h16v3M9 20h6M12 4v16" />
          </svg>
        </button>
        <button
          className={`toolbar-button ${mode === 'image' ? 'active' : ''}`}
          onClick={() => {
            onModeChange('image')
            fileInputRef.current?.click()
          }}
          title="Add image"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </button>
        {onClearAll && (
          <button
            className={`toolbar-button clear-button ${isConfirmingClear ? 'confirming' : ''}`}
            onClick={handleClearClick}
            title={isConfirmingClear ? "Click again to clear all" : "Clear all"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        </div>

        {showColorPicker && onHighlightColorChange && (
          <div className="toolbar-section color-picker">
            {highlightColors.map(color => (
              <button
                key={color}
                className={`color-button ${highlightColor === color ? 'active' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => onHighlightColorChange(color)}
                title="Highlight color"
              />
            ))}
          </div>
        )}
      </div>

      <div className="toolbar-center">
        {/* PDF navigation */}
        {pageNumber !== undefined && numPages !== undefined && (
          <div className="toolbar-section pdf-navigation">
            <button
              className="toolbar-button nav-button"
              onClick={onPrevPage}
              disabled={pageNumber <= 1}
              title="Previous page"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
            <span className="page-info">{pageNumber} / {numPages}</span>
            <button
              className="toolbar-button nav-button"
              onClick={onNextPage}
              disabled={pageNumber >= numPages}
              title="Next page"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>
        )}

        {/* PDF zoom controls */}
        {scale !== undefined && (
          <div className="toolbar-section zoom-controls">
            <button onClick={onFitWidth} className="toolbar-button" title="Fit width">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="5 9 2 12 5 15"></polyline>
                <polyline points="19 9 22 12 19 15"></polyline>
                <line x1="2" y1="12" x2="22" y2="12"></line>
              </svg>
            </button>
            <button onClick={onFitHeight} className="toolbar-button" title="Fit height">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 5 12 2 15 5"></polyline>
                <polyline points="9 19 12 22 15 19"></polyline>
                <line x1="12" y1="2" x2="12" y2="22"></line>
              </svg>
            </button>
            <button onClick={onZoomOut} className="toolbar-button" title="Zoom out">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            {isEditingZoom ? (
              <input
                ref={zoomInputRef}
                type="text"
                inputMode="numeric"
                value={zoomInputValue}
                onChange={onZoomInputChange}
                onBlur={onZoomInputBlur}
                onKeyDown={onZoomInputKeyDown}
                onPaste={onZoomInputPaste}
                className="zoom-input"
              />
            ) : (
              <span className="zoom-level" onClick={onZoomInputClick} title="Click to edit zoom">
                {Math.round((scale || 1) * 100)}%
              </span>
            )}
            <button onClick={onZoomIn} className="toolbar-button" title="Zoom in">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            {/* show/hide notes button moved to the Chat header */}
          </div>
        )}
      </div>

      <div className="toolbar-right">
        {/* Actions */}
        {showLayoutToggle && onToggleLayout && (
          <div className="toolbar-section toolbar-actions">
            <button
              className="toolbar-button layout-toggle-button"
              onClick={onToggleLayout}
              title={layout === 'floating' ? 'Switch to split layout' : 'Switch to floating layout'}
            >
              {layout === 'floating' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                  <line x1="12" y1="3" x2="12" y2="21" />
                </svg>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default AnnotationToolbar

