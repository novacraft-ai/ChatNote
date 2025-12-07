import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { AUTO_MODELS, BACKEND_URL } from '../config'
import { sendChatMessage, isChatConfigured } from '../services/authenticatedChatService'
import { notifyPDFHistoryCacheUpdated } from '../utils/pdfHistoryCache'
import './PDFHistoryPanel.css'

interface PDFHistoryEntry {
  pdfId: string
  displayName: string
  originalFileName: string
  uploadedAt: number
  lastModifiedAt: number
  pageCount: number
  hasAnnotations: boolean
  hasNotes: boolean
}

interface PDFHistoryPanelProps {
  isOpen: boolean
  onClose: () => void
  onSelectPdf: (pdfId: string) => void
  hasUnsavedChanges?: boolean // Whether current PDF has unsaved changes
  onSaveBeforeFetch?: () => Promise<void> // Optional callback to save before fetching
  isDriveAuthorized?: boolean // Whether Google Drive is authorized
  isGoogleDriveEligible?: boolean // Whether user is eligible for Google Drive features
}

const CACHE_KEY = 'chatnote_pdf_history_cache'
const CACHE_EXPIRY_MS = 5 * 60 * 1000 // 5 minutes
const NAME_CACHE_KEY = 'chatnote_pdf_history_names'
const HISTORY_VERSION_KEY = 'chatnote_pdf_history_version'
const HISTORY_LAST_FETCH_KEY = 'chatnote_pdf_history_last_fetch'

interface GeneratedNameCacheEntry {
  name: string
  originalFileName: string
  updatedAt: number
}

type GeneratedNameCache = Record<string, GeneratedNameCacheEntry>

const loadGeneratedNameCache = (): GeneratedNameCache => {
  try {
    const cached = localStorage.getItem(NAME_CACHE_KEY)
    if (!cached) return {}
    const parsed = JSON.parse(cached)
    if (parsed && typeof parsed === 'object') {
      return parsed
    }
  } catch (error) {
    console.warn('Failed to parse generated name cache:', error)
  }
  return {}
}

const saveGeneratedNameCache = (cache: GeneratedNameCache) => {
  try {
    localStorage.setItem(NAME_CACHE_KEY, JSON.stringify(cache))
  } catch (error) {
    console.warn('Failed to persist generated name cache:', error)
  }
}

const removeHistoryEntryFromCache = (pdfId: string) => {
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    if (!cached) return
    const parsed: CachedHistory = JSON.parse(cached)
    parsed.pdfs = (parsed.pdfs || []).filter(pdf => pdf.pdfId !== pdfId)
    localStorage.setItem(CACHE_KEY, JSON.stringify(parsed))
    notifyPDFHistoryCacheUpdated()
  } catch (error) {
    console.warn('Failed to update history cache after deletion:', error)
  }
}

const stripModelResponse = (response: string) => {
  if (!response) return ''
  const reasoningStart = '__REASONING_START__'
  const reasoningEnd = '__REASONING_END__'
  if (response.includes(reasoningStart) && response.includes(reasoningEnd)) {
    const endIndex = response.indexOf(reasoningEnd) + reasoningEnd.length
    response = response.slice(endIndex)
  }
  response = response.replace(/<think>[\s\S]*?<\/think>/gi, '')
  return response.trim()
}

