import React, { useRef } from 'react'
import './AnnotationToolbar.css'

interface AnnotationToolbarProps {
  mode: 'textbox' | 'image' | 'select' | null
  onModeChange: (mode: 'textbox' | 'image' | 'select' | null) => void
  onImageUpload: (file: File) => void
  onDownload: () => void
}

const AnnotationToolbar: React.FC<AnnotationToolbarProps> = ({
  mode,
  onModeChange,
  onImageUpload,
  onDownload,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type.startsWith('image/')) {
      onImageUpload(file)
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }


  return (
    <div className="annotation-toolbar">
      <div className="toolbar-section">
        <button
          className={`toolbar-button ${mode === 'select' ? 'active' : ''}`}
          onClick={() => onModeChange('select')}
          title="Select mode (click to select annotations)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
          </svg>
          Select
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
          Text
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
          Image
        </button>
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
          Download
        </button>
      </div>
    </div>
  )
}

export default AnnotationToolbar

