/**
 * Quiz Service
 * Generates quizzes from PDF content using Reasoning mode models
 */

import { sendChatMessage, type ChatMessage } from './authenticatedChatService'
import { REASONING_MODELS } from '../config'
import { QuizQuestion, QuizQuestionType } from '../types/interactionModes'

interface QuizGenerationOptions {
  count?: number
  difficulty?: 'easy' | 'medium' | 'hard' | 'mixed'
  questionTypes?: QuizQuestionType[]
  focusPages?: number[]
}

/**
 * Generate quiz questions from PDF content using AI
 */
export async function generateQuiz(
  pdfText: string,
  options: QuizGenerationOptions = {}
): Promise<QuizQuestion[]> {
  const {
    count = 10,
    difficulty = 'mixed',
    questionTypes = ['multiple-choice'],
    focusPages
  } = options

  // Add timestamp to ensure unique quiz generation each time
  const timestamp = Date.now()
  const randomSeed = Math.floor(Math.random() * 10000)
  
  const systemPrompt = `You are an expert quiz generator. Generate high-quality quiz questions based on the provided content.

IMPORTANT: Generate UNIQUE questions each time. Use varied topics, concepts, and difficulty levels across the content.
Generation ID: ${timestamp}-${randomSeed}

Requirements:
- Generate exactly ${count} questions
- Difficulty: ${difficulty}
- Question types: ${questionTypes.join(', ')}
- Each question must have clear, unambiguous answers
- For multiple choice: provide 4 options with only ONE correct answer
- For short answer: provide the correct answer text (NO options)
- For true/false: correctAnswer should be "true" or "false" (NO options)
- For fill-blank: provide the word/phrase that fills the blank (NO options)
- Include page references when possible
- Provide detailed explanations for correct answers
- Vary the topics and concepts tested - don't focus on the same areas

Return ONLY a valid JSON array of questions. Use these structures based on question type:

For multiple-choice:
{
  "id": "q1",
  "type": "multiple-choice",
  "question": "What is...",
  "options": [
    {"id": "a", "text": "Option A", "isCorrect": false},
    {"id": "b", "text": "Option B", "isCorrect": true},
    {"id": "c", "text": "Option C", "isCorrect": false},
    {"id": "d", "text": "Option D", "isCorrect": false}
  ],
  "correctAnswer": "b",
  "explanation": "The correct answer is B because...",
  "pageReference": 1,
  "difficulty": "medium"
}

For short-answer (NO options array):
{
  "id": "q2",
  "type": "short-answer",
  "question": "Explain the concept of...",
  "correctAnswer": "The expected answer text",
  "explanation": "A good answer should include...",
  "pageReference": 2,
  "difficulty": "medium"
}
NOTE: For short-answer questions, avoid answers that require typing math functions or complex formulas. Use simple text answers instead.

For true-false (NO options array):
{
  "id": "q3",
  "type": "true-false",
  "question": "Statement to evaluate...",
  "correctAnswer": "true",
  "explanation": "This is true/false because...",
  "pageReference": 3,
  "difficulty": "easy"
}

For fill-blank (NO options array):
{
  "id": "q4",
  "type": "fill-blank",
  "question": "The ____ is responsible for...",
  "correctAnswer": "nucleus",
  "explanation": "The nucleus is correct because...",
  "pageReference": 4,
  "difficulty": "medium"
}

IMPORTANT: 
- Do NOT include "options" field for short-answer, true-false, or fill-blank questions. Only multiple-choice questions should have options.
- Ensure all text fields use proper JSON escaping (escape quotes, backslashes, and newlines)
- Keep text clean and simple - avoid special characters that need escaping when possible
- Do not use literal newlines in text fields - use spaces instead

Focus on testing understanding, not just memorization.`

  const userPrompt = `Generate ${count} ${difficulty} quiz questions from this content:

${focusPages ? `Focus on pages: ${focusPages.join(', ')}\n\n` : ''}${pdfText}`


  // Truncate PDF text if too large (e.g., 6000 chars)
  const MAX_PDF_LENGTH = 6000;
  let truncatedPdfText = pdfText;
  if (pdfText.length > MAX_PDF_LENGTH) {
    truncatedPdfText = pdfText.slice(0, MAX_PDF_LENGTH);
  }

  let lastError = null;
  // Retry logic: up to 3 attempts per model
  for (let modelIdx = 0; modelIdx < REASONING_MODELS.length; modelIdx++) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await sendChatMessage([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt.replace(pdfText, truncatedPdfText) }
        ], REASONING_MODELS[modelIdx]);

        const content = typeof response === 'string' ? response : '';
        // Try to extract JSON array first
        let jsonMatch = content.match(/\[[\s\S]*\]/);
        let jsonString = jsonMatch ? jsonMatch[0] : null;

        // If no array, try to extract single object
        if (!jsonString) {
          const objMatch = content.match(/\{[\s\S]*\}/);
          if (objMatch) {
            jsonString = `[${objMatch[0]}]`;
          }
        }

        if (!jsonString) {
          console.error('No JSON array/object found in response:', content.substring(0, 500));
          lastError = new Error('Failed to parse quiz questions from AI response');
          continue;
        }

        // Clean up common JSON issues from AI responses
        jsonString = jsonString.replace(/```json\s*/g, '').replace(/```\s*/g, '');
        jsonString = jsonString
          .replace(/\\n/g, ' ')
          .replace(/\\t/g, ' ')
          .replace(/\n/g, ' ')
          .replace(/\t/g, ' ')
          .replace(/\r/g, ' ');

        let questions: QuizQuestion[] = [];
        try {
          questions = JSON.parse(jsonString);
        } catch (parseError) {
          console.warn('JSON parse failed, attempting to fix:', parseError);
          // Try to fix trailing commas
          jsonString = jsonString.replace(/,\s*([}\]])/g, '$1');
          questions = JSON.parse(jsonString);
        }

        // Validate and sanitize questions, filter out blanks
        const validQuestions = questions
          .map((q, index) => {
            const sanitized: QuizQuestion = {
              id: q.id || `q${index + 1}`,
              type: q.type || 'multiple-choice',
              question: q.question,
              correctAnswer: q.correctAnswer,
              explanation: q.explanation,
              pageReference: q.pageReference,
              difficulty: q.difficulty || 'medium'
            };
            if (q.type === 'multiple-choice' && q.options) {
              sanitized.options = q.options;
            }
            return sanitized;
          })
          .filter(q => q.question && typeof q.question === 'string' && q.question.trim().length > 0 && (q.type !== 'multiple-choice' || (Array.isArray(q.options) && q.options.length > 0)));

        if (validQuestions.length > 0) {
          return validQuestions;
        }
        // If no valid questions, retry
        console.warn(`Attempt ${attempt + 1}: No valid questions, retrying...`);
      } catch (error: any) {
        lastError = error;
        // If error is rate limit or payload too large, try next model
        if (error?.message?.includes('rate limit') || error?.message?.includes('Payload Too Large')) {
          console.warn('Model error, trying next fallback:', error?.message);
          break;
        }
        // For other errors, break
        break;
      }
    }
  }
  console.error('Quiz generation error:', lastError);
  throw new Error('Failed to generate quiz. Please try again.');
}

