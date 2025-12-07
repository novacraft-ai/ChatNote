/**
 * RAG (Retrieval-Augmented Generation) utilities for PDF documents
 * Implements the standard RAG pattern: chunk -> embed -> store -> retrieve
 * Uses lightweight TF-IDF for semantic search (no API keys required)
 */

interface PDFChunk {
  id: string
  text: string
  start: number
  end: number
  embedding?: number[]
  metadata?: {
    page?: number
    section?: string
  }
}

interface PDFIndex {
  pdfId: string // Hash of PDF content or file name
  chunks: PDFChunk[]
  createdAt: number
}

// In-memory storage for PDF indices (could be moved to IndexedDB for persistence)
const pdfIndices = new Map<string, PDFIndex>()

/**
 * Generate a simple hash for PDF identification
 */
function hashPDF(pdfText: string): string {
  // Simple hash function (could use crypto.subtle for better hashing)
  let hash = 0
  for (let i = 0; i < Math.min(pdfText.length, 1000); i++) {
    const char = pdfText.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return `pdf_${Math.abs(hash)}`
}

/**
 * Chunk PDF text into semantic sections
 * Uses paragraph boundaries to preserve context
 */
export function chunkPDF(pdfText: string, chunkSize: number = 1000, overlap: number = 200): PDFChunk[] {
  if (!pdfText) return []
  
  const chunks: PDFChunk[] = []
  const paragraphs = pdfText.split(/\n\s*\n/)
  
  let currentChunk = ''
  let currentStart = 0
  let chunkIndex = 0
  
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i].trim()
    if (!para) continue
    
    // If adding this paragraph would exceed chunk size, finalize current chunk
    if (currentChunk && (currentChunk.length + para.length > chunkSize)) {
      const chunkEnd = currentStart + currentChunk.length
      chunks.push({
        id: `chunk_${chunkIndex++}`,
        text: currentChunk.trim(),
        start: currentStart,
        end: chunkEnd
      })
      
      // Start new chunk with overlap (last part of previous chunk)
      const overlapText = currentChunk.slice(-overlap)
      currentChunk = overlapText + '\n\n' + para
      currentStart = chunkEnd - overlap
    } else {
      if (currentChunk) {
        currentChunk += '\n\n' + para
      } else {
        currentChunk = para
        currentStart = pdfText.indexOf(para, currentStart)
      }
    }
  }
  
  // Add final chunk
  if (currentChunk.trim()) {
    chunks.push({
      id: `chunk_${chunkIndex++}`,
      text: currentChunk.trim(),
      start: currentStart,
      end: currentStart + currentChunk.length
    })
  }
  
  return chunks
}

/**
 * Simple tokenizer - splits text into words and normalizes them
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remove punctuation
    .split(/\s+/)
    .filter(word => word.length > 2) // Filter out very short words
}

/**
 * Calculate TF-IDF based similarity between query and document chunk
 * This is a lightweight alternative to neural embeddings
 */
function calculateTFIDFSimilarity(query: string, chunkText: string, allChunks: PDFChunk[]): number {
  const queryTokens = new Set(tokenize(query))
  const chunkTokens = tokenize(chunkText)
  
  if (queryTokens.size === 0 || chunkTokens.length === 0) return 0
  
  // Calculate term frequency (TF) in the chunk
  const chunkTokenCounts = new Map<string, number>()
  chunkTokens.forEach(token => {
    chunkTokenCounts.set(token, (chunkTokenCounts.get(token) || 0) + 1)
  })
  
  // Calculate inverse document frequency (IDF) across all chunks
  const docFreq = new Map<string, number>()
  allChunks.forEach(chunk => {
    const tokens = new Set(tokenize(chunk.text))
    tokens.forEach(token => {
      docFreq.set(token, (docFreq.get(token) || 0) + 1)
    })
  })
  
  const totalDocs = allChunks.length
  
  // Calculate TF-IDF score for query terms in this chunk
  let score = 0
  queryTokens.forEach(queryToken => {
    const tf = (chunkTokenCounts.get(queryToken) || 0) / chunkTokens.length
    const df = docFreq.get(queryToken) || 1
    const idf = Math.log(totalDocs / df)
    score += tf * idf
  })
  
  // Normalize by query length
  return score / queryTokens.size
}

