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
    const handleResize = () => {
      if (window.innerWidth > 720 && showMobileTools) {
        setShowMobileTools(false)
      }
    }

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
        <button
          type="button"
          className={`toolbar-button mobile-tools-toggle ${showMobileTools ? 'active' : ''}`}
          onClick={() => setShowMobileTools(prev => !prev)}
          aria-pressed={showMobileTools}
          aria-expanded={showMobileTools}
          aria-label={showMobileTools ? 'Hide annotation tools' : 'Show annotation tools'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        {/* Annotation tools */}
        <div className={`toolbar-section annotation-tools ${showMobileTools ? 'mobile-expanded' : ''}`}>
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
                <line x1="10" y1="3" x2="10" y2="10" />
                <line x1="3" y1="10" x2="10" y2="10" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AnnotationToolbar

