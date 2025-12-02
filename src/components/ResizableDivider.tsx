import { useState, useEffect, useRef } from 'react'
import './ResizableDivider.css'

interface ResizableDividerProps {
  onResize: (width: number) => void
  initialWidth: number
  minWidth: number
  maxWidth: number
  modelMode: 'auto' | 'reasoning' | 'advanced'
  onDragStateChange?: (isDragging: boolean) => void
}

const ResizableDivider: React.FC<ResizableDividerProps> = ({
  onResize,
  initialWidth,
  minWidth,
  maxWidth,
  modelMode,
  onDragStateChange,
}) => {
  const [isDragging, setIsDragging] = useState(false)
  const [isHovering, setIsHovering] = useState(false)
  const startXRef = useRef<number>(0)
  const startWidthRef = useRef<number>(initialWidth)

  // Get color based on model mode
  const getModelColor = () => {
    switch (modelMode) {
      case 'auto':
        return '#4285f4' // Blue
      case 'reasoning':
        return '#9c27b0' // Purple
      case 'advanced':
        return '#4caf50' // Green
      default:
        return '#4285f4'
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    onDragStateChange?.(true)
    startXRef.current = e.clientX
    startWidthRef.current = initialWidth
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current
      const newWidth = startWidthRef.current - delta // Subtract because chat is on right
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth))
      onResize(clampedWidth)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      onDragStateChange?.(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, minWidth, maxWidth, onResize, onDragStateChange])

  return (
    <div
      className={`resizable-divider ${isDragging ? 'dragging' : ''} ${isHovering ? 'hovering' : ''}`}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      style={{
        '--model-color': getModelColor(),
      } as React.CSSProperties}
    >
      <div className="divider-handle">
        <div className="divider-grip"></div>
        <div className="divider-grip"></div>
        <div className="divider-grip"></div>
      </div>
    </div>
  )
}

export default ResizableDivider
