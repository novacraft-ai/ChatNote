import { useState, lazy, Suspense, useEffect } from 'react'
import { ThemeProvider, useTheme } from './contexts/ThemeContext'
import { AuthProvider } from './contexts/AuthContext'
import { ChatVisibilityProvider, useChatVisibility } from './contexts/ChatVisibilityContext'
import NavBar from './components/NavBar'
import ChatGPTEmbedded from './components/ChatGPTEmbedded'
import ErrorBoundary from './components/ErrorBoundary'
import KnowledgeNotesPanel from './components/KnowledgeNotesPanel'
import { extractTextFromPDF } from './utils/pdfTextExtractor'
import { KnowledgeNote } from './types/knowledgeNotes'
import { COMMON_COLORS, TextBoxAnnotation } from './types/annotations'
import './App.css'

const PDFViewer = lazy(() => import('./components/PDFViewer'))

type ChatLayout = 'floating' | 'split'

function AppContent() {
  const { theme } = useTheme()
  const { isChatVisible } = useChatVisibility()
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfText, setPdfText] = useState<string>('')
  const [selectedText, setSelectedText] = useState<string>('')
  const [chatLayout, setChatLayout] = useState<ChatLayout>('floating')
  const [currentPageNumber, setCurrentPageNumber] = useState<number>(1)
  const [knowledgeNotes, setKnowledgeNotes] = useState<KnowledgeNote[]>([])
  const [showKnowledgeNotes, setShowKnowledgeNotes] = useState<boolean>(false) // Default to collapsed
  const [lastSelectedTextPosition, setLastSelectedTextPosition] = useState<{ text: string; pageNumber: number; textYPosition: number } | null>(null)

  const handlePdfUpload = async (file: File) => {
    setPdfFile(file)
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
    } catch (error) {
      console.error('Failed to extract PDF text:', error)
      setPdfText('')
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

  // Warn user before leaving/refreshing if PDF is uploaded
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Only show warning if PDF is uploaded
      if (pdfFile) {
        // Modern browsers require returnValue to be set
        e.preventDefault()
        e.returnValue = ''
        return ''
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
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
    }
  }

  const toggleChatLayout = () => {
    setChatLayout((prev) => (prev === 'floating' ? 'split' : 'floating'))
  }

  const handleCreateKnowledgeNote = (
    content: string,
    linkedText: string | undefined,
    pageNumber: number | undefined,
    messageId: string
  ) => {
    // Use stored text position if available, otherwise use current page
    const notePageNumber = pageNumber || lastSelectedTextPosition?.pageNumber || currentPageNumber
    const noteTextYPosition = lastSelectedTextPosition?.textYPosition
    
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
      ;(window as any).__pdfScrollToPage(pageNumber)
    }
  }

  return (
        <div className="app">
          <NavBar />
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
            onAddAnnotation={() => {}} // Enable annotation adding via global function
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
                
                ;(window as any).__addPDFAnnotation(annotation)
              }
            }}
          />
            </div>
        )}
          </div>
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

