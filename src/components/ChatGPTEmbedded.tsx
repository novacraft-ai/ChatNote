import { useState, useRef, useEffect } from 'react'
import { useTheme } from '../contexts/ThemeContext'
import { useAuth } from '../contexts/AuthContext'
import { sendChatMessage, isChatConfigured, type ChatMessage } from '../services/authenticatedChatService'
import { AUTO_MODELS, REASONING_MODELS, ADVANCED_MODELS, CLASSIFICATION_MODELS, BACKEND_URL } from '../config'
import ModelModeToggle, { type ModelMode } from './ModelModeToggle'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { preprocessMathContent } from '../utils/markdownUtils'
import './ChatGPTEmbedded.css'
import chatNoteIcon from '../assets/chatnote-icon.svg'
import InteractionModeSelector from './InteractionModeSelector'
import QuizInterface from './QuizInterface'
import QuizConfiguration from './QuizConfiguration'
import type { InteractionMode, QuizSession, QuizQuestion } from '../types/interactionModes'
import type { QuizQuestionType } from '../types/interactionModes'
import { generateQuiz, evaluateAnswer } from '../services/quizService'
import { analytics } from '../services/analyticsService'

/**
 * Extract keywords from user question for relevance matching
 */
function extractKeywords(text: string): string[] {
  if (!text) return []

  // Remove common stop words and extract meaningful words
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how', 'about', 'tell', 'me', 'please', 'help', 'does', 'mention', 'any', 'pdf'])

  const textLower = text.toLowerCase()

  // First, extract important multi-word phrases (2-3 words)
  const phrases: string[] = []
  const words = textLower
    .replace(/[^\w\s]/g, ' ') // Remove punctuation
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word))

  // Extract 2-word phrases (e.g., "data distribution", "geolocation features")
  for (let i = 0; i < words.length - 1; i++) {
    const phrase = `${words[i]} ${words[i + 1]}`
    if (words[i].length > 3 && words[i + 1].length > 3) {
      phrases.push(phrase)
    }
  }

  // Extract 3-word phrases for important concepts
  for (let i = 0; i < words.length - 2; i++) {
    const phrase = `${words[i]} ${words[i + 1]} ${words[i + 2]}`
    if (words[i].length > 3 && words[i + 1].length > 2 && words[i + 2].length > 3) {
      phrases.push(phrase)
    }
  }

  // Combine phrases and individual words, prioritizing phrases
  const allKeywords = [...phrases, ...words]

  // Return unique keywords, prioritizing longer phrases/words
  return [...new Set(allKeywords)].sort((a, b) => b.length - a.length)
}

/**
 * Expand query with synonyms and related terms for broader search
 */
function expandQuery(keywords: string[]): string[] {
  const expanded = new Set<string>(keywords)

  // Add synonyms for common terms
  const synonymMap: Record<string, string[]> = {
    'distribution': ['spread', 'scatter', 'allocation', 'dispersion', 'arrangement'],
    'data': ['information', 'dataset', 'sample', 'observation', 'record'],
    'figure': ['chart', 'graph', 'plot', 'diagram', 'visualization', 'illustration'],
    'table': ['matrix', 'grid', 'tabular'],
    'method': ['approach', 'technique', 'algorithm', 'procedure', 'strategy'],
    'result': ['finding', 'outcome', 'conclusion', 'summary', 'finding'],
    'analysis': ['evaluation', 'examination', 'study', 'investigation', 'assessment']
  }

  for (const keyword of keywords) {
    const keywordLower = keyword.toLowerCase()
    // Add the keyword itself
    expanded.add(keywordLower)

    // Add synonyms
    for (const [term, synonyms] of Object.entries(synonymMap)) {
      if (keywordLower.includes(term) || term.includes(keywordLower)) {
        synonyms.forEach(syn => expanded.add(syn))
      }
    }

    // Add stemmed variations (simple stemming)
    if (keywordLower.endsWith('s')) {
      expanded.add(keywordLower.slice(0, -1)) // Remove 's'
    }
    if (keywordLower.endsWith('ed')) {
      expanded.add(keywordLower.slice(0, -2)) // Remove 'ed'
    }
    if (keywordLower.endsWith('ing')) {
      expanded.add(keywordLower.slice(0, -3)) // Remove 'ing'
    }
  }

  return Array.from(expanded)
}

/**
 * Simple keyword-based search: find all occurrences of keywords and extract context
 * This is a more direct approach that should work better for finding specific content
 */
function searchPDFByKeywords(pdfText: string, keywords: string[], maxChars: number): string {
  if (!pdfText || keywords.length === 0) return pdfText

  const contextWindow = 800 // Characters before and after each match
  const matches: Array<{ start: number; end: number; score: number }> = []

  // Find all occurrences of each keyword
  for (const keyword of keywords) {
    const keywordLower = keyword.toLowerCase()
    const regex = new RegExp(keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    let match

    while ((match = regex.exec(pdfText)) !== null) {
      const matchStart = match.index
      const matchEnd = match.index + match[0].length

      // Extract context around the match
      const contextStart = Math.max(0, matchStart - contextWindow)
      const contextEnd = Math.min(pdfText.length, matchEnd + contextWindow)

      // Calculate score based on keyword importance (longer keywords = more important)
      const score = keyword.length > 4 ? 3 : 2

      matches.push({
        start: contextStart,
        end: contextEnd,
        score
      })
    }
  }

  if (matches.length === 0) {
    // No matches found, return beginning + end
    return truncateText(pdfText, Math.floor(maxChars / 4))
  }

  // Sort by position to merge overlapping matches
  matches.sort((a, b) => a.start - b.start)

  // Merge overlapping matches
  const merged: Array<{ start: number; end: number; score: number }> = []
  for (const match of matches) {
    let mergedWith = false
    for (let i = 0; i < merged.length; i++) {
      const existing = merged[i]
      // If matches overlap or are close (within 200 chars), merge them
      if (match.start <= existing.end + 200 && match.end >= existing.start - 200) {
        existing.start = Math.min(existing.start, match.start)
        existing.end = Math.max(existing.end, match.end)
        existing.score += match.score
        mergedWith = true
        break
      }
    }
    if (!mergedWith) {
      merged.push(match)
    }
  }

  // Sort by score (most relevant first)
  merged.sort((a, b) => b.score - a.score)

  // Extract text from merged matches
  let result = ''
  let usedChars = 0

  for (const match of merged) {
    if (usedChars >= maxChars * 0.9) break // Leave 10% buffer

    const matchText = pdfText.substring(match.start, match.end)
    const matchSize = matchText.length

    if (usedChars + matchSize <= maxChars) {
      // Add separator if not first match
      if (result) {
        result += '\n\n---\n\n'
      }
      result += matchText
      usedChars += matchSize + 10 // +10 for separator
    } else {
      // Partial match if space allows
      const remaining = maxChars - usedChars - 10
      if (remaining > 200) {
        if (result) {
          result += '\n\n---\n\n'
        }
        result += matchText.substring(0, remaining) + '...'
      }
      break
    }
  }

  // If we have space, add beginning and end for context
  const remainingSpace = maxChars - usedChars
  if (remainingSpace > 500 && result) {
    const beginningSize = Math.min(remainingSpace * 0.3, 500)
    const endSize = Math.min(remainingSpace * 0.2, 300)
    const beginning = pdfText.substring(0, beginningSize)
    const end = pdfText.substring(Math.max(0, pdfText.length - endSize))

    result = `[Document Introduction]\n${beginning}\n\n---\n\n[Relevant Sections]\n${result}\n\n---\n\n[Document Conclusion]\n${end}`
  } else if (!result) {
    // Fallback: if no matches, return beginning + end
    return truncateText(pdfText, Math.floor(maxChars / 4))
  }

  return result
}

/**
 * Smart PDF context extraction: RAG approach with embeddings
 * Uses standard RAG pattern: index PDF -> search with embeddings -> retrieve relevant chunks
 * Falls back to keyword search if embeddings unavailable
 */
async function extractRelevantPDFContext(
  pdfText: string,
  userQuestion: string,
  maxTokens: number
): Promise<string> {
  if (!pdfText) return pdfText
  const maxChars = maxTokens * 4 // Convert tokens to approximate characters
  if (pdfText.length <= maxChars) return pdfText

  // Try RAG approach first (uses free embedding services - no API key required!)
  try {
    // Check for optional API keys (for better embedding quality)
    // RAG uses TF-IDF (no API keys required)
    const { getRAGContext } = await import('../utils/pdfRAG')
    const ragContext = await getRAGContext(pdfText, userQuestion, maxTokens)
    if (ragContext && ragContext.length > 100) {
      return ragContext
    }
  } catch (error) {
    // Fallback to keyword search on error
  }

  // Fallback: Use keyword-based search
  const keywords = extractKeywords(userQuestion)
  const expandedKeywords = expandQuery(keywords)

  if (expandedKeywords.length === 0) {
    return truncateText(pdfText, maxTokens)
  }

  const searchResult = searchPDFByKeywords(pdfText, expandedKeywords, maxChars)

  if (searchResult && searchResult.length > 100) {
    return searchResult
  }

  return truncateText(pdfText, maxTokens)
}

/**
 * Truncate text intelligently to fit within token limit
 * Preserves both beginning and end of document to avoid cutting off important conclusions
 * Tries to preserve sentences and paragraphs
 * Token estimation: 1 token ≈ 4 characters (rough approximation)
 */
function truncateText(text: string, maxTokens: number): string {
  if (!text) return text
  const maxChars = maxTokens * 4 // Convert tokens to approximate characters
  if (text.length <= maxChars) return text

  // Strategy: Keep beginning + end (important for papers where conclusions are at the end)
  // Allocate 60% to beginning, 40% to end to ensure conclusions aren't lost
  const beginningSize = Math.floor(maxChars * 0.6)
  const endSize = Math.floor(maxChars * 0.4)

  const beginning = text.substring(0, beginningSize)
  const end = text.substring(Math.max(0, text.length - endSize))

  // Try to truncate beginning at sentence boundary
  let beginningText = beginning
  const lastPeriod = beginning.lastIndexOf('.')
  const lastNewline = beginning.lastIndexOf('\n')
  const lastBoundary = Math.max(lastPeriod, lastNewline)

  if (lastBoundary > beginningSize * 0.7) {
    // If we found a boundary in the last 30%, use it
    beginningText = beginning.substring(0, lastBoundary + 1)
  } else {
    // Otherwise truncate at word boundary
    const lastSpace = beginning.lastIndexOf(' ')
    if (lastSpace > beginningSize * 0.8) {
      beginningText = beginning.substring(0, lastSpace)
    }
  }

  // Try to start end at sentence boundary
  let endText = end
  const firstPeriod = end.indexOf('.')
  const firstNewline = end.indexOf('\n')
  const firstBoundary = firstPeriod !== -1 && firstNewline !== -1
    ? Math.min(firstPeriod, firstNewline)
    : (firstPeriod !== -1 ? firstPeriod : firstNewline)

  if (firstBoundary !== -1 && firstBoundary < endSize * 0.3) {
    // If we found a boundary in the first 30%, start from there
    endText = end.substring(firstBoundary + 1)
  } else {
    // Otherwise start at word boundary
    const firstSpace = end.indexOf(' ')
    if (firstSpace !== -1 && firstSpace < endSize * 0.2) {
      endText = end.substring(firstSpace + 1)
    }
  }

  // Combine beginning and end with a clear separator
  const result = beginningText + '\n\n[... middle content truncated ...]\n\n' + endText

  // Final check: if still too long, trim proportionally
  if (result.length > maxChars) {
    const excess = result.length - maxChars
    // Trim from the middle separator message if possible
    const separator = '\n\n[... middle content truncated ...]\n\n'
    if (excess <= separator.length) {
      return beginningText + '\n\n[...]\n\n' + endText
    }
    // Otherwise trim from beginning (keep end intact as it's more important)
    const trimFromBeginning = Math.floor(excess * 0.6)
    const newBeginning = beginningText.substring(0, beginningText.length - trimFromBeginning)
    return newBeginning + separator + endText
  }

  return result
}

/**
 * Estimate token count for a message (rough approximation: 1 token ≈ 4 characters)
 */
function estimateTokens(text: string): number {
  if (!text) return 0
  // More accurate: count words and add overhead for formatting
  const words = text.trim().split(/\s+/).length
  const chars = text.length
  // Average: 1 token ≈ 0.75 words or 4 chars, use the more conservative estimate
  return Math.ceil(Math.max(words * 1.33, chars / 4))
}

/**
 * Estimate total tokens for a conversation including context
 */
function estimateConversationTokens(messages: ChatMessage[], context?: string): number {
  let total = 0

  // Add context tokens
  if (context) {
    total += estimateTokens(context)
  }

  // Add message tokens (each message has overhead)
  for (const msg of messages) {
    const content = typeof msg.content === 'string'
      ? msg.content
      : (Array.isArray(msg.content)
        ? msg.content.find(item => item.type === 'text')?.text || ''
        : '')
    total += estimateTokens(content)
    total += 4 // Message overhead (role, formatting, etc.)
  }

  return total
}

/**
 * Question Classification Interface
 */
interface QuestionClassification {
  // Context needs
  needsPdfContext: boolean        // Is this about the PDF?
  needsChatHistory: boolean       // Is this a follow-up question?
  needsFullContext: boolean       // Does it need both PDF + history?

  // Answer complexity
  answerComplexity: 'quick' | 'detailed' | 'reasoning'  // How complex is the answer?

  // Question characteristics
  isClarification: boolean        // "What do you mean by X?"
  isFollowUp: boolean            // References previous messages
  isDefinition: boolean          // "What is X?"
  isCalculation: boolean        // Math/formula questions
  isComparison: boolean         // "Compare X and Y"

  // Confidence scores (0-1)
  pdfRelevanceScore: number      // How relevant to PDF? (0-1)
  historyRelevanceScore: number   // How relevant to chat history? (0-1)

  // Classification metadata
  classificationMethod: 'rule-based' | 'llm'  // How was this classified?
  confidence: number              // Overall confidence (0-1)
}

/**
 * Routing Decision Interface
 */
interface RoutingDecision {
  // Context strategy
  includePdfContext: boolean
  pdfContextTokens: number        // 0, 500, 1000, 2000
  includeChatHistory: boolean
  chatHistoryDepth: number        // 0, 1, 2, 5

  // Conversation management
  summarizeOldMessages: boolean
  recentMessagesCount: number

  // Model hints (optional)
  preferQuickModel: boolean       // Use faster model for quick answers
  needsReasoning: boolean         // Needs reasoning model
}

/**
 * Rule-based question classifier (fast, no API calls)
 */
function classifyQuestionRules(
  question: string,
  chatHistory: ChatMessage[],
  hasPdf: boolean
): QuestionClassification {
  const q = question.toLowerCase().trim()
  const hasHistory = chatHistory.length > 0

  // Quick question patterns
  const quickPatterns = [
    /^(what|who|when|where|which)\s+(is|are|was|were)\s+\w{1,30}\?*$/i,  // Simple definitions
    /^(yes|no|ok|thanks|thank you|got it)/i,                              // Acknowledgments
    /^(explain|define|tell me about)\s+\w{1,20}$/i,                       // Simple requests
  ]

  // Follow-up indicators
  const followUpPatterns = [
    /^(it|that|this|they|those|these)/i,                                  // Pronouns
    /^(also|additionally|furthermore|moreover|and|but)/i,                // Continuation
    /^(what about|how about|can you|could you|would you)/i,               // Requests
    /^(can you|could you|would you)\s+(also|please|again)/i,             // Polite requests
  ]

  // PDF indicators - improved patterns to catch PDF-related questions
  const pdfPatterns = [
    /(pdf|document|text|chapter|section|page|according to|in the|from the)/i,
    /(what does.*say|what is.*about|what does the.*say)/i,
    /(what is this.*about|what is the.*about|what's this.*about|what's the.*about)/i,  // "what is this pdf about"
    /(tell me about.*pdf|tell me about.*document|tell me about.*text)/i,
    /(summarize.*pdf|summarize.*document|summarize.*text)/i,
    /(explain.*pdf|explain.*document|explain.*text)/i,
    /(describe.*pdf|describe.*document|describe.*text)/i,
    /(this pdf|the pdf|this document|the document)/i,  // Direct references
  ]

  // Complex question patterns
  const complexPatterns = [
    /(why|how|explain|analyze|compare|contrast|evaluate|discuss)/i,
    /(calculate|solve|derive|prove|show|demonstrate)/i,
    /(relationship|connection|difference|similarity|correlation)/i,
  ]

  // Classification logic
  const isQuick = quickPatterns.some(pattern => pattern.test(q))
  const isFollowUp = hasHistory && followUpPatterns.some(pattern => pattern.test(q))
  const hasPdfIndicators = hasPdf && pdfPatterns.some(pattern => pattern.test(q))
  const isComplex = complexPatterns.some(pattern => pattern.test(q))
  const isDefinition = /^(what is|what are|define|definition)/i.test(q)
  const isCalculation = /(calculate|solve|compute|formula|equation|math)/i.test(q)
  const isComparison = /(compare|contrast|difference|similar|versus|vs)/i.test(q)
  const isClarification = /(what do you mean|clarify|explain.*again|repeat)/i.test(q)

  // Check if question asks about content (needed for PDF relevance calculation)
  const asksAboutContent = /(what is|what's|what are|tell me about|summarize|explain|describe).*(about|say|contain|discuss)/i.test(q)

  // Calculate relevance scores
  let pdfRelevanceScore = 0
  if (hasPdfIndicators) {
    // High relevance for explicit PDF references
    pdfRelevanceScore = 0.9
  } else if (asksAboutContent && hasPdf && !isFollowUp) {
    // High relevance for questions asking about content when PDF exists
    pdfRelevanceScore = 0.85
  } else if (hasPdf && !isQuick && !isFollowUp) {
    // Moderate relevance if PDF exists and question isn't quick/follow-up
    pdfRelevanceScore = 0.4
  } else if (hasPdf) {
    // Low relevance as fallback
    pdfRelevanceScore = 0.2
  }

  let historyRelevanceScore = 0
  if (isFollowUp) historyRelevanceScore = 0.9
  else if (hasHistory && (isClarification || /^(it|that|this)/i.test(q))) historyRelevanceScore = 0.7
  else if (hasHistory) historyRelevanceScore = 0.2  // Low relevance if history exists but not clearly referenced

  // Determine answer complexity
  let answerComplexity: 'quick' | 'detailed' | 'reasoning' = 'detailed'
  if (isQuick || isDefinition) answerComplexity = 'quick'
  else if (isComplex || isCalculation || isComparison) answerComplexity = 'reasoning'

  // Determine context needs
  // PDF context is needed if:
  // 1. Has PDF indicators (explicit references to PDF/document)
  // 2. Question asks about content ("what is X about", "tell me about X") AND PDF exists
  // 3. Not a follow-up question (follow-ups usually reference previous conversation)
  // Note: Even quick questions about PDFs need PDF context!
  const needsPdfContext = hasPdf && (
    hasPdfIndicators ||  // Explicit PDF references
    (asksAboutContent && !isFollowUp) ||  // Questions about content (not follow-ups)
    (!isFollowUp && !isQuick && hasPdf)  // Non-quick, non-follow-up questions when PDF exists
  )
  const needsChatHistory = hasHistory && (isFollowUp || isClarification || historyRelevanceScore > 0.5)
  const needsFullContext = needsPdfContext && needsChatHistory

  return {
    needsPdfContext,
    needsChatHistory,
    needsFullContext,
    answerComplexity,
    isClarification,
    isFollowUp,
    isDefinition,
    isCalculation,
    isComparison,
    pdfRelevanceScore,
    historyRelevanceScore,
    classificationMethod: 'rule-based',
    confidence: isQuick || isFollowUp || hasPdfIndicators ? 0.9 : 0.6
  }
}

/**
 * LLM-based question classifier using structured outputs
 */
async function classifyQuestionLLM(
  question: string,
  chatHistory: ChatMessage[],
  hasPdf: boolean,
  authToken: string
): Promise<QuestionClassification> {
  const hasHistory = chatHistory.length > 0

  // Build context for classification
  const getLastMessageText = (msg: ChatMessage): string => {
    if (typeof msg.content === 'string') return msg.content
    if (Array.isArray(msg.content)) {
      const textItem = msg.content.find(item => item.type === 'text')
      return textItem?.text || ''
    }
    return ''
  }

  const historyContext = hasHistory
    ? `Previous conversation has ${chatHistory.length} messages. Last user message: "${getLastMessageText(chatHistory[chatHistory.length - 1]).substring(0, 100)}"`
    : 'No previous conversation history.'

  const pdfContext = hasPdf ? 'A PDF document is available as context.' : 'No PDF document is available.'

  // Classification schema for structured outputs
  const classificationSchema = {
    type: 'object',
    properties: {
      needsPdfContext: { type: 'boolean' },
      needsChatHistory: { type: 'boolean' },
      needsFullContext: { type: 'boolean' },
      answerComplexity: { type: 'string', enum: ['quick', 'detailed', 'reasoning'] },
      isClarification: { type: 'boolean' },
      isFollowUp: { type: 'boolean' },
      isDefinition: { type: 'boolean' },
      isCalculation: { type: 'boolean' },
      isComparison: { type: 'boolean' },
      pdfRelevanceScore: { type: 'number', minimum: 0, maximum: 1 },
      historyRelevanceScore: { type: 'number', minimum: 0, maximum: 1 },
      confidence: { type: 'number', minimum: 0, maximum: 1 }
    },
    required: [
      'needsPdfContext', 'needsChatHistory', 'needsFullContext', 'answerComplexity',
      'isClarification', 'isFollowUp', 'isDefinition', 'isCalculation', 'isComparison',
      'pdfRelevanceScore', 'historyRelevanceScore', 'confidence'
    ],
    additionalProperties: false
  }

  // Try classification models with fallback
  for (const model of CLASSIFICATION_MODELS) {
    try {
      const response = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: `You are a question classification expert. Analyze the user's question and classify it to determine what context is needed for an optimal response. Consider:
- Whether the question is about the PDF document
- Whether the question references previous conversation
- The complexity of the answer needed (quick fact, detailed explanation, or reasoning)
- Question characteristics (clarification, follow-up, definition, calculation, comparison)

${pdfContext}
${historyContext}

Output your classification as JSON matching the provided schema.`
            },
            {
              role: 'user',
              content: question
            }
          ],
          model,
          temperature: 0.3,  // Lower temperature for more consistent classification
          maxTokens: 500,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'question_classification',
              schema: classificationSchema
            }
          }
        })
      })

      if (!response.ok) {
        continue
      }

      const data = await response.json()
      const classification = JSON.parse(data.choices[0]?.message?.content || '{}')

      return {
        ...classification,
        classificationMethod: 'llm',
        confidence: classification.confidence || 0.8
      }
    } catch (error) {
      continue
    }
  }

  // Fallback to rule-based if all LLM attempts fail
  return classifyQuestionRules(question, chatHistory, hasPdf)
}

