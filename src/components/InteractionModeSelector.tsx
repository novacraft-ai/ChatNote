/**
 * Interaction Mode Selector
 * Beautiful UI for selecting between "Guide Me Learn" and "Quiz Me"
 */

import { useState } from 'react'
import { InteractionMode } from '../types/interactionModes'
import './InteractionModeSelector.css'

interface InteractionModeSelectorProps {
  onModeSelect: (mode: InteractionMode) => void
  disabled?: boolean
}

export default function InteractionModeSelector({
  onModeSelect,
  disabled = false
}: InteractionModeSelectorProps) {
  const [hoveredMode, setHoveredMode] = useState<InteractionMode>(null)

  return (
    <div className="interaction-mode-selector">
      <div className="mode-selector-header">
        <h2>How would you like to learn today?</h2>
        <p>Choose your preferred learning experience</p>
      </div>

      <div className="mode-cards">
        {/* Guide Me Learn Card */}
        <button
          className={`mode-card ${hoveredMode === 'guide-me-learn' ? 'hovered' : ''}`}
          onClick={() => !disabled && onModeSelect('guide-me-learn')}
          onMouseEnter={() => setHoveredMode('guide-me-learn')}
          onMouseLeave={() => setHoveredMode(null)}
          disabled={disabled}
        >
          <div className="mode-icon guide-icon">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 2L2 7L12 12L22 7L12 2Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M2 17L12 22L22 17"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M2 12L12 17L22 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h3>Guide Me Learn</h3>
          <p>Interactive learning with AI tutor assistance</p>
          <ul className="mode-features">
            <li>💬 Chat with AI about PDF</li>
            <li>📖 Get detailed explanations</li>
            <li>💡 Ask questions anytime</li>
            <li>🔍 Deep dive into any topic</li>
          </ul>
          <div className="mode-action">
            Start Learning →
          </div>
        </button>

        {/* Quiz Me Card */}
        <button
          className={`mode-card ${hoveredMode === 'quiz-me' ? 'hovered' : ''}`}
          onClick={() => !disabled && onModeSelect('quiz-me')}
          onMouseEnter={() => setHoveredMode('quiz-me')}
          onMouseLeave={() => setHoveredMode(null)}
          disabled={disabled}
        >
          <div className="mode-icon quiz-icon">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M9 11L12 14L22 4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M21 12V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h3>Quiz Me</h3>
          <p>Test your knowledge with AI-generated quizzes</p>
          <ul className="mode-features">
            <li>🎯 Multiple types questions</li>
            <li>🧠 AI-powered generation</li>
            <li>📊 Track your progress</li>
            <li>🔄 Request more questions</li>
          </ul>
          <div className="mode-action">
            Take Quiz →
          </div>
        </button>
      </div>
    </div>
  )
}
