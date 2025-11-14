import { useState, lazy, Suspense } from 'react'
import { ThemeProvider } from './contexts/ThemeContext'
import { AuthProvider } from './contexts/AuthContext'
import NavBar from './components/NavBar'
import ChatGPTEmbedded from './components/ChatGPTEmbedded'
import ErrorBoundary from './components/ErrorBoundary'
import './App.css'

const PDFViewer = lazy(() => import('./components/PDFViewer'))

type ChatLayout = 'floating' | 'split'

function App() {
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [selectedText, setSelectedText] = useState<string>('')
  const [chatLayout, setChatLayout] = useState<ChatLayout>('floating')

  const handlePdfUpload = (file: File) => {
    setPdfFile(file)
  }

  const handleTextSelection = (text: string) => {
    setSelectedText(text)
  }

  const toggleChatLayout = () => {
    setChatLayout((prev) => (prev === 'floating' ? 'split' : 'floating'))
  }

  return (
    <ThemeProvider>
      <AuthProvider>
        <div className="app">
          <NavBar />
          <div className={`main-content ${chatLayout === 'split' ? 'split-layout' : ''}`}>
            <ErrorBoundary>
              <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center' }}>Loading PDF viewer...</div>}>
                <PDFViewer
                  file={pdfFile}
                  onFileUpload={handlePdfUpload}
                  onTextSelection={handleTextSelection}
                  layout={chatLayout}
                />
              </Suspense>
            </ErrorBoundary>
            <div className={`chat-container ${chatLayout === 'floating' ? 'floating-chat' : 'split-chat'}`}>
              <ChatGPTEmbedded selectedText={selectedText} onToggleLayout={toggleChatLayout} layout={chatLayout} />
            </div>
          </div>
        </div>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App