/**
 * Hybrid question classifier: tries rules first, uses LLM for ambiguous cases
 */
async function classifyQuestion(
  question: string,
  chatHistory: ChatMessage[],
  hasPdf: boolean,
  authToken: string
): Promise<QuestionClassification> {
  // First, try rule-based classification (fast, no API calls)
  const ruleBased = classifyQuestionRules(question, chatHistory, hasPdf)

  // If rule-based has high confidence, use it
  if (ruleBased.confidence >= 0.85) {
    return ruleBased
  }

  // For ambiguous cases, use LLM classification
  try {
    return await classifyQuestionLLM(question, chatHistory, hasPdf, authToken)
  } catch (error) {
    return ruleBased
  }
}

/**
 * Route question based on classification
 */
function routeQuestion(
  classification: QuestionClassification,
  modelMode: ModelMode,
  chatHistoryLength: number
): RoutingDecision {
  const isReasoningMode = modelMode === 'reasoning'

  // Decision tree based on classification
  // IMPORTANT: Check PDF needs FIRST, even for quick questions
  // Quick questions about PDFs still need PDF context (just with fewer tokens)

  if (classification.needsPdfContext && !classification.needsChatHistory) {
    // PDF-only question
    // Even "quick" questions about PDFs need substantial context to answer properly
    // The question being simple doesn't mean we can skimp on PDF context
    // Always include at least 2 previous messages for context, even if not explicitly needed
    const pdfTokens = classification.answerComplexity === 'quick'
      ? (isReasoningMode ? 1500 : 2000)  // Quick PDF questions: still need good context
      : (classification.answerComplexity === 'detailed' && !isReasoningMode ? 2000 : 1500)
    const minHistoryCount = 2 // Always include at least 2 messages
    return {
      includePdfContext: true,
      pdfContextTokens: pdfTokens,
      includeChatHistory: chatHistoryLength > 0, // Include history if available
      chatHistoryDepth: minHistoryCount,
      summarizeOldMessages: chatHistoryLength > minHistoryCount,
      recentMessagesCount: minHistoryCount,
      preferQuickModel: classification.answerComplexity === 'quick',
      needsReasoning: classification.answerComplexity === 'reasoning'
    }
  }

  if (classification.needsChatHistory && !classification.needsPdfContext) {
    // History-only question
    const historyDepth = classification.isFollowUp ? 2 : (isReasoningMode ? 2 : 5)
    return {
      includePdfContext: false,
      pdfContextTokens: 0,
      includeChatHistory: true,
      chatHistoryDepth: historyDepth,
      summarizeOldMessages: chatHistoryLength > historyDepth,
      recentMessagesCount: historyDepth,
      preferQuickModel: classification.answerComplexity === 'quick',
      needsReasoning: classification.answerComplexity === 'reasoning'
    }
  }

  // Quick questions without PDF or history needs
  // Still include at least 2 previous messages for context
  if (classification.answerComplexity === 'quick' && !classification.needsPdfContext && !classification.needsChatHistory) {
    const minHistoryCount = 2 // Always include at least 2 messages
    return {
      includePdfContext: false,
      pdfContextTokens: 0,
      includeChatHistory: chatHistoryLength > 0, // Include history if available
      chatHistoryDepth: minHistoryCount,
      summarizeOldMessages: chatHistoryLength > minHistoryCount,
      recentMessagesCount: minHistoryCount,
      preferQuickModel: true,
      needsReasoning: false
    }
  }

  // Default: balanced approach (both PDF and history, or complex questions)
  // For questions that need both PDF and history, allocate tokens appropriately
  // If PDF is needed, ensure adequate context even for quick questions
  const pdfTokens = classification.needsPdfContext
    ? (classification.answerComplexity === 'quick'
      ? (isReasoningMode ? 1200 : 1500)  // Quick questions with PDF: still need good context
      : (isReasoningMode ? 1500 : (classification.answerComplexity === 'detailed' ? 2000 : 1500)))
    : 0

  // When needsChatHistory is True, include more messages
  // When needsChatHistory is False, still include at least 2 messages for context
  const historyDepth = classification.needsChatHistory
    ? (isReasoningMode ? 2 : (classification.isFollowUp ? 2 : 5))  // More messages when explicitly needed
    : 2  // Minimum 2 messages even when not explicitly needed

  return {
    includePdfContext: classification.needsPdfContext,
    pdfContextTokens: pdfTokens,
    includeChatHistory: chatHistoryLength > 0, // Always include history if available
    chatHistoryDepth: historyDepth,
    summarizeOldMessages: chatHistoryLength > historyDepth,
    recentMessagesCount: historyDepth,
    preferQuickModel: classification.answerComplexity === 'quick',
    needsReasoning: classification.answerComplexity === 'reasoning'
  }
}

/**
 * Summarize old messages into a compact summary
 * This preserves conversation context while reducing tokens
 * Uses a more efficient format to minimize token usage
 * @param oldMessages Messages to summarize
 * @param isReasoningMode If true, use more aggressive summarization
 */
function summarizeOldMessages(oldMessages: ChatMessage[], isReasoningMode: boolean = false): ChatMessage {
  if (oldMessages.length === 0) {
    return { role: 'system', content: '' }
  }

  // Extract key information from old messages in a compact format
  const summaryParts: string[] = []

  // More aggressive truncation for reasoning mode
  const userTruncateLength = isReasoningMode ? 50 : 80
  const assistantTruncateLength = isReasoningMode ? 80 : 120

  // Group messages into conversation pairs for better context
  for (let i = 0; i < oldMessages.length; i += 2) {
    const userMsg = oldMessages[i]
    const assistantMsg = oldMessages[i + 1]

    if (userMsg && userMsg.role === 'user') {
      const userContent = typeof userMsg.content === 'string' ? userMsg.content :
        (Array.isArray(userMsg.content) ? userMsg.content.find(item => item.type === 'text')?.text || '' : '')
      if (userContent.trim()) {
        // Truncate to first N chars for user messages
        const truncated = userContent.length > userTruncateLength
          ? userContent.substring(0, userTruncateLength) + '...'
          : userContent
        summaryParts.push(`Q: ${truncated}`)
      }
    }

    if (assistantMsg && assistantMsg.role === 'assistant') {
      const assistantContent = typeof assistantMsg.content === 'string' ? assistantMsg.content :
        (Array.isArray(assistantMsg.content) ? assistantMsg.content.find(item => item.type === 'text')?.text || '' : '')
      if (assistantContent.trim()) {
        // Truncate to first N chars for assistant messages
        const truncated = assistantContent.length > assistantTruncateLength
          ? assistantContent.substring(0, assistantTruncateLength) + '...'
          : assistantContent
        summaryParts.push(`A: ${truncated}`)
      }
    }
  }

  // Create compact summary - even more compact for reasoning mode
  const prefix = isReasoningMode ? `[Prev (${oldMessages.length})]` : `[Previous conversation (${oldMessages.length} msgs)]`
  const summary = `${prefix}:\n${summaryParts.join('\n')}`

  return {
    role: 'system',
    content: summary
  }
}

/**
 * Remove instruction prompts from message content for display
 */
function removeInstructions(content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>): string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
  if (typeof content === 'string') {
    // Remove instruction patterns
    return content
      .replace(/\n\n\[IMPORTANT: Please provide a concise and direct response[^\]]+\]\n?/g, '')
      .replace(/\n\n\[IMPORTANT: Please think step by step[^\]]+\]\n?/g, '')
      .replace(/\[IMPORTANT: Please provide a concise and direct response[^\]]+\]\n\n?/g, '')
      .replace(/\[IMPORTANT: Please think step by step[^\]]+\]\n\n?/g, '')
      .trim()
  } else if (Array.isArray(content)) {
    // For array content (vision models), remove instructions from text parts
    return content.map(item => {
      if (item.type === 'text' && item.text) {
        const cleanedText = item.text
          .replace(/\n\n\[IMPORTANT: Please provide a concise and direct response[^\]]+\]\n?/g, '')
          .replace(/\n\n\[IMPORTANT: Please think step by step[^\]]+\]\n?/g, '')
          .replace(/\[IMPORTANT: Please provide a concise and direct response[^\]]+\]\n\n?/g, '')
          .replace(/\[IMPORTANT: Please think step by step[^\]]+\]\n\n?/g, '')
          .trim()
        return { ...item, text: cleanedText }
      }
      return item
    }).filter(item => {
      // Remove text items that are empty after removing instructions
      if (item.type === 'text' && item.text && item.text.trim() === '') {
        return false
      }
      return true
    })
  }
  return content
}

/**
 * Extract thinking content from response
 * Handles multiple formats:
 * 1. __REASONING_START__...__REASONING_END__ format (from Groq API parsed format)
 * 2. <think>...</think> tags (legacy format)
 */
