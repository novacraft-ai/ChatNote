/**
 * Interaction Mode Types
 * Defines the new interaction paradigm for ChatNote
 */

// Primary interaction modes
export type InteractionMode = 'guide-me-learn' | 'quiz-me' | null

// Quiz types
export type QuizQuestionType = 'multiple-choice' | 'true-false' | 'short-answer' | 'fill-blank'

export interface QuizOption {
  id: string
  text: string
  isCorrect: boolean
}

export interface QuizQuestion {
  id: string
  type: QuizQuestionType
  question: string
  options?: QuizOption[]  // For multiple choice
  correctAnswer: string | string[]  // For other types
  explanation: string
  pageReference?: number
  difficulty: 'easy' | 'medium' | 'hard'
}

export interface QuizSession {
  questions: QuizQuestion[]
  currentQuestionIndex: number
  answers: Map<string, string>
  score: number
  startTime: Date
  endTime?: Date
  isComplete: boolean
}

// Quiz history for saving completed quizzes
export interface QuizAttempt {
  attemptNumber: number
  score: number
  totalQuestions: number
  completedAt: Date
  timeSpent: number // in seconds
  answers: Record<string, string> // questionId -> user answer
}

export interface QuizHistory {
  id: string
  pdfId: string
  pdfName: string
  questions: QuizQuestion[]
  attempts: QuizAttempt[]
  createdAt: Date
  lastAttemptAt: Date
  bestScore: number
  totalAttempts: number
}
