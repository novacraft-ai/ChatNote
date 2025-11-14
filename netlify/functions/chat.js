/**
 * Netlify Serverless Function for OpenAI API Proxy
 * 
 * Place this file in: netlify/functions/chat.js
 * 
 * Set environment variable in Netlify dashboard:
 * - OPENAI_API_KEY: Your OpenAI API key
 */

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { messages, context: pdfContext, model, temperature, maxTokens, stream } = body;

    // Validate input
    if (!messages || !Array.isArray(messages)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Messages array is required' }),
      };
    }

    // Get API key from environment (server-side only!)
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('OPENAI_API_KEY not configured');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server configuration error' }),
      };
    }

    // Prepare system message with context
    const systemMessages = pdfContext
      ? [
          {
            role: 'system',
            content: `You are a helpful assistant helping a student understand their PDF document. 
Context from the PDF: "${pdfContext}"
Use this context to provide relevant and accurate answers. If the context doesn't contain relevant information, you can still help with general questions.`,
          },
        ]
      : [
          {
            role: 'system',
            content: 'You are a helpful assistant helping students learn and understand their study materials.',
          },
        ];

    const allMessages = [...systemMessages, ...messages];

    // Prepare request body
    const requestBody = {
      model: model || 'gpt-3.5-turbo',
      messages: allMessages,
      temperature: temperature || 0.7,
      max_tokens: maxTokens || 3000,  // Increased default to reduce cut-off issues
    };

    // Add streaming if requested
    if (stream) {
      requestBody.stream = true;
    }

    // Make request to OpenAI
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ 
          error: error.error?.message || `OpenAI API error: ${response.status}` 
        }),
      };
    }

    // Handle streaming response
    if (stream && response.body) {
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        body: response.body,
      };
    } else {
      // Non-streaming response
      const data = await response.json();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(data),
      };
    }
  } catch (error) {
    console.error('Proxy error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: error.message || 'Internal server error' 
      }),
    };
  }
};

