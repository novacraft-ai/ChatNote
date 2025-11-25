// Event type definitions based on your requirements

export type AIMode = 'auto' | 'reasoning' | 'advanced';
export type UIMode = 'floating' | 'split';
export type NoteViewMode = 'following' | 'stack';
export type AnnotationTool = 'highlight' | 'text' | 'image';
export type AIResultAction = 'add_to_pdf' | 'save_note';
export type ErrorType = 'upload_fail' | 'ai_timeout';

// Event property types
export interface PageViewedProperties {
  // Empty object
}

export interface QuerySubmittedProperties {
  ai_mode: AIMode;
  ui_mode: UIMode;
  is_contextual: boolean;
}

export interface AIResponseRenderedProperties {
  ai_mode: AIMode;
  response_time_ms: number;
}

export interface AIResultActionProperties {
  action_type: AIResultAction;
}

export interface PDFUploadedProperties {
  file_size_mb: number;
}

export interface AnnotationAddedProperties {
  tool_name: AnnotationTool;
}

export interface PDFExportedProperties {
  include_annotations: boolean;
}

export interface NoteModeViewedProperties {
  view_mode: NoteViewMode;
  duration_ms: number;
}

export interface ErrorOccurredProperties {
  error_type: ErrorType;
  error_message: string;
}

// Union type for all event properties
export type EventProperties = 
  | PageViewedProperties
  | QuerySubmittedProperties
  | AIResponseRenderedProperties
  | AIResultActionProperties
  | PDFUploadedProperties
  | AnnotationAddedProperties
  | PDFExportedProperties
  | NoteModeViewedProperties
  | ErrorOccurredProperties;

// Event name type
export type EventName = 
  | 'page_viewed'
  | 'query_submitted'
  | 'ai_response_rendered'
  | 'ai_result_action'
  | 'pdf_uploaded'
  | 'annotation_added'
  | 'pdf_exported'
  | 'note_mode_viewed'
  | 'error_occurred';

// Event payload structure
export interface TrackEventPayload {
  eventName: EventName;
  properties: EventProperties;
  documentId?: string;
}
