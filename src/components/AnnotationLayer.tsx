import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Annotation, TextBoxAnnotation, ImageAnnotation } from '../types/annotations'
import './AnnotationLayer.css'

interface AnnotationLayerProps {
  pageNumber: number
  pageWidth: number
  pageHeight: number
  scale: number
  annotations: Annotation[]
  selectedAnnotationId: string | null
  onAnnotationUpdate: (annotation: Annotation) => void
  onAnnotationDelete: (id: string) => void
  onAnnotationSelect: (id: string | null) => void
  mode: 'textbox' | 'image' | 'select' | null
}

const AnnotationLayer: React.FC<AnnotationLayerProps> = ({
  pageNumber,
  pageWidth,
  pageHeight,
  scale,
  annotations,
  selectedAnnotationId,
  onAnnotationUpdate,
  onAnnotationDelete,
  onAnnotationSelect,
  mode,
}) => {
  const layerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [isRotating, setIsRotating] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [resizeHandle, setResizeHandle] = useState<string | null>(null)
  const [resizeStart, setResizeStart] = useState<{
    x: number
    y: number
    width: number
    height: number
    annotationX: number
    annotationY: number
  } | null>(null)
  const [rotateStart, setRotateStart] = useState({ x: 0, y: 0, angle: 0 })
  const [editingText, setEditingText] = useState<string | null>(null)

  // Filter annotations for this page
  const pageAnnotations = annotations.filter((ann) => ann.pageNumber === pageNumber)

  // Convert relative coordinates (0-1) to pixel coordinates
  const toPixelX = (relX: number) => relX * pageWidth * scale
  const toPixelY = (relY: number) => relY * pageHeight * scale
  const toPixelWidth = (relWidth: number) => relWidth * pageWidth * scale
  const toPixelHeight = (relHeight: number) => relHeight * pageHeight * scale

  // Convert pixel coordinates to relative coordinates (0-1)
  const toRelativeX = (pixelX: number) => pixelX / (pageWidth * scale)
  const toRelativeY = (pixelY: number) => pixelY / (pageHeight * scale)

  // Constrain position and size within page bounds
  const constrainToPage = useCallback(
    (x: number, y: number, width: number, height: number) => {
      const maxX = 1 - width
      const maxY = 1 - height
      return {
        x: Math.max(0, Math.min(maxX, x)),
        y: Math.max(0, Math.min(maxY, y)),
        width: Math.max(0.01, Math.min(1, width)),
        height: Math.max(0.01, Math.min(1, height)),
      }
    },
    []
  )

  // Note: Text box creation and deselection are now handled by PDFViewer
  // since the annotation layer has pointer-events: none to allow text selection

  // Handle mouse down on annotation
  const handleAnnotationMouseDown = useCallback(
    (e: React.MouseEvent, annotation: Annotation) => {
      e.stopPropagation()
      
      // Check if clicking on resize handle
      const target = e.target as HTMLElement
      if (target.classList.contains('resize-handle')) {
        e.preventDefault()
        setIsResizing(true)
        setResizeHandle(target.dataset.handle || null)
        const rect = layerRef.current?.getBoundingClientRect()
        if (rect) {
          // Store initial mouse position and annotation state for smooth resizing
          setDragStart({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          })
          setResizeStart({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            width: annotation.width,
            height: annotation.height,
            annotationX: annotation.x,
            annotationY: annotation.y,
          })
        }
        return
      }

      // Check if clicking on rotate handle
      if (target.classList.contains('rotate-handle')) {
        e.preventDefault()
        setIsRotating(true)
        const rect = layerRef.current?.getBoundingClientRect()
        if (rect) {
          const centerX = toPixelX(annotation.x + annotation.width / 2)
          const centerY = toPixelY(annotation.y + annotation.height / 2)
          const startX = e.clientX - rect.left
          const startY = e.clientY - rect.top
          const startAngle = Math.atan2(startY - centerY, startX - centerX) * (180 / Math.PI)
          setRotateStart({ x: startX, y: startY, angle: annotation.rotation - startAngle })
        }
        return
      }

      // Check if clicking on delete button
      if (target.classList.contains('delete-button')) {
        e.preventDefault()
        onAnnotationDelete(annotation.id)
        return
      }

      // For all other clicks (including on image, textbox content, etc.), select and start dragging
      // Allow dragging regardless of mode when clicking on existing annotations
      e.preventDefault() // Prevent text selection and other default behaviors
      onAnnotationSelect(annotation.id)
      // Start dragging immediately
      setIsDragging(true)
      const rect = layerRef.current?.getBoundingClientRect()
      if (rect) {
        setDragStart({
          x: e.clientX - rect.left - toPixelX(annotation.x),
          y: e.clientY - rect.top - toPixelY(annotation.y),
        })
      }
    },
    [mode, toPixelX, toPixelY, onAnnotationSelect, onAnnotationDelete]
  )

  // Handle mouse move
  useEffect(() => {
    if (!isDragging && !isResizing && !isRotating) return

    const handleMouseMove = (e: MouseEvent) => {
      const rect = layerRef.current?.getBoundingClientRect()
      if (!rect) return

      const selectedAnnotation = pageAnnotations.find((ann) => ann.id === selectedAnnotationId)
      if (!selectedAnnotation) return

      if (isRotating) {
        const centerX = toPixelX(selectedAnnotation.x + selectedAnnotation.width / 2)
        const centerY = toPixelY(selectedAnnotation.y + selectedAnnotation.height / 2)
        const currentX = e.clientX - rect.left
        const currentY = e.clientY - rect.top
        const angle = Math.atan2(currentY - centerY, currentX - centerX) * (180 / Math.PI)
        const newRotation = (rotateStart.angle + angle) % 360
        onAnnotationUpdate({ ...selectedAnnotation, rotation: newRotation })
      } else if (isResizing && resizeHandle && resizeStart) {
        const currentX = e.clientX - rect.left
        const currentY = e.clientY - rect.top
        
        // Calculate pixel deltas
        const deltaXPixels = currentX - resizeStart.x
        const deltaYPixels = currentY - resizeStart.y
        
        // Convert to relative coordinates (0-1 scale) with smoothing factor
        // Use a smaller factor to reduce sensitivity (0.5 means half the sensitivity)
        const smoothingFactor = 0.5
        const deltaX = (deltaXPixels / (pageWidth * scale)) * smoothingFactor
        const deltaY = (deltaYPixels / (pageHeight * scale)) * smoothingFactor

        let newX = resizeStart.annotationX
        let newY = resizeStart.annotationY
        let newWidth = resizeStart.width
        let newHeight = resizeStart.height

        // Handle different resize handles
        if (resizeHandle.includes('n')) {
          // Resize from top - move Y up and reduce height
          newY = Math.max(0, resizeStart.annotationY + deltaY)
          newHeight = Math.max(0.01, resizeStart.height - deltaY)
        }
        if (resizeHandle.includes('s')) {
          // Resize from bottom - increase height
          newHeight = Math.max(0.01, resizeStart.height + deltaY)
        }
        if (resizeHandle.includes('w')) {
          // Resize from left - move X left and reduce width
          newX = Math.max(0, resizeStart.annotationX + deltaX)
          newWidth = Math.max(0.01, resizeStart.width - deltaX)
        }
        if (resizeHandle.includes('e')) {
          // Resize from right - increase width
          newWidth = Math.max(0.01, resizeStart.width + deltaX)
        }

        const constrained = constrainToPage(newX, newY, newWidth, newHeight)
        onAnnotationUpdate({ ...selectedAnnotation, ...constrained })
      } else if (isDragging) {
        const newX = toRelativeX(e.clientX - rect.left - dragStart.x)
        const newY = toRelativeY(e.clientY - rect.top - dragStart.y)
        const constrained = constrainToPage(newX, newY, selectedAnnotation.width, selectedAnnotation.height)
        onAnnotationUpdate({ ...selectedAnnotation, ...constrained })
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      setIsResizing(false)
      setIsRotating(false)
      setResizeHandle(null)
      setResizeStart(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, isResizing, isRotating, resizeHandle, resizeStart, dragStart, rotateStart, selectedAnnotationId, pageAnnotations, toPixelX, toPixelY, toPixelWidth, toPixelHeight, toRelativeX, toRelativeY, constrainToPage, onAnnotationUpdate, pageWidth, pageHeight, scale])

  // Handle keyboard delete
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedAnnotationId && (e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
          e.preventDefault()
          onAnnotationDelete(selectedAnnotationId)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedAnnotationId, onAnnotationDelete])

  // Render text box annotation
  const renderTextBox = (annotation: TextBoxAnnotation) => {
    const isSelected = annotation.id === selectedAnnotationId
    const pixelX = toPixelX(annotation.x)
    const pixelY = toPixelY(annotation.y)
    const pixelWidth = toPixelWidth(annotation.width)
    const pixelHeight = toPixelHeight(annotation.height)

    return (
      <div
        key={annotation.id}
        className={`annotation textbox-annotation ${isSelected ? 'selected' : ''}`}
        style={{
          left: `${pixelX}px`,
          top: `${pixelY}px`,
          maxWidth: `${pixelWidth}px`, // Use max-width instead of width
          maxHeight: `${pixelHeight}px`, // Use max-height instead of height
          transform: `rotate(${annotation.rotation}deg)`,
          transformOrigin: 'center center',
        }}
        onMouseDown={(e) => handleAnnotationMouseDown(e, annotation)}
      >
        {isSelected && (
          <>
            <button
              className="delete-button"
              onClick={(e) => {
                e.stopPropagation()
                onAnnotationDelete(annotation.id)
              }}
              title="Delete (or press Delete key)"
            >
              ×
            </button>
            {/* Removed nw (top-left) resize handle to avoid conflict with delete button */}
            <div className="resize-handle" data-handle="ne" />
            <div className="resize-handle" data-handle="sw" />
            <div className="resize-handle" data-handle="se" />
            <div className="resize-handle" data-handle="n" />
            <div className="resize-handle" data-handle="s" />
            <div className="resize-handle" data-handle="w" />
            <div className="resize-handle" data-handle="e" />
            <div className="rotate-handle" />
          </>
        )}
        {editingText === annotation.id ? (
          <textarea
            className="textbox-input"
            value={annotation.text}
            onChange={(e) => {
              onAnnotationUpdate({ ...annotation, text: e.target.value })
            }}
            onBlur={() => setEditingText(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                setEditingText(null)
              }
              if (e.key === 'Escape') {
                setEditingText(null)
              }
            }}
            style={{
              fontSize: `${annotation.fontSize}px`,
              color: annotation.color,
            }}
            autoFocus
          />
        ) : (
          <div
            className="textbox-content"
            onClick={(e) => {
              e.stopPropagation()
              setEditingText(annotation.id)
            }}
            style={{
              fontSize: `${annotation.fontSize}px`,
              color: annotation.color,
            }}
          >
            {annotation.text || 'Text'}
          </div>
        )}
      </div>
    )
  }

  // Render image annotation
  const renderImage = (annotation: ImageAnnotation) => {
    const isSelected = annotation.id === selectedAnnotationId
    const pixelX = toPixelX(annotation.x)
    const pixelY = toPixelY(annotation.y)
    const containerWidth = toPixelWidth(annotation.width)
    const containerHeight = toPixelHeight(annotation.height)
    
    // Calculate actual rendered image size with object-fit: contain
    // The image maintains its aspect ratio and fits within the container
    const imageAspectRatio = annotation.imageWidth / annotation.imageHeight
    const containerAspectRatio = containerWidth / containerHeight
    
    let actualImageWidth: number
    let actualImageHeight: number
    
    if (imageAspectRatio > containerAspectRatio) {
      // Image is wider - it fills the container width
      actualImageWidth = containerWidth
      actualImageHeight = containerWidth / imageAspectRatio
    } else {
      // Image is taller - it fills the container height
      actualImageHeight = containerHeight
      actualImageWidth = containerHeight * imageAspectRatio
    }

    return (
      <div
        key={annotation.id}
        className={`annotation image-annotation ${isSelected ? 'selected' : ''}`}
        style={{
          left: `${pixelX}px`,
          top: `${pixelY}px`,
          width: `${actualImageWidth}px`, // Use actual rendered image width
          height: `${actualImageHeight}px`, // Use actual rendered image height
          transform: `rotate(${annotation.rotation}deg)`,
          transformOrigin: 'center center',
        }}
        onMouseDown={(e) => handleAnnotationMouseDown(e, annotation)}
      >
        {isSelected && (
          <>
            <button
              className="delete-button"
              onClick={(e) => {
                e.stopPropagation()
                onAnnotationDelete(annotation.id)
              }}
              title="Delete (or press Delete key)"
            >
              ×
            </button>
            {/* Removed nw (top-left) resize handle to avoid conflict with delete button */}
            <div className="resize-handle" data-handle="ne" />
            <div className="resize-handle" data-handle="sw" />
            <div className="resize-handle" data-handle="se" />
            <div className="resize-handle" data-handle="n" />
            <div className="resize-handle" data-handle="s" />
            <div className="resize-handle" data-handle="w" />
            <div className="resize-handle" data-handle="e" />
            <div className="rotate-handle" />
          </>
        )}
        <img 
          src={annotation.imageData} 
          alt="Annotation" 
          draggable={false}
        />
      </div>
    )
  }

  const layerWidth = pageWidth * scale
  const layerHeight = pageHeight * scale
  // Use pointer-events: none on the layer itself to allow text selection
  // Individual annotations will have pointer-events: auto
  const layerStyle: React.CSSProperties = {
    width: `${layerWidth}px`,
    height: `${layerHeight}px`,
    pointerEvents: 'none', // Allow pointer events to pass through to PDF text layer
  }

  return (
    <div
      ref={layerRef}
      className="annotation-layer"
      style={layerStyle}
      // Note: onClick is removed because pointer-events: none prevents it from firing
      // Text box creation and deselection are handled by PDFViewer
    >
      {pageAnnotations.map((annotation) => {
        if (annotation.type === 'textbox') {
          return renderTextBox(annotation)
        } else if (annotation.type === 'image') {
          return renderImage(annotation)
        }
        return null
      })}
    </div>
  )
}

export default AnnotationLayer

