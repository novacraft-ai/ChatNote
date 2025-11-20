import React, { useRef, useState } from 'react'
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
  onDownload: () => void
  onNewSession?: () => void
  onClearAll?: () => void
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
  onDownload,
  onNewSession,
  onClearAll,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isConfirmingClear, setIsConfirmingClear] = useState(false)
  const clearTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const highlightColors = [
    '#ffeb3b', // Yellow
    '#8bc34a', // Green
    '#03a9f4', // Blue
    '#e91e63', // Pink
    '#9c27b0', // Purple
  ]

  // Reset confirmation state when clicking outside
  React.useEffect(() => {
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
      <div className="toolbar-section">
        <button
          className={`toolbar-button ${isHighlightActive ? 'active' : ''}`}
          onClick={onHighlightClick}
          disabled={!hasTextSelection}
          title={hasTextSelection ? (isHighlightActive ? "Remove highlight" : "Highlight text") : "Select text to highlight"}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l-6 6v3h9l3-3" />
            <path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
          </svg>
        </button>
        <button
          className={`toolbar-button ${mode === 'textbox' ? 'active' : ''}`}
          onClick={() => onModeChange('textbox')}
          title="Add text box (click on PDF to add)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 20h16" />
            <path d="M6 4v16" />
            <path d="M18 4v16" />
            <path d="M4 7h16" />
            <path d="M4 10h16" />
            <path d="M4 13h16" />
            <path d="M4 16h16" />
          </svg>
          <span className="toolbar-button-text">Text</span>
        </button>
        <button
          className={`toolbar-button ${mode === 'image' ? 'active' : ''}`}
          onClick={() => {
            onModeChange('image')
            fileInputRef.current?.click()
          }}
          title="Add image (click to upload)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <span className="toolbar-button-text">Image</span>
        </button>
        {onClearAll && (
          <button
            className={`toolbar-button clear-button ${isConfirmingClear ? 'confirming' : ''}`}
            onClick={handleClearClick}
            title={isConfirmingClear ? "Click again to clear all annotations" : "Clear all annotations"}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            <span className="toolbar-button-text">Clear All</span>
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
              title="Select highlight color"
            />
          ))}
        </div>
      )}

      <div className="toolbar-section toolbar-actions">
        {onNewSession && (
          <button className="toolbar-button new-session-button" onClick={onNewSession} title="Start new session (save current and upload new PDF)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
            <span className="toolbar-button-text">New Session</span>
          </button>
        )}
        <button className="toolbar-button download-button" onClick={onDownload} title="Download annotated PDF">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span className="toolbar-button-text">Download</span>
        </button>
      </div>
    </div>
  )
}

export default AnnotationToolbar

