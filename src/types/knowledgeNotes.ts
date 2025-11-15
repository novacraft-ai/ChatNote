export interface KnowledgeNote {
  id: string
  content: string // The model response content
  linkedText?: string // Selected text if applicable
  pageNumber?: number // Page number of linked text or current page
  textYPosition?: number // Y position of selected text relative to page (0-1)
  absoluteYPosition?: number // Absolute Y position in PDF viewer (pixels from top)
  createdAt: number // Timestamp
  messageId: string // ID of the message this note was created from
}

