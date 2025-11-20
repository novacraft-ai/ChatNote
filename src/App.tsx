import { useState, lazy, Suspense, useEffect, useMemo, useCallback, useRef } from 'react'
import { ThemeProvider, useTheme } from './contexts/ThemeContext'
import { AuthProvider } from './contexts/AuthContext'
import { ChatVisibilityProvider, useChatVisibility } from './contexts/ChatVisibilityContext'
import { SaveProvider } from './contexts/SaveContext'
import { sendChatMessage } from './services/authenticatedChatService'
import NavBar from './components/NavBar'
import ChatGPTEmbedded from './components/ChatGPTEmbedded'
import ErrorBoundary from './components/ErrorBoundary'
import KnowledgeNotesPanel from './components/KnowledgeNotesPanel'
import PDFHistoryPanel, { invalidatePDFHistoryCache, prefetchPDFHistory, markPDFHistoryNeedsRefresh } from './components/PDFHistoryPanel'
import { extractTextFromPDF } from './utils/pdfTextExtractor'
import { KnowledgeNote } from './types/knowledgeNotes'
import { COMMON_COLORS, TextBoxAnnotation, Annotation } from './types/annotations'
import { useAuth } from './contexts/AuthContext'
import { BACKEND_URL, AUTO_MODELS } from './config'
import DriveSyncPrompt from './components/DriveSyncPrompt'
import Toast from './components/Toast'
import './App.css'

const PDFViewer = lazy(() => import('./components/PDFViewer'))

type ChatLayout = 'floating' | 'split'

