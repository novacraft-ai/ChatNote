export type AnnotationType = 'textbox' | 'image'

export interface BaseAnnotation {
  id: string
  type: AnnotationType
  pageNumber: number
  x: number // Position relative to page (0-1 scale)
  y: number // Position relative to page (0-1 scale)
  width: number // Width relative to page (0-1 scale)
  height: number // Height relative to page (0-1 scale)
  rotation: number // Rotation in degrees (0-360)
}

export interface TextBoxAnnotation extends BaseAnnotation {
  type: 'textbox'
  text: string
  fontSize: number
  color: string
}

export interface ImageAnnotation extends BaseAnnotation {
  type: 'image'
  imageData: string // Base64 or data URL
  imageWidth: number // Original image width
  imageHeight: number // Original image height
}

export type Annotation = TextBoxAnnotation | ImageAnnotation

export const COMMON_COLORS = [
  '#000000', // Black
  '#FF0000', // Red
  '#00FF00', // Green
  '#0000FF', // Blue
  '#FFFF00', // Yellow
  '#FF00FF', // Magenta
  '#00FFFF', // Cyan
  '#FFA500', // Orange
  '#800080', // Purple
  '#FFC0CB', // Pink
]

