import { useState, useRef, useEffect, useCallback } from 'react'
import './ModelModeToggle.css'

export type ModelMode = 'auto' | 'reasoning' | 'advanced'

interface ModelModeToggleProps {
  mode: ModelMode
  onModeChange: (mode: ModelMode) => void
  disabled?: boolean
}

export default function ModelModeToggle({
  mode,
  onModeChange,
  disabled = false
}: ModelModeToggleProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [dragStartX, setDragStartX] = useState(0)
  const [hasMoved, setHasMoved] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const toggleRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLDivElement>(null)

  const modes: ModelMode[] = ['auto', 'reasoning', 'advanced']
  const modeLabels = {
    auto: 'Auto',
    reasoning: 'Reasoning',
    advanced: 'Advanced'
  }
  const modeDescriptions = {
    auto: 'ChatNote will choose the best model automatically - best for daily use',
    reasoning: 'Uses advanced reasoning models for complex problems with thinking process',
    advanced: 'Most capable model for challenging tasks that need real-time information (limited usage)'
  }

  // Calculate button position based on mode
  const getButtonPosition = useCallback(() => {
    const modeIndex = modes.indexOf(mode)
    const toggleWidth = toggleRef.current?.offsetWidth || 80
    const buttonWidth = buttonRef.current?.offsetWidth || 20
    // Account for padding (2px on each side = 4px total)
    const padding = 4
    const trackWidth = toggleWidth - padding - buttonWidth
    const segmentWidth = trackWidth / (modes.length - 1)
    return modeIndex * segmentWidth
  }, [mode])

  // Handle mouse down - start drag
  const handleMouseDown = (e: React.MouseEvent) => {
    if (disabled) return
    
    setIsDragging(true)
    setHasMoved(false)
    setDragStartX(e.clientX)
    
    e.preventDefault()
      e.stopPropagation()
  }

  // Handle mouse move - update drag position
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || disabled) return

    const deltaX = e.clientX - dragStartX
    
    // Track if mouse has moved significantly (more than 3px) to distinguish drag from click
    if (Math.abs(deltaX) > 3) {
      setHasMoved(true)
    }

    const toggleWidth = toggleRef.current?.offsetWidth || 80
    const buttonWidth = buttonRef.current?.offsetWidth || 20
    const padding = 4
    const trackWidth = toggleWidth - padding - buttonWidth
    const segmentWidth = trackWidth / (modes.length - 1)

    // Calculate which segment we're in
    const toggleRect = toggleRef.current?.getBoundingClientRect()
    if (!toggleRect) return
    const relativeX = e.clientX - toggleRect.left - padding / 2 - buttonWidth / 2
    const segmentIndex = Math.round(relativeX / segmentWidth)
    const clampedIndex = Math.max(0, Math.min(modes.length - 1, segmentIndex))
    const newMode = modes[clampedIndex]

    if (newMode !== mode) {
      onModeChange(newMode)
    }
  }, [isDragging, disabled, dragStartX, mode, onModeChange])

  // Handle mouse up - end drag
  const handleMouseUp = useCallback(() => {
    if (!isDragging) return
    
    setIsDragging(false)
    
    // If no significant movement, treat as click and cycle to next mode
    if (!hasMoved) {
      const currentIndex = modes.indexOf(mode)
      const nextIndex = (currentIndex + 1) % modes.length
      onModeChange(modes[nextIndex])
    }
  }, [isDragging, hasMoved, mode, onModeChange])

  // Set up global mouse event listeners for dragging
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  // Handle click on toggle track (not button)
  const handleTrackClick = (e: React.MouseEvent) => {
    if (disabled || isDragging) return
    
    const toggleRect = toggleRef.current?.getBoundingClientRect()
    if (!toggleRect) return
    
    const clickX = e.clientX - toggleRect.left
    const toggleWidth = toggleRect.width
    const buttonWidth = buttonRef.current?.offsetWidth || 20
    const padding = 4
    const trackWidth = toggleWidth - padding - buttonWidth
    const segmentWidth = trackWidth / (modes.length - 1)
    
    // Calculate which segment was clicked
    const relativeX = clickX - padding / 2 - buttonWidth / 2
    const segmentIndex = Math.round(relativeX / segmentWidth)
    const clampedIndex = Math.max(0, Math.min(modes.length - 1, segmentIndex))
    const newMode = modes[clampedIndex]
    
    if (newMode !== mode) {
      onModeChange(newMode)
    }
  }

  const buttonPosition = getButtonPosition()

  return (
    <div className="model-mode-toggle-wrapper">
    <div
      ref={toggleRef}
        className={`model-mode-toggle ${mode} ${disabled ? 'disabled' : ''} ${isDragging ? 'dragging' : ''}`}
      onMouseDown={handleMouseDown}
        onClick={handleTrackClick}
    >
        <div className="model-mode-toggle-track">
          <div
        ref={buttonRef}
        className="model-mode-toggle-button"
            style={{ 
              transform: `translateX(${buttonPosition}px)`,
              transition: isDragging ? 'none' : 'transform 0.3s ease'
            }}
          />
        </div>
      </div>
      <div className="model-mode-toggle-label">{modeLabels[mode]}</div>
      <div 
        className="model-mode-info-icon-wrapper"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <svg 
          className="model-mode-info-icon" 
          width="14" 
          height="14" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        {showTooltip && (
          <div className="model-mode-tooltip">
            {modeDescriptions[mode]}
          </div>
        )}
      </div>
    </div>
  )
}
