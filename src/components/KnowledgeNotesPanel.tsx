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

  // Get note position from the calculated positions map
  const getNotePosition = (note: KnowledgeNote): number | undefined => {
    return notePositions.get(note.id)
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
          {/* Close button for mobile drawer */}
          <button
            className="knowledge-notes-close"
            onClick={(e) => {
              e.stopPropagation()
              onClose?.()
            }}
            aria-label="Close knowledge notes"
            style={{
              display: 'none', // Hidden by default, shown on mobile via CSS
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
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
            return (
              <div
                key={note.id}
                className={`knowledge-note-item ${isFrontNote ? 'note-front' : ''}`}
                onClick={(e) => {
                  // Only handle click on the note card itself, not on buttons or clickable elements inside
                  const target = e.target as HTMLElement
                  if (target.closest('button') || target.closest('.note-linked-text')) {
                    return
                  }
                  // Bring this note to front when clicked
                  if (displayMode === 'following') {
                    setFrontNoteId(note.id)
                  }
                }}
                style={
                  displayMode === 'following' && notePosition !== undefined 
                    ? { 
                        position: 'absolute', 
                        top: `${notePosition}px`, 
                        left: '8px', 
                        right: '8px', 
                        width: 'auto', 
                        zIndex: isFrontNote ? 20 : 10, // Front note gets higher z-index
                        pointerEvents: 'auto', // Ensure notes are clickable
                        transition: 'z-index 0.2s ease' // Smooth transition
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