const normalizeGeneratedName = (response: string, fallback: string) => {
  const stripped = stripModelResponse(response)
  if (!stripped) return fallback
  const firstLine = stripped.split('\n')[0]
  const cleaned = firstLine
    .replace(/^["'“”`]+|["'“”`]+$/g, '')
    .replace(/[.:]+$/g, '')
    .trim()
    .replace(/\s+/g, ' ')
  if (!cleaned) return fallback
  return cleaned.length > 60 ? `${cleaned.slice(0, 57).trimEnd()}...` : cleaned
}

const getHistoryVersion = (): number => {
  try {
    const stored = localStorage.getItem(HISTORY_VERSION_KEY)
    if (!stored) return 0
    const num = Number(stored)
    return Number.isFinite(num) ? num : 0
  } catch {
    return 0
  }
}

const getLastFetchedHistoryVersion = (): number => {
  try {
    const stored = sessionStorage.getItem(HISTORY_LAST_FETCH_KEY)
    if (!stored) return 0
    const num = Number(stored)
    return Number.isFinite(num) ? num : 0
  } catch {
    return 0
  }
}

const setLastFetchedHistoryVersion = (version: number) => {
  try {
    sessionStorage.setItem(HISTORY_LAST_FETCH_KEY, `${version}`)
  } catch {
    // Ignore session storage errors
  }
}

const HISTORY_PENDING_SAVE_KEY = 'chatnote_pdf_history_pending_save'

export const markPDFHistoryPendingSave = () => {
  try {
    localStorage.setItem(HISTORY_PENDING_SAVE_KEY, 'true')
  } catch {
    // Ignore storage errors
  }
}

const clearPDFHistoryPendingSave = () => {
  try {
    localStorage.removeItem(HISTORY_PENDING_SAVE_KEY)
  } catch {
    // Ignore errors
  }
}

const getPDFHistoryPendingSave = (): boolean => {
  try {
    return localStorage.getItem(HISTORY_PENDING_SAVE_KEY) === 'true'
  } catch {
    return false
  }
}

const resetLastFetchedHistoryVersion = () => {
  try {
    sessionStorage.removeItem(HISTORY_LAST_FETCH_KEY)
  } catch {
    // Ignore errors
  }
}

export const markPDFHistoryNeedsRefresh = (pendingSave: boolean) => {
  try {
    localStorage.setItem(HISTORY_VERSION_KEY, `${Date.now()}`)
    if (pendingSave) {
      markPDFHistoryPendingSave()
    }
  } catch {
    // Ignore storage errors
  }
}

const clearHistoryVersion = () => {
  try {
    localStorage.removeItem(HISTORY_VERSION_KEY)
  } catch {
    // Ignore storage errors
  }
}

// Export function to invalidate cache (called when PDFs are uploaded/saved)
export function invalidatePDFHistoryCache() {
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    if (cached) {
      try {
        const parsed: CachedHistory = JSON.parse(cached)
        parsed.timestamp = 0
        localStorage.setItem(CACHE_KEY, JSON.stringify(parsed))
      } catch {
        localStorage.removeItem(CACHE_KEY)
      }
    } else {
      localStorage.removeItem(CACHE_KEY)
    }
    notifyPDFHistoryCacheUpdated()
  } catch (error) {
    console.warn('Failed to invalidate PDF history cache:', error)
  }
}

// Track in-flight prefetch to avoid duplicate network calls
let pendingPrefetchPromise: Promise<void> | null = null

// Export function to pre-fetch PDF history (called on login)
export async function prefetchPDFHistory(backendUrl: string): Promise<void> {
  try {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      return // Not authenticated, skip prefetch
    }

    // Check if we have fresh cached data (less than 5 minutes old)
    const cached = localStorage.getItem(CACHE_KEY)
    if (cached) {
      try {
        const parsed: CachedHistory = JSON.parse(cached)
        const now = Date.now()
        if (now - parsed.timestamp < CACHE_EXPIRY_MS) {
          // Cache is still fresh, no need to prefetch
          return
        }
      } catch (error) {
        // Invalid cache, continue to fetch
      }
    }

    // Deduplicate concurrent prefetch requests
    if (pendingPrefetchPromise) {
      return pendingPrefetchPromise
    }

    pendingPrefetchPromise = (async () => {
      try {
        // Fetch fresh data in the background
        const response = await fetch(`${backendUrl}/api/drive/history`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        })

        if (response.ok) {
          const data = await response.json()
          const pdfs = data.pdfs || []

          // Save to cache
          try {
            const cache: CachedHistory = {
              pdfs,
              timestamp: Date.now()
            }
            localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
          } catch (error) {
            console.warn('Failed to save cached history:', error)
          }
        } else if (response.status === 403) {
          // Drive not authorized - clear any stale cache
          try {
            localStorage.removeItem(CACHE_KEY)
          } catch (error) {
            // Ignore
          }
        }
        // Silently ignore other errors - prefetch shouldn't block user
      } finally {
        pendingPrefetchPromise = null
      }
    })()

    return pendingPrefetchPromise
  } catch (error) {
    // Silently ignore prefetch errors - it's just for optimization
  }
}

