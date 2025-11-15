import { useState, lazy, Suspense, useEffect } from 'react'
import { ThemeProvider, useTheme } from './contexts/ThemeContext'
import { AuthProvider } from './contexts/AuthContext'
import NavBar from './components/NavBar'
import ChatGPTEmbedded from './components/ChatGPTEmbedded'
import ErrorBoundary from './components/ErrorBoundary'
import KnowledgeNotesPanel from './components/KnowledgeNotesPanel'
import { extractTextFromPDF } from './utils/pdfTextExtractor'
import { KnowledgeNote } from './types/knowledgeNotes'
import './App.css'

const PDFViewer = lazy(() => import('./components/PDFViewer'))

type ChatLayout = 'floating' | 'split'

function AppContent() {
  const { theme } = useTheme()
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfText, setPdfText] = useState<string>('')
  const [selectedText, setSelectedText] = useState<string>('')
  const [chatLayout, setChatLayout] = useState<ChatLayout>('floating')
  const [isExtractingText, setIsExtractingText] = useState<boolean>(false)
  const [currentPageNumber, setCurrentPageNumber] = useState<number>(1)
  const [knowledgeNotes, setKnowledgeNotes] = useState<KnowledgeNote[]>([])
  const [showKnowledgeNotes, setShowKnowledgeNotes] = useState<boolean>(false) // Default to collapsed
  const [lastSelectedTextPosition, setLastSelectedTextPosition] = useState<{ text: string; pageNumber: number; textYPosition: number } | null>(null)

  const handlePdfUpload = async (file: File) => {
    setPdfFile(file)
    setIsExtractingText(true)
    try {
      const extractedText = await extractTextFromPDF(file)
      setPdfText(extractedText)
    } catch (error) {
      console.error('Failed to extract PDF text:', error)
      setPdfText('')
    } finally {
      setIsExtractingText(false)
    }
  }

  // Clear PDF text when PDF is removed
  useEffect(() => {
    if (!pdfFile) {
      setPdfText('')
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
        <div className={`chat-container ${chatLayout === 'floating' ? 'floating-chat' : 'split-chat'} ${showKnowledgeNotes ? 'knowledge-notes-open' : ''}`}>
          <ChatGPTEmbedded 
            selectedText={selectedText} 
            pdfText={pdfText}
            isExtractingText={isExtractingText}
            onToggleLayout={toggleChatLayout} 
            layout={chatLayout}
            currentPageNumber={currentPageNumber}
            onCreateKnowledgeNote={handleCreateKnowledgeNote}
          />
            </div>
          </div>
        </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App

