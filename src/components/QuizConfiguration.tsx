import { useState } from 'react'
import './QuizConfiguration.css'
import { QuizQuestionType } from '../types/interactionModes'
import { ApiKeyStatus } from '../services/authService'

export type QuestionTypeOption = QuizQuestionType | 'mixed'

interface QuizConfigurationProps {
  onStartQuiz: (count: number, types: QuizQuestionType[]) => void
  onBack: () => void
  apiKeyStatus?: ApiKeyStatus
}

const QUESTION_LIMITS: Record<QuestionTypeOption, number> = {
  'multiple-choice': 20,
  'true-false': 30,
  'short-answer': 15,
  'fill-blank': 15,
  'mixed': 20
}

function QuizConfiguration({ onStartQuiz, onBack, apiKeyStatus }: QuizConfigurationProps) {
  const [selectedTypes, setSelectedTypes] = useState<QuestionTypeOption[]>(['multiple-choice'])
  const [questionCount, setQuestionCount] = useState(10)

  // Check if user has reached quiz generation limit
  const isQuizLimitReached = apiKeyStatus?.freeTrial && 
                            !apiKeyStatus.hasApiKey && 
                            !apiKeyStatus.isAdmin &&
                            (apiKeyStatus.freeTrial.quizGenerated || 0) >= (apiKeyStatus.freeTrial.quizLimit || 1)

  const getTypeIcon = (type: QuestionTypeOption) => {
    switch (type) {
      case 'multiple-choice':
        return (
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        )
      case 'true-false':
        return (
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9 12l2 2 4-4" />
            <path d="M15 9l-6 6" opacity="0.4" />
          </svg>
        )
      case 'short-answer':
        return (
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        )
      case 'mixed':
        return (
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
        )
    }
  }

  const questionTypeOptions = [
    { value: 'multiple-choice' as QuestionTypeOption, label: 'Multiple Choice', description: 'Select from 4 options' },
    { value: 'true-false' as QuestionTypeOption, label: 'True/False', description: 'Binary choice questions' },
    { value: 'short-answer' as QuestionTypeOption, label: 'Short Answer', description: 'Brief written responses' },
    { value: 'mixed' as QuestionTypeOption, label: 'Mixed', description: 'Combination of types' }
  ]

  const getMaxQuestions = () => {
    if (selectedTypes.length === 0) return 10
    return Math.min(...selectedTypes.map(type => QUESTION_LIMITS[type]))
  }

  const handleTypeToggle = (type: QuestionTypeOption) => {
    if (type === 'mixed') {
      // Mixed is exclusive - deselect all others
      setSelectedTypes(['mixed'])
      if (questionCount < 3) {
        setQuestionCount(3) // Auto-adjust to minimum 3 if current count is less
      }
    } else {
      // Deselect mixed if selecting individual types
      const newTypes = selectedTypes.includes(type)
        ? selectedTypes.filter(t => t !== type)
        : [...selectedTypes.filter(t => t !== 'mixed'), type]
      
      if (newTypes.length === 0) {
        setSelectedTypes(['multiple-choice']) // Always have at least one
      } else {
        setSelectedTypes(newTypes)
        const minCount = newTypes.length; // Minimum count is the number of selected types
        if (questionCount < minCount) {
          setQuestionCount(minCount) // Auto-adjust to minimum count if current count is less
        }
      }
    }
  }

  const handleCountChange = (value: number) => {
    const max = getMaxQuestions()
    const min = selectedTypes.includes('mixed')
      ? 3
      : Math.max(1, selectedTypes.length) // Minimum count is the number of selected types
    setQuestionCount(Math.min(Math.max(min, value), max))
  }

  const handleStartQuiz = () => {
    // Convert selectedTypes to QuizQuestionType[] - if mixed, use all types
    const quizTypes: QuizQuestionType[] = selectedTypes.includes('mixed')
      ? ['multiple-choice', 'true-false', 'short-answer']
      : selectedTypes.filter((t): t is QuizQuestionType => t !== 'mixed')
    
    onStartQuiz(questionCount, quizTypes)
  }

  const maxQuestions = getMaxQuestions()

  return (
    <div className={`quiz-configuration ${isQuizLimitReached ? 'limit-reached' : ''}`}>
      <button className="quiz-config-back" onClick={onBack} title="Back to mode selection">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back
      </button>

      <div className="quiz-config-header">
        <h2>Configure Your Quiz</h2>
        <p>Customize your learning experience</p>
        {isQuizLimitReached && (
          <div className="quiz-limit-warning">
            ⚠️ You've reached your free trial quiz limit. Please add your own API key to generate more quizzes.
          </div>
        )}
      </div>

      <div className="quiz-config-content">
        {/* Question Type Selection */}
        <div className="config-section">
          <h3>Question Types</h3>
          <p className="section-description">Select one or more types (or choose Mixed)</p>
          <div className="question-type-grid">
            {questionTypeOptions.map(option => (
              <button
                key={option.value}
                className={`question-type-card ${selectedTypes.includes(option.value) ? 'selected' : ''}`}
                onClick={() => handleTypeToggle(option.value)}
                disabled={isQuizLimitReached}
              >
                <div className="type-icon">{getTypeIcon(option.value)}</div>
                <div className="type-label">{option.label}</div>
                <div className="type-description">{option.description}</div>
                <div className="type-limit">Max: {QUESTION_LIMITS[option.value]}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Question Count Selection */}
        <div className="config-section">
          <h3>Number of Questions</h3>
          <p className="section-description">
            Choose between 1 and {maxQuestions} questions
          </p>
          
          <div className="question-count-selector">
            <div className="count-input-wrapper">
              <button 
                className="count-btn"
                onClick={() => handleCountChange(questionCount - 1)}
                disabled={questionCount <= 1 || isQuizLimitReached}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              
              <input
                type="number"
                value={questionCount}
                onChange={(e) => handleCountChange(parseInt(e.target.value) || 1)}
                min={1}
                max={maxQuestions}
                className="count-input"
                disabled={isQuizLimitReached}
              />
              
              <button 
                className="count-btn"
                onClick={() => handleCountChange(questionCount + 1)}
                disabled={questionCount >= maxQuestions || isQuizLimitReached}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>

            <input
              type="range"
              value={questionCount}
              onChange={(e) => handleCountChange(parseInt(e.target.value))}
              min={1}
              max={maxQuestions}
              className="count-slider"
              disabled={isQuizLimitReached}
            />
          </div>
        </div>

        {/* Summary & Start Button */}
        <div className="config-summary">
          <div className="summary-info">
            <div className="summary-icon">📝</div>
            <div className="summary-text">
              <strong>{questionCount}</strong> {selectedTypes.join(' + ')} question{questionCount !== 1 ? 's' : ''}
            </div>
          </div>
          
          <button 
            className="start-quiz-btn" 
            onClick={handleStartQuiz}
            disabled={isQuizLimitReached}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            {isQuizLimitReached ? 'Quiz Limit Reached' : 'Generate Quiz'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default QuizConfiguration