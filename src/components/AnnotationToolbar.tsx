import React, { useRef, useState } from 'react'
import './AnnotationToolbar.css'

interface AnnotationToolbarProps {
  mode: 'textbox' | 'image' | 'select' | null
  onModeChange: (mode: 'textbox' | 'image' | 'select' | null) => void
  onImageUpload: (file: File) => void
  onDownload: () => void
  onClearAll?: () => void
}

const AnnotationToolbar: React.FC<AnnotationToolbarProps> = ({
  mode,
  onModeChange,
  onImageUpload,
  onDownload,
  onClearAll,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isConfirmingClear, setIsConfirmingClear] = useState(false)
  const clearTimeoutRef = useRef<NodeJS.Timeout | null>(null)

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


      <div className="toolbar-section toolbar-actions">
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