function extractThinking(content: string): { thinking: string | null; mainContent: string } {
  if (!content) return { thinking: null, mainContent: content }

  // First, check for the new format with __REASONING_START__ markers
  const reasoningStartMarker = '__REASONING_START__'
  const reasoningEndMarker = '__REASONING_END__'
  const startIndex = content.indexOf(reasoningStartMarker)
  const endIndex = content.indexOf(reasoningEndMarker)

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    // Extract reasoning from the markers
    const thinkingStart = startIndex + reasoningStartMarker.length
    const thinking = content.substring(thinkingStart, endIndex).trim()
    const mainContent = content.substring(endIndex + reasoningEndMarker.length).trim()
    return { thinking: thinking || null, mainContent }
  }

  // Fallback to legacy format: <think> tags
  const firstOpenTag = content.indexOf('<think>')
  const lastCloseTag = content.lastIndexOf('</think>')

  // If we don't have both tags, return original content
  if (firstOpenTag === -1 || lastCloseTag === -1 || lastCloseTag <= firstOpenTag) {
    return { thinking: null, mainContent: content }
  }

  // Extract thinking content between first opening tag and last closing tag
  const thinkingStart = firstOpenTag + '<think>'.length
  const thinking = content.substring(thinkingStart, lastCloseTag).trim()

  // Remove the entire thinking block from main content
  // Remove from first opening tag to last closing tag (including the closing tag)
  const beforeThinking = content.substring(0, firstOpenTag)
  const afterThinking = content.substring(lastCloseTag + '</think>'.length)
  const mainContent = (beforeThinking + afterThinking).trim()

  return { thinking: thinking || null, mainContent }
}


interface ChatGPTEmbeddedProps {
  selectedText: string
  pdfText: string
  onToggleLayout?: () => void
  layout: 'floating' | 'split'
  currentPageNumber?: number
  pdfTotalPages?: number
  onCreateKnowledgeNote?: (content: string, linkedText: string | undefined, pageNumber: number | undefined, textYPosition: number | undefined, messageId: string) => void
  onClearSelectedText?: () => void
  onAddAnnotationToPDF?: (text: string, pageNumber: number, textYPosition?: number) => void
  onOpenKnowledgeNotes?: () => void
  onToggleKnowledgeNotes?: () => void
  showKnowledgeNotes?: boolean
  onModeChange?: (mode: InteractionMode) => void
  resetModeRef?: React.MutableRefObject<(() => void) | null>
  onRequestPageChange?: (page: number) => void
  modelMode?: ModelMode
  onModelModeChange?: (mode: ModelMode) => void
}