/**
 * Index a PDF: chunk it for TF-IDF search
 * This is the "pre-processing" step that happens ONCE when PDF is uploaded
 * Uses lightweight TF-IDF (no API keys, no external dependencies)
 * 
 * @param pdfText - The extracted PDF text
 * @param onProgress - Optional callback for progress updates (0-1)
 * @returns PDF ID for later retrieval
 */
export async function indexPDF(
  pdfText: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  const pdfId = hashPDF(pdfText)
  
  // Check if already indexed
  if (pdfIndices.has(pdfId)) {
    onProgress?.(1)
    return pdfId
  }
  
  onProgress?.(0)
  
  // Step 1: Chunk the PDF
  const chunks = chunkPDF(pdfText, 1000, 200)
  
  // Step 2: Store the index (no embeddings needed for TF-IDF)
  pdfIndices.set(pdfId, {
    pdfId,
    chunks,
    createdAt: Date.now()
  })
  
  onProgress?.(1)
  return pdfId
}

/**
 * Search for relevant chunks using TF-IDF similarity
 * Lightweight, no API keys required, works entirely client-side
 */
export async function searchPDFChunks(
  pdfId: string,
  query: string,
  topK: number = 5
): Promise<Array<{ chunk: PDFChunk; score: number }>> {
  const index = pdfIndices.get(pdfId)
  if (!index) {
    return []
  }
  
  // Use TF-IDF for semantic search
  const scoredChunks = index.chunks
    .map(chunk => ({
      chunk,
      score: calculateTFIDFSimilarity(query, chunk.text, index.chunks)
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
  
  return scoredChunks
}

/**
 * Get relevant context from PDF using TF-IDF RAG approach
 * Assumes PDF is already indexed (indexing happens once on upload)
 * Uses lightweight TF-IDF (no API keys required)
 */
export async function getRAGContext(
  pdfText: string,
  query: string,
  maxTokens: number
): Promise<string> {
  // Step 1: Get PDF ID (index should already exist from upload)
  const pdfId = hashPDF(pdfText)
  
  // If not indexed yet, index it now (shouldn't happen, but fallback)
  if (!pdfIndices.has(pdfId)) {
    await indexPDF(pdfText, undefined)
  }
  
  // Step 2: Search for relevant chunks
  const maxChars = maxTokens * 4
  const topK = Math.max(3, Math.floor(maxChars / 1000)) // Adjust based on available space
  const results = await searchPDFChunks(pdfId, query, topK)
  
  if (results.length === 0) {
    // Fallback: return beginning + end
    return pdfText.length <= maxChars 
      ? pdfText 
      : pdfText.substring(0, maxChars * 0.6) + '\n\n[...]\n\n' + pdfText.substring(pdfText.length - maxChars * 0.4)
  }
  
  // Step 3: Combine relevant chunks
  let context = ''
  let usedChars = 0
  
  for (const { chunk } of results) {
    if (usedChars >= maxChars * 0.9) break
    
    const chunkText = chunk.text
    if (usedChars + chunkText.length <= maxChars) {
      if (context) context += '\n\n---\n\n'
      context += chunkText
      usedChars += chunkText.length + 10 // +10 for separator
    } else {
      // Partial chunk if space allows
      const remaining = maxChars - usedChars - 10
      if (remaining > 200) {
        if (context) context += '\n\n---\n\n'
        context += chunkText.substring(0, remaining) + '...'
      }
      break
    }
  }
  
  return context || pdfText.substring(0, maxChars)
}

/**
 * Clear cached indices (useful for memory management)
 */
export function clearPDFIndices(): void {
  pdfIndices.clear()
}

