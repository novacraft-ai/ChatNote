/**
 * Quiz Review Component
 * Comprehensive review screen showing all questions, answers, and actions
 */

import { QuizQuestion } from '../types/interactionModes'
import { evaluateAnswer } from '../services/quizService'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { preprocessMathContent } from '../utils/markdownUtils'
import './QuizReview.css'

interface QuizReviewProps {
  questions: QuizQuestion[]
  userAnswers: Map<string, string>
  score: number
  onAddToPDF: (question: QuizQuestion, answer: string, isCorrect: boolean) => void
  onAddToNotes: (question: QuizQuestion, answer: string, isCorrect: boolean) => void
  onRetake: () => void
  onExit: () => void
}

export default function QuizReview({
  questions,
  userAnswers,
  score,
  onAddToPDF,
  onAddToNotes,
  onRetake,
  onExit
}: QuizReviewProps) {
  const totalQuestions = questions.length
  const percentage = Math.round((score / totalQuestions) * 100)

  const getAnswerText = (question: QuizQuestion, answerId: string): JSX.Element => {
    let text = answerId
    if (question.type === 'multiple-choice' && question.options) {
      const option = question.options.find(opt => opt.id === answerId)
      text = option ? option.text : answerId
    }
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
      >
        {preprocessMathContent(text)}
      </ReactMarkdown>
    )
  }

  const getCorrectAnswerText = (question: QuizQuestion): JSX.Element => {
    let text = 'N/A'
    if (question.type === 'multiple-choice' && question.options) {
      const correctOption = question.options.find(opt => opt.isCorrect)
      text = correctOption ? correctOption.text : 'N/A'
    } else if (Array.isArray(question.correctAnswer)) {
      text = question.correctAnswer.join(', ')
    } else {
      text = question.correctAnswer
    }
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
      >
        {preprocessMathContent(text)}
      </ReactMarkdown>
    )
  }

  return (
    <div className="quiz-review">
      {/* Header with Score Summary */}
      <div className="review-header">
        <div className="score-summary">
          <div className="score-circle-small">
            <svg viewBox="0 0 120 120">
              <circle
                cx="60"
                cy="60"
                r="54"
                fill="none"
                stroke="#e5e7eb"
                strokeWidth="12"
              />
              <circle
                cx="60"
                cy="60"
                r="54"
                fill="none"
                stroke="url(#reviewGradient)"
                strokeWidth="12"
                strokeDasharray={`${percentage * 3.39} 339`}
                strokeLinecap="round"
                transform="rotate(-90 60 60)"
              />
              <defs>
                <linearGradient id="reviewGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#667eea" />
                  <stop offset="100%" stopColor="#764ba2" />
                </linearGradient>
              </defs>
            </svg>
            <div className="score-text-small">
              <div className="score-percentage-small">{percentage}%</div>
            </div>
          </div>
          
          <div className="summary-text">
            <h2>Quiz Review</h2>
            <p className="score-details">
              You answered <strong>{score}</strong> out of <strong>{totalQuestions}</strong> questions correctly
            </p>
            <div className="performance-badge">
              {percentage >= 90 && '🌟 Excellent Work!'}
              {percentage >= 70 && percentage < 90 && '👍 Good Job!'}
              {percentage >= 50 && percentage < 70 && '📚 Keep Studying!'}
              {percentage < 50 && '💪 Practice More!'}
            </div>
          </div>
        </div>

        <div className="header-actions">
          <button className="action-btn secondary" onClick={onRetake}>
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 4V10H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M3.51 15C4.15839 16.8404 5.38734 18.4202 7.01166 19.5014C8.63598 20.5826 10.5677 21.1066 12.5157 20.9945C14.4637 20.8824 16.3226 20.1402 17.8121 18.8798C19.3017 17.6193 20.3413 15.9089 20.7742 14.0064C21.2072 12.1038 21.0101 10.1119 20.2126 8.33111C19.4152 6.55029 18.0605 5.07462 16.3528 4.1235C14.6451 3.17238 12.6769 2.78949 10.7447 3.02841C8.81245 3.26733 7.02091 4.11638 5.64 5.45" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Retake Quiz
          </button>
          <button className="action-btn primary" onClick={onExit}>
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 11L12 14L22 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M21 12V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Done
          </button>
        </div>
      </div>

      {/* Questions Review List */}
      <div className="questions-review-list">
        {questions.map((question, index) => {
          const userAnswer = userAnswers.get(question.id) || ''
          const evaluation = evaluateAnswer(question, userAnswer)
          const isCorrect = evaluation.isCorrect

          return (
            <div key={question.id} className={`review-question-card ${isCorrect ? 'correct' : 'incorrect'}`}>
              {/* Question Header */}
              <div className="review-question-header">
                <div className="question-number-badge">
                  Question {index + 1}
                  {isCorrect ? (
                    <span className="status-icon correct-icon">✓</span>
                  ) : (
                    <span className="status-icon incorrect-icon">✗</span>
                  )}
                </div>
                <div className="question-meta">
                  <span className={`difficulty-badge ${question.difficulty}`}>
                    {question.difficulty}
                  </span>
                  {question.pageReference && (
                    <span className="page-ref">Page {question.pageReference}</span>
                  )}
                </div>
              </div>

              {/* Question Text */}
              <div className="review-question-text">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
                >
                  {preprocessMathContent(question.question)}
                </ReactMarkdown>
              </div>

              {/* Answer Comparison */}
              <div className="answer-comparison">
                <div className={`answer-box ${isCorrect ? 'correct-answer-box' : 'incorrect-answer-box'}`}>
                  <div className="answer-label">Your Answer</div>
                  <div className="answer-content">
                    {userAnswer ? getAnswerText(question, userAnswer) : (
                      <span className="no-answer">No answer provided</span>
                    )}
                  </div>
                </div>

                {!isCorrect && (
                  <div className="answer-box correct-answer-box">
                    <div className="answer-label">Correct Answer</div>
                    <div className="answer-content">
                      {getCorrectAnswerText(question)}
                    </div>
                  </div>
                )}
              </div>

              {/* Explanation */}
              <div className="review-explanation">
                <div className="explanation-label">
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                    <path d="M12 16V12M12 8H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  Explanation
                </div>
                <div className="explanation-content">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
                  >
                    {preprocessMathContent(question.explanation)}
                  </ReactMarkdown>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="review-question-actions">
                <button 
                  className="mini-action-btn"
                  onClick={() => onAddToPDF(question, userAnswer, isCorrect)}
                  title="Add question and answer to PDF as annotation"
                >
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M12 18V12M9 15H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Add to PDF
                </button>
                <button 
                  className="mini-action-btn"
                  onClick={() => onAddToNotes(question, userAnswer, isCorrect)}
                  title="Save question to Knowledge Notes"
                >
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M19 21L12 16L5 21V5C5 4.46957 5.21071 3.96086 5.58579 3.58579C5.96086 3.21071 6.46957 3 7 3H17C17.5304 3 18.0391 3.21071 18.4142 3.58579C18.7893 3.96086 19 4.46957 19 5V21Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Save to Notes
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
