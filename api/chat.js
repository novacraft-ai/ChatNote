/**
 * Serverless Function for OpenAI API Proxy
 * 
 * This protects your API key by keeping it server-side only.
 * 
 * Deployment:
 * - Vercel: Place in /api folder, deploy to Vercel
 * - Netlify: Place in /netlify/functions folder
 * - Node.js: Use as Express route
 * 
 * Environment Variables Required:
 * - OPENAI_API_KEY: Your OpenAI API key (set in hosting platform)
 */

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS headers (adjust origin for production)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { messages, context, model, temperature, maxTokens, stream } = req.body;

    // Validate input
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    // Get API key from environment (server-side only!)
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('OPENAI_API_KEY not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Prepare system message with context
    const systemMessages = context
      ? [
          {
            role: 'system',
            content: `You are a helpful assistant helping a student understand their PDF document. 
Context from the PDF: "${context}"
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
      return res.status(response.status).json({ 
        error: error.error?.message || `OpenAI API error: ${response.status}` 
      });
    }

    // Handle streaming response
    if (stream && response.body) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
        }
        res.end();
      } catch (error) {
        console.error('Streaming error:', error);
        res.end();
      }
    } else {
      // Non-streaming response
      const data = await response.json();
      res.json(data);
    }
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ 
      error: error.message || 'Internal server error' 
    });
  }
}