function AppContent() {
  const { theme } = useTheme()
  const { isChatVisible, setChatVisible } = useChatVisibility()
  const { isAuthenticated, user } = useAuth()
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfText, setPdfText] = useState<string>('')
  const [selectedText, setSelectedText] = useState<string>('')
  const [chatLayout, setChatLayout] = useState<ChatLayout>('floating')
  const [currentPageNumber, setCurrentPageNumber] = useState<number>(1)
  const [knowledgeNotes, setKnowledgeNotes] = useState<KnowledgeNote[]>([])
  const [showKnowledgeNotes, setShowKnowledgeNotes] = useState<boolean>(false) // Default to collapsed
  const [lastSelectedTextPosition, setLastSelectedTextPosition] = useState<{ text: string; pageNumber: number; textYPosition: number } | null>(null)
  const [showHistory, setShowHistory] = useState<boolean>(false)
  const [currentPdfId, setCurrentPdfId] = useState<string | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [isLoadingPdf, setIsLoadingPdf] = useState<boolean>(false)
  const [isSavingSession, setIsSavingSession] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [showDriveSyncPrompt, setShowDriveSyncPrompt] = useState(false)
  const [driveAuthUrl, setDriveAuthUrl] = useState<string | null>(null)
  const [driveAuthChecked, setDriveAuthChecked] = useState<boolean>(false)
  const [isDriveAuthorized, setIsDriveAuthorized] = useState<boolean>(false)
  const [lastSaveTime, setLastSaveTime] = useState<number>(0) // Track when we last saved
  const [lastModificationTime, setLastModificationTime] = useState<number>(0) // Track when data was last modified
  const hasMarkedInitialHistoryRef = useRef(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const hasCurrentPdfUnsavedChanges = useMemo(() => {
    if (!currentPdfId || !isAuthenticated) {
      return false
    }
    return lastSaveTime === 0 || lastModificationTime > lastSaveTime
  }, [currentPdfId, isAuthenticated, lastSaveTime, lastModificationTime])

  // Handle Drive OAuth callback redirect
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const driveAuthSuccess = urlParams.get('drive_auth_success')
    const driveAuthError = urlParams.get('drive_auth_error')

    if (driveAuthSuccess === 'true') {
      // Drive authorization successful - clear URL params
      window.history.replaceState({}, '', window.location.pathname)
      // Reset drive auth check to allow status check
      setDriveAuthChecked(false)
      // Prefetch PDF history after successful authorization
      setTimeout(() => {
        prefetchPDFHistory(BACKEND_URL).catch(() => {
          // Silently ignore errors - prefetch is non-critical
        })
      }, 1000) // Small delay to ensure auth state is fully updated
    } else if (driveAuthError) {
      // Drive authorization failed - show error and clear URL params
      console.warn('Drive authorization failed:', driveAuthError)
      window.history.replaceState({}, '', window.location.pathname)
      // Don't block user - they can try again manually
    }
  }, [])

  // Auto-authorize Drive when user logs in
  useEffect(() => {
    if (isAuthenticated && user && !hasMarkedInitialHistoryRef.current) {
      markPDFHistoryNeedsRefresh(false)
      hasMarkedInitialHistoryRef.current = true
    }

    if (isAuthenticated && user && !driveAuthChecked) {
      setDriveAuthChecked(true)
      // Small delay to ensure user state is fully set
      setTimeout(() => {
        checkAndAuthorizeDrive()
      }, 500)
    } else if (!isAuthenticated) {
      setDriveAuthChecked(false)
      hasMarkedInitialHistoryRef.current = false
      // Clear all PDF state on logout
      setPdfFile(null)
      setPdfText('')
      setAnnotations([])
      setKnowledgeNotes([])
      setCurrentPdfId(null)
      setCurrentPageNumber(1)
      setShowKnowledgeNotes(false)
      setSelectedText('')
      setShowHistory(false)
      // Clear PDF history cache
      invalidatePDFHistoryCache()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user])

  // Check Drive authorization status and auto-authorize if needed
  const checkAndAuthorizeDrive = async () => {
    try {
      const token = localStorage.getItem('auth_token')
      if (!token) return

      // Check Drive status
      const statusResponse = await fetch(`${BACKEND_URL}/api/drive/status`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (statusResponse.ok) {
        const statusData = await statusResponse.json()
        if (statusData.authorized) {
          // Already authorized - set state and prefetch PDF history
          setIsDriveAuthorized(true)
          prefetchPDFHistory(BACKEND_URL).catch(() => {
            // Silently ignore errors - prefetch is non-critical
          })
          return
        } else {
          setIsDriveAuthorized(false)
        }
      }

      // Not authorized - initiate authorization
      const authResponse = await fetch(`${BACKEND_URL}/api/drive/auth`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (authResponse.ok) {
        const authData = await authResponse.json()
        if (!authData.authorized && authData.authUrl) {
          // Ask user before redirecting
          setDriveAuthUrl(authData.authUrl)
          setShowDriveSyncPrompt(true)
        }
      }
    } catch (error) {
      console.warn('Failed to check/authorize Drive:', error)
      // Don't block user - they can authorize manually later
    }
  }

  const handleDriveSyncConfirm = () => {
    if (driveAuthUrl) {
      window.location.href = driveAuthUrl
    }
    setShowDriveSyncPrompt(false)
  }

  const handleDriveSyncCancel = () => {
    setShowDriveSyncPrompt(false)
  }

  const handlePdfUpload = async (file: File) => {
    setPdfFile(file)
    setIsUploading(true)
    try {
      // Step 1: Extract text from PDF
      const extractedText = await extractTextFromPDF(file)
      setPdfText(extractedText)

      // Step 2: Index PDF with embeddings (happens once on upload)
      // This creates embeddings for all chunks so we can do semantic search later
      if (extractedText && extractedText.trim().length > 0) {
        try {
          const { indexPDF } = await import('./utils/pdfRAG')

          // Index PDF with progress callback (optional - for UI feedback)
          // Uses TF-IDF (no API keys required)
          await indexPDF(extractedText)
        } catch (error) {
          console.warn('[RAG] Failed to index PDF, will use keyword search:', error)
          // Continue - keyword search will work as fallback
        }
      }

      // Step 3: Upload to Drive if authenticated AND authorized
      if (isAuthenticated && isDriveAuthorized) {
        try {
          const token = localStorage.getItem('auth_token')
          if (token) {
            // Convert file to base64 (chunked to avoid stack overflow)
            const arrayBuffer = await file.arrayBuffer()
            const uint8Array = new Uint8Array(arrayBuffer)

            // Convert to base64 in chunks to avoid stack overflow
            // Build binary string character by character to avoid apply() argument limits
            let binaryString = ''
            const chunkSize = 8192 // Process 8KB at a time
            for (let i = 0; i < uint8Array.length; i += chunkSize) {
              const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length))
              // Convert chunk to string character by character
              for (let j = 0; j < chunk.length; j++) {
                binaryString += String.fromCharCode(chunk[j])
              }
            }
            const base64 = btoa(binaryString)

            // Generate title using LLM if text is available
            let generatedTitle = ''
            if (extractedText && extractedText.trim().length > 0) {
              try {
                // Take first 1000 chars for title generation
                const context = extractedText.slice(0, 1000)
                const prompt = `You generate short, descriptive titles for uploaded PDFs based on their content.
File name: "${file.name}"
Content snippet: "${context}"
Output a concise (<=5 words) human-friendly title without quotes. Do not include "Title:" prefix.`

                const response = await sendChatMessage(
                  [{ role: 'user', content: prompt }],
                  undefined,
                  undefined,
                  AUTO_MODELS[0]
                )

                // Clean response
                generatedTitle = response
                  .replace(/^["'“”`]+|["'“”`]+$/g, '') // Remove quotes
                  .replace(/[.:]+$/g, '') // Remove trailing punctuation
                  .trim()

                // Fallback if empty or too long
                if (!generatedTitle || generatedTitle.length > 60) {
                  generatedTitle = ''
                }
              } catch (error) {
                console.warn('Failed to generate title:', error)
                // Continue without generated title
              }
            }

            const response = await fetch(`${BACKEND_URL}/api/drive/upload-pdf`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                pdfBase64: base64,
                fileName: file.name,
                displayName: generatedTitle || undefined
              })
            })

            if (response.ok) {
              const data = await response.json()
              setCurrentPdfId(data.pdfId)
              // Reset save tracking for new PDF
              setLastSaveTime(0)
              setLastModificationTime(0)
              console.log('PDF uploaded to Drive:', data.pdfId)
              // Invalidate cache so history updates
              invalidatePDFHistoryCache()
              markPDFHistoryNeedsRefresh(false)
            } else {
              console.warn('Failed to upload PDF to Drive:', await response.text())
            }
          }
        } catch (error) {
          console.warn('Error uploading PDF to Drive:', error)
          // Continue - PDF is still loaded locally
        }
      }
    } catch (error) {
      console.error('Failed to extract PDF text:', error)
      setPdfText('')
    } finally {
      setIsUploading(false)
    }
  }

  // Clear PDF text and RAG index when PDF is removed
  useEffect(() => {
    if (!pdfFile) {
      setPdfText('')
      // Clear RAG indices when PDF is removed
      import('./utils/pdfRAG').then(({ clearPDFIndices }) => {
        clearPDFIndices()
      }).catch(() => {
        // Ignore if module not loaded
      })
    }
  }, [pdfFile])

  const handleTextSelection = (text: string, pageNumber?: number, textYPosition?: number) => {
    setSelectedText(text)
    // Store the selected text position for later use when creating knowledge notes
    if (text && pageNumber !== undefined && textYPosition !== undefined) {
      // Store in a ref or state that persists across conversation rounds
      // We'll use this when creating knowledge notes
      setLastSelectedTextPosition({ text, pageNumber, textYPosition })
      // Also store in window for easy access from chat component
      ;(window as any).__lastSelectedTextPosition = { text, pageNumber, textYPosition }
    } else if (!text) {
      // When clearing selection, don't clear the last position - we want to keep it for notes
      // Only clear if explicitly needed
    }
  }

  const toggleChatLayout = () => {
    setChatLayout((prev) => (prev === 'floating' ? 'split' : 'floating'))
  }

  const handleCreateKnowledgeNote = (
    content: string,
    linkedText: string | undefined,
    pageNumber: number | undefined,
    textYPosition: number | undefined,
    messageId: string
  ) => {
    // Check if a note with this messageId already exists to prevent duplicates
    const existingNote = knowledgeNotes.find(note => note.messageId === messageId && note.content === content)
    if (existingNote) {
      setToastMessage('This note has already been saved to your knowledge notes')
      return
    }
    
    // Determine page number - use provided or fallback to last selected or current
    const notePageNumber = pageNumber || lastSelectedTextPosition?.pageNumber || currentPageNumber
    
    // Determine Y position:
    // 1. Use explicitly provided textYPosition (from saved message data)
    // 2. Fall back to lastSelectedTextPosition if available
    // 3. Default to 0 (top of page) if no selection
    const noteTextYPosition = textYPosition ?? lastSelectedTextPosition?.textYPosition ?? 0

    const newNote: KnowledgeNote = {
      id: `note-${Date.now()}`,
      content,
      linkedText: linkedText || lastSelectedTextPosition?.text,
      pageNumber: notePageNumber,
      textYPosition: noteTextYPosition,
      createdAt: Date.now(),
      messageId,
    }
    setKnowledgeNotes((prev) => [...prev, newNote])
  }

  const handleDeleteKnowledgeNote = (id: string) => {
    setKnowledgeNotes((prev) => prev.filter((note) => note.id !== id))
  }

  const handleClearAllNotes = () => {
    setKnowledgeNotes([])
  }

  const handleScrollToPage = (pageNumber: number) => {
    setCurrentPageNumber(pageNumber)
    // Trigger scroll in PDFViewer via global function
    if ((window as any).__pdfScrollToPage) {
      ; (window as any).__pdfScrollToPage(pageNumber)
    }
  }

  const handleSaveAnnotations = useCallback(async () => {
    if (!currentPdfId || !isAuthenticated) return
    if (annotations.length === 0) return

    try {
      const token = localStorage.getItem('auth_token')
      if (!token) return

      await fetch(`${BACKEND_URL}/api/drive/save-annotations/${currentPdfId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ annotations })
      })
      // Invalidate cache so history updates with annotation status
      invalidatePDFHistoryCache()
      markPDFHistoryNeedsRefresh(true)
      // Update last save time
      setLastSaveTime(Date.now())
    } catch (error) {
      console.error('Failed to save annotations:', error)
    }
  }, [currentPdfId, isAuthenticated, annotations])

  const handleSaveKnowledgeNotes = useCallback(async () => {
    if (!currentPdfId || !isAuthenticated) return
    if (knowledgeNotes.length === 0) return

    try {
      const token = localStorage.getItem('auth_token')
      if (!token) return

      await fetch(`${BACKEND_URL}/api/drive/save-notes/${currentPdfId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ notes: knowledgeNotes })
      })
      // Invalidate cache so history updates with notes status
      invalidatePDFHistoryCache()
      markPDFHistoryNeedsRefresh(true)
      // Update last save time
      setLastSaveTime(Date.now())
    } catch (error) {
      console.error('Failed to save notes:', error)
    }
  }, [currentPdfId, isAuthenticated, knowledgeNotes])

  // Save data and warn user before leaving/refreshing
  useEffect(() => {
    // Check if there are actual unsaved changes
    const hasUnsavedChanges = () => {
      if (!currentPdfId || !isAuthenticated) return false

      const hasAnnotations = annotations.length > 0
      const hasNotes = knowledgeNotes.length > 0
      if (!hasAnnotations && !hasNotes) return false

      // Check if modifications were made after last save
      // If lastModificationTime > lastSaveTime, we have unsaved changes
      // Also check if we've never saved (lastSaveTime === 0)
      return lastSaveTime === 0 || lastModificationTime > lastSaveTime
    }

    // Primary save mechanism: visibilitychange (more reliable, more time)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && hasUnsavedChanges()) {
        // Page is being hidden - save unsaved changes
        // We have 1-2 seconds here, which is usually enough
        const savePromises: Promise<void>[] = []

        if (annotations.length > 0) {
          savePromises.push(handleSaveAnnotations())
        }

        if (knowledgeNotes.length > 0) {
          savePromises.push(handleSaveKnowledgeNotes())
        }

        // Try to complete saves, but don't block if it takes too long
        Promise.race([
          Promise.all(savePromises),
          new Promise(resolve => setTimeout(resolve, 1500)) // Max 1.5 second wait
        ]).catch(() => {
          // If save fails, try one more time with keepalive in beforeunload
        })
      }
    }

    // Backup save mechanism: beforeunload (less reliable, less time)
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Only save if we still have unsaved changes (visibilitychange might have saved)
      if (hasUnsavedChanges()) {
        try {
          const token = localStorage.getItem('auth_token')
          if (token) {
            // Use fetch with keepalive for best-effort saving
            // Note: sendBeacon doesn't support custom headers (Authorization), so we use fetch
            // keepalive ensures request continues after page unload (up to 64KB limit)
            if (annotations.length > 0) {
              const annotationsJson = JSON.stringify({ annotations })
              // Check size limit (keepalive has ~64KB limit)
              if (annotationsJson.length < 60000) {
                fetch(`${BACKEND_URL}/api/drive/save-annotations/${currentPdfId}`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                  },
                  body: annotationsJson,
                  keepalive: true // Critical: keeps request alive after page unload
                }).catch(() => { }) // Ignore errors - best effort
              }
            }

            if (knowledgeNotes.length > 0) {
              const notesJson = JSON.stringify({ notes: knowledgeNotes })
              if (notesJson.length < 60000) {
                fetch(`${BACKEND_URL}/api/drive/save-notes/${currentPdfId}`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                  },
                  body: notesJson,
                  keepalive: true // Critical: keeps request alive after page unload
                }).catch(() => { }) // Ignore errors - best effort
              }
            }
          }
        } catch (error) {
          // Ignore errors - we're unloading anyway
        }
      }

      // Show warning if PDF is uploaded AND there are unsaved changes
      if (pdfFile && hasUnsavedChanges()) {
        // Modern browsers require returnValue to be set
        e.preventDefault()
        e.returnValue = ''
        return ''
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [pdfFile, currentPdfId, isAuthenticated, annotations, knowledgeNotes, lastSaveTime, lastModificationTime, handleSaveAnnotations, handleSaveKnowledgeNotes])

  const saveCurrentPdfState = useCallback(async () => {
    if (!currentPdfId || !isAuthenticated) {
      return
    }
    
    // Remember if chat was visible
    const wasChatVisible = isChatVisible
    
    // Auto-fold knowledge panel
    setShowKnowledgeNotes(false)
    
    // Hide chat window
    setChatVisible(false)
    
    // Show saving visual effect
    setIsSavingSession(true)
    
    try {
      await Promise.all([
        handleSaveAnnotations(),
        handleSaveKnowledgeNotes()
      ])
    } finally {
      // Hide saving visual effect
      setIsSavingSession(false)
      
      // Re-show chat window if it was visible before
      if (wasChatVisible) {
        setChatVisible(true)
      }
    }
  }, [currentPdfId, isAuthenticated, isChatVisible, setChatVisible, handleSaveAnnotations, handleSaveKnowledgeNotes])

  // Load PDF from history
  const handleLoadPdfFromHistory = async (pdfId: string) => {
    // Don't switch if clicking the same PDF
    if (pdfId === currentPdfId) {
      return
    }

    // Save current PDF's annotations and notes before switching (if there are changes)
    if (currentPdfId && isAuthenticated && hasCurrentPdfUnsavedChanges) {
      try {
        // Wait for saves to complete (but don't block if it takes too long)
        await Promise.race([
          saveCurrentPdfState(),
          new Promise(resolve => setTimeout(resolve, 2000)) // Max 2 second wait
        ])
      } catch (error) {
        console.warn('Failed to save before switching PDF:', error)
        // Continue anyway - don't block user from switching
      }
    }

    setIsLoadingPdf(true)
    // Clear current PDF and its data first to show loading state
    setPdfFile(null)
    setAnnotations([])
    setKnowledgeNotes([])
    setCurrentPdfId(null)

    try {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        alert('Please log in to load PDF from history')
        setIsLoadingPdf(false)
        return
      }

      const response = await fetch(`${BACKEND_URL}/api/drive/load-pdf/${pdfId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        throw new Error('Failed to load PDF')
      }

      const data = await response.json()

      // Convert base64 to File
      const binaryString = atob(data.pdfBlob)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const file = new File([blob], data.metadata.originalFileName, { type: 'application/pdf' })

      // Restore PDF file - this will trigger PDFViewer to load
      setPdfFile(file)
      setCurrentPdfId(data.metadata.pdfId)

      // Extract text (don't wait for this to show PDF)
      extractTextFromPDF(file).then((extractedText) => {
        setPdfText(extractedText)

        // Re-index for RAG
        if (extractedText && extractedText.trim().length > 0) {
          try {
            import('./utils/pdfRAG').then(({ indexPDF }) => {
              indexPDF(extractedText).catch((error) => {
                console.warn('[RAG] Failed to index PDF:', error)
              })
            })
          } catch (error) {
            console.warn('[RAG] Failed to index PDF:', error)
          }
        }
      }).catch((error) => {
        console.warn('Failed to extract PDF text:', error)
      })

      // Restore annotations
      setAnnotations(data.annotations || [])

      // Restore knowledge notes
      setKnowledgeNotes(data.knowledgeNotes || [])

      // Reset save tracking - data is already saved on Drive
      setLastSaveTime(Date.now())
      setLastModificationTime(Date.now())

      // Reset to first page
      setCurrentPageNumber(1)

      // Show knowledge notes panel if notes exist
      if (data.knowledgeNotes && data.knowledgeNotes.length > 0) {
        setShowKnowledgeNotes(true)
      }

      // Keep loading state true - it will be cleared when PDF document loads
      // The PDFViewer will handle clearing it via onDocumentLoadSuccess
    } catch (error) {
      console.error('Failed to load PDF from history:', error)
      alert('Failed to load PDF. Please try again.')
      setIsLoadingPdf(false)
    }
    // Note: Don't clear isLoadingPdf here - let PDFViewer clear it when document loads
  }

  const handleNewSession = async () => {
    const hadUnsavedChanges = hasCurrentPdfUnsavedChanges

    if (hadUnsavedChanges) {
      setIsSavingSession(true)
      try {
        await saveCurrentPdfState()
      } catch (error) {
        console.warn('Failed to save before starting new session:', error)
      } finally {
        setIsSavingSession(false)
      }
    }

    // Clear current state (show start page)
    setPdfFile(null)
    setPdfText('')
    setAnnotations([])
    setKnowledgeNotes([])
    setCurrentPdfId(null)
    setCurrentPageNumber(1)
    setShowKnowledgeNotes(false)
    setSelectedText('')

    if (hadUnsavedChanges) {
      // Prefetch history so new state reflects latest save
      prefetchPDFHistory(BACKEND_URL).catch(() => {
        // Non-critical: ignore errors
      })
    }
  }

  const handleSaveBeforeFetch = useCallback(async () => {
    if (hasCurrentPdfUnsavedChanges) {
      await saveCurrentPdfState()
    }
  }, [hasCurrentPdfUnsavedChanges, saveCurrentPdfState])

  // Track modification time when annotations or notes change
  useEffect(() => {
    if (annotations.length > 0 || knowledgeNotes.length > 0) {
      setLastModificationTime(Date.now())
    }
  }, [annotations, knowledgeNotes])

  // Auto-save annotations and notes when they change
  // Increased debounce to 5 seconds to reduce API calls
  useEffect(() => {
    if (currentPdfId && isAuthenticated && annotations.length > 0) {
      const timeoutId = setTimeout(() => {
        handleSaveAnnotations()
      }, 5000) // Debounce: save 5 seconds after last change (optimized from 2s)
      return () => clearTimeout(timeoutId)
    }
  }, [annotations, currentPdfId, isAuthenticated, handleSaveAnnotations])

  useEffect(() => {
    if (currentPdfId && isAuthenticated && knowledgeNotes.length > 0) {
      const timeoutId = setTimeout(() => {
        handleSaveKnowledgeNotes()
      }, 5000) // Debounce: save 5 seconds after last change (optimized from 2s)
      return () => clearTimeout(timeoutId)
    }
  }, [knowledgeNotes, currentPdfId, isAuthenticated, handleSaveKnowledgeNotes])

  return (
    <div className="app">
      <SaveProvider 
        hasUnsavedChanges={hasCurrentPdfUnsavedChanges} 
        saveCurrentState={saveCurrentPdfState}
        isSavingSession={isSavingSession}
        setIsSavingSession={setIsSavingSession}
      >
        <NavBar onOpenHistory={() => setShowHistory(true)} isSavingSession={isSavingSession} />
      </SaveProvider>
      <PDFHistoryPanel
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        onSelectPdf={handleLoadPdfFromHistory}
        hasUnsavedChanges={hasCurrentPdfUnsavedChanges}
        onSaveBeforeFetch={handleSaveBeforeFetch}
        isDriveAuthorized={isDriveAuthorized}
      />
      <div className={`main-content ${chatLayout === 'split' ? 'split-layout' : ''} ${showKnowledgeNotes && chatLayout === 'floating' ? 'has-knowledge-notes' : ''}`}>
        <ErrorBoundary>
          <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center' }}>Loading PDF viewer...</div>}>
            <PDFViewer
              file={pdfFile}
              onFileUpload={handlePdfUpload}
              onTextSelection={handleTextSelection}
              layout={chatLayout}
              onPageChange={setCurrentPageNumber}
              showKnowledgeNotes={showKnowledgeNotes}
              onToggleKnowledgeNotes={() => setShowKnowledgeNotes(!showKnowledgeNotes)}
              knowledgeNotes={knowledgeNotes}
              onScrollToPage={handleScrollToPage}
              onNoteClick={(note) => {
                if (note.pageNumber) {
                  handleScrollToPage(note.pageNumber)
                }
              }}
              pdfContentRef={(window as any).__pdfContentRef ? { current: (window as any).__pdfContentRef } : undefined}
              onAddAnnotation={() => { }} // Enable annotation adding via global function
              initialAnnotations={annotations}
              onAnnotationsChange={setAnnotations}
              isLoadingPdf={isLoadingPdf}
              onLoadingComplete={() => setIsLoadingPdf(false)}
              isSavingSession={isSavingSession}
              onNewSession={handleNewSession}
            />
          </Suspense>
        </ErrorBoundary>
        {showKnowledgeNotes && (
          <KnowledgeNotesPanel
            notes={knowledgeNotes}
            onDeleteNote={handleDeleteKnowledgeNote}
            onClearAllNotes={handleClearAllNotes}
            onScrollToPage={handleScrollToPage}
            layout={chatLayout}
            theme={theme}
            isVisible={showKnowledgeNotes}
            onClose={() => setShowKnowledgeNotes(false)}
            onNoteClick={(note) => {
              if (note.pageNumber) {
                handleScrollToPage(note.pageNumber)
              }
            }}
            pdfContentRef={(window as any).__pdfContentRef ? { current: (window as any).__pdfContentRef } : undefined}
          />
        )}
        {isChatVisible && (
          <div className={`chat-container ${chatLayout === 'floating' ? 'floating-chat' : 'split-chat'} ${showKnowledgeNotes ? 'knowledge-notes-open' : ''}`}>
            <ChatGPTEmbedded
              selectedText={selectedText}
              pdfText={pdfText}
              onToggleLayout={toggleChatLayout}
              layout={chatLayout}
              currentPageNumber={currentPageNumber}
              onCreateKnowledgeNote={handleCreateKnowledgeNote}
              onClearSelectedText={() => setSelectedText('')}
              onOpenKnowledgeNotes={() => {
                if (!showKnowledgeNotes) {
                  setShowKnowledgeNotes(true)
                }
              }}
              onAddAnnotationToPDF={(text: string, pageNumber: number, textYPosition?: number) => {
                // Create text box annotation and add it to PDF
                if ((window as any).__addPDFAnnotation) {
                  // Calculate position: use textYPosition if available, otherwise center of page
                  const x = 0.4 // Center horizontally (40% from left, leaving room for text box)
                  const y = textYPosition !== undefined ? textYPosition : 0.5 // Use selected text position or center

                  const annotation: TextBoxAnnotation = {
                    id: `textbox-${Date.now()}`,
                    type: 'textbox',
                    pageNumber,
                    x: Math.max(0, Math.min(1 - 0.3, x - 0.15)), // Constrain to page bounds
                    y: Math.max(0, Math.min(1 - 0.2, y - 0.1)), // Constrain to page bounds
                    width: 0.3, // 30% of page width
                    height: 0.2, // 20% of page height (will auto-expand if needed)
                    rotation: 0,
                    text: text,
                    fontSize: 14,
                    color: COMMON_COLORS[0], // Black
                  }

                    ; (window as any).__addPDFAnnotation(annotation)
                }
              }}
            />
          </div>
        )}
      </div>
      {isUploading && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white'
        }}>
          <div className="loading-spinner" style={{
            width: '40px',
            height: '40px',
            border: '4px solid rgba(255, 255, 255, 0.3)',
            borderTop: '4px solid white',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            marginBottom: '16px'
          }} />
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
          <h3>Uploading PDF...</h3>
          <p>This may take a moment for large files</p>
        </div>
      )}
      <DriveSyncPrompt
        isOpen={showDriveSyncPrompt}
        onConfirm={handleDriveSyncConfirm}
        onCancel={handleDriveSyncCancel}
      />
      {toastMessage && (
        <Toast
          message={toastMessage}
          type="info"
          duration={3000}
          onClose={() => setToastMessage(null)}
        />
      )}
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ChatVisibilityProvider>
          <AppContent />
        </ChatVisibilityProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App