/**
 * Generate additional questions of a specific type
 */
export async function generateMoreQuestions(
  pdfText: string,
  existingQuestions: QuizQuestion[],
  count: number = 5,
  questionType?: QuizQuestionType
): Promise<QuizQuestion[]> {
  // Add timestamp to ensure unique quiz generation each time
  const timestamp = Date.now()
  const randomSeed = Math.floor(Math.random() * 10000)
  
  const systemPrompt = `You are an expert quiz generator. Generate MORE quiz questions that are DIFFERENT from the existing ones.

IMPORTANT: Generate UNIQUE questions each time. Explore different aspects and topics from the content.
Generation ID: ${timestamp}-${randomSeed}

Requirements:
- Generate exactly ${count} NEW questions
- ${questionType ? `Question type: ${questionType}` : 'Mixed question types'}
- Avoid repeating topics from existing questions
- Maintain high quality and clarity
- Include detailed explanations
- Cover different concepts than previously tested

Question type structures:
- multiple-choice: Include "options" array with 4 choices, and "correctAnswer" as option id (a/b/c/d)
- short-answer: NO options, only "correctAnswer" as the expected answer text (avoid math functions/formulas - use simple text)
- true-false: NO options, only "correctAnswer" as "true" or "false"
- fill-blank: NO options, only "correctAnswer" as the word/phrase to fill in

IMPORTANT: 
- Do NOT include "options" field for short-answer, true-false, or fill-blank questions.
- For short-answer questions, avoid answers requiring math functions or complex formulas that are difficult to type.

Return ONLY a valid JSON array of questions.`

  const existingTopics = existingQuestions.map(q => 
    q.question.substring(0, 50)
  ).join('\n')

  const userPrompt = `Generate ${count} new quiz questions. Avoid these topics:
${existingTopics}

Content:
${pdfText}`

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ]

  try {
    const response = await sendChatMessage(messages, REASONING_MODELS[0])

    // Handle response which is always a string from sendChatMessage
    const content = typeof response === 'string' ? response : ''
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    
    if (!jsonMatch) {
      console.error('No JSON array found in response:', content.substring(0, 500))
      throw new Error('Failed to parse additional questions')
    }

    let jsonString = jsonMatch[0]
    const startId = existingQuestions.length + 1
    
    // Try parsing with error recovery
    try {
      const questions: QuizQuestion[] = JSON.parse(jsonString)
      
      return questions.map((q, index) => {
        const sanitized: QuizQuestion = {
          id: q.id || `q${startId + index}`,
          type: q.type || questionType || 'multiple-choice',
          question: q.question,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          pageReference: q.pageReference,
          difficulty: q.difficulty || 'medium'
        }
        
        // Only include options for multiple-choice questions
        if ((q.type === 'multiple-choice' || (!q.type && !questionType) || questionType === 'multiple-choice') && q.options) {
          sanitized.options = q.options
        }
        
        return sanitized
      })
    } catch (parseError) {
      // If parsing fails, try to fix common issues
      console.warn('Initial JSON parse failed, attempting to clean:', parseError)
      
      // Remove any markdown code block markers
      jsonString = jsonString.replace(/```json\s*/g, '').replace(/```\s*/g, '')
      
      // Try to fix escaped newlines and tabs that might be breaking JSON
      jsonString = jsonString
        .replace(/\\n/g, ' ')  // Replace literal \n with space
        .replace(/\\t/g, ' ')  // Replace literal \t with space
        .replace(/\n/g, ' ')   // Replace actual newlines with space
        .replace(/\t/g, ' ')   // Replace actual tabs with space
        .replace(/\r/g, ' ')   // Replace carriage returns with space
      
      // Try parsing again
      const questions: QuizQuestion[] = JSON.parse(jsonString)
      
      return questions.map((q, index) => {
        const sanitized: QuizQuestion = {
          id: q.id || `q${startId + index}`,
          type: q.type || questionType || 'multiple-choice',
          question: q.question,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          pageReference: q.pageReference,
          difficulty: q.difficulty || 'medium'
        }
        
        // Only include options for multiple-choice questions
        if ((q.type === 'multiple-choice' || (!q.type && !questionType) || questionType === 'multiple-choice') && q.options) {
          sanitized.options = q.options
        }
        
        return sanitized
      })
    }
  } catch (error) {
    console.error('Additional questions generation error:', error)
    throw new Error('Failed to generate additional questions')
  }
}

/**
 * Evaluate a user's answer and provide feedback
 */
export function evaluateAnswer(
  question: QuizQuestion,
  userAnswer: string
): { isCorrect: boolean; feedback: string } {
  const correctAnswer = Array.isArray(question.correctAnswer)
    ? question.correctAnswer
    : [question.correctAnswer]

  const isCorrect = correctAnswer.some(
    ans => ans.toLowerCase().trim() === userAnswer.toLowerCase().trim()
  )

  const feedback = isCorrect
    ? `✅ Correct! ${question.explanation}`
    : `❌ Incorrect. ${question.explanation}`

  return { isCorrect, feedback }
}
