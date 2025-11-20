import { useEffect, useState } from 'react'
import './Toast.css'

interface ToastProps {
  message: string
  type?: 'info' | 'success' | 'warning' | 'error'
  duration?: number
  onClose: () => void
}

export default function Toast({ message, type = 'info', duration = 3000, onClose }: ToastProps) {
  const [isExiting, setIsExiting] = useState(false)

  useEffect(() => {
    const exitTimer = setTimeout(() => {
      setIsExiting(true)
    }, duration - 300) // Start exit animation 300ms before close

    const closeTimer = setTimeout(() => {
      onClose()
    }, duration)

    return () => {
      clearTimeout(exitTimer)
      clearTimeout(closeTimer)
    }
  }, [duration, onClose])

  return (
    <div className="toast-container">
      <div className={`toast ${isExiting ? 'toast-exit' : ''}`}>
        <svg className={`toast-icon ${type}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {type === 'info' && (
            <>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </>
          )}
        </svg>
        <span>{message}</span>
      </div>
    </div>
  )
}
