import { createClient } from '@supabase/supabase-js';

// Supabase configuration
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Only warn during development to avoid noisy logs in production builds
  if (import.meta.env.DEV) {
    console.warn('Supabase environment variables not configured. Analytics tracking will be disabled.');
  }
}

// Create Supabase client
export const supabase = supabaseUrl && supabaseAnonKey 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Database types for type safety
export interface User {
  user_id: string;
  email: string;
  first_login_at: string;
  created_at: string;
  updated_at: string;
}

export interface Document {
  document_id: string;
  owner_user_id: string;
  upload_at: string;
  file_size_mb: number;
  has_annotations: boolean;
  has_notes: boolean;
  has_export: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserEvent {
  event_id?: number;
  session_id: string;
  user_id: string;
  document_id?: string | null;
  event_timestamp?: string;
  event_name: string;
  properties: Record<string, any>;
  created_at?: string;
}

export default supabase;
