/**
 * Quiz Interface Component
 * Interactive quiz UI with multiple choice questions and scoring
 */

import { useState, useEffect } from 'react'
import { QuizSession, QuizQuestionType, QuizQuestion } from '../types/interactionModes'
import { evaluateAnswer } from '../services/quizService'
import QuizReview from './QuizReview'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { preprocessMathContent } from '../utils/markdownUtils'
import './QuizInterface.css'

interface QuizInterfaceProps {
  session: QuizSession
  onAnswer: (questionId: string, answer: string) => void
  onNextQuestion: () => void
  onPreviousQuestion: () => void
  onRequestMore: (count: number, type?: QuizQuestionType) => void
  onFinish: () => void
  onRestart: () => void
  onAddToPDF?: (question: QuizQuestion, answer: string, isCorrect: boolean) => void
  onAddToNotes?: (question: QuizQuestion, answer: string, isCorrect: boolean) => void
  onExitReview?: () => void
}

export default function QuizInterface({
  session,
  onAnswer,
  onNextQuestion,
  onPreviousQuestion,
  onRequestMore,
  onFinish,
  onRestart,
  onAddToPDF,
  onAddToNotes,
  onExitReview
}: QuizInterfaceProps) {
  const [selectedAnswer, setSelectedAnswer] = useState<string>('')
  const [showExplanation, setShowExplanation] = useState(false)
  const [showRequestMore, setShowRequestMore] = useState(false)
  const [showReview, setShowReview] = useState(false)

  const currentQuestion = session.questions[session.currentQuestionIndex]
  const isLastQuestion = session.currentQuestionIndex === session.questions.length - 1
  const isFirstQuestion = session.currentQuestionIndex === 0
  const hasAnswered = session.answers.has(currentQuestion?.id || '')

  // Sync selectedAnswer when question changes or when navigating to a previously answered question
  useEffect(() => {
    const existingAnswer = session.answers.get(currentQuestion?.id || '')
    if (existingAnswer && hasAnswered) {
      // If the question was already answered, show the existing answer
      setSelectedAnswer(existingAnswer)
      setShowExplanation(true)
    } else {
      // Clear for new questions
      setSelectedAnswer('')
      setShowExplanation(false)
    }
  }, [session.currentQuestionIndex, currentQuestion?.id, hasAnswered, session.answers])

  const handleAnswerSelect = (answer: string) => {
    if (hasAnswered) return
    
    setSelectedAnswer(answer)
    onAnswer(currentQuestion.id, answer)
    setShowExplanation(true)
  }

  const handleNext = () => {
    // selectedAnswer and showExplanation will be updated by useEffect when question changes
    if (isLastQuestion) {
      onFinish()
    } else {
      onNextQuestion()
    }
  }

  const handlePrevious = () => {
    // selectedAnswer and showExplanation will be updated by useEffect when question changes
    onPreviousQuestion()
  }

  const handleRequestMore = (count: number, type?: QuizQuestionType) => {
    setShowRequestMore(false)
    onRequestMore(count, type)
  }

  if (!currentQuestion) {
    return (
      <div className="quiz-interface">
        <div className="quiz-empty">
          <h3>Loading quiz...</h3>
        </div>
      </div>
    )
  }

  if (session.isComplete) {
    // Show review if requested
    if (showReview) {
      return (
        <QuizReview
          questions={session.questions}
          userAnswers={session.answers}
          score={session.score}
          onAddToPDF={onAddToPDF || (() => {})}
          onAddToNotes={onAddToNotes || (() => {})}
          onRetake={() => {
            setShowReview(false)
            onRestart()
          }}
          onExit={() => {
            setShowReview(false)
            if (onExitReview) onExitReview()
          }}
        />
      )
    }

    const totalQuestions = session.questions.length
    const correctAnswers = Array.from(session.answers.entries()).filter(([qId, answer]) => {
      const question = session.questions.find(q => q.id === qId)
      if (!question) return false
      return evaluateAnswer(question, answer).isCorrect
    }).length

    const percentage = Math.round((correctAnswers / totalQuestions) * 100)

    return (
      <div className="quiz-interface quiz-complete">
        <div className="quiz-results">
          <div className="results-header">
            <div className="trophy-icon">🏆</div>
            <h2>Quiz Complete!</h2>
          </div>

          <div className="score-circle">
            <svg viewBox="0 0 200 200">
              <circle
                cx="100"
                cy="100"
                r="90"
                fill="none"
                stroke="#e5e7eb"
                strokeWidth="20"
              />
              <circle
                cx="100"
                cy="100"
                r="90"
                fill="none"
                stroke="url(#scoreGradient)"
                strokeWidth="20"
                strokeDasharray={`${percentage * 5.65} 565`}
                strokeLinecap="round"
                transform="rotate(-90 100 100)"
              />
              <defs>
                <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#667eea" />
                  <stop offset="100%" stopColor="#764ba2" />
                </linearGradient>
              </defs>
            </svg>
            <div className="score-text">
              <div className="score-percentage">{percentage}%</div>
              <div className="score-label">{correctAnswers} / {totalQuestions}</div>
            </div>
          </div>

          <div className="performance-label">
            {percentage >= 90 && '🌟 Excellent!'}
            {percentage >= 70 && percentage < 90 && '👍 Good job!'}
            {percentage >= 50 && percentage < 70 && '📚 Keep studying!'}
            {percentage < 50 && '💪 Practice more!'}
          </div>

          <div className="results-actions">
            <button className="result-btn primary" onClick={() => setShowReview(true)}>
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 5H7C6.46957 5 5.96086 5.21071 5.58579 5.58579C5.21071 5.96086 5 6.46957 5 7V19C5 19.5304 5.21071 20.0391 5.58579 20.4142C5.96086 20.7893 6.46957 21 7 21H17C17.5304 21 18.0391 20.7893 18.4142 20.4142C18.7893 20.0391 19 19.5304 19 19V7C19 6.46957 18.7893 5.96086 18.4142 5.58579C18.0391 5.21071 17.5304 5 17 5H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 5C9 4.46957 9.21071 3.96086 9.58579 3.58579C9.96086 3.21071 10.4696 3 11 3H13C13.5304 3 14.0391 3.21071 14.4142 3.58579C14.7893 3.96086 15 4.46957 15 5C15 5.53043 14.7893 6.03914 14.4142 6.41421C14.0391 6.78929 13.5304 7 13 7H11C10.4696 7 9.96086 6.78929 9.58579 6.41421C9.21071 6.03914 9 5.53043 9 5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 12H15M9 16H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Review Answers
            </button>
            <button className="result-btn" onClick={onRestart}>
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 4V10H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M23 20V14H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M20.49 9C19.9828 7.56678 19.1209 6.28536 17.9845 5.27541C16.8482 4.26546 15.4745 3.55977 13.9917 3.22426C12.5089 2.88875 10.9652 2.93434 9.50481 3.35677C8.04437 3.77921 6.71475 4.56471 5.64 5.64L1 10M23 14L18.36 18.36C17.2853 19.4353 15.9556 20.2208 14.4952 20.6432C13.0348 21.0657 11.4911 21.1112 10.0083 20.7757C8.52547 20.4402 7.1518 19.7345 6.01547 18.7246C4.87913 17.7146 4.01717 16.4332 3.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Try Again
            </button>
            <button className="result-btn" onClick={() => setShowRequestMore(true)}>
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              More Questions
            </button>
          </div>

          {showRequestMore && (
            <div className="request-more-panel">
              <h4>Request More Questions</h4>
              <div className="more-options">
                <button onClick={() => handleRequestMore(5)}>
                  +5 Mixed Questions
                </button>
                <button onClick={() => handleRequestMore(5, 'multiple-choice')}>
                  +5 Multiple Choice
                </button>
                <button onClick={() => handleRequestMore(10)}>
                  +10 Mixed Questions
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  const userAnswer = session.answers.get(currentQuestion.id)
  const evaluation = userAnswer ? evaluateAnswer(currentQuestion, userAnswer) : null

  return (
    <div className="quiz-interface">
      {/* Quiz Header */}
      <div className="quiz-header">
        <div className="quiz-progress">
          <div className="progress-text">
            Question {session.currentQuestionIndex + 1} of {session.questions.length}
          </div>
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ width: `${((session.currentQuestionIndex + 1) / session.questions.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="quiz-score">
          Score: {session.score} / {session.questions.length}
        </div>
      </div>

      {/* Question Card */}
      <div className="question-card">
        <div className="question-header">
          <span className={`difficulty-badge ${currentQuestion.difficulty}`}>
            {currentQuestion.difficulty}
          </span>
          {currentQuestion.pageReference && (
            <span className="page-ref">Page {currentQuestion.pageReference}</span>
          )}
        </div>

        <div className="question-text">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
          >
            {preprocessMathContent(currentQuestion.question)}
          </ReactMarkdown>
        </div>

        {/* Multiple Choice Options */}
        {currentQuestion.type === 'multiple-choice' && currentQuestion.options && (
          <div className="options-list">
            {currentQuestion.options.map(option => {
              const isSelected = selectedAnswer === option.id || userAnswer === option.id
              const isCorrect = option.isCorrect
              const showCorrect = hasAnswered && isCorrect
              const showIncorrect = hasAnswered && isSelected && !isCorrect

              return (
                <button
                  key={option.id}
                  className={`option-btn ${isSelected ? 'selected' : ''} ${showCorrect ? 'correct' : ''} ${showIncorrect ? 'incorrect' : ''}`}
                  onClick={() => handleAnswerSelect(option.id)}
                  disabled={hasAnswered}
                >
                  <div className="option-letter">{option.id.toUpperCase()}</div>
                  <div className="option-text">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
                    >
                      {preprocessMathContent(option.text)}
                    </ReactMarkdown>
                  </div>
                  {showCorrect && <div className="option-icon">✓</div>}
                  {showIncorrect && <div className="option-icon">✗</div>}
                </button>
              )
            })}
          </div>
        )}

        {/* True/False Options */}
        {currentQuestion.type === 'true-false' && (
          <div className="true-false-options">
            {['true', 'false'].map(option => {
              const isSelected = selectedAnswer === option || userAnswer === option
              const isCorrect = currentQuestion.correctAnswer === option
              const showCorrect = hasAnswered && isCorrect
              const showIncorrect = hasAnswered && isSelected && !isCorrect

              return (
                <button
                  key={option}
                  className={`tf-btn ${isSelected ? 'selected' : ''} ${showCorrect ? 'correct' : ''} ${showIncorrect ? 'incorrect' : ''}`}
                  onClick={() => handleAnswerSelect(option)}
                  disabled={hasAnswered}
                >
                  <div className="tf-icon">
                    {option === 'true' ? '✓' : '✗'}
                  </div>
                  <div className="tf-text">{option === 'true' ? 'True' : 'False'}</div>
                  {showCorrect && <div className="option-icon">✓</div>}
                  {showIncorrect && <div className="option-icon">✗</div>}
                </button>
              )
            })}
          </div>
        )}

        {/* Short Answer Input */}
        {currentQuestion.type === 'short-answer' && (
          <div className="short-answer-container">
            <textarea
              className="short-answer-input"
              placeholder="Type your answer here..."
              value={selectedAnswer}
              onChange={(e) => setSelectedAnswer(e.target.value)}
              disabled={hasAnswered}
              rows={4}
            />
            {!hasAnswered && (
              <button 
                className="submit-answer-btn"
                onClick={() => handleAnswerSelect(selectedAnswer)}
                disabled={!selectedAnswer.trim()}
              >
                Submit Answer
              </button>
            )}
          </div>
        )}

        {/* Fill in the Blank Input */}
        {currentQuestion.type === 'fill-blank' && (
          <div className="fill-blank-container">
            <input
              type="text"
              className="fill-blank-input"
              placeholder="Type your answer..."
              value={selectedAnswer}
              onChange={(e) => setSelectedAnswer(e.target.value)}
              disabled={hasAnswered}
            />
            {!hasAnswered && (
              <button 
                className="submit-answer-btn"
                onClick={() => handleAnswerSelect(selectedAnswer)}
                disabled={!selectedAnswer.trim()}
              >
                Submit Answer
              </button>
            )}
          </div>
        )}

        {/* Explanation */}
        {showExplanation && evaluation && (
          <div className={`explanation ${evaluation.isCorrect ? 'correct' : 'incorrect'}`}>
            <div className="explanation-header">
              {evaluation.isCorrect ? '✅ Correct!' : '❌ Incorrect'}
            </div>
            <div className="explanation-text">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
              >
                {preprocessMathContent(currentQuestion.explanation)}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="quiz-navigation">
        <button
          className="nav-btn"
          onClick={handlePrevious}
          disabled={isFirstQuestion}
        >
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Previous
        </button>

        {hasAnswered && (
          <button className="nav-btn primary" onClick={handleNext}>
            {isLastQuestion ? 'Finish Quiz' : 'Next Question'}
            {!isLastQuestion && (
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Request More Button */}
      <button className="request-more-btn" onClick={() => setShowRequestMore(!showRequestMore)}>
        + Request More Questions
      </button>

      {showRequestMore && (
        <div className="request-more-panel">
          <h4>Add More Questions</h4>
          <div className="more-options">
            <button onClick={() => handleRequestMore(5)}>
              +5 Questions
            </button>
            <button onClick={() => handleRequestMore(5, 'multiple-choice')}>
              +5 Multiple Choice
            </button>
            <button onClick={() => handleRequestMore(10)}>
              +10 Questions
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
