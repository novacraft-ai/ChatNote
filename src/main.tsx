import React from 'react'
import ReactDOM from 'react-dom/client'
import './pdfjs-setup'
import App from './App.tsx'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

try {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
} catch (error) {
  rootElement.innerHTML = `
    <div style="padding: 20px; color: red;">
      <h1>Error Loading App</h1>
      <p>${error instanceof Error ? error.message : String(error)}</p>
      <p>Check the browser console for more details.</p>
    </div>
  `
}

