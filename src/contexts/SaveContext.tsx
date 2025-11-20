import { createContext, useContext, ReactNode } from 'react'

interface SaveContextType {
  hasUnsavedChanges: boolean
  saveCurrentState: () => Promise<void>
  isSavingSession: boolean
  setIsSavingSession: (saving: boolean) => void
}

const SaveContext = createContext<SaveContextType | undefined>(undefined)

export function SaveProvider({ 
  children, 
  hasUnsavedChanges, 
  saveCurrentState,
  isSavingSession,
  setIsSavingSession
}: { 
  children: ReactNode
  hasUnsavedChanges: boolean
  saveCurrentState: () => Promise<void>
  isSavingSession: boolean
  setIsSavingSession: (saving: boolean) => void
}) {
  return (
    <SaveContext.Provider value={{ hasUnsavedChanges, saveCurrentState, isSavingSession, setIsSavingSession }}>
      {children}
    </SaveContext.Provider>
  )
}

export function useSave() {
  const context = useContext(SaveContext)
  if (context === undefined) {
    throw new Error('useSave must be used within a SaveProvider')
  }
  return context
}
