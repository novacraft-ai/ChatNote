export interface PDFPageBlock {
  type: 'heading' | 'paragraph'
  text: string
  level?: number
}

export interface PDFFigure {
  id: string
  label: string
  pageNumber: number
  caption: string
  altText?: string
  context?: string
  previewDataUrl?: string
}

export interface PDFPageContent {
  pageNumber: number
  text: string
  blocks: PDFPageBlock[]
  figures: PDFFigure[]
  pageImageDataUrl?: string  // Full page rendered as image (base64 data URL)
}

export interface PDFExtractionResult {
  fullText: string
  pages: PDFPageContent[]
  fileName?: string  // Filename for PageIndex cache lookup
  contentHash?: string  // SHA256 hash of PDF content for cache correctness
  pdfId?: string  // Unique document ID from Drive for PageIndex namespacing
}

export interface RAGEvidence {
  id: string
  text?: string
  citation?: string
  type?: 'text' | 'figure'
  pageNumber?: number
  pages?: number[]  // For PageIndex evidence (page range)
  sectionPath?: string[]
  figurePreview?: string  // Base64 data URL for figure previews
  figureId?: string
  figureLabel?: string
  title?: string  // For PageIndex tree nodes
  summary?: string  // For PageIndex tree nodes
}

export interface RAGContextResult {
  contextText: string
  evidence: RAGEvidence[]
}
