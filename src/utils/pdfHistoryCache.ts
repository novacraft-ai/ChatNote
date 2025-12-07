// Utility to read recent PDFs from localStorage cache
import { BACKEND_URL } from '../config'

export const PDF_HISTORY_CACHE_KEY = 'chatnote_pdf_history_cache'
export const PDF_HISTORY_CACHE_UPDATED_EVENT = 'pdf-history-cache-updated'
const DEFAULT_TTL = 5 * 60 * 1000 // 5 minutes

export function notifyPDFHistoryCacheUpdated() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  try {
    window.dispatchEvent(new CustomEvent(PDF_HISTORY_CACHE_UPDATED_EVENT))
  } catch {
    // Ignore event dispatch errors
  }
}

export function getRecentPDFsFromCache(limit = 3) {
  const historyRaw = localStorage.getItem(PDF_HISTORY_CACHE_KEY)
  let recentPdfs: any[] = []
  try {
    if (historyRaw) {
      const parsed = JSON.parse(historyRaw)
      if (parsed && Array.isArray(parsed.pdfs)) {
        recentPdfs = parsed.pdfs.slice(0, limit)
      }
    }
  } catch {}
  return recentPdfs
}

export function setPDFsInCache(pdfs: any[]) {
  try {
    const cache = { pdfs, timestamp: Date.now() }
    localStorage.setItem(PDF_HISTORY_CACHE_KEY, JSON.stringify(cache))
    notifyPDFHistoryCacheUpdated()
  } catch (e) {
    // ignore
  }
}

export function isCacheFresh(ttl = DEFAULT_TTL) {
  try {
    const raw = localStorage.getItem(PDF_HISTORY_CACHE_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.timestamp !== 'number') return false
    return Date.now() - parsed.timestamp < ttl
  } catch {
    return false
  }
}

// Prefetch fresh list from backend (if authenticated). Updates cache and returns list.
export async function prefetchRecentPDFs(limit = 3): Promise<any[]> {
  try {
    const token = localStorage.getItem('auth_token')
    if (!token) return getRecentPDFsFromCache(limit)

    // If cache is fresh, return it immediately but still try background refresh
    const cached = getRecentPDFsFromCache(limit)
    const isFresh = isCacheFresh()

    const fetchPromise = fetch(`${BACKEND_URL}/api/drive/history`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(async (res) => {
      if (!res.ok) {
        if (res.status === 403) {
          // auth revoked -> clear cache
          try {
            localStorage.removeItem(PDF_HISTORY_CACHE_KEY)
            notifyPDFHistoryCacheUpdated()
          } catch {}
          return []
        }
        return []
      }
      const data = await res.json()
      const pdfs = data.pdfs || []
      setPDFsInCache(pdfs)
      return pdfs.slice(0, limit)
    }).catch(() => {
      return []
    })

    if (isFresh) {
      // return cached value immediately, but still refresh in background
      fetchPromise.catch(() => {})
      return cached
    }

    const fresh = await fetchPromise
    return fresh.length > 0 ? fresh : cached
  } catch {
    return getRecentPDFsFromCache(limit)
  }
}