interface CachedHistory {
  pdfs: PDFHistoryEntry[]
  timestamp: number
}

export default function PDFHistoryPanel({ isOpen, onClose, onSelectPdf, hasUnsavedChanges = false, onSaveBeforeFetch, isDriveAuthorized = false, isGoogleDriveEligible = false }: PDFHistoryPanelProps) {
  const { isAuthenticated } = useAuth()
  const [pdfs, setPdfs] = useState<PDFHistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [generatedNameCache, setGeneratedNameCache] = useState<GeneratedNameCache>(() => loadGeneratedNameCache())
  const [nameGenerationStatus, setNameGenerationStatus] = useState<Record<string, boolean>>({})
  const generationQueueRef = useRef<Set<string>>(new Set())
  const [isChatReady, setIsChatReady] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({})
  const [deleteConfirmIds, setDeleteConfirmIds] = useState<Record<string, boolean>>({})
  const deleteConfirmTimeoutsRef = useRef<Record<string, number>>({})
  const [lastFetchedVersion, setLastFetchedVersion] = useState<number>(() => getLastFetchedHistoryVersion())
  const isOpenRef = useRef(isOpen) // Track isOpen in a ref for async operations

  // Load cached history
  const loadCachedHistory = (): PDFHistoryEntry[] | null => {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      if (!cached) return null

      const parsed: CachedHistory = JSON.parse(cached)
      const now = Date.now()

      // Check if cache is still valid
      if (now - parsed.timestamp < CACHE_EXPIRY_MS) {
        return parsed.pdfs
      }
    } catch (error) {
      console.warn('Failed to load cached history:', error)
    }
    return null
  }

  // Save history to cache
  const saveCachedHistory = (pdfs: PDFHistoryEntry[]) => {
    try {
      const cache: CachedHistory = {
        pdfs,
        timestamp: Date.now()
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
      notifyPDFHistoryCacheUpdated()
    } catch (error) {
      console.warn('Failed to save cached history:', error)
    }
  }

  // Keep ref in sync with prop
  useEffect(() => {
    isOpenRef.current = isOpen
  }, [isOpen])

  useEffect(() => {
    return () => {
      Object.values(deleteConfirmTimeoutsRef.current).forEach(timeoutId => clearTimeout(timeoutId))
      deleteConfirmTimeoutsRef.current = {}
    }
  }, [])

  useEffect(() => {
    let active = true
    isChatConfigured()
      .then((configured) => {
        if (active) {
          setIsChatReady(configured)
        }
      })
      .catch(() => {
        if (active) {
          setIsChatReady(false)
        }
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (isOpen && isAuthenticated) {
      // Reset refresh state when panel opens
      setIsRefreshing(false)

      // Load cached data immediately for fast display
      const cachedPdfs = loadCachedHistory()
      if (cachedPdfs) {
        setPdfs(cachedPdfs)
        setLoading(false)

        // Smart fetch logic: only fetch if needed
        const currentVersion = getHistoryVersion()
        const versionNeedsFetch = currentVersion > 0 && currentVersion > lastFetchedVersion
        const pendingSave = getPDFHistoryPendingSave()
        // Check hasUnsavedChanges inline instead of using it as dependency to avoid infinite loops
        const hasChanges = hasUnsavedChanges
        const shouldFetch = versionNeedsFetch || pendingSave || hasChanges || (!cachedPdfs || cachedPdfs.length === 0)

        if (shouldFetch) {
          // If there are unsaved changes, save first, then fetch
          if (hasChanges && onSaveBeforeFetch) {
            onSaveBeforeFetch().then(() => {
              // Save completed, now fetch fresh history
              const updatedVersion = getHistoryVersion()
              const pendingFlag = getPDFHistoryPendingSave()
              loadHistory(true, updatedVersion, pendingFlag)
            }).catch(() => {
              // Save failed, still try to fetch (best effort)
              const updatedVersion = getHistoryVersion()
              const pendingFlag = getPDFHistoryPendingSave()
              loadHistory(true, updatedVersion, pendingFlag)
            })
          } else {
            // No unsaved changes, just fetch fresh data in the background
            loadHistory(true, currentVersion, pendingSave)
          }
        }
        // If cache is fresh and no changes, don't fetch - just use cache
      } else {
        // No cache - fetch immediately (not background)
        setLoading(true)
        loadHistory(false, getHistoryVersion(), getPDFHistoryPendingSave())
      }
    } else if (!isAuthenticated) {
      setPdfs([])
      setError(null)
      setLoading(false)
      setIsRefreshing(false) // Reset refresh state on logout
      clearHistoryVersion()
      setLastFetchedVersion(0)
      resetLastFetchedHistoryVersion()
      clearPDFHistoryPendingSave()
    } else if (!isOpen) {
      // Panel closed - reset refresh state
      setIsRefreshing(false)
      setSearchQuery('')
      setDeleteConfirmIds({})
    }
  }, [isOpen, isAuthenticated])

  useEffect(() => {
    if (!isChatReady || pdfs.length === 0) return

    let cancelled = false

    const generateNames = async () => {
      for (const pdf of pdfs) {
        if (cancelled) return
        
        // Check inline instead of using shouldGenerateName to avoid dependency issues
        const cachedEntry = generatedNameCache[pdf.pdfId]
        let shouldGenerate = false
        
        if (cachedEntry) {
          shouldGenerate = cachedEntry.originalFileName !== pdf.originalFileName
        } else {
          const isRawFilename = pdf.displayName.toLowerCase().endsWith('.pdf') ||
            pdf.displayName === pdf.originalFileName
          shouldGenerate = isRawFilename
        }
        
        if (!shouldGenerate || generationQueueRef.current.has(pdf.pdfId)) {
          continue
        }

        generationQueueRef.current.add(pdf.pdfId)
        setNameGenerationStatus((prev) => ({ ...prev, [pdf.pdfId]: true }))
        try {
          const prompt = `You generate short, descriptive titles for uploaded PDFs.\nFile name: "${pdf.originalFileName}".\nOutput a concise (<=5 words) human-friendly title without quotes.`
          const response = await sendChatMessage(
            [{ role: 'user', content: prompt }],
            undefined,
            undefined,
            AUTO_MODELS[0]
          )
          if (cancelled) return
          const generatedTitle = normalizeGeneratedName(response.content, pdf.displayName || pdf.originalFileName)
          setGeneratedNameCache((prev) => {
            // Check if value actually changed before creating new object
            const existing = prev[pdf.pdfId]
            if (existing && existing.name === generatedTitle && existing.originalFileName === pdf.originalFileName) {
              return prev // No change, return same reference
            }
            const next = {
              ...prev,
              [pdf.pdfId]: {
                name: generatedTitle,
                originalFileName: pdf.originalFileName,
                updatedAt: Date.now()
              }
            }
            saveGeneratedNameCache(next)
            return next
          })
        } catch (error) {
          console.warn('Failed to generate PDF title:', error)
        } finally {
          generationQueueRef.current.delete(pdf.pdfId)
          setNameGenerationStatus((prev) => {
            const next = { ...prev }
            delete next[pdf.pdfId]
            return next
          })
        }
      }
    }

    generateNames()

    return () => {
      cancelled = true
    }
  }, [isChatReady, pdfs])

  const requestDeleteConfirmation = useCallback((pdfId: string) => {
    setDeleteConfirmIds((prev) => ({ ...prev, [pdfId]: true }))
    if (deleteConfirmTimeoutsRef.current[pdfId]) {
      clearTimeout(deleteConfirmTimeoutsRef.current[pdfId])
    }
    deleteConfirmTimeoutsRef.current[pdfId] = window.setTimeout(() => {
      setDeleteConfirmIds((prev) => {
        const next = { ...prev }
        delete next[pdfId]
        return next
      })
      delete deleteConfirmTimeoutsRef.current[pdfId]
    }, 4000)
  }, [])

  const handleDeletePdf = useCallback(async (pdfId: string) => {
    if (!pdfId) return
    setDeletingIds((prev) => ({ ...prev, [pdfId]: true }))
    try {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        throw new Error('Please log in again.')
      }

      const response = await fetch(`${BACKEND_URL}/api/drive/history/${pdfId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || 'Failed to delete PDF')
      }

      setPdfs((prev) => prev.filter(pdf => pdf.pdfId !== pdfId))
      setGeneratedNameCache((prev) => {
        if (!prev[pdfId]) return prev
        const next = { ...prev }
        delete next[pdfId]
        saveGeneratedNameCache(next)
        return next
      })
      removeHistoryEntryFromCache(pdfId)
      invalidatePDFHistoryCache()
      markPDFHistoryNeedsRefresh(false)
    } catch (error) {
      console.error('Failed to delete PDF:', error)
      alert(error instanceof Error ? error.message : 'Failed to delete PDF')
    } finally {
      setDeletingIds((prev) => {
        const next = { ...prev }
        delete next[pdfId]
        return next
      })
      setDeleteConfirmIds((prev) => {
        if (!prev[pdfId]) return prev
        const next = { ...prev }
        delete next[pdfId]
        return next
      })
      if (deleteConfirmTimeoutsRef.current[pdfId]) {
        clearTimeout(deleteConfirmTimeoutsRef.current[pdfId])
        delete deleteConfirmTimeoutsRef.current[pdfId]
      }
    }
  }, [])

  const loadHistory = async (isBackgroundRefresh = false, pendingVersion?: number, pendingSave?: boolean) => {
    // Don't fetch if Drive is not authorized or user is not eligible
    if (!isGoogleDriveEligible || !isDriveAuthorized) {
      if (isOpenRef.current && !isBackgroundRefresh) {
        setError('Google Drive not authorized. Please authorize Drive access to view PDF history.')
        setLoading(false)
      }
      return
    }

    // Only proceed if panel is still open (avoid state updates after unmount)
    if (!isOpenRef.current) return

    if (isBackgroundRefresh) {
      setIsRefreshing(true)
    } else {
      setLoading(true)
    }
    setError(null)

    try {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        if (isOpenRef.current) {
          setError('Not authenticated')
        }
        // Always clear loading/refreshing state
        if (isBackgroundRefresh) {
          setIsRefreshing(false)
        } else {
          setLoading(false)
        }
        return
      }

      const response = await fetch(`${BACKEND_URL}/api/drive/history`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        if (isOpenRef.current) {
          const errorText = await response.text()
          if (response.status === 403) {
            // Check if it's an "expired" error
            if (errorText.includes('expired') || errorText.includes('try again')) {
              setError('Drive authorization may have expired. Please try again or re-authorize.')
            } else {
              setError('Drive not authorized. Please authorize Drive access first.')
              // Clear cache on auth error
              localStorage.removeItem(CACHE_KEY)
            }
          } else {
            setError('Failed to load PDF history')
          }
        }
        // Always clear loading/refreshing state on error
        if (isBackgroundRefresh) {
          setIsRefreshing(false)
        } else {
          setLoading(false)
        }
        return
      }

      const data = await response.json()
      const freshPdfs = data.pdfs || []

      // Only update state if panel is still open
      if (isOpenRef.current) {
        // Update state
        setPdfs(freshPdfs)

        // Update cache
        saveCachedHistory(freshPdfs)
        const versionToRecord = pendingVersion && pendingVersion > 0 ? pendingVersion : getHistoryVersion()
        if (versionToRecord > 0) {
          setLastFetchedVersion(versionToRecord)
          setLastFetchedHistoryVersion(versionToRecord)
        }
        if (pendingSave) {
          clearPDFHistoryPendingSave()
        }
      }
    } catch (error) {
      console.error('Error loading history:', error)
      if (isOpenRef.current && !isBackgroundRefresh) {
        setError('Failed to load PDF history')
      }
    } finally {
      // Always clear loading/refreshing state (even if panel closed during fetch)
      // Use the ref to check if we should update state, but always clear the indicator
      if (isBackgroundRefresh) {
        setIsRefreshing(false)
      } else {
        setLoading(false)
      }
    }
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`

    return date.toLocaleDateString()
  }

  const filteredPdfs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) {
      return pdfs
    }
    return pdfs.filter((pdf) => {
      const generated = generatedNameCache[pdf.pdfId]?.name || ''
      return (
        generated.toLowerCase().includes(query) ||
        pdf.originalFileName.toLowerCase().includes(query) ||
        pdf.displayName.toLowerCase().includes(query)
      )
    })
  }, [pdfs, searchQuery, generatedNameCache])

  const hasSearchQuery = searchQuery.trim().length > 0

  if (!isOpen) return null

  return (
    <>
      <div className="pdf-history-overlay" onClick={onClose} />
      <div className="pdf-history-panel">
        <div className="pdf-history-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2>PDF History</h2>
            {isRefreshing && (
              <div className="pdf-history-refresh-indicator" title="Refreshing...">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                </svg>
              </div>
            )}
          </div>
          <button
            className="pdf-history-close"
            onClick={onClose}
            aria-label="Close history"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="pdf-history-content">
          {!isGoogleDriveEligible && (
            <div className="pdf-history-unavailable">
              <h3>PDF History Not Available</h3>
              <p>You don't have access to the PDF history feature. Please contact support if you believe this is an error.</p>
            </div>
          )}
          
          {isGoogleDriveEligible && (
            <>
              {!error && (
                <div className="pdf-history-search">
                  <input
                    type="search"
                    placeholder="Search by title or file name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    aria-label="Search PDF history"
                    disabled={loading && pdfs.length === 0}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="pdf-history-search-clear"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search"
                    >
                      ×
                    </button>
                  )}
                </div>
              )}

              {loading && (
                <div className="pdf-history-loading">
                  <div className="loading-spinner" />
                  <p>Loading PDF history...</p>
                </div>
              )}

              {error && (
                <div className="pdf-history-error">
                  <p>{error}</p>
                  {(!isDriveAuthorized || error.includes('expired') || error.includes('try again')) && (
                    <button
                      className="authorize-drive-button"
                      onClick={async () => {
                        try {
                          const token = localStorage.getItem('auth_token')
                          if (!token) return

                          const response = await fetch(`${BACKEND_URL}/api/drive/auth`, {
                            headers: {
                              'Authorization': `Bearer ${token}`
                            }
                          })

                          if (!response.ok) {
                            throw new Error('Failed to initiate Drive authorization')
                          }

                          const data = await response.json()

                          if (data.authorized) {
                            // Already authorized, reload history
                            loadHistory()
                          } else if (data.authUrl) {
                            // Redirect to OAuth URL
                            window.location.href = data.authUrl
                          }
                        } catch (error) {
                          console.error('Error authorizing Drive:', error)
                          setError('Failed to authorize Drive access. Please try again.')
                        }
                      }}
                    >
                      Authorize Drive Access
                    </button>
                  )}
                </div>
              )}

              {!loading && !error && pdfs.length === 0 && !hasSearchQuery && (
                <div className="pdf-history-empty">
                  <p>No PDFs yet</p>
                  <p className="pdf-history-empty-hint">Upload a PDF to get started</p>
                </div>
              )}

              {!loading && !error && hasSearchQuery && filteredPdfs.length === 0 && (
                <div className="pdf-history-empty">
                  <p>No PDFs match your search</p>
                  <button
                    type="button"
                    className="pdf-history-search-reset"
                    onClick={() => setSearchQuery('')}
                  >
                    Clear search
                  </button>
                </div>
              )}

              {!loading && !error && filteredPdfs.length > 0 && (
                <div className="pdf-history-list">
                  {filteredPdfs.map((pdf) => {
                    const generatedTitle = generatedNameCache[pdf.pdfId]?.name || pdf.displayName
                    const isGeneratingTitle = !!nameGenerationStatus[pdf.pdfId]
                    const isDeleting = !!deletingIds[pdf.pdfId]
                    const isConfirmingDelete = !!deleteConfirmIds[pdf.pdfId]
                    return (
                      <div
                        key={pdf.pdfId}
                        className="pdf-history-item"
                        onClick={() => {
                          if (isDeleting) return
                          onSelectPdf(pdf.pdfId)
                          onClose()
                          // Note: History will be refreshed automatically when panel reopens
                          // because cache is invalidated after save operations
                        }}
                      >
                        <div className="pdf-history-item-icon">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                          </svg>
                        </div>
                        <div className="pdf-history-item-content">
                          <div className="pdf-history-item-title">
                            {isGeneratingTitle ? (
                              <div className="pdf-history-title-placeholder">
                                <div className="loading-dots">
                                  <div></div>
                                  <div></div>
                                  <div></div>
                                </div>
                              </div>
                            ) : (
                              <span className="pdf-history-display-name" title={generatedTitle}>
                                {generatedTitle}
                              </span>
                            )}
                            {isConfirmingDelete ? (
                              <button
                                className="pdf-history-delete-confirm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeletePdf(pdf.pdfId)
                                }}
                                disabled={isDeleting}
                                title={isDeleting ? 'Deleting...' : 'Confirm delete'}
                                aria-live="polite"
                              >
                                {isDeleting ? (
                                  <>
                                    <div
                                      className="delete-spinner"
                                      role="status"
                                      aria-label="Deleting..."
                                    />
                                    <span>Deleting...</span>
                                  </>
                                ) : (
                                  'Confirm Delete'
                                )}
                              </button>
                            ) : (
                              <button
                                className="pdf-history-delete"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  requestDeleteConfirmation(pdf.pdfId)
                                }}
                                disabled={isDeleting}
                                title={isDeleting ? 'Deleting...' : 'Delete PDF'}
                              >
                                {isDeleting ? (
                                  <div className="delete-spinner" />
                                ) : (
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    <line x1="10" y1="11" x2="10" y2="17" />
                                    <line x1="14" y1="11" x2="14" y2="17" />
                                  </svg>
                                )}
                              </button>
                            )}
                          </div>
                          <div className="pdf-history-item-original" title={pdf.originalFileName}>
                            <span className="pdf-history-original-name">{pdf.originalFileName}</span>
                            <span className="pdf-history-divider">•</span>
                            <span>{formatDate(pdf.lastModifiedAt)}</span>
                          </div>
                          <div className="pdf-history-item-meta">
                            {pdf.pageCount > 0 && (
                              <span>{pdf.pageCount} page{pdf.pageCount !== 1 ? 's' : ''}</span>
                            )}
                          </div>
                          {(pdf.hasAnnotations || pdf.hasNotes) && (
                            <div className="pdf-history-item-badges">
                              {pdf.hasAnnotations && (
                                <span className="pdf-history-badge">Annotations</span>
                              )}
                              {pdf.hasNotes && (
                                <span className="pdf-history-badge">Notes</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
