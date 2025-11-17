import React, { useState, useEffect, useRef, useCallback } from 'react'
import { KnowledgeNote } from '../types/knowledgeNotes'
import './KnowledgeNotesPanel.css'

interface KnowledgeNotesPanelProps {
  notes: KnowledgeNote[]
  onDeleteNote: (id: string) => void
  onClearAllNotes?: () => void
  onScrollToPage?: (pageNumber: number) => void
  onHighlightText?: (text: string) => void
  layout: 'floating' | 'split'
  theme: 'light' | 'dark'
  onNoteClick?: (note: KnowledgeNote) => void
  isVisible?: boolean
  onClose?: () => void
  pdfContentRef?: React.RefObject<HTMLDivElement> // For scroll sync
}

const KnowledgeNotesPanel: React.FC<KnowledgeNotesPanelProps> = ({
  notes,
  onDeleteNote,
  onClearAllNotes,
  onScrollToPage,
  onHighlightText,
  layout,
  theme,
  onNoteClick,
  isVisible = true,
  onClose,
  pdfContentRef,
}) => {
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set())
  const notesListRef = useRef<HTMLDivElement>(null)
  const [pdfContentHeight, setPdfContentHeight] = useState<number>(0)
  const [notePositions, setNotePositions] = useState<Map<string, number>>(new Map())
  const [displayMode, setDisplayMode] = useState<'following' | 'stack'>('following')
  const [showConfirmDialog, setShowConfirmDialog] = useState<boolean>(false)
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null)
  const [frontNoteId, setFrontNoteId] = useState<string | null>(null) // Track which note is brought to front

  // Handle Escape key to close confirmation dialog
  useEffect(() => {
    if (!showConfirmDialog) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowConfirmDialog(false)
        setNoteToDelete(null)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showConfirmDialog])

  // Toggle expand/collapse for a note
  const toggleExpand = useCallback((noteId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setExpandedNotes((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(noteId)) {
        newSet.delete(noteId)
      } else {
        newSet.add(noteId)
      }
      return newSet
    })
  }, [])

  // Update notes list height to match PDF content scroll height
  // And sync scroll position so notes scroll with PDF using the same scrollbar
  useEffect(() => {
    const getPdfContentRef = () => {
      if (pdfContentRef?.current) {
        return pdfContentRef.current
      }
      return (window as any).__pdfContentRef || null
    }

    const updateHeight = () => {
      const pdfContent = getPdfContentRef()
      if (pdfContent && notesListRef.current) {
        // Set the notes list height to match PDF content scroll height (only in following mode)
        // This allows notes to be positioned at the same Y coordinates as PDF content
        const scrollHeight = pdfContent.scrollHeight
        setPdfContentHeight(scrollHeight)
        if (displayMode === 'following') {
          notesListRef.current.style.height = `${scrollHeight}px`
        } else {
          notesListRef.current.style.height = 'auto'
        }
        
        // Sync scroll position: move notes list to match PDF scroll (only in following mode)
        // Since notes are absolutely positioned, we use transform to move them
        if (displayMode === 'following') {
          const scrollTop = pdfContent.scrollTop
          notesListRef.current.style.transform = `translateY(-${scrollTop}px)`
        } else {
          notesListRef.current.style.transform = 'none'
        }
      }
    }

    // Initial update
    updateHeight()

    // Update when PDF content changes (pages load, zoom changes, etc.)
    const pdfContent = getPdfContentRef()
    if (pdfContent) {
      // Sync scroll position when PDF scrolls (only in following mode)
      const handleScroll = () => {
        if (notesListRef.current && displayMode === 'following') {
          const scrollTop = pdfContent.scrollTop
          notesListRef.current.style.transform = `translateY(-${scrollTop}px)`
        } else if (notesListRef.current && displayMode === 'stack') {
          // Reset transform in stack mode
          notesListRef.current.style.transform = 'none'
        }
      }
      pdfContent.addEventListener('scroll', handleScroll, { passive: true })

      // Use ResizeObserver to watch for PDF content size changes
      const resizeObserver = new ResizeObserver(() => {
        updateHeight()
      })
      resizeObserver.observe(pdfContent)

      // Also update periodically to catch any missed changes
      const interval = setInterval(updateHeight, 1000)

      return () => {
        clearInterval(interval)
        pdfContent.removeEventListener('scroll', handleScroll)
        resizeObserver.disconnect()
      }
    }

    // Also update when notes change
    const timeout = setTimeout(updateHeight, 100)
    return () => clearTimeout(timeout)
  }, [pdfContentRef, isVisible, notes.length, displayMode])

  // Handle note click
  const handleNoteClick = (note: KnowledgeNote) => {
    if (note.pageNumber && onScrollToPage) {
      onScrollToPage(note.pageNumber)
      // Small delay to ensure page has scrolled before highlighting
      setTimeout(() => {
        if (note.linkedText && onHighlightText) {
          onHighlightText(note.linkedText)
        }
      }, 500)
    } else if (note.linkedText && onHighlightText) {
      onHighlightText(note.linkedText)
    }
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // Calculate note positions for all notes
  const calculateNotePositions = useCallback(() => {
    const pdfContent = pdfContentRef?.current || (window as any).__pdfContentRef
    if (!pdfContent) {
      return
    }

    const newPositions = new Map<string, number>()

    notes.forEach((note) => {
      if (!note.pageNumber || note.textYPosition === undefined) {
        return
      }

      // Find the page wrapper element
      const pageWrappers = pdfContent.querySelectorAll('.pdf-page-wrapper')
      if (pageWrappers.length < note.pageNumber) {
        // Fallback to react-pdf__Page if pdf-page-wrapper not found
        const pageElements = pdfContent.querySelectorAll('.react-pdf__Page')
        if (pageElements.length < note.pageNumber) return
        const pageElement = pageElements[note.pageNumber - 1] as HTMLElement
        if (!pageElement) return
        
        const pageTop = pageElement.offsetTop
        const pageHeight = pageElement.offsetHeight
        const absoluteY = pageTop + (note.textYPosition * pageHeight)
        newPositions.set(note.id, absoluteY)
        return
      }

      const pageWrapper = pageWrappers[note.pageNumber - 1] as HTMLElement
      if (!pageWrapper) return
      
      // Calculate absolute position relative to PDF content container
      const pageTop = pageWrapper.offsetTop
      const pageHeight = pageWrapper.offsetHeight
      
      // Calculate the Y position of the text within the page
      const textYInPage = note.textYPosition * pageHeight
      
      // Absolute Y position = page top + text Y within page
      const absoluteY = pageTop + textYInPage
      
      newPositions.set(note.id, absoluteY)
    })

    setNotePositions(newPositions)
  }, [notes, pdfContentRef])

  // Recalculate positions when PDF content changes
  useEffect(() => {
    calculateNotePositions()
    
    const pdfContent = pdfContentRef?.current || (window as any).__pdfContentRef
    if (pdfContent) {
      // Recalculate when PDF content is resized (zoom, pages load, etc.)
      const resizeObserver = new ResizeObserver(() => {
        calculateNotePositions()
      })
      resizeObserver.observe(pdfContent)

      // Also recalculate periodically to catch any missed changes
      const interval = setInterval(calculateNotePositions, 500)

      return () => {
        resizeObserver.disconnect()
        clearInterval(interval)
      }
    }
  }, [calculateNotePositions, pdfContentRef, isVisible])

  // Recalculate note positions when PDF content height changes
  useEffect(() => {
    if (pdfContentHeight > 0) {
      // Small delay to ensure PDF pages are rendered
      const timeout = setTimeout(() => {
        calculateNotePositions()
      }, 200)
      return () => clearTimeout(timeout)
    }
  }, [pdfContentHeight, calculateNotePositions])

  // When a new note is added, ensure it doesn't change the front note
  // New notes should appear at the back of their stack
  useEffect(() => {
    if (notes.length === 0) {
      setFrontNoteId(null)
      return
    }

    // When notes change, check if frontNoteId is still valid
    const frontNoteExists = notes.some((n) => n.id === frontNoteId)
    if (frontNoteId && !frontNoteExists) {
      // Front note was deleted, clear it
      setFrontNoteId(null)
    }
    
    // If no front note is set and there are notes, don't auto-set one
    // This ensures new notes appear at the back (highest displayIndex)
  }, [notes, frontNoteId])

  // Get note position from the calculated positions map
  const getNotePosition = (note: KnowledgeNote): number | undefined => {
    return notePositions.get(note.id)
  }

  // Group notes by position to handle overlapping notes (like Apple Wallet cards)
  const getNoteStackInfo = (note: KnowledgeNote, allNotes: KnowledgeNote[]): { stackIndex: number; stackSize: number; basePosition: number; displayIndex: number } => {
    const notePosition = getNotePosition(note)
    if (notePosition === undefined) {
      return { stackIndex: 0, stackSize: 1, basePosition: 0, displayIndex: 0 }
    }

    // Find all notes at the same position (within 10px threshold)
    const positionThreshold = 10
    const samePositionNotes = allNotes.filter((n) => {
      const pos = getNotePosition(n)
      return pos !== undefined && Math.abs(pos - notePosition) < positionThreshold
    }).sort((a, b) => {
      // Sort by creation time (older notes first) for consistent ordering
      // Newer notes will have higher indices (at the back)
      return a.createdAt - b.createdAt
    })

    const originalStackIndex = samePositionNotes.findIndex((n) => n.id === note.id)
    const stackSize = samePositionNotes.length

    // Find the base position (lowest position in the stack)
    const basePosition = Math.min(...samePositionNotes.map((n) => getNotePosition(n) || 0))

    // Calculate display index based on front note rotation
    // New notes (highest originalStackIndex) should always be at the back (highest displayIndex)
    let displayIndex = originalStackIndex
    if (stackSize > 1 && frontNoteId) {
      const frontNoteIndex = samePositionNotes.findIndex((n) => n.id === frontNoteId)
      if (frontNoteIndex !== -1) {
        // Rotate: front note becomes index 0, others shift
        // But ensure newer notes (higher originalStackIndex) are always at the back
        
        // Count how many notes are newer than this note
        const newerNotesCount = samePositionNotes.filter((_, idx) => 
          idx > originalStackIndex
        ).length
        
        if (originalStackIndex > frontNoteIndex) {
          // This note is newer than the front note
          // Place it at the back: stackSize - 1 - (number of notes newer than this)
          // This ensures the newest note gets the highest displayIndex
          displayIndex = stackSize - 1 - newerNotesCount
        } else {
          // This note is older than or equal to the front note
          // Use rotation formula, but ensure it doesn't conflict with newer notes at the back
          const baseDisplayIndex = (originalStackIndex - frontNoteIndex + stackSize) % stackSize
          // Count notes newer than front note
          const newerThanFrontCount = samePositionNotes.filter((_, idx) => 
            idx > frontNoteIndex
          ).length
          // Older notes should be in positions 0 to (stackSize - 1 - newerThanFrontCount)
          // So cap the displayIndex to ensure newer notes can be at the back
          displayIndex = Math.min(baseDisplayIndex, stackSize - 1 - newerThanFrontCount)
        }
      }
    } else if (stackSize > 1) {
      // If no front note is set, the oldest note (index 0) should be at front
      // Newest note (highest index) should be at back
      // So displayIndex = originalStackIndex (no rotation needed)
      displayIndex = originalStackIndex
    }

    return { stackIndex: originalStackIndex, stackSize, basePosition, displayIndex }
  }

  return (
    <div className={`knowledge-notes-panel ${layout}-layout theme-${theme} ${isVisible ? 'knowledge-notes-visible' : ''}`}>
      <div className="knowledge-notes-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h3>Knowledge Notes</h3>
          <button
            className="display-mode-toggle"
            onClick={() => setDisplayMode(displayMode === 'following' ? 'stack' : 'following')}
            title={displayMode === 'following' ? 'Switch to stack mode' : 'Switch to following mode'}
            style={{
              background: 'transparent',
              border: '1px solid rgba(0, 0, 0, 0.2)',
              borderRadius: '4px',
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: '12px',
              color: 'inherit',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {displayMode === 'following' ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
                Following
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="9" y1="9" x2="15" y2="9" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                </svg>
                Stack
              </>
            )}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            className="notes-count-button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (notes.length > 0) {
                setNoteToDelete(null)
                setShowConfirmDialog(true)
              }
            }}
            title={notes.length > 0 ? 'Clear all notes' : 'No notes to clear'}
            disabled={notes.length === 0}
          >
            <span className="notes-count-text">{notes.length}</span>
            <svg className="notes-count-clear-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          {/* Close button */}
          <button
            className="knowledge-notes-close"
            onClick={(e) => {
              e.stopPropagation()
              onClose?.()
            }}
            aria-label="Close knowledge notes"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              transition: 'background 0.2s, color 0.2s',
              // Color is handled by CSS for proper theme support
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      <div 
        className={`knowledge-notes-list ${displayMode === 'stack' ? 'stack-mode' : 'following-mode'}`} 
        ref={notesListRef} 
        style={{ 
          height: displayMode === 'following' && pdfContentHeight > 0 ? `${pdfContentHeight}px` : 'auto',
          overflow: displayMode === 'stack' ? 'auto' : 'visible'
        }}
      >
        {notes.length === 0 ? (
          <div className="empty-notes">No knowledge notes yet</div>
        ) : (
          notes.map((note) => {
            const isExpanded = expandedNotes.has(note.id)
            const notePosition = getNotePosition(note)
            const contentLines = note.content ? note.content.split('\n') : []
            // Check if content needs expand button (more than 3 lines OR more than 200 chars)
            const needsExpand = contentLines.length > 3 || (note.content && note.content.length > 200)

            const isFrontNote = frontNoteId === note.id
            const stackInfo = getNoteStackInfo(note, notes)
            
            // Calculate stacking offsets (like Apple Wallet cards)
            const stackOffset = 8 // Vertical offset per card
            const rotationOffset = 1.5 // Rotation in degrees per card
            const horizontalOffset = 2 // Horizontal offset per card
            
            // Use displayIndex for visual positioning (rotated based on front note)
            // displayIndex 0 is the front card (no offset/rotation)
            // displayIndex 1, 2, 3... are behind with increasing offsets
            // Newest cards (highest originalStackIndex) should have the most clockwise rotation
            const verticalOffset = stackInfo.displayIndex * stackOffset
            const horizontalShift = stackInfo.displayIndex * horizontalOffset
            
            // Calculate rotation: cards further back get more clockwise rotation
            // The newest card (highest originalStackIndex) should always have maximum rotation
            const maxDisplayIndex = stackInfo.stackSize - 1
            const isNewestCard = stackInfo.stackIndex === stackInfo.stackSize - 1
            const maxRotation = maxDisplayIndex * rotationOffset
            
            // If this is the newest card, it should have maximum clockwise rotation
            // Otherwise, use rotation based on displayIndex
            const rotation = isNewestCard ? maxRotation : stackInfo.displayIndex * rotationOffset
            
            // Front note (displayIndex 0) should be on top with no rotation/offset
            const finalTop = notePosition !== undefined 
              ? (stackInfo.displayIndex === 0 ? notePosition : notePosition + verticalOffset)
              : undefined
            // Apply rotation: front card has no rotation, newest card has maximum clockwise rotation
            const finalRotation = stackInfo.displayIndex === 0 ? 0 : rotation
            const finalHorizontalShift = stackInfo.displayIndex === 0 ? 0 : horizontalShift
            
            return (
              <div
                key={note.id}
                className={`knowledge-note-item ${isFrontNote ? 'note-front' : ''} ${stackInfo.stackSize > 1 ? 'note-stacked' : ''}`}
                onClick={(e) => {
                  // Only handle click on the note card itself, not on buttons or clickable elements inside
                  const target = e.target as HTMLElement
                  if (target.closest('button') || target.closest('.note-linked-text')) {
                    return
                  }
                  // Rotate the stack: bring clicked note to front (rotation effect)
                  if (displayMode === 'following' && stackInfo.stackSize > 1) {
                    // If clicking a note that's not already in front, rotate it to front
                    if (frontNoteId !== note.id) {
                      setFrontNoteId(note.id)
                    } else {
                      // If clicking the front note, rotate to next note in stack
                      const samePositionNotes = notes.filter((n) => {
                        const pos = getNotePosition(n)
                        const notePos = getNotePosition(note)
                        return pos !== undefined && notePos !== undefined && 
                               Math.abs(pos - notePos) < 10
                      }).sort((a, b) => a.createdAt - b.createdAt)
                      
                      const currentIndex = samePositionNotes.findIndex((n) => n.id === note.id)
                      const nextIndex = (currentIndex + 1) % samePositionNotes.length
                      setFrontNoteId(samePositionNotes[nextIndex].id)
                    }
                  } else if (displayMode === 'following') {
                    // Single note or not in a stack, just set as front
                    setFrontNoteId(note.id)
                  }
                }}
                style={
                  displayMode === 'following' && finalTop !== undefined 
                    ? { 
                        position: 'absolute', 
                        top: `${finalTop}px`, 
                        left: `${8 + finalHorizontalShift}px`, 
                        right: `${8 - finalHorizontalShift}px`, 
                        width: 'auto', 
                        zIndex: stackInfo.displayIndex === 0 ? 20 + stackInfo.stackSize : 10 + stackInfo.displayIndex, // Front note (displayIndex 0) gets highest z-index
                        pointerEvents: 'auto', // Ensure notes are clickable
                        transform: `rotate(${finalRotation}deg)`,
                        transformOrigin: 'center top',
                        transition: 'transform 0.3s ease, z-index 0.2s ease, top 0.3s ease, left 0.3s ease, right 0.3s ease',
                        boxShadow: stackInfo.displayIndex === 0 
                          ? '0 4px 16px rgba(0, 0, 0, 0.15)' 
                          : `0 ${2 + stackInfo.displayIndex}px ${8 + stackInfo.displayIndex * 2}px rgba(0, 0, 0, ${0.1 + stackInfo.displayIndex * 0.02})`
                      } 
                    : { 
                        position: 'relative',
                        marginBottom: '12px', // Add spacing for notes
                        marginLeft: '8px',
                        marginRight: '8px',
                        width: 'auto'
                      }
                }
              >
                <div className="note-header">
                  <div className="note-meta">
                    {note.pageNumber && (
                      <span className="note-page-badge">Page {note.pageNumber}</span>
                    )}
                    {note.linkedText && (
                      <span className="note-text-badge">Linked Text</span>
                    )}
                    <span className="note-date">{formatDate(note.createdAt)}</span>
                  </div>
                  <button
                    className="note-delete-button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setNoteToDelete(note.id)
                      setShowConfirmDialog(true)
                    }}
                    title="Delete note"
                  >
                    ×
                  </button>
                </div>
                {note.linkedText && (
                  <div className="note-linked-text" onClick={() => {
                    handleNoteClick(note)
                    onNoteClick?.(note)
                  }}>
                    "{note.linkedText.substring(0, 100)}{note.linkedText.length > 100 ? '...' : ''}"
                  </div>
                )}
                <div className="note-content-wrapper">
                  <div 
                    className={`note-content ${isExpanded ? 'expanded' : 'collapsed'}`}
                  >
                    {note.content}
                  </div>
                  {needsExpand && (
                    <button
                      className="note-expand-button"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        toggleExpand(note.id, e)
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation()
                      }}
                      title={isExpanded ? 'Collapse' : 'Expand'}
                      type="button"
                    >
                      {isExpanded ? (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="18 15 12 9 6 15" />
                          </svg>
                          <span>Show Less</span>
                        </>
                      ) : (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                          <span>Show More</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
      {showConfirmDialog && (
        <div className="confirm-dialog-overlay" onClick={() => {
          setShowConfirmDialog(false)
          setNoteToDelete(null)
        }}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-dialog-header">
              <h3>{noteToDelete ? 'Delete Note' : 'Clear All Notes'}</h3>
            </div>
            <div className="confirm-dialog-content">
              {noteToDelete ? (
                <>
                  <p>
                    Are you sure you want to delete this knowledge note?
                  </p>
                  <p className="confirm-dialog-warning">This action cannot be undone.</p>
                </>
              ) : (
                <>
                  <p>
                    Are you sure you want to delete all <strong>{notes.length}</strong> knowledge note{notes.length === 1 ? '' : 's'}?
                  </p>
                  <p className="confirm-dialog-warning">This action cannot be undone.</p>
                </>
              )}
            </div>
            <div className="confirm-dialog-actions">
              <button
                className="confirm-dialog-button confirm-dialog-button-cancel"
                onClick={() => {
                  setShowConfirmDialog(false)
                  setNoteToDelete(null)
                }}
              >
                Cancel
              </button>
              <button
                className="confirm-dialog-button confirm-dialog-button-confirm"
                onClick={() => {
                  if (noteToDelete) {
                    onDeleteNote(noteToDelete)
                    setNoteToDelete(null)
                  } else if (onClearAllNotes) {
                    onClearAllNotes()
                  }
                  setShowConfirmDialog(false)
                }}
              >
                {noteToDelete ? 'Delete' : 'Clear All'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default KnowledgeNotesPanel