function ChatGPTEmbedded({ selectedText, pdfText, layout, currentPageNumber, onCreateKnowledgeNote, onClearSelectedText, onAddAnnotationToPDF, onOpenKnowledgeNotes, onToggleKnowledgeNotes, showKnowledgeNotes, onModeChange, resetModeRef, modelMode: externalModelMode, onModelModeChange }: ChatGPTEmbeddedProps) {
  const { theme } = useTheme()
  const { isAuthenticated, user, loading: authLoading } = useAuth()

  // Suppress KaTeX warnings about non-breaking hyphens (we normalize them in preprocessing)
  useEffect(() => {
    const originalWarn = console.warn
    console.warn = (...args: any[]) => {
      // Convert all arguments to strings and join them
      const fullMessage = args.map(arg => {
        if (typeof arg === 'string') return arg
        if (arg && typeof arg === 'object') {
          try {
            return JSON.stringify(arg)
          } catch {
            return String(arg)
          }
        }
        return String(arg)
      }).join(' ')

      // Suppress KaTeX warnings about non-breaking hyphen (U+2011, character code 8209)
      // Check for various warning formats from KaTeX - be very permissive
      const isKaTeXNonBreakingHyphenWarning =
        fullMessage.includes("No character metrics") &&
        (fullMessage.includes("‑") || fullMessage.includes("8209") || fullMessage.includes("U+2011")) ||
        fullMessage.includes("Unrecognized Unicode character") &&
        (fullMessage.includes("‑") || fullMessage.includes("8209") || fullMessage.includes("U+2011")) ||
        fullMessage.includes("LaTeX-incompatible input") &&
        (fullMessage.includes("‑") || fullMessage.includes("8209") || fullMessage.includes("U+2011")) ||
        fullMessage.includes("unknownSymbol") &&
        (fullMessage.includes("‑") || fullMessage.includes("8209") || fullMessage.includes("U+2011"))

      if (isKaTeXNonBreakingHyphenWarning) {
        // Silently ignore - we're normalizing these characters in preprocessing
        // The normalization is working (logs show 0 remaining), but KaTeX may still
        // process the content in a way that generates warnings before normalization completes
        return
      }
      originalWarn.apply(console, args)
    }

    return () => {
      console.warn = originalWarn
    }
  }, [])
  const [messages, setMessages] = useState<Array<ChatMessage & { id: string; selectedTextAtSend?: string; pageNumberAtSend?: number; textYPositionAtSend?: number; thinking?: string }>>([])
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({}) // Track which thinking sections are expanded
  const [expandedPdfContext, setExpandedPdfContext] = useState<Record<string, boolean>>({}) // Track which PDF context sections are expanded
  // Track multiple responses per message: messageId -> array of responses
  const [messageResponses, setMessageResponses] = useState<Record<string, Array<{ content: string; thinking?: string; timestamp: number }>>>({})
  // Track current response index for each message: messageId -> current index
  const [currentResponseIndex, setCurrentResponseIndex] = useState<Record<string, number>>({})
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [apiKeyMissing, setApiKeyMissing] = useState(true)
  const [isCheckingApiKey, setIsCheckingApiKey] = useState(true)
  const [isCollapsed, setIsCollapsed] = useState(true)
  const [savedScrollPosition, setSavedScrollPosition] = useState<number | null>(null)
  const [modelMode, setModelMode] = useState<ModelMode>(externalModelMode || 'auto')
  const [isInputFocused, setIsInputFocused] = useState(false)
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null) // Track which image is enlarged (using messageId-index format)
  const [uploadedImages, setUploadedImages] = useState<string[]>([]) // Array of base64 image URLs
  const [isDraggingOver, setIsDraggingOver] = useState(false) // Track drag-over state for visual feedback
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [messageScrollStates, setMessageScrollStates] = useState<Record<string, { canScrollLeft: boolean; canScrollRight: boolean }>>({})
  const [clearConfirming, setClearConfirming] = useState(false)
  const clearConfirmTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // Interaction mode states - restore from localStorage
  const [interactionMode, setInteractionMode] = useState<InteractionMode>(() => {
    const saved = localStorage.getItem('chatnote-interaction-mode')
    return saved ? (saved as InteractionMode) : null
  })
  const [quizSession, setQuizSession] = useState<QuizSession | null>(null)
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false)
  const [showQuizConfig, setShowQuizConfig] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imagesPreviewRef = useRef<HTMLDivElement>(null)
  const messageImagesRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const modelSelectorRef = useRef<HTMLDivElement>(null)
  const chatInnerRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [dynamicMaxHeight, setDynamicMaxHeight] = useState<number | null>(null)
  const [enlargedImageMaxHeight, setEnlargedImageMaxHeight] = useState<number | null>(null)

  const scrollToBottom = (smooth: boolean = true, force: boolean = false) => {
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100

      // Auto-scroll if user is near the bottom OR if forced (e.g., when sending a new message)
      if (isNearBottom || force) {
        // Use requestAnimationFrame to ensure DOM layout is complete (important for tables)
        requestAnimationFrame(() => {
          // Double RAF to ensure layout is fully settled (especially for tables)
          requestAnimationFrame(() => {
            if (!messagesContainerRef.current) return
            const container = messagesContainerRef.current

            if (smooth) {
              // Try scrollIntoView first, fallback to direct scrollTop
              if (messagesEndRef.current) {
                messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
              } else {
                container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
              }
            } else {
              // Instant scroll - use direct scrollTop for better reliability
              if (messagesEndRef.current) {
                messagesEndRef.current.scrollIntoView({ behavior: 'auto' })
              } else {
                container.scrollTop = container.scrollHeight
              }
            }
          })
        })
      }
    }
  }

  const adjustTextareaHeight = () => {
    const textarea = inputRef.current
    if (textarea) {
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto'
      // Calculate the new height based on content, with min and max constraints
      const minHeight = 24 // Minimum height for one line (line-height * 1)
      const maxHeight = 200 // Maximum height before scrolling (matches CSS max-height)
      const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)
      textarea.style.height = `${newHeight}px`
    }
  }

  // Only scroll smoothly when messages array length changes (new message added)
  // Use a ref to track previous message count and last message role
  const prevMessageCountRef = useRef(0)
  const prevLastMessageRoleRef = useRef<string | null>(null)
  useEffect(() => {
    const currentCount = messages.length
    const prevCount = prevMessageCountRef.current
    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null
    const lastMessageRole = lastMessage?.role || null

    // If a new message was added (count increased)
    if (currentCount > prevCount) {
      // If it's a user message, force scroll to bottom (user asked a new question)
      if (lastMessageRole === 'user') {
        scrollToBottom(true, true)
      } else {
        // For assistant messages, scroll smoothly if near bottom
        scrollToBottom(true)
      }
    } else if (currentCount === prevCount && isLoading) {
      // During streaming updates, use instant scroll to avoid bouncing
      scrollToBottom(false)
    }

    prevMessageCountRef.current = currentCount
    prevLastMessageRoleRef.current = lastMessageRole
  }, [messages, isLoading])

  // Watch for content size changes (especially tables) during streaming
  useEffect(() => {
    if (!messagesContainerRef.current || !isLoading) return

    const container = messagesContainerRef.current
    let lastScrollHeight = container.scrollHeight
    let scrollTimeout: NodeJS.Timeout | null = null

    // Use ResizeObserver to detect when content height changes (e.g., table rendering)
    const resizeObserver = new ResizeObserver(() => {
      if (!messagesContainerRef.current) return

      const currentScrollHeight = messagesContainerRef.current.scrollHeight
      const isNearBottom = messagesContainerRef.current.scrollHeight - messagesContainerRef.current.scrollTop - messagesContainerRef.current.clientHeight < 100

      // If content height increased and user is near bottom, scroll to keep up
      if (currentScrollHeight > lastScrollHeight && isNearBottom) {
        // Clear any pending scroll
        if (scrollTimeout) {
          clearTimeout(scrollTimeout)
        }

        // Debounce scroll to avoid excessive scrolling during rapid updates
        scrollTimeout = setTimeout(() => {
          scrollToBottom(false)
          lastScrollHeight = currentScrollHeight
        }, 50)
      } else {
        lastScrollHeight = currentScrollHeight
      }
    })

    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      if (scrollTimeout) {
        clearTimeout(scrollTimeout)
      }
    }
  }, [isLoading])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (clearConfirmTimeoutRef.current) {
        clearTimeout(clearConfirmTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
    adjustTextareaHeight()
  }, [])

  // Auto-resize textarea when input changes
  useEffect(() => {
    // Use setTimeout to ensure DOM has updated before measuring
    const timeoutId = setTimeout(() => {
      adjustTextareaHeight()
    }, 0)
    return () => clearTimeout(timeoutId)
  }, [input])

  const checkApiKey = async () => {
    if (isAuthenticated) {
      setIsCheckingApiKey(true)
      try {
        const configured = await isChatConfigured()
        setApiKeyMissing(!configured)
      } catch (error) {
        // If rate limited or network error, don't change the state
        // This prevents false warnings when backend is temporarily unavailable
        console.warn('API key check failed:', error)
      } finally {
        setIsCheckingApiKey(false)
      }
    } else {
      setApiKeyMissing(true)
      setIsCheckingApiKey(false)
    }
  }

  useEffect(() => {
    checkApiKey()

    // Periodically check API key status to handle backend restarts
    // Increased interval to 10 seconds to reduce rate limiting issues
    const intervalId = setInterval(() => {
      if (isAuthenticated) {
        checkApiKey()
      }
    }, 10000) // Check every 10 seconds

    return () => clearInterval(intervalId)
  }, [isAuthenticated])

  // Auto-unfold chat history when in split layout
  useEffect(() => {
    if (layout === 'split') {
      setIsCollapsed(false)
      // Clear saved scroll position when switching to split layout
      setSavedScrollPosition(null)
    }
  }, [layout])

  // Restore scroll position when expanding in floating layout
  useEffect(() => {
    if (layout === 'floating' && !isCollapsed && savedScrollPosition !== null && messagesContainerRef.current) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = savedScrollPosition
        }
      })
    }
  }, [isCollapsed, layout, savedScrollPosition])

  // Auto-collapse chat history in floating layout when screen height is too short
  // Also calculate dynamic max-height to prevent cropping when expanded
  useEffect(() => {
    if (layout !== 'floating') {
      setDynamicMaxHeight(null)
      return
    }

    const checkScreenHeight = () => {
      const viewportHeight = window.innerHeight
      // Chat is positioned at bottom: 90px (or 70px on mobile)
      const bottomOffset = window.innerWidth <= 768 ? 70 : 90
      const navbarHeight = 60
      const minimumChatHeight = 400 // Minimum height needed for chat to be usable
      const availableHeight = viewportHeight - navbarHeight - bottomOffset

      // If available height is less than minimum, auto-collapse
      if (availableHeight < minimumChatHeight) {
        setIsCollapsed(true)
        setDynamicMaxHeight(null)
      } else if (!isCollapsed) {
        // Calculate dynamic max-height when expanded to prevent cropping
        // Reserve space for: model selector bar (~60px) + input area (~100px) + padding (~40px)
        const reservedHeight = 200
        const calculatedMaxHeight = Math.min(availableHeight - reservedHeight, 600)
        setDynamicMaxHeight(Math.max(calculatedMaxHeight, 300)) // Minimum 300px
      } else {
        setDynamicMaxHeight(null)
      }
    }

    // Check on mount and resize
    checkScreenHeight()
    window.addEventListener('resize', checkScreenHeight)

    return () => {
      window.removeEventListener('resize', checkScreenHeight)
    }
  }, [layout, isCollapsed])


  // Handle chat window resizing when image is enlarged
  useEffect(() => {
    if (!enlargedImage || !messagesContainerRef.current || !chatInnerRef.current) {
      setEnlargedImageMaxHeight(null)
      return
    }

    const checkAndResize = () => {
      const messagesContainer = messagesContainerRef.current
      const chatInner = chatInnerRef.current
      if (!messagesContainer || !chatInner) return

      // Get current container dimensions
      const containerHeight = messagesContainer.clientHeight

      // Calculate the image size (max-height: 70vh, max-width: 600px)
      const viewportHeight = window.innerHeight
      const maxImageHeight = Math.min(viewportHeight * 0.7, 600) // 600px max width, 70vh max height

      // Check if image fits in current container
      // We need at least the image height + some padding
      const requiredHeight = maxImageHeight + 40 // padding

      if (requiredHeight <= containerHeight) {
        // Image fits, don't resize
        setEnlargedImageMaxHeight(null)
      } else {
        // Image doesn't fit, resize to accommodate it
        // Calculate new height: image height + padding + other UI elements
        const otherUIHeight = chatInner.clientHeight - containerHeight
        const newHeight = requiredHeight + otherUIHeight
        setEnlargedImageMaxHeight(newHeight)
      }
    }

    // Check after a small delay to allow DOM to update
    const timeoutId = setTimeout(checkAndResize, 100)
    window.addEventListener('resize', checkAndResize)

    return () => {
      clearTimeout(timeoutId)
      window.removeEventListener('resize', checkAndResize)
    }
  }, [enlargedImage])

  // Get current model based on mode (with fallback logic handled in service)
  const getCurrentModel = (): string => {
    switch (modelMode) {
      case 'auto':
        return AUTO_MODELS[0]
      case 'reasoning':
        return REASONING_MODELS[0]
      case 'advanced':
        return ADVANCED_MODELS.primary
    }
  }

  const handleModeChange = (mode: ModelMode) => {
    setModelMode(mode)
    // Sync with parent if callback provided
    if (onModelModeChange) {
      onModelModeChange(mode)
    }
    // Clear uploaded images when switching away from auto mode (vision models)
    if (mode !== 'auto' && uploadedImages.length > 0) {
      setUploadedImages([])
    }
  }

  const isVisionModel = () => {
    // Only Auto mode supports vision (llama 4 models)
    if (modelMode !== 'auto') return false
    const currentModel = getCurrentModel()
    // Check if it's one of the llama 4 models
    return currentModel === 'meta-llama/llama-4-scout-17b-16e-instruct' ||
      currentModel === 'meta-llama/llama-4-maverick-17b-128e-instruct'
  }

  // Clear uploaded images when switching from vision model to non-vision model
  useEffect(() => {
    const currentlyIsVision = isVisionModel()

    // If switching to a non-vision model and there are uploaded images, clear them
    if (!currentlyIsVision && uploadedImages.length > 0) {
      setUploadedImages([])
    }
  }, [modelMode]) // Only depend on modelMode, not uploadedImages

  // Sync external modelMode with internal state
  useEffect(() => {
    if (externalModelMode && externalModelMode !== modelMode) {
      setModelMode(externalModelMode)
    }
  }, [externalModelMode])

  const processImageFiles = (files: FileList | File[]) => {
    const fileArray = Array.from(files)

    fileArray.forEach((file) => {
      if (!file.type.startsWith('image/')) {
        setError('Please upload image files only.')
        return
      }

      const reader = new FileReader()
      reader.onload = (event) => {
        const result = event.target?.result as string
        if (result) {
          setUploadedImages((prev) => [...prev, result])
        }
      }
      reader.onerror = () => {
        setError('Failed to read image file.')
      }
      reader.readAsDataURL(file)
    })
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    processImageFiles(files)

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    if (!isVisionModel()) return
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (!isVisionModel()) return
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    if (!isVisionModel()) return
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)

    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      processImageFiles(files)
    }
  }

  const checkScrollButtons = () => {
    const container = imagesPreviewRef.current
    if (!container) {
      setCanScrollLeft(false)
      setCanScrollRight(false)
      return
    }
    setCanScrollLeft(container.scrollLeft > 0)
    setCanScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth - 1)
  }

  const scrollImages = (direction: 'left' | 'right') => {
    const container = imagesPreviewRef.current
    if (!container) return

    const scrollAmount = 200 // pixels to scroll
    const newScrollLeft = direction === 'left'
      ? container.scrollLeft - scrollAmount
      : container.scrollLeft + scrollAmount

    container.scrollTo({
      left: newScrollLeft,
      behavior: 'smooth'
    })
  }

  const checkMessageScrollButtons = (messageId: string) => {
    const container = messageImagesRefs.current[messageId]
    if (!container) {
      setMessageScrollStates(prev => ({
        ...prev,
        [messageId]: { canScrollLeft: false, canScrollRight: false }
      }))
      return
    }
    const canScrollLeft = container.scrollLeft > 0
    const canScrollRight = container.scrollLeft < container.scrollWidth - container.scrollWidth - 1
    setMessageScrollStates(prev => ({
      ...prev,
      [messageId]: { canScrollLeft, canScrollRight }
    }))
  }

  const scrollMessageImages = (messageId: string, direction: 'left' | 'right') => {
    const container = messageImagesRefs.current[messageId]
    if (!container) return

    const scrollAmount = 200 // pixels to scroll
    const newScrollLeft = direction === 'left'
      ? container.scrollLeft - scrollAmount
      : container.scrollLeft + scrollAmount

    container.scrollTo({
      left: newScrollLeft,
      behavior: 'smooth'
    })
  }

  // Check scroll buttons when images change or component mounts
  useEffect(() => {
    // Use setTimeout to ensure DOM is updated
    const timeoutId = setTimeout(() => {
      checkScrollButtons()
    }, 0)

    const container = imagesPreviewRef.current
    if (container) {
      container.addEventListener('scroll', checkScrollButtons)
      // Also check on resize
      window.addEventListener('resize', checkScrollButtons)
      return () => {
        clearTimeout(timeoutId)
        container.removeEventListener('scroll', checkScrollButtons)
        window.removeEventListener('resize', checkScrollButtons)
      }
    }

    return () => {
      clearTimeout(timeoutId)
    }
  }, [uploadedImages])

  // Check message images scroll buttons when messages change
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      Object.keys(messageImagesRefs.current).forEach(messageId => {
        checkMessageScrollButtons(messageId)
      })
    }, 0)

    const handleResize = () => {
      Object.keys(messageImagesRefs.current).forEach(messageId => {
        checkMessageScrollButtons(messageId)
      })
    }

    window.addEventListener('resize', handleResize)

    return () => {
      clearTimeout(timeoutId)
      window.removeEventListener('resize', handleResize)
    }
  }, [messages])


  const handleSend = async () => {
    const userInput = input.trim()
    const hasImages = uploadedImages.length > 0
    if (!userInput && !selectedText && !hasImages) return

    if (!isAuthenticated) {
      setError('Please sign in to use the chat feature.')
      return
    }

    if (apiKeyMissing) {
      setError('Please configure your Groq API key in Settings.')
      return
    }

    if (isCollapsed) {
      setIsCollapsed(false)
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()
    
    // Track query submission
    const queryStartTime = Date.now()
    const isContextual = !!selectedText
    analytics.trackQuerySubmitted(modelMode, layout, isContextual)

    let userMessageContent = userInput
    if (selectedText && !userInput) {
      userMessageContent = `Tell me about this: ${selectedText}`
    } else if (selectedText && userInput) {
      userMessageContent = `${userInput}\n\nContext from PDF: ${selectedText}`
    }

    // Build message content - for vision models, use array format with images
    let messageContent: ChatMessage['content']
    if (isVisionModel() && uploadedImages.length > 0) {
      // Vision models need content array format
      const contentArray: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []

      // Add text content
      if (userMessageContent) {
        contentArray.push({ type: 'text', text: userMessageContent })
      }

      // Add images
      uploadedImages.forEach((imageUrl) => {
        contentArray.push({ type: 'image_url', image_url: { url: imageUrl } })
      })

      messageContent = contentArray
    } else {
      // Regular text-only message
      messageContent = userMessageContent
    }

    // Get selection position from window global
    const selectionPosition = (window as any).__lastSelectedTextPosition
    
    const userMessage: ChatMessage & { id: string; selectedTextAtSend?: string; pageNumberAtSend?: number; textYPositionAtSend?: number } = {
      id: Date.now().toString(),
      role: 'user',
      content: messageContent,
      selectedTextAtSend: selectedText || undefined, // Store the selected text at the time of sending
      pageNumberAtSend: selectionPosition?.pageNumber, // Store the page number where text was selected
      textYPositionAtSend: selectionPosition?.textYPosition, // Store the Y position where text was selected
    }

    // Update UI immediately (optimistic update) - show user message and loading state
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setUploadedImages([]) // Clear uploaded images after sending
    // Reset textarea height after clearing input
    setTimeout(() => {
      adjustTextareaHeight()
    }, 0)
    setIsLoading(true)
    setError(null)

    // Force scroll to bottom when user sends a new question
    // Use requestAnimationFrame to ensure DOM has updated
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottom(true, true)
      })
    })

    // Smart Routing: Classify question and determine optimal context strategy
    // This happens AFTER UI update for better UX
    const isReasoningMode = modelMode === 'reasoning'
    const hasPdf = (pdfText && pdfText.trim().length > 0) || !!selectedText
    const questionText = userInput || (selectedText ? `Tell me about: ${selectedText}` : '')

    // Get auth token for LLM classification if needed
    const authToken = localStorage.getItem('auth_token') || ''

    // Classify the question (hybrid: rules first, LLM for ambiguous cases)
    let classification: QuestionClassification
    let routing: RoutingDecision

    try {
      classification = await classifyQuestion(questionText, messages, hasPdf, authToken)
      routing = routeQuestion(classification, modelMode, messages.length)

    } catch (error) {
      console.warn('[Smart Router] Classification failed, using default routing:', error)
      // Fallback to default routing (use generous PDF context to ensure questions can be answered)
      routing = {
        includePdfContext: hasPdf,
        pdfContextTokens: isReasoningMode ? 1500 : 2000,  // Generous context for fallback
        includeChatHistory: true,
        chatHistoryDepth: isReasoningMode ? 2 : 5,
        summarizeOldMessages: messages.length > (isReasoningMode ? 2 : 5),
        recentMessagesCount: isReasoningMode ? 2 : 5,
        preferQuickModel: false,
        needsReasoning: false
      }
    }

    // Apply routing decision to determine context
    let contextToSend: string | undefined

    if (routing.includePdfContext && routing.pdfContextTokens > 0) {
      if (selectedText && !userInput) {
        // Selected text takes priority
        contextToSend = truncateText(selectedText, routing.pdfContextTokens)
      } else if (pdfText && pdfText.trim().length > 0) {
        // Use smart PDF extraction based on routing decision with hybrid RAG
        if (userInput && userInput.trim().length > 0) {
          // Use simple keyword search approach for better retrieval
          contextToSend = await extractRelevantPDFContext(
            pdfText,
            userInput,
            routing.pdfContextTokens
          )
        } else {
          contextToSend = truncateText(pdfText, routing.pdfContextTokens)
        }
      } else if (selectedText && userInput) {
        contextToSend = truncateText(selectedText, routing.pdfContextTokens)
      }
    }

    const assistantMessageId = (Date.now() + 1).toString()
    // Find the selected text from the user message that triggered this response
    const userMessageSelectedText = userMessage.selectedTextAtSend
    const assistantMessage: ChatMessage & { id: string; selectedTextAtSend?: string; pageNumberAtSend?: number; textYPositionAtSend?: number } = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      selectedTextAtSend: userMessageSelectedText, // Inherit the selected text from the user's message
      pageNumberAtSend: userMessage.pageNumberAtSend, // Inherit the page number from the user's message
      textYPositionAtSend: userMessage.textYPositionAtSend, // Inherit the Y position from the user's message
    }
    setMessages((prev) => [...prev, assistantMessage])

    // Force scroll to bottom when assistant message is created
    // Use requestAnimationFrame to ensure DOM has updated
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottom(true, true)
      })
    })

    try {
      // Smart chat history management based on routing decision
      let conversationHistory: ChatMessage[] = []

      if (routing.includeChatHistory && messages.length > 0) {
        const totalMessages = messages.length
        const recentCount = routing.recentMessagesCount

        if (totalMessages > recentCount && routing.summarizeOldMessages) {
          // Split into old and recent messages
          const oldMessages = messages.slice(0, totalMessages - recentCount)
          const recentMessages = messages.slice(-recentCount)

          // Summarize old messages (use reasoning mode flag for aggressive summarization)
          const summaryMessage = summarizeOldMessages(oldMessages, isReasoningMode)

          // Combine summary + recent messages
          conversationHistory = [
            summaryMessage,
            ...recentMessages.map((msg) => ({
              role: msg.role,
              content: msg.content,
            }))
          ]
        } else if (totalMessages <= recentCount) {
          // If we have few messages, send all of them
          conversationHistory = messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          }))
        } else {
          // Just send recent messages without summary
          conversationHistory = messages.slice(-recentCount).map((msg) => ({
            role: msg.role,
            content: msg.content,
          }))
        }
      } else {
        // No chat history needed based on routing
        conversationHistory = []
      }

      // Estimate tokens and adjust context if needed
      const estimatedTokens = estimateConversationTokens(
        [...conversationHistory, userMessage],
        contextToSend
      )

      // Model-specific token limits (conservative estimates to avoid rate limits)
      const MODEL_TOKEN_LIMITS: Record<string, number> = {
        'openai/gpt-oss-120b': 7000, // 8000 TPM limit, use 7000 to be safe
        'openai/gpt-oss-20b': 7000,  // 8000 TPM limit, use 7000 to be safe
        'qwen/qwen3-32b': 5000,      // 6000 TPM limit, use 5000 to be safe (also has lower request limit)
      }

      const currentModel = getCurrentModel()
      const modelLimit = MODEL_TOKEN_LIMITS[currentModel] || 8000

      // If estimated tokens exceed limit, reduce context
      if (estimatedTokens > modelLimit && contextToSend) {
        const reductionFactor = modelLimit / estimatedTokens
        const targetContextTokens = Math.floor(estimateTokens(contextToSend) * reductionFactor * 0.9) // 90% to be safe
        contextToSend = truncateText(contextToSend, targetContextTokens)
      }

      // Add KaTeX-friendly system prompt to guide model's math output
      const katexSystemPrompt: ChatMessage = {
        role: 'system',
        content: `You are a mathematical assistant. All mathematical equations you generate must be 100% compatible with the KaTeX rendering engine.

Follow these strict rules:

1. **Delimiters:**
   * For block-level equations (on their own line), **must** use \`$$...$$\` delimiters.
   * For inline equations (inside a sentence), **must** use \`\\(...\\)\` delimiters.
   * **Do not** use single \`$\` or \`\\[...\\]\` delimiters.

2. **Alignment (Crucial):**
   * To align multiple equations, **must** use the \`aligned\` environment.
   * **Do not** use the \`align\`, \`align*\`, or \`eqnarray\` environments, as they are not supported.
   * Example of a correct multi-line equation:
     \`\`\`
     $$
     \\begin{aligned}
     a &= b + c \\\\
     d &= e + f
     \\end{aligned}
     $$
     \`\`\`

3. **General Formatting:**
   * Use standard, common LaTeX commands.
   * To write plain text inside math, **must** use \`\\text{...}\`.
   * To create a fraction, **must** use \`\\frac{...}{...}\`.
   * To create a matrix or case, use the \`pmatrix\`, \`bmatrix\`, or \`cases\` environments.
   * **Do not** use complex, obscure, or custom LaTeX packages. Stick to \`amsmath\`-style commands that are known to be supported by KaTeX.

4. **Dollar Amounts and Numbers:**
   * For dollar amounts in text (e.g., "$40,000", "$1,000"), use plain text with commas, NOT math delimiters.
   * **Always include spaces** before and after dollar amounts when they appear in sentences (e.g., "between $40,000 and $42,000", not "between $40,000and$42,000").
   * **Do not** wrap dollar amounts in \`$\` delimiters unless they are part of a mathematical expression.
   * For consistency, use the same formatting style for similar phrases (e.g., if you use "no smaller than" in normal text, use "no larger than" in the same style, not italic).

5. **Text Formatting Consistency:**
   * Use consistent markdown formatting for similar phrases.
   * If you use italic (\`*text*\`) for emphasis, use it consistently for similar phrases.
   * **Always preserve spaces** between numbers and words (e.g., "1,000 and", not "1,000and$42,000").
   * **Do not** wrap dollar amounts in \`$\` delimiters unless they are part of a mathematical expression.
   * For consistency, use the same formatting style for similar phrases (e.g., if you use "no smaller than" in normal text, use "no larger than" in the same style, not italic).`
      }

      // Prepend system prompt to conversation history (only once, at the beginning)
      const messagesWithSystemPrompt = conversationHistory.length > 0 && conversationHistory[0]?.role === 'system'
        ? conversationHistory // Already has a system message, don't add another
        : [katexSystemPrompt, ...conversationHistory]

      // If still over limit, reduce conversation history further
      let finalEstimatedTokens = estimateConversationTokens(
        [...messagesWithSystemPrompt, userMessage],
        contextToSend
      )

      if (finalEstimatedTokens > modelLimit && messagesWithSystemPrompt.length > 1) {
        // Remove oldest messages from conversation history, but keep system prompt
        const systemMsg = messagesWithSystemPrompt[0]?.role === 'system' ? messagesWithSystemPrompt[0] : null
        const otherMessages = systemMsg ? messagesWithSystemPrompt.slice(1) : messagesWithSystemPrompt
        const summaryMsg = otherMessages[0]
        const restMessages = otherMessages.slice(1)

        // Keep only the most recent message pair
        const reducedHistory = restMessages.slice(-2)
        const newHistory = summaryMsg?.content
          ? (systemMsg ? [systemMsg, summaryMsg, ...reducedHistory] : [summaryMsg, ...reducedHistory])
          : (systemMsg ? [systemMsg, ...reducedHistory] : reducedHistory)

        conversationHistory = newHistory
        finalEstimatedTokens = estimateConversationTokens(
          [...conversationHistory, userMessage],
          contextToSend
        )
      } else {
        conversationHistory = messagesWithSystemPrompt
      }

      // Last resort: remove context entirely if still over limit
      if (finalEstimatedTokens > modelLimit && contextToSend) {
        contextToSend = undefined
      }

      let fullResponse = ''

      // Use the user message as-is (no hard-coded prompts)
      const finalUserMessage = userMessage

      const messagePromise = sendChatMessage(
        [...conversationHistory, finalUserMessage],
        contextToSend,
        (chunk: string) => {
          // Check if aborted before processing chunk
          if (abortControllerRef.current?.signal.aborted) {
            return
          }
          fullResponse += chunk

          // Extract thinking during streaming for both Reasoning and Advanced modes
          // This ensures users don't see the __REASONING_START__/__REASONING_END__ markers during streaming
          const { thinking: streamingThinking, mainContent: streamingMainContent } = extractThinking(fullResponse)
          const hasStreamingThinking = streamingThinking && streamingThinking.trim().length > 0

          if (isReasoningMode || (modelMode === 'advanced' && hasStreamingThinking)) {
            // In reasoning mode or advanced mode with thinking, extract and display separately
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? {
                    ...msg,
                    content: streamingMainContent || fullResponse, // Show main content without reasoning markers
                    thinking: hasStreamingThinking ? streamingThinking : msg.thinking // Update thinking if available
                  }
                  : msg
              )
            )
          } else {
            // In other modes without thinking, show content streaming normally
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, content: fullResponse }
                  : msg
              )
            )
          }
          scrollToBottom(false)
        },
        currentModel,
        abortControllerRef.current?.signal,
        isReasoningMode
      )

      // Handle the promise to prevent unhandled rejections
      messagePromise.catch((error) => {
        // Silently handle abort errors - they're expected when user pauses
        if (error instanceof DOMException && error.name === 'AbortError') {
          // Keep the partial response, just stop loading
          return
        }
        // Re-throw other errors to be handled by the outer catch
        throw error
      })

      const finalResponse = await messagePromise

      // For reasoning mode, extract reasoning from response
      // Groq reasoning models can return reasoning in different formats:
      // 1. reasoning_format: 'parsed' - reasoning in message.reasoning field
      // 2. reasoning_format: 'raw' - reasoning in <think> tags
      // 3. reasoning_format: 'hidden' - no reasoning shown
      // The service will handle this and return both reasoning and content
      // For now, we'll check if the response contains reasoning tags
      const { thinking, mainContent } = extractThinking(finalResponse)

      // Fix: Handle cases where mainContent is empty or thinking/mainContent are identical
      let finalThinking = thinking
      let finalMainContent = mainContent

      // Case 1: If mainContent is empty but thinking exists, the model only returned reasoning
      // For Compound models, when content is empty, the reasoning itself might contain the answer
      // We should extract a concise conclusion/summary from the thinking as the main content
      if (thinking && (!mainContent || mainContent.trim().length === 0)) {

        // Try multiple strategies to extract a meaningful conclusion:

        // Strategy 1: Look for explicit conclusion markers
        const conclusionPatterns = [
          /(?:Therefore|In conclusion|To summarize|The answer is|The result is|In summary|To conclude)[:.]?\s*(.+?)(?:\n\n|$)/is,
          /(?:So|Thus|Hence)[,.]?\s*(.+?)(?:\n\n|$)/is,
          /(?:The final answer is|The solution is|The answer)[:.]?\s*(.+?)(?:\n\n|$)/is
        ]

        let extractedConclusion = null
        for (const pattern of conclusionPatterns) {
          const match = thinking.match(pattern)
          if (match && match[1]) {
            const matchIndex = thinking.indexOf(match[0])
            const afterMatch = thinking.substring(matchIndex + match[0].length)

            // Extract the text after the conclusion marker
            let conclusionText = match[1].trim()

            // Find the next sentence boundary to ensure we have a complete sentence
            const nextSentenceMatch = afterMatch.match(/^([^.!?]*[.!?]+)/)
            if (nextSentenceMatch) {
              conclusionText += nextSentenceMatch[1]
            } else {
              // If no sentence boundary found, look for the end of the paragraph
              const paragraphEnd = afterMatch.match(/^([^\n]+)/)
              if (paragraphEnd) {
                conclusionText += paragraphEnd[1]
              }
            }

            extractedConclusion = conclusionText.trim()

            // Ensure we start from a sentence boundary (not mid-sentence)
            // If the extracted text doesn't start with a capital letter or is clearly mid-sentence,
            // try to find the sentence start
            if (extractedConclusion && !extractedConclusion.match(/^[A-Z"']/)) {
              // Look backwards from the match to find the sentence start
              const beforeMatch = thinking.substring(Math.max(0, matchIndex - 200), matchIndex)
              const sentenceStart = beforeMatch.match(/([.!?]\s+)([A-Z"'][^.!?]*)$/)
              if (sentenceStart) {
                extractedConclusion = sentenceStart[2] + extractedConclusion
              }
            }

            // Limit conclusion length to avoid showing too much (take first 1-2 complete sentences)
            if (extractedConclusion.length > 300) {
              // Split by sentence boundaries while preserving punctuation
              const sentenceParts = extractedConclusion.match(/[^.!?]*[.!?]+/g)
              if (sentenceParts && sentenceParts.length > 0) {
                // Take first 1-2 sentences
                extractedConclusion = sentenceParts.slice(0, 2).join(' ').trim()
                if (sentenceParts.length > 2) {
                  extractedConclusion += '...'
                }
              } else {
                // Fallback: just truncate at 300 chars
                extractedConclusion = extractedConclusion.substring(0, 300).trim() + '...'
              }
            }
            break
          }
        }

        // Strategy 2: If no conclusion pattern found, look for the last step or final paragraph
        if (!extractedConclusion) {
          const paragraphs = thinking.split(/\n\n+/).filter(p => p.trim().length > 0)
          if (paragraphs.length > 0) {
            // Look for the last paragraph that seems like a conclusion (not a step)
            // Skip paragraphs that start with "Step" or numbered items
            for (let i = paragraphs.length - 1; i >= 0; i--) {
              const para = paragraphs[i].trim()
              // If it doesn't start with "Step" or a number, it might be a conclusion
              if (!para.match(/^(?:Step \d+|## Step|\d+\.)/i) && para.length > 50) {
                // Extract complete sentences using regex that preserves punctuation
                const sentenceMatches = para.match(/[^.!?]*[.!?]+/g)
                if (sentenceMatches && sentenceMatches.length > 0) {
                  // Take the last 1-2 complete sentences
                  extractedConclusion = sentenceMatches.slice(-2).join(' ').trim()
                } else {
                  // Fallback: use the whole paragraph
                  extractedConclusion = para
                }
                // Limit length
                if (extractedConclusion.length > 300) {
                  // Take first 1-2 sentences if too long
                  const firstSentences = sentenceMatches ? sentenceMatches.slice(0, 2).join(' ').trim() : null
                  if (firstSentences) {
                    extractedConclusion = firstSentences + (sentenceMatches && sentenceMatches.length > 2 ? '...' : '')
                  } else {
                    extractedConclusion = para.substring(0, 300).trim() + '...'
                  }
                }
                break
              }
            }

            // If still no conclusion, use the last paragraph anyway, but ensure complete sentences
            if (!extractedConclusion && paragraphs.length > 0) {
              const lastPara = paragraphs[paragraphs.length - 1].trim()
              // Extract complete sentences
              const sentenceMatches = lastPara.match(/[^.!?]*[.!?]+/g)
              if (sentenceMatches && sentenceMatches.length > 0) {
                // Take the last 1-2 sentences
                extractedConclusion = sentenceMatches.slice(-2).join(' ').trim()
                if (extractedConclusion.length > 300) {
                  // Take first 1-2 sentences if too long
                  extractedConclusion = sentenceMatches.slice(0, 2).join(' ').trim() + (sentenceMatches.length > 2 ? '...' : '')
                }
              } else {
                // Fallback: use the whole paragraph, but truncate if too long
                extractedConclusion = lastPara
                if (extractedConclusion.length > 300) {
                  extractedConclusion = lastPara.substring(0, 300).trim() + '...'
                }
              }
            }
          }
        }

        // Clean up the extracted conclusion: fix any math formatting issues
        if (extractedConclusion) {
          // Fix patterns like $\40,000$ or $\42,000$ (where \40 and \42 are octal escapes)
          // These should be $40,000$ or $42,000$
          // Pattern: $ followed by backslash followed by 1-3 octal digits, then more digits
          extractedConclusion = extractedConclusion.replace(/\$\\([0-7]{1,3})(\d[^$]*)\$/g, (_match, octalPart, rest) => {
            // Convert octal escape to the intended number
            // \40 in octal is 32 in decimal, but we want literal "40"
            // So we just take the octal digits as-is and combine with rest
            return `$${octalPart}${rest}$`
          })

          // Fix escaped dollar signs that are already inside math delimiters
          // Pattern: $\$...$ should become $...$ (remove the escape since we're already in math mode)
          extractedConclusion = extractedConclusion.replace(/\$\\\$(\d[^$]*)\$/g, '$$$1$')

          // Fix cases where we have \$ outside of math delimiters that should be in math
          // Pattern: \$40,000 (not in math) should become $40,000$ if it's a number
          extractedConclusion = extractedConclusion.replace(/\\\$(\d[^$]*?)(?=\s|$|,|\.|;)/g, '$$$1$')
        }

        // Set main content to the extracted conclusion
        // If we can't extract a good conclusion, leave it empty (better than showing duplicate thinking)
        finalMainContent = extractedConclusion || ''
        // Keep the full thinking in the thinking section
        finalThinking = thinking

      }
      // Case 2: If thinking and mainContent are identical, it means the model returned duplicate content
      else if (thinking && mainContent && thinking.trim() === mainContent.trim()) {
        // Model returned duplicate content - only show main content, no thinking
        finalThinking = null
        finalMainContent = mainContent
      }


      // Extract and store thinking if it exists (for both Reasoning and Advanced modes)
      // Advanced mode models (like groq/compound) sometimes return reasoning content
      // Use finalThinking and finalMainContent (which handle duplicate detection)
      const hasThinking = finalThinking && finalThinking.trim().length > 0

      // Store this response in messageResponses
      const responseData = {
        content: finalMainContent || (hasThinking ? '' : finalResponse),
        thinking: hasThinking ? (finalThinking || undefined) : undefined,
        timestamp: Date.now()
      }

      setMessageResponses((prev) => {
        const existing = prev[assistantMessageId] || []
        const newResponses = [...existing, responseData]
        const newIndex = newResponses.length - 1 // Index of the newly added response (0-based)
        // Update current response index to point to the new response
        setCurrentResponseIndex((prevIdx) => ({ ...prevIdx, [assistantMessageId]: newIndex }))
        return { ...prev, [assistantMessageId]: newResponses }
      })

      if (isReasoningMode || (modelMode === 'advanced' && hasThinking)) {
        // In reasoning mode or advanced mode with thinking, show both thinking and main content
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                ...msg,
                // If finalMainContent is empty, don't fall back to finalResponse (which contains reasoning)
                // Instead, use empty string or a placeholder
                content: responseData.content,
                thinking: responseData.thinking
              }
              : msg
          )
        )
      } else {
        // In other modes without thinking, only show main content
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: responseData.content, thinking: undefined }
              : msg
          )
        )
      }
    } catch (error) {
      // Don't show error if it was aborted by user
      if (error instanceof DOMException && error.name === 'AbortError') {
        // Keep the partial response, just stop loading
      } else {
        console.error('Error sending message (details logged, user sees sanitized message):', error)
        // Error message is already sanitized by sendChatMessage function
        const errorMessage = error instanceof Error ? error.message : 'Unable to send message. Please try again.'
        setError(errorMessage)
        setMessages((prev) => prev.filter((msg) => msg.id !== assistantMessageId))
        
        // Track AI timeout/error
        const isTimeout = errorMessage.toLowerCase().includes('timeout') || 
                         errorMessage.toLowerCase().includes('timed out')
        if (isTimeout) {
          await analytics.trackError('ai_timeout', `Model: ${modelMode}, Error: ${errorMessage}`)
        }
      }
    } finally {
      // Track AI response completion
      const responseTimeMs = Date.now() - queryStartTime
      analytics.trackAIResponse(modelMode, responseTimeMs)
      
      setIsLoading(false)
      abortControllerRef.current = null
      inputRef.current?.focus()
    }
  }

  const handlePause = () => {
    if (abortControllerRef.current) {
      // Abort the request - this will cause the promise to reject with AbortError
      // The error is already handled in the catch block of handleSend
      abortControllerRef.current.abort()
      abortControllerRef.current = null
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleUseSelectedText = () => {
    if (selectedText) {
      setInput(`Tell me about this: ${selectedText}`)
      inputRef.current?.focus()
    }
  }

  // Handle resending a question to get a new response
  const handleResendMessage = async (messageId: string) => {
    // Find the assistant message
    const assistantMessageIndex = messages.findIndex(msg => msg.id === messageId)
    if (assistantMessageIndex === -1 || messages[assistantMessageIndex].role !== 'assistant') return

    // Find the previous user message
    let userMessageIndex = assistantMessageIndex - 1
    while (userMessageIndex >= 0 && messages[userMessageIndex].role !== 'user') {
      userMessageIndex--
    }

    if (userMessageIndex < 0) return

    const userMessage = messages[userMessageIndex]
    const isReasoningMode = modelMode === 'reasoning'

    // Clear the current response content to show it's being regenerated
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? { ...msg, content: '', thinking: undefined }
          : msg
      )
    )

    // Set loading state
    setIsLoading(true)

    // Abort any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    try {
      // Extract question text and context from the original user message
      const questionText = typeof userMessage.content === 'string'
        ? userMessage.content
        : userMessage.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n')

      // Get the original selected text that was used
      const originalSelectedText = userMessage.selectedTextAtSend

      // Build conversation history up to (but not including) this assistant message
      const conversationHistory: ChatMessage[] = messages.slice(0, assistantMessageIndex).map((msg) => ({
        role: msg.role,
        content: msg.content
      }))

      // Determine context to send (PDF context if available)
      let contextToSend: string | undefined
      if (pdfText && pdfText.trim().length > 0) {
        if (originalSelectedText) {
          contextToSend = originalSelectedText
        } else {
          // Use smart PDF extraction
          contextToSend = await extractRelevantPDFContext(
            pdfText,
            questionText,
            isReasoningMode ? 1500 : 2000
          )
        }
      }

      // Determine which model to use based on mode
      let currentModel: string
      if (modelMode === 'auto') {
        currentModel = AUTO_MODELS[0]
      } else if (modelMode === 'reasoning') {
        currentModel = REASONING_MODELS[0]
      } else {
        currentModel = ADVANCED_MODELS.primary
      }

      // Call the API to get a new response
      let fullResponse = ''
      const finalResponse = await sendChatMessage(
        [...conversationHistory, userMessage],
        contextToSend,
        (chunk: string) => {
          if (abortControllerRef.current?.signal.aborted) {
            return
          }
          fullResponse += chunk

          // Extract thinking during streaming
          const { thinking: streamingThinking, mainContent: streamingMainContent } = extractThinking(fullResponse)
          const hasStreamingThinking = streamingThinking && streamingThinking.trim().length > 0

          if (isReasoningMode || (modelMode === 'advanced' && hasStreamingThinking)) {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === messageId
                  ? {
                    ...msg,
                    content: streamingMainContent || fullResponse,
                    thinking: hasStreamingThinking ? streamingThinking : msg.thinking
                  }
                  : msg
              )
            )
          } else {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === messageId
                  ? { ...msg, content: fullResponse }
                  : msg
              )
            )
          }
          scrollToBottom(false)
        },
        currentModel,
        abortControllerRef.current.signal,
        isReasoningMode
      )

      // Process the final response
      const { thinking, mainContent } = extractThinking(finalResponse)
      const hasThinking = thinking && thinking.trim().length > 0

      let finalThinking = thinking
      let finalMainContent = mainContent

      // Handle Advanced mode special cases
      if (modelMode === 'advanced' && hasThinking) {
        if (thinking && (!mainContent || mainContent.trim().length === 0)) {
          // Extract conclusion from thinking
          const conclusionPatterns = [
            /(?:Therefore|In conclusion|To summarize|The answer is|The result is|In summary|To conclude)[:.]?\s*(.+?)(?:\n\n|$)/is,
            /(?:So|Thus|Hence)[,.]?\s*(.+?)(?:\n\n|$)/is,
            /(?:The final answer is|The solution is|The answer)[:.]?\s*(.+?)(?:\n\n|$)/is
          ]

          let extractedConclusion = null
          for (const pattern of conclusionPatterns) {
            const match = thinking.match(pattern)
            if (match && match[1]) {
              const matchIndex = thinking.indexOf(match[0])
              const afterMatch = thinking.substring(matchIndex + match[0].length)

              let conclusionText = match[1].trim()
              const nextSentenceMatch = afterMatch.match(/^([^.!?]*[.!?]+)/)
              if (nextSentenceMatch) {
                conclusionText += nextSentenceMatch[1]
              } else {
                const paragraphEnd = afterMatch.match(/^([^\n]+)/)
                if (paragraphEnd) {
                  conclusionText += paragraphEnd[1]
                }
              }

              extractedConclusion = conclusionText.trim()

              if (extractedConclusion && !extractedConclusion.match(/^[A-Z"']/)) {
                const beforeMatch = thinking.substring(Math.max(0, matchIndex - 200), matchIndex)
                const sentenceStart = beforeMatch.match(/([.!?]\s+)([A-Z"'][^.!?]*)$/)
                if (sentenceStart) {
                  extractedConclusion = sentenceStart[2] + extractedConclusion
                }
              }

              if (extractedConclusion.length > 300) {
                const sentenceParts = extractedConclusion.match(/[^.!?]*[.!?]+/g)
                if (sentenceParts && sentenceParts.length > 0) {
                  extractedConclusion = sentenceParts.slice(0, 2).join(' ').trim()
                  if (sentenceParts.length > 2) {
                    extractedConclusion += '...'
                  }
                } else {
                  extractedConclusion = extractedConclusion.substring(0, 300).trim() + '...'
                }
              }
              break
            }
          }

          if (!extractedConclusion) {
            const paragraphs = thinking.split(/\n\n+/).filter(p => p.trim().length > 0)
            if (paragraphs.length > 0) {
              for (let i = paragraphs.length - 1; i >= 0; i--) {
                const para = paragraphs[i].trim()
                if (!para.match(/^(?:Step \d+|## Step|\d+\.)/i) && para.length > 50) {
                  const sentenceMatches = para.match(/[^.!?]*[.!?]+/g)
                  if (sentenceMatches && sentenceMatches.length > 0) {
                    extractedConclusion = sentenceMatches.slice(-2).join(' ').trim()
                  } else {
                    extractedConclusion = para
                  }
                  if (extractedConclusion.length > 300) {
                    const firstSentences = sentenceMatches ? sentenceMatches.slice(0, 2).join(' ').trim() : null
                    if (firstSentences) {
                      extractedConclusion = firstSentences + (sentenceMatches && sentenceMatches.length > 2 ? '...' : '')
                    } else {
                      extractedConclusion = para.substring(0, 300).trim() + '...'
                    }
                  }
                  break
                }
              }

              if (!extractedConclusion && paragraphs.length > 0) {
                const lastPara = paragraphs[paragraphs.length - 1].trim()
                const sentenceMatches = lastPara.match(/[^.!?]*[.!?]+/g)
                if (sentenceMatches && sentenceMatches.length > 0) {
                  extractedConclusion = sentenceMatches.slice(-2).join(' ').trim()
                  if (extractedConclusion.length > 300) {
                    extractedConclusion = sentenceMatches.slice(0, 2).join(' ').trim() + (sentenceMatches.length > 2 ? '...' : '')
                  }
                } else {
                  extractedConclusion = lastPara
                  if (extractedConclusion.length > 300) {
                    extractedConclusion = lastPara.substring(0, 300).trim() + '...'
                  }
                }
              }
            }
          }

          finalMainContent = extractedConclusion || ''
          finalThinking = thinking
        } else if (thinking && mainContent && thinking.trim() === mainContent.trim()) {
          finalThinking = null
          finalMainContent = mainContent
        }
      }

      // Store this response in messageResponses
      const responseData = {
        content: finalMainContent || (hasThinking ? '' : finalResponse),
        thinking: hasThinking ? (finalThinking || undefined) : undefined,
        timestamp: Date.now()
      }

      // Update both states together to ensure consistency
      setMessageResponses((prev) => {
        const existing = prev[messageId] || []
        const newResponses = [...existing, responseData]

        // Update currentResponseIndex immediately with the new index
        setCurrentResponseIndex((prevIdx) => {
          // Ensure we're setting it to the latest index
          const latestIndex = newResponses.length - 1
          return { ...prevIdx, [messageId]: latestIndex }
        })

        return { ...prev, [messageId]: newResponses }
      })

      // Update the message with the new response
      if (isReasoningMode || (modelMode === 'advanced' && hasThinking)) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? {
                ...msg,
                content: responseData.content,
                thinking: responseData.thinking
              }
              : msg
          )
        )
      } else {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? { ...msg, content: responseData.content, thinking: undefined }
              : msg
          )
        )
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        // Keep the partial response
      } else {
        console.error('Error resending message:', error)
        setError(error instanceof Error ? error.message : 'Unable to resend message. Please try again.')
        // Restore the previous response if available
        const responses = messageResponses[messageId] || []
        if (responses.length > 0) {
          const lastResponse = responses[responses.length - 1]
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === messageId
                ? { ...msg, content: lastResponse.content, thinking: lastResponse.thinking }
                : msg
            )
          )
        }
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }

  // Handle navigating between responses
  const handleNavigateResponse = (messageId: string, direction: 'prev' | 'next') => {
    const responses = messageResponses[messageId] || []
    if (responses.length === 0) return

    // Get current index, defaulting to the last response if not set
    const currentIdx = currentResponseIndex[messageId] ?? (responses.length - 1)
    let newIndex = currentIdx

    if (direction === 'prev') {
      newIndex = Math.max(0, currentIdx - 1)
    } else {
      // For 'next', make sure we don't go beyond the last index
      newIndex = Math.min(responses.length - 1, currentIdx + 1)
    }

    // If we're already at the target index, don't do anything
    if (newIndex === currentIdx) return

    // Update the index first
    setCurrentResponseIndex((prev) => {
      const updated = { ...prev, [messageId]: newIndex }
      return updated
    })

    // Update the message content to show the selected response
    const selectedResponse = responses[newIndex]
    if (selectedResponse) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? { ...msg, content: selectedResponse.content, thinking: selectedResponse.thinking }
            : msg
        )
      )
    }
  }

  // Parse user message to extract main question and PDF context
  const parseUserMessage = (content: string | Array<{ type: string; text?: string }>): { mainQuestion: string; pdfContext?: string } => {
    let textContent = ''
    if (typeof content === 'string') {
      textContent = content
    } else if (Array.isArray(content)) {
      const textItem = content.find(item => item.type === 'text')
      textContent = textItem?.text || ''
    }

    // Check if message contains "Context from PDF:" pattern
    const contextMatch = textContent.match(/^(.+?)\n\nContext from PDF:\s*(.+)$/s)
    if (contextMatch) {
      return {
        mainQuestion: contextMatch[1].trim(),
        pdfContext: contextMatch[2].trim()
      }
    }

    // Check for "Tell me about this:" pattern (when only selected text is used)
    const tellMeMatch = textContent.match(/^Tell me about this:\s*(.+)$/s)
    if (tellMeMatch) {
      return {
        mainQuestion: '',
        pdfContext: tellMeMatch[1].trim()
      }
    }

    // No PDF context found
    return {
      mainQuestion: textContent.trim()
    }
  }

  // Get currently selected text in the chat history
  const getSelectedTextInChat = (): string | null => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
      return null
    }

    const selectedText = selection.toString().trim()
    if (!selectedText) {
      return null
    }

    // Check if the selection is within a message content area
    const range = selection.getRangeAt(0)
    const commonAncestor = range.commonAncestorContainer

    // Check if selection is within a message (not in buttons or other UI elements)
    const messageElement = commonAncestor.nodeType === Node.TEXT_NODE
      ? commonAncestor.parentElement?.closest('.message-assistant, .message-user')
      : (commonAncestor as Element)?.closest('.message-assistant, .message-user')

    if (messageElement) {
      return selectedText
    }

    return null
  }

  const handleClearChat = () => {
    if (clearConfirming) {
      // Second click: actually clear
      setMessages([])
      setError(null)
      setClearConfirming(false)
      if (clearConfirmTimeoutRef.current) {
        clearTimeout(clearConfirmTimeoutRef.current)
        clearConfirmTimeoutRef.current = null
      }
    } else {
      // First click: show confirmation (red state)
      setClearConfirming(true)
      // Reset confirmation after 3 seconds
      if (clearConfirmTimeoutRef.current) {
        clearTimeout(clearConfirmTimeoutRef.current)
      }
      clearConfirmTimeoutRef.current = setTimeout(() => {
        setClearConfirming(false)
        clearConfirmTimeoutRef.current = null
      }, 3000)
    }
  }

  // Handle interaction mode changes
  const handleInteractionModeSelect = (mode: InteractionMode) => {
    setInteractionMode(mode)
    if (mode === 'quiz-me') {
      setShowQuizConfig(true)
    }
    // Guide me learn now goes directly to chat - no sub-mode selection needed
    onModeChange?.(mode)
  }

  const handleBackToInteraction = () => {
    setInteractionMode(null)
    onModeChange?.(null)
  }

  const handleBackFromQuizConfig = () => {
    setShowQuizConfig(false)
    setInteractionMode(null)
    onModeChange?.(null)
  }

  // Expose reset function to parent via ref
  useEffect(() => {
    if (resetModeRef) {
      resetModeRef.current = handleBackToInteraction
    }
  }, [resetModeRef])

  // Persist interaction mode to localStorage
  useEffect(() => {
    if (interactionMode) {
      localStorage.setItem('chatnote-interaction-mode', interactionMode)
    } else {
      localStorage.removeItem('chatnote-interaction-mode')
    }
  }, [interactionMode])

  // Notify parent of mode changes and restore on mount
  useEffect(() => {
    if (interactionMode) {
      onModeChange?.(interactionMode)
    }
  }, [interactionMode, onModeChange])

  // Restore quiz config screen if quiz-me mode was saved
  useEffect(() => {
    if (interactionMode === 'quiz-me' && !quizSession) {
      setShowQuizConfig(true)
    }
  }, []) // Only run on mount

  // Quiz handlers
  const handleStartQuiz = async (count: number, types: QuizQuestionType[]) => {
    if (!pdfText) {
      setError('Please load a PDF document first')
      return
    }

    setShowQuizConfig(false)
    setQuizSession(null) // Clear old quiz session before generating new one
    setIsGeneratingQuiz(true)
    setError(null)

    try {
      const questions = await generateQuiz(pdfText, {
        count: count,
        difficulty: 'medium',
        questionTypes: types
      })

      setQuizSession({
        questions: questions,
        currentQuestionIndex: 0,
        score: 0,
        answers: new Map(),
        startTime: new Date(),
        isComplete: false
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate quiz')
      setInteractionMode(null)
    } finally {
      setIsGeneratingQuiz(false)
    }
  }

  const handleAnswerQuestion = async (questionId: string, answer: string) => {
    if (!quizSession) return

    const currentQuestion = quizSession.questions[quizSession.currentQuestionIndex]
    const evaluation = await evaluateAnswer(currentQuestion, answer)

    const updatedAnswers = new Map(quizSession.answers)
    updatedAnswers.set(questionId, answer)

    const newScore = evaluation.isCorrect ? quizSession.score + 1 : quizSession.score
    const isLastQuestion = quizSession.currentQuestionIndex === quizSession.questions.length - 1

    setQuizSession({
      ...quizSession,
      answers: updatedAnswers,
      score: newScore,
      currentQuestionIndex: isLastQuestion ? quizSession.currentQuestionIndex : quizSession.currentQuestionIndex + 1,
      isComplete: isLastQuestion,
      endTime: isLastQuestion ? new Date() : undefined
    })
  }

  const handleRequestMoreQuestions = () => {
    // Show configuration again to get more questions
    setQuizSession(null)
    setShowQuizConfig(true)
  }

  const handleRestartQuiz = () => {
    // Retake the same quiz by resetting answers and score
    if (quizSession) {
      setQuizSession({
        ...quizSession,
        currentQuestionIndex: 0,
        score: 0,
        answers: new Map(),
        startTime: new Date(),
        endTime: undefined,
        isComplete: false
      })
    } else {
      // If no session exists, show configuration
      setQuizSession(null)
      setShowQuizConfig(true)
    }
  }

  const handleExitQuiz = () => {
    setQuizSession(null)
    setInteractionMode(null)
    onModeChange?.(null)
  }

  const handleAddQuizQuestionToPDF = (question: QuizQuestion, userAnswer: string, isCorrect: boolean) => {
    if (!question.pageReference) {
      // Use current page if no page reference
      const pageNumber = currentPageNumber || 1
      const questionText = `Quiz Question: ${question.question}\n\nYour Answer: ${userAnswer}\n${isCorrect ? '✓ Correct!' : '✗ Incorrect'}\n\nExplanation: ${question.explanation}`
      
      onAddAnnotationToPDF?.(questionText, pageNumber, 0.5)
    } else {
      const questionText = `Quiz Question: ${question.question}\n\nYour Answer: ${userAnswer}\n${isCorrect ? '✓ Correct!' : '✗ Incorrect'}\n\nExplanation: ${question.explanation}`
      
      onAddAnnotationToPDF?.(questionText, question.pageReference, 0.5)
    }
  }

  const handleAddQuizQuestionToNotes = (question: QuizQuestion, _userAnswer: string, isCorrect: boolean) => {
    const pageNumber = question.pageReference || currentPageNumber || 1
    
    // Get the correct answer text
    let correctAnswerText = 'N/A'
    if (question.type === 'multiple-choice' && question.options) {
      const correctOption = question.options.find(opt => opt.isCorrect)
      correctAnswerText = correctOption ? correctOption.text : 'N/A'
    } else if (Array.isArray(question.correctAnswer)) {
      correctAnswerText = question.correctAnswer.join(', ')
    } else {
      correctAnswerText = question.correctAnswer
    }
    
    const noteContent = `**Quiz Question** ${isCorrect ? '✓' : '✗'}\n\n${question.question}\n\n**Correct Answer:** ${correctAnswerText}\n\n**Explanation:** ${question.explanation}`
    
    onCreateKnowledgeNote?.(
      noteContent,
      question.question, // linked text
      pageNumber,
      0.5, // textYPosition
      `quiz-${question.id}` // messageId - stable ID to prevent duplicates
    )
  }

  return (
    <div className="chatgpt-wrapper">
      {/* Only show interaction modes when PDF is loaded */}
      {pdfText && (
        <>
      {/* Interaction Mode Selection */}
      {!interactionMode && (
        <InteractionModeSelector
          onModeSelect={handleInteractionModeSelect}
        />
      )}

      {/* Quiz Mode */}
      {interactionMode === 'quiz-me' && (
        <>
          {showQuizConfig && (
            <QuizConfiguration
              onStartQuiz={handleStartQuiz}
              onBack={handleBackFromQuizConfig}
            />
          )}
          {isGeneratingQuiz && (
            <div className="quiz-loading">
              <div className="quiz-loading-spinner"></div>
              <p>Generating quiz questions...</p>
            </div>
          )}
          {quizSession && !showQuizConfig && (
            <QuizInterface
              session={quizSession}
              onAnswer={handleAnswerQuestion}
              onNextQuestion={() => {
                if (quizSession.currentQuestionIndex < quizSession.questions.length - 1) {
                  setQuizSession({
                    ...quizSession,
                    currentQuestionIndex: quizSession.currentQuestionIndex + 1
                  })
                }
              }}
              onPreviousQuestion={() => {
                if (quizSession.currentQuestionIndex > 0) {
                  setQuizSession({
                    ...quizSession,
                    currentQuestionIndex: quizSession.currentQuestionIndex - 1
                  })
                }
              }}
              onRequestMore={(_count, _type) => handleRequestMoreQuestions()}
              onFinish={handleExitQuiz}
              onRestart={handleRestartQuiz}
              onAddToPDF={handleAddQuizQuestionToPDF}
              onAddToNotes={handleAddQuizQuestionToNotes}
              onExitReview={handleExitQuiz}
            />
          )}
        </>
      )}

      {/* Chat Interface - Show for guide-me-learn or when no mode selected */}
      {(!interactionMode || interactionMode === 'guide-me-learn') && (
        <>
      {!authLoading && !isAuthenticated && layout === 'floating' && (
        <div className="api-key-warning-outer">
          <span>🔐 Please sign in to use the chat feature</span>
          <span className="warning-hint">
            Click "Sign in with Google" in the navigation bar
          </span>
        </div>
      )}
      {!authLoading && isAuthenticated && !isCheckingApiKey && apiKeyMissing && layout === 'floating' && (
        <div className="api-key-warning-outer">
          <div className="warning-content">
            <span>⚠️ Groq API key not configured</span>
            <span className="warning-hint">
              {user?.role === 'admin'
                ? 'Admin API key not configured on server'
                : 'Add your API key in Settings (click the gear icon)'}
            </span>
          </div>
          <button
            className="api-key-refresh-button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              checkApiKey()
            }}
            title="Refresh API key status"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
        </div>
      )}

      {layout === 'floating' && (
        <div className={`model-selector-bar ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
          <div className="model-selector-wrapper" ref={modelSelectorRef}>
            <div className="model-mode-toggle-container">
              <ModelModeToggle
                mode={modelMode}
                onModeChange={handleModeChange}
                disabled={apiKeyMissing}
              />
            </div>
            {isVisionModel() && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageUpload}
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    fileInputRef.current?.click()
                  }}
                  className="image-upload-button"
                  title="Upload images"
                  disabled={apiKeyMissing}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <span className="image-upload-text">Image</span>
                </button>
              </>
            )}
          </div>
          <div className="header-actions">
            {messages.length > 0 && (
              <button onClick={handleClearChat} className={`clear-button ${clearConfirming ? 'confirming' : ''}`} title={clearConfirming ? 'Click again to confirm' : 'Clear chat'}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
                <span className="clear-button-text">{clearConfirming ? 'Confirm' : 'Clear'}</span>
              </button>
            )}
            {layout === 'floating' && (
              <>
                {/* Layout switch moved to AnnotationToolbar (in PDF viewer) */}
                <button
                  onClick={onToggleKnowledgeNotes}
                  className="notes-toggle-button collapse-button"
                  title={showKnowledgeNotes ? 'Hide knowledge notes' : 'Show knowledge notes'}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                </button>
                <button
                  onClick={() => {
                    if (!isCollapsed) {
                      // About to collapse: save current scroll position
                      if (messagesContainerRef.current) {
                        setSavedScrollPosition(messagesContainerRef.current.scrollTop)
                      }
                    }
                    setIsCollapsed(!isCollapsed)
                  }}
                  className="collapse-button"
                  title={isCollapsed ? 'Expand chat' : 'Collapse chat'}
                  aria-label={isCollapsed ? 'Expand chat' : 'Collapse chat'}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ transform: isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s' }}
                  >
                    <path d="M18 15l-6-6-6 6" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div
        ref={chatInnerRef}
        className={`chatgpt-inner ${theme === 'dark' ? 'theme-dark' : 'theme-light'} ${isCollapsed && layout === 'floating' ? 'collapsed' : ''}`}
        style={{
          ...(enlargedImageMaxHeight
            ? { maxHeight: `${enlargedImageMaxHeight}px` }
            : layout === 'floating' && !isCollapsed && dynamicMaxHeight
              ? { maxHeight: `${dynamicMaxHeight}px` }
              : {})
        }}
      >
        {selectedText && (
          <div className="selected-text-banner">
            <span className="banner-text">
              Selected Text: {selectedText.length > 20 ? `${selectedText.substring(0, 20)}...` : selectedText}
            </span>
            <div className="banner-buttons">
              <button onClick={handleUseSelectedText} className="use-text-button">
                Tell me more
              </button>
              {onClearSelectedText && (
                <button onClick={onClearSelectedText} className="close-text-button" title="Clear selection">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}

        {(!isCollapsed || layout === 'split') && (
          <div ref={messagesContainerRef} className="chatgpt-messages">
            {messages.length === 0 && (
              <div className="welcome-screen">
                <div className="welcome-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z"
                      fill="#10a37f"
                      opacity="0.1"
                    />
                    <path
                      d="M6 9H18M6 13H14"
                      stroke="#10a37f"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <h3>How can I help you today?</h3>
                <p>Ask me anything about your PDF, or select text to get context-specific answers.</p>
              </div>
            )}
            {messages.map((message, index) => {
              // Check if this is the last assistant message
              const isLastAssistantMessage = message.role === 'assistant' &&
                index === messages.length - 1

              return (
                <div
                  key={message.id}
                  className={`message ${message.role === 'user' ? 'message-user' : 'message-assistant'}`}
                >
                  <div className="message-avatar">
                    {message.role === 'user' ? (
                      <div className="avatar-user">
                        {user?.picture ? (
                          <img
                            src={user.picture}
                            alt={user.name || user.email}
                            crossOrigin="anonymous"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              // If image fails to load, show fallback
                              const target = e.target as HTMLImageElement
                              target.style.display = 'none'
                              const parent = target.parentElement
                              if (parent) {
                                // Remove any existing span
                                const existingSpan = parent.querySelector('span.avatar-fallback')
                                if (existingSpan) {
                                  existingSpan.remove()
                                }
                                // Add fallback
                                const fallback = document.createElement('span')
                                fallback.className = 'avatar-fallback'
                                fallback.textContent = user.name?.[0]?.toUpperCase() || user.email[0].toUpperCase()
                                parent.appendChild(fallback)
                              }
                            }}
                          />
                        ) : (
                          <span className="avatar-fallback">
                            {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="avatar-assistant">
                        <img
                          src={chatNoteIcon}
                          alt="ChatNote"
                          className="assistant-avatar-img"
                          onError={(e) => {
                            // If image fails to load, show fallback SVG
                            const target = e.target as HTMLImageElement
                            target.style.display = 'none'
                            const parent = target.parentElement
                            if (parent) {
                              // Remove any existing fallback
                              const existingFallback = parent.querySelector('svg.avatar-fallback-svg')
                              if (existingFallback) {
                                existingFallback.remove()
                              }
                              // Add fallback SVG
                              const fallback = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
                              fallback.setAttribute('width', '32')
                              fallback.setAttribute('height', '32')
                              fallback.setAttribute('viewBox', '0 0 24 24')
                              fallback.setAttribute('fill', 'none')
                              fallback.setAttribute('class', 'avatar-fallback-svg')
                              const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
                              path.setAttribute('d', 'M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z')
                              path.setAttribute('fill', 'currentColor')
                              fallback.appendChild(path)
                              parent.appendChild(fallback)
                            }
                          }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="message-content-wrapper">
                    <div className="message-content">
                      {message.role === 'assistant' && isLoading && !message.content && isLastAssistantMessage ? (
                        <div className="typing-indicator">
                          <span></span>
                          <span></span>
                          <span></span>
                        </div>
                      ) : message.role === 'assistant' && message.content ? (
                        <>
                          {/* Show thinking process when in Reasoning or Advanced mode and thinking content exists */}
                          {/* Note: thinking is preserved in chat history even when switching modes */}
                          {(modelMode === 'reasoning' || modelMode === 'advanced') && message.thinking && message.thinking.trim().length > 0 ? (
                            <div className="thinking-process-container">
                              <button
                                className={`thinking-toggle-button ${expandedThinking[message.id] ? 'expanded' : ''}`}
                                onClick={() => {
                                  setExpandedThinking(prev => ({
                                    ...prev,
                                    [message.id]: !(prev[message.id] ?? false)
                                  }))
                                }}
                                title={expandedThinking[message.id] ? 'Collapse thinking' : 'Expand thinking'}
                              >
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  style={{
                                    transform: expandedThinking[message.id] ? 'rotate(90deg)' : 'rotate(0deg)',
                                    transition: 'transform 0.2s'
                                  }}
                                >
                                  <polyline points="9 18 15 12 9 6"></polyline>
                                </svg>
                                <span>Thinking Process</span>
                                {isLoading && isLastAssistantMessage && !expandedThinking[message.id] && (
                                  <span style={{ marginLeft: '8px', fontSize: '12px', opacity: 0.7 }}>
                                    (generating...)
                                  </span>
                                )}
                              </button>
                              {expandedThinking[message.id] && message.thinking ? (
                                <div className="thinking-content expanded">
                                  <div className="markdown-content">
                                    <ReactMarkdown
                                      remarkPlugins={[remarkGfm, remarkMath]}
                                      rehypePlugins={[[rehypeKatex, {
                                        strict: false, // Don't throw on parse errors
                                        throwOnError: false, // Don't throw on render errors
                                        errorColor: '#cc0000',
                                        macros: {},
                                        fleqn: false,
                                        output: 'html',
                                        trust: false,
                                      }]]}
                                    >
                                      {(() => {
                                        try {
                                          const processed = preprocessMathContent(message.thinking || '')

                                          // Final safety check for thinking content too
                                          if (processed.includes('\u2011')) {
                                            return processed.replace(/\u2011/g, '-')
                                          }

                                          return processed || ''
                                        } catch (error) {
                                          console.error('Error preprocessing thinking content:', error)
                                          const fallback = message.thinking || ''
                                          // Even in error case, try to normalize
                                          return fallback.replace(/\u2011/g, '-')
                                        }
                                      })()}
                                    </ReactMarkdown>
                                  </div>
                                  {isLoading && isLastAssistantMessage && (
                                    <div className="typing-indicator" style={{ marginTop: '12px' }}>
                                      <span></span>
                                      <span></span>
                                      <span></span>
                                    </div>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          {/* Only show final response if we have content (not empty string) */}
                          {message.content && (typeof message.content === 'string' ? message.content.trim().length > 0 : true) ? (
                            <div className="markdown-content">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm, remarkMath]}
                                rehypePlugins={[[rehypeKatex, {
                                  strict: false, // Don't throw on parse errors
                                  throwOnError: false, // Don't throw on render errors
                                  errorColor: '#cc0000',
                                  macros: {},
                                  fleqn: false,
                                  output: 'html',
                                  trust: false,
                                }]]}
                                components={{
                                  table: ({ children, ...props }) => (
                                    <div className="table-scroll-wrapper">
                                      <table {...props}>{children}</table>
                                    </div>
                                  ),
                                  // Wrap math blocks in scrollable containers
                                  div: ({ children, className, ...props }) => {
                                    if (className && typeof className === 'string' &&
                                      className.includes('katex-display') &&
                                      !className.includes('math-scroll-wrapper')) {
                                      return (
                                        <div className="math-scroll-wrapper">
                                          <div className={className} {...props}>
                                            {children}
                                          </div>
                                        </div>
                                      )
                                    }
                                    return <div {...props} className={className}>{children}</div>
                                  },
                                  pre: ({ children, ...props }) => (
                                    <pre className="code-scroll-wrapper" {...props}>
                                      {children}
                                    </pre>
                                  ),
                                }}
                              >
                                {(() => {
                                  try {
                                    if (typeof message.content === 'string' && message.content) {
                                      // Strip <tool> and <think> tags from advanced model responses
                                      let processed = message.content.replace(/<tool>[\s\S]*?<\/tool>/gi, '').replace(/<think>[\s\S]*?<\/think>/gi, '')
                                      processed = preprocessMathContent(processed)

                                      // Final safety check: ensure no non-breaking hyphens before passing to ReactMarkdown
                                      if (processed.includes('\u2011')) {
                                        // Force final normalization as emergency fallback
                                        return processed.replace(/\u2011/g, '-')
                                      }

                                      return processed || ''
                                    }
                                    return ''
                                  } catch (error) {
                                    console.error('Error preprocessing message content:', error)
                                    const fallback = typeof message.content === 'string' ? message.content : ''
                                    // Even in error case, try to normalize
                                    return fallback.replace(/\u2011/g, '-')
                                  }
                                })()}
                              </ReactMarkdown>
                            </div>
                          ) : null}
                        </>
                      ) : message.role === 'user' ? (
                        <div className="user-message-content">
                          {Array.isArray(message.content) ? (
                            <>
                              {(() => {
                                const cleanedContent = removeInstructions(message.content) as Array<{ type: string; text?: string; image_url?: { url: string } }>
                                const textItems = cleanedContent.filter(item => item.type === 'text')
                                const imageItems = cleanedContent.filter(item => item.type === 'image_url')
                                const scrollState = messageScrollStates[message.id] || { canScrollLeft: false, canScrollRight: false }

                                // Parse text content to separate main question and PDF context
                                const fullText = textItems.map(item => item.text || '').join('\n')
                                const parsed = parseUserMessage(fullText)

                                return (
                                  <>
                                    {/* Main question */}
                                    {parsed.mainQuestion && (
                                      <div className="message-text">{parsed.mainQuestion}</div>
                                    )}

                                    {/* PDF Context - Collapsible */}
                                    {parsed.pdfContext && (
                                      <div className="pdf-context-container">
                                        <button
                                          className={`pdf-context-toggle ${expandedPdfContext[message.id] ? 'expanded' : ''}`}
                                          onClick={() => {
                                            setExpandedPdfContext(prev => ({
                                              ...prev,
                                              [message.id]: !(prev[message.id] ?? false)
                                            }))
                                          }}
                                          title={expandedPdfContext[message.id] ? 'Collapse PDF context' : 'Expand PDF context'}
                                        >
                                          <svg
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            style={{
                                              transform: expandedPdfContext[message.id] ? 'rotate(90deg)' : 'rotate(0deg)',
                                              transition: 'transform 0.2s'
                                            }}
                                          >
                                            <polyline points="9 18 15 12 9 6"></polyline>
                                          </svg>
                                          <span>Context from PDF</span>
                                        </button>
                                        {expandedPdfContext[message.id] && (
                                          <div className="pdf-context-content">
                                            <div className="message-text">{parsed.pdfContext}</div>
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* Fallback: if no parsing worked, show original text */}
                                    {!parsed.mainQuestion && !parsed.pdfContext && textItems.map((item, idx) => (
                                      <div key={`text-${idx}`} className="message-text">{item.text}</div>
                                    ))}
                                    {imageItems.length > 0 && (
                                      <>
                                        {/* Render enlarged image outside scroll container if any image is enlarged */}
                                        {imageItems.map((item, idx) => {
                                          const imageUrl = item.image_url?.url
                                          if (!imageUrl) return null
                                          const imageId = `${message.id}-${idx}`
                                          const isEnlarged = enlargedImage === imageId
                                          if (isEnlarged) {
                                            return (
                                              <div key={`enlarged-${idx}`} className="message-image-enlarged-container">
                                                <div className="message-image enlarged">
                                                  <div className="message-image-wrapper">
                                                    <img
                                                      src={imageUrl}
                                                      alt="Uploaded"
                                                      onClick={(e) => {
                                                        e.stopPropagation()
                                                        setEnlargedImage(null)
                                                      }}
                                                    />
                                                  </div>
                                                </div>
                                              </div>
                                            )
                                          }
                                          return null
                                        })}
                                        {/* Render scrollable container with non-enlarged images */}
                                        <div className="message-images-wrapper">
                                          {scrollState.canScrollLeft && (
                                            <button
                                              className="message-image-scroll-button message-image-scroll-left"
                                              onClick={() => scrollMessageImages(message.id, 'left')}
                                              title="Scroll left"
                                            >
                                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="15 18 9 12 15 6"></polyline>
                                              </svg>
                                            </button>
                                          )}
                                          <div
                                            ref={(el) => {
                                              messageImagesRefs.current[message.id] = el
                                              if (el) {
                                                // Check scroll state after ref is set
                                                setTimeout(() => checkMessageScrollButtons(message.id), 0)
                                              }
                                            }}
                                            className="message-images-container"
                                            onScroll={() => checkMessageScrollButtons(message.id)}
                                          >
                                            {imageItems.map((item, idx) => {
                                              const imageUrl = item.image_url?.url
                                              if (!imageUrl) return null
                                              const imageId = `${message.id}-${idx}`
                                              const isEnlarged = enlargedImage === imageId

                                              // Skip enlarged images in scroll container
                                              if (isEnlarged) return null

                                              return (
                                                <div key={idx} className="message-image-item">
                                                  <div className="message-image">
                                                    <div className="message-image-wrapper">
                                                      <img
                                                        src={imageUrl}
                                                        alt="Uploaded"
                                                        onClick={(e) => {
                                                          e.stopPropagation()
                                                          setEnlargedImage(imageId)
                                                        }}
                                                      />
                                                      <div
                                                        className="image-magnifier"
                                                        onClick={(e) => {
                                                          e.stopPropagation()
                                                          setEnlargedImage(imageId)
                                                        }}
                                                        title="Click to enlarge"
                                                      >
                                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                          <circle cx="11" cy="11" r="8"></circle>
                                                          <path d="m21 21-4.35-4.35"></path>
                                                          <circle cx="11" cy="11" r="3"></circle>
                                                        </svg>
                                                      </div>
                                                    </div>
                                                  </div>
                                                </div>
                                              )
                                            })}
                                          </div>
                                          {scrollState.canScrollRight && (
                                            <button
                                              className="message-image-scroll-button message-image-scroll-right"
                                              onClick={() => scrollMessageImages(message.id, 'right')}
                                              title="Scroll right"
                                            >
                                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="9 18 15 12 9 6"></polyline>
                                              </svg>
                                            </button>
                                          )}
                                        </div>
                                      </>
                                    )}
                                  </>
                                )
                              })()}
                            </>
                          ) : (
                            (() => {
                              const content = typeof message.content === 'string' ? removeInstructions(message.content) as string : ''
                              const parsed = parseUserMessage(content)

                              return (
                                <>
                                  {/* Main question */}
                                  {parsed.mainQuestion && (
                                    <div className="message-text">{parsed.mainQuestion}</div>
                                  )}

                                  {/* PDF Context - Collapsible */}
                                  {parsed.pdfContext && (
                                    <div className="pdf-context-container">
                                      <button
                                        className={`pdf-context-toggle ${expandedPdfContext[message.id] ? 'expanded' : ''}`}
                                        onClick={() => {
                                          setExpandedPdfContext(prev => ({
                                            ...prev,
                                            [message.id]: !(prev[message.id] ?? false)
                                          }))
                                        }}
                                        title={expandedPdfContext[message.id] ? 'Collapse PDF context' : 'Expand PDF context'}
                                      >
                                        <svg
                                          width="16"
                                          height="16"
                                          viewBox="0 0 24 24"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          style={{
                                            transform: expandedPdfContext[message.id] ? 'rotate(90deg)' : 'rotate(0deg)',
                                            transition: 'transform 0.2s'
                                          }}
                                        >
                                          <polyline points="9 18 15 12 9 6"></polyline>
                                        </svg>
                                        <span>Context from PDF</span>
                                      </button>
                                      {expandedPdfContext[message.id] && (
                                        <div className="pdf-context-content">
                                          <div className="message-text">{parsed.pdfContext}</div>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Fallback: if no parsing worked, show original content */}
                                  {!parsed.mainQuestion && !parsed.pdfContext && (
                                    <div className="message-text">{content}</div>
                                  )}
                                </>
                              )
                            })()
                          )}
                        </div>
                      ) : (
                        <div className="markdown-content">{typeof message.content === 'string' ? message.content : ''}</div>
                      )}
                    </div>
                    {message.role === 'assistant' && message.content && (
                      <div className="message-actions">
                        <button
                          className="message-action-button copy-button"
                          onClick={async () => {
                            try {
                              const textToCopy = typeof message.content === 'string'
                                ? message.content
                                : Array.isArray(message.content)
                                  ? message.content.filter(item => item.type === 'text').map(item => (item as { type: 'text'; text: string }).text).join('\n')
                                  : ''
                              await navigator.clipboard.writeText(textToCopy)
                              // You could add a toast notification here
                            } catch (err) {
                              console.error('Failed to copy:', err)
                            }
                          }}
                          title="Copy to clipboard"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                          <span className="message-action-button-text">Copy</span>
                        </button>
                        {pdfText && pdfText.trim().length > 0 && (
                          <>
                            <button
                              className="message-action-button knowledge-note-button"
                              onClick={() => {
                                if (onCreateKnowledgeNote) {
                                  // Track AI result action
                                  analytics.trackAIResultAction('save_note')
                                  
                                  // Update document to mark it has notes
                                  const currentDocId = analytics.getCurrentDocumentId()
                                  if (currentDocId) {
                                    analytics.updateDocument(currentDocId, { has_notes: true })
                                  }
                                  
                                  // Check if user has selected text in chat history
                                  const selectedTextInChat = getSelectedTextInChat()

                                  // Use selected text if available, otherwise use full message content
                                  let contentToSave = ''
                                  if (selectedTextInChat) {
                                    contentToSave = selectedTextInChat
                                  } else {
                                    contentToSave = typeof message.content === 'string'
                                      ? message.content
                                      : Array.isArray(message.content)
                                        ? message.content.filter(item => item.type === 'text').map(item => (item as { type: 'text'; text: string }).text).join('\n')
                                        : ''
                                  }

                                  // Use the selected text that was stored when the message was sent,
                                  // not the current selectedText prop which might have changed
                                  const linkedText = message.selectedTextAtSend || selectedText || undefined
                                  
                                  // Use the page number from when the message was sent, not the current page
                                  // This ensures notes stick to the original selected text position
                                  const notePageNumber = message.pageNumberAtSend || currentPageNumber
                                  const noteTextYPosition = message.textYPositionAtSend

                                  onCreateKnowledgeNote(
                                    contentToSave,
                                    linkedText,
                                    notePageNumber,
                                    noteTextYPosition,
                                    message.id
                                  )

                                  // Auto-open knowledge notes panel if it's not open
                                  if (onOpenKnowledgeNotes) {
                                    onOpenKnowledgeNotes()
                                  }
                                }
                              }}
                              title="Create knowledge note"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                                <line x1="16" y1="13" x2="8" y2="13" />
                                <line x1="16" y1="17" x2="8" y2="17" />
                                <polyline points="10 9 9 9 8 9" />
                              </svg>
                              <span className="message-action-button-text">Save Note</span>
                            </button>
                            <button
                              className="message-action-button add-to-pdf-button"
                              onClick={() => {
                                if (onAddAnnotationToPDF) {
                                  // Track AI result action
                                  analytics.trackAIResultAction('add_to_pdf')
                                  
                                  // Update document to mark it has annotations
                                  const currentDocId = analytics.getCurrentDocumentId()
                                  if (currentDocId) {
                                    analytics.updateDocument(currentDocId, { has_annotations: true })
                                  }
                                  
                                  // Check if user has selected text in chat history
                                  const selectedTextInChat = getSelectedTextInChat()

                                  let finalResponse = ''
                                  if (selectedTextInChat) {
                                    // Use selected text if available
                                    finalResponse = selectedTextInChat
                                  } else {
                                    // Extract final response without thinking process
                                    if (typeof message.content === 'string') {
                                      const { mainContent } = extractThinking(message.content)
                                      finalResponse = mainContent
                                    } else if (Array.isArray(message.content)) {
                                      const textContent = message.content
                                        .filter(item => item.type === 'text')
                                        .map(item => (item as { type: 'text'; text: string }).text)
                                        .join('\n')
                                      const { mainContent } = extractThinking(textContent)
                                      finalResponse = mainContent
                                    }
                                  }

                                  // Get page number and text position
                                  // Priority: 1) selected text page, 2) current viewing page, 3) fallback to page 1
                                  const lastSelectedPosition = (window as any).__lastSelectedTextPosition
                                  const pageNumber = lastSelectedPosition?.pageNumber || currentPageNumber || 1
                                  const textYPosition = lastSelectedPosition?.textYPosition

                                  if (finalResponse.trim()) {
                                    onAddAnnotationToPDF(finalResponse, pageNumber, textYPosition)

                                    // Auto-collapse chat history in floating layout
                                    if (layout === 'floating') {
                                      // Save scroll position before collapsing
                                      if (messagesContainerRef.current) {
                                        setSavedScrollPosition(messagesContainerRef.current.scrollTop)
                                      }
                                      setIsCollapsed(true)
                                    }
                                  }
                                }
                              }}
                              title="Add response to PDF as text box"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                                <line x1="12" y1="18" x2="12" y2="12" />
                                <line x1="9" y1="15" x2="15" y2="15" />
                              </svg>
                              <span className="message-action-button-text">Add to PDF</span>
                            </button>
                          </>
                        )}
                        {/* Redo/Refresh button - always show */}
                        <button
                          className="message-action-button refresh-button"
                          onClick={() => handleResendMessage(message.id)}
                          title="Get a new response"
                          disabled={isLoading}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <polyline points="1 20 1 14 7 14"></polyline>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                          </svg>
                          <span className="message-action-button-text">Redo</span>
                        </button>
                        {/* Navigation arrows - only show if there are multiple responses */}
                        {messageResponses[message.id] && messageResponses[message.id].length > 1 && (
                          <>
                            <button
                              className="message-action-button nav-button-left"
                              onClick={() => handleNavigateResponse(message.id, 'prev')}
                              title="Previous response"
                              disabled={!currentResponseIndex[message.id] || currentResponseIndex[message.id] === 0}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="15 18 9 12 15 6"></polyline>
                              </svg>
                            </button>
                            <button
                              className="message-action-button nav-button-right"
                              onClick={() => handleNavigateResponse(message.id, 'next')}
                              title="Next response"
                              disabled={(() => {
                                const responses = messageResponses[message.id] || []
                                if (responses.length === 0) return true
                                const currentIdx = currentResponseIndex[message.id] ?? (responses.length - 1)
                                return currentIdx >= (responses.length - 1)
                              })()}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="9 18 15 12 9 6"></polyline>
                              </svg>
                            </button>
                            {/* Response counter */}
                            <span className="response-counter">
                              {(currentResponseIndex[message.id] ?? (messageResponses[message.id].length - 1)) + 1} / {messageResponses[message.id].length}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {error && (
              <div className="error-message">
                <div className="error-icon">⚠️</div>
                <div className="error-text">{error}</div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Split layout: Warning bar above model selector */}
        {!authLoading && !isAuthenticated && layout === 'split' && (
          <div className="api-key-warning-split-top">
            <span>🔐 Please sign in to use the chat feature</span>
            <span className="warning-hint">
              Click "Sign in with Google" in the navigation bar
            </span>
          </div>
        )}
        {!authLoading && isAuthenticated && !isCheckingApiKey && apiKeyMissing && layout === 'split' && (
          <div className="api-key-warning-split-top">
            <div className="warning-content">
              <span>⚠️ Groq API key not configured</span>
              <span className="warning-hint">
                {user?.role === 'admin'
                  ? 'Admin API key not configured on server'
                  : 'Add your API key in Settings (click the gear icon)'}
              </span>
            </div>
            <button
              className="api-key-refresh-button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                checkApiKey()
              }}
              title="Refresh API key status"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
            </button>
          </div>
        )}

        {/* Split layout: Model selector bar above input */}
        {layout === 'split' && (
          <>
            <div className={`model-selector-bar ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
              <div className="model-selector-wrapper" ref={modelSelectorRef}>
                <div className="model-mode-toggle-container">
                  <ModelModeToggle
                    mode={modelMode}
                    onModeChange={handleModeChange}
                    disabled={apiKeyMissing || !isAuthenticated}
                  />
                </div>
                {isVisionModel() && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleImageUpload}
                      style={{ display: 'none' }}
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        fileInputRef.current?.click()
                      }}
                      className="image-upload-button"
                      title="Upload images"
                      disabled={apiKeyMissing || !isAuthenticated}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                      <span className="image-upload-text">Image</span>
                    </button>
                  </>
                )}
              </div>
              {messages.length > 0 && (
                <button onClick={handleClearChat} className={`clear-button ${clearConfirming ? 'confirming' : ''}`} title={clearConfirming ? 'Click again to confirm' : 'Clear chat'}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                  <span className="clear-button-text">{clearConfirming ? 'Confirm' : 'Clear'}</span>
                </button>
              )}
                {layout === 'split' && (
                  <button
                    onClick={onToggleKnowledgeNotes}
                    className="layout-toggle-button collapse-button"
                    title={showKnowledgeNotes ? 'Hide knowledge notes' : 'Show knowledge notes'}
                    aria-label={showKnowledgeNotes ? 'Hide knowledge notes' : 'Show knowledge notes'}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                  </button>
                )}
                {/* Layout toggle moved to AnnotationToolbar; don't show it here */}
            </div>
          </>
        )}


        <div
          className={`chatgpt-input-container`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {uploadedImages.length > 0 && (
            <div className="uploaded-images-preview-wrapper">
              {canScrollLeft && (
                <button
                  className="image-scroll-button image-scroll-left"
                  onClick={() => scrollImages('left')}
                  title="Scroll left"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6"></polyline>
                  </svg>
                </button>
              )}
              <div
                ref={imagesPreviewRef}
                className="uploaded-images-preview"
                onScroll={checkScrollButtons}
              >
                {uploadedImages.map((imageUrl, index) => (
                  <div key={index} className="image-preview-item">
                    <img src={imageUrl} alt={`Upload ${index + 1}`} />
                    <button
                      type="button"
                      className="image-preview-remove"
                      onClick={() => {
                        setUploadedImages((prev) => prev.filter((_, i) => i !== index))
                      }}
                      title="Remove image"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {canScrollRight && (
                <button
                  className="image-scroll-button image-scroll-right"
                  onClick={() => scrollImages('right')}
                  title="Scroll right"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </button>
              )}
            </div>
          )}
          <div className={`input-wrapper${isDraggingOver && isVisionModel() ? ' drag-over' : ''}${isInputFocused ? ` focus-${modelMode}` : ''}`}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              placeholder="Ask a question..."
              rows={1}
              className="chatgpt-input"
              disabled={isLoading || apiKeyMissing || !isAuthenticated}
            />
            {isLoading ? (
              <button
                onClick={handlePause}
                className="send-button pause-button"
                title="Pause/Stop response"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" />
                  <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={(!input.trim() && !selectedText && uploadedImages.length === 0) || apiKeyMissing || !isAuthenticated}
                className="send-button"
                title="Send message"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Disclaimer - positioned below input bar. In split layout show only on the mode selection page (no messages). */}
        {layout === 'split' && messages.length === 0 && !selectedText && (
          <div className={`footer-text-outer split-footer ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
            <span className="footer-text">
              AI responses may contain errors. Please verify important information.
            </span>
          </div>
        )}

        {layout === 'floating' && (
          <div className={`footer-text-outer ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
            <span className="footer-text">
              AI responses may contain errors. Please verify important information.
            </span>
          </div>
        )}
      </div>
      </>
      )}
      </>
      )}
    </div>
  )
}

export default ChatGPTEmbedded



