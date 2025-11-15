import React from 'react'
import { KnowledgeNote } from '../types/knowledgeNotes'
import './KnowledgeNoteConnections.css'

interface KnowledgeNoteConnectionsProps {
  pageNumber: number
  pageWidth: number
  pageHeight: number
  scale: number
  knowledgeNotes: KnowledgeNote[]
  showKnowledgeNotes: boolean
  layout: 'floating' | 'split'
  onNoteClick?: (note: KnowledgeNote) => void
}

const KnowledgeNoteConnections: React.FC<KnowledgeNoteConnectionsProps> = ({
  pageNumber,
  pageWidth,
  pageHeight,
  scale,
  knowledgeNotes,
  showKnowledgeNotes,
  onNoteClick,
}) => {
  // Filter notes for this page
  const pageNotes = knowledgeNotes.filter((note) => note.pageNumber === pageNumber)

  if (!showKnowledgeNotes || pageNotes.length === 0) {
    return null
  }

  const pixelWidth = pageWidth * scale
  const pixelHeight = pageHeight * scale

  return (
    <div 
      className="knowledge-note-connections" 
      style={{ 
        width: `${pixelWidth}px`, 
        height: `${pixelHeight}px`,
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      <svg
        className="connection-svg"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          overflow: 'visible',
        }}
      >
        {pageNotes.map((note, index) => {
          // Place markers at top-right corner, stacked vertically
          const markerX = pixelWidth - 25
          const markerY = 25 + index * 35

          return (
            <g key={note.id}>
              {/* Marker on page */}
              <circle
                cx={markerX}
                cy={markerY}
                r="10"
                fill="#4285f4"
                stroke="white"
                strokeWidth="2"
                className="knowledge-note-marker"
                onClick={(e) => {
                  e.stopPropagation()
                  onNoteClick?.(note)
                }}
                style={{ cursor: 'pointer', pointerEvents: 'all' }}
              />
              <text
                x={markerX}
                y={markerY}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize="11"
                fontWeight="bold"
                pointerEvents="none"
              >
                {index + 1}
              </text>
              {/* Tooltip line indicator */}
              <line
                x1={markerX}
                y1={markerY + 12}
                x2={markerX}
                y2={markerY + 20}
                stroke="#4285f4"
                strokeWidth="2"
                opacity="0.7"
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export default KnowledgeNoteConnections

