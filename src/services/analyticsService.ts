import { BACKEND_URL } from '../config';
import { EventName, EventProperties } from '../types/analytics';

class AnalyticsService {
  private sessionId: string;
  private userId: string | null = null;
  private currentDocumentId: string | null = null;
  
  // Track note mode viewing start time
  private noteModeStartTime: number | null = null;
  private currentNoteMode: 'following' | 'stack' | null = null;

  constructor() {
    // Restore or generate session ID for this tab/session
    const storedSessionId = typeof window !== 'undefined'
      ? sessionStorage.getItem('analytics_session_id')
      : null;
    if (storedSessionId) {
      this.sessionId = storedSessionId;
    } else {
      this.sessionId = this.generateSessionId();
      try {
        sessionStorage.setItem('analytics_session_id', this.sessionId);
      } catch {}
    }
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  // Remove random user ID generation; always use setUserId from AuthContext

  /**
   * Generate a unique document ID
   */
  generateDocumentId(): string {
    return `doc_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Set the current user ID
   */
  setUserId(userId: string): void {
    this.userId = userId;
    // Store in localStorage for persistence
    localStorage.setItem('analytics_user_id', userId);
  }

  /**
   * Get the current user ID
   */
  getUserId(): string | null {
    if (!this.userId) {
      // Try to retrieve from localStorage
      this.userId = localStorage.getItem('analytics_user_id');
    }
    return this.userId;
  }

  /**
   * Set the current document ID
   */
  setCurrentDocument(documentId: string): void {
    this.currentDocumentId = documentId;
  }

  /**
   * Clear the current document ID
   */
  clearCurrentDocument(): void {
    this.currentDocumentId = null;
  }

  /**
   * Get the current document ID
   */
  getCurrentDocumentId(): string | null {
    return this.currentDocumentId;
  }

  /**
   * Track an event
   */
  async trackEvent(
    eventName: EventName,
    properties: EventProperties,
    documentId?: string
  ): Promise<void> {
    // Get userId from AuthContext (Google ID)
    const userId = this.getUserId();
    if (!userId) {
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/internal/logs/event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          eventName,
          properties: { ...properties, user_id: userId },
          documentId,
          sessionId: this.sessionId
        })
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('[Analytics] Failed to track event:', eventName, error);
      }
    } catch (error) {
      console.error('[Analytics] Error tracking event:', eventName, error);
    }
  }

  /**
   * Track page view - should only be called once after successful login
   */
  async trackPageView(): Promise<void> {
    await this.trackEvent('page_viewed', {});
  }

  /**
   * Reset analytics state (call on logout)
   */
  async resetAnalytics(): Promise<void> {
    // End any ongoing note mode tracking before resetting
    await this.endNoteModeTracking();
    
    this.userId = null;
    this.currentDocumentId = null;
    this.noteModeStartTime = null;
    this.currentNoteMode = null;
    // Clear user ID from localStorage
    try {
      localStorage.removeItem('analytics_user_id');
    } catch {}
  }

  /**
   * Track query submission
   */
  async trackQuerySubmitted(
    aiMode: 'auto' | 'quick' | 'thinking',
    uiMode: 'floating' | 'split',
    isContextual: boolean
  ): Promise<void> {
    await this.trackEvent('query_submitted', {
      ai_mode: aiMode,
      ui_mode: uiMode,
      is_contextual: isContextual,
    });
  }

  /**
   * Track AI response completion
   */
  async trackAIResponse(
    aiMode: 'auto' | 'quick' | 'thinking',
    responseTimeMs: number
  ): Promise<void> {
    await this.trackEvent('ai_response_rendered', {
      ai_mode: aiMode,
      response_time_ms: responseTimeMs,
    });
  }

  /**
   * Track AI result action (add to PDF or save note)
   */
  async trackAIResultAction(
    actionType: 'add_to_pdf' | 'save_note'
  ): Promise<void> {
    await this.trackEvent('ai_result_action', {
      action_type: actionType,
    });
  }

  /**
   * Track PDF upload
   */
  async trackPDFUpload(fileSizeMb: number, documentId: string): Promise<void> {
    await this.trackEvent('pdf_uploaded', {
      file_size_mb: fileSizeMb,
    }, documentId);
  }

  /**
   * Track annotation addition
   */
  async trackAnnotationAdded(
    toolName: 'highlight' | 'text' | 'image'
  ): Promise<void> {
    await this.trackEvent('annotation_added', {
      tool_name: toolName,
    });
  }

  /**
   * Track PDF export
   */
  async trackPDFExport(includeAnnotations: boolean): Promise<void> {
    await this.trackEvent('pdf_exported', {
      include_annotations: includeAnnotations,
    });
  }

  /**
   * Start tracking note mode viewing
   * If already tracking a different mode, end the previous tracking first
   */
  async startNoteModeTracking(mode: 'following' | 'stack'): Promise<void> {
    // If we're already tracking a different mode, end it first and insert the record
    if (this.noteModeStartTime !== null && this.currentNoteMode !== null && this.currentNoteMode !== mode) {
      // Calculate duration for the OLD mode
      const durationMs = Date.now() - this.noteModeStartTime;

      // Insert record for the OLD mode if duration is meaningful
      if (durationMs >= 100) {
        await this.trackEvent('note_mode_viewed', {
          view_mode: this.currentNoteMode, // Use the OLD mode
          duration_ms: durationMs,
        });
      }
      
      // Reset state
      this.noteModeStartTime = null;
      this.currentNoteMode = null;
    }

    // Start tracking the new mode only if not already tracking
    if (this.noteModeStartTime === null) {
      this.noteModeStartTime = Date.now();
      this.currentNoteMode = mode;
    }
  }

  /**
   * End tracking note mode viewing and send event to database
   */
  async endNoteModeTracking(): Promise<void> {
    if (this.noteModeStartTime === null || this.currentNoteMode === null) {
      return;
    }

    const durationMs = Date.now() - this.noteModeStartTime;

    // Only track if duration is meaningful (at least 100ms)
    if (durationMs >= 100) {
      await this.trackEvent('note_mode_viewed', {
        view_mode: this.currentNoteMode,
        duration_ms: durationMs,
      });
    }

    // Reset tracking state
    this.noteModeStartTime = null;
    this.currentNoteMode = null;
  }

  /**
   * Track error occurrence
   */
  async trackError(
    errorType: 'upload_fail' | 'ai_timeout',
    errorMessage: string
  ): Promise<void> {
    await this.trackEvent('error_occurred', {
      error_type: errorType,
      error_message: errorMessage,
    });
  }

  /**
   * Create or update user in database
   */
  async upsertUser(userId: string, email: string): Promise<void> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/internal/logs/user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ userId, email })
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Failed to upsert user:', error);
      }
    } catch (error) {
      console.error('Error upserting user:', error);
    }
  }

  /**
   * Create document record in database
   */
  async createDocument(
    documentId: string,
    fileSizeMb: number
  ): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/internal/logs/document`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ documentId, fileSizeMb })
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Failed to create document:', error);
      }
    } catch (error) {
      console.error('Error creating document:', error);
    }
  }

  /**
   * Update document flags
   */
  async updateDocument(
    documentId: string,
    updates: {
      has_annotations?: boolean;
      has_notes?: boolean;
      has_export?: boolean;
    }
  ): Promise<void> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/internal/logs/document/${documentId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify(updates)
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Failed to update document:', error);
      }
    } catch (error) {
      console.error('Error updating document:', error);
    }
  }
}

// Export singleton instance
export const analytics = new AnalyticsService();
export default analytics;
