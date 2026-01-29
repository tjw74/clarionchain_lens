/**
 * Anthropic (Claude) provider implementation
 * Placeholder for future implementation
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-3-5-sonnet-20241022'; // Vision-capable model

/**
 * Create analysis prompt for Bitcoin chart
 * @param {Object} metadata - Chart metadata
 * @returns {string} Analysis prompt
 */
function createAnalysisPrompt(metadata) {
  return `Analyze this Bitcoin chart from ${metadata.url || 'bitview.space'}.

Chart Title: ${metadata.title || 'Bitcoin Price Chart'}
Timestamp: ${metadata.timestamp || new Date().toISOString()}

You are a professional Bitcoin on-chain market analyst. Provide structured technical and on-chain insights:

1. Identify trend direction (bullish, bearish, or neutral)
2. Identify key support and resistance levels
3. Assess volatility regime (low, moderate, high)
4. Provide on-chain implications based on chart patterns
5. Present 2-3 scenarios: bullish, base case, and bearish
6. State clear invalidation conditions for each scenario

Be concise and professional. Avoid giving financial advice. Focus on objective technical and on-chain analysis.`;
}

/**
 * Analyze chart using Anthropic API
 * @param {string} imageDataUrl - Base64 encoded chart image
 * @param {Object} metadata - Chart metadata
 * @param {string} apiKey - Anthropic API key
 * @param {Function} onChunk - Optional streaming callback
 * @param {Array} conversationHistory - Previous conversation messages
 * @returns {Promise<string>} Analysis text
 */
export async function analyzeChart(imageDataUrl, metadata, apiKey, onChunk = null, conversationHistory = []) {
  if (!apiKey) {
    throw new Error('Anthropic API key is required');
  }

  // Extract base64 data
  const base64Image = imageDataUrl.includes(',') 
    ? imageDataUrl.split(',')[1] 
    : imageDataUrl;

  const prompt = createAnalysisPrompt(metadata);

  // Build messages array
  const messages = [];

  // If there's conversation history, this is a follow-up question
  if (conversationHistory.length > 0) {
    // Add all conversation history except the last user message (we'll add it with image)
    const historyWithoutLast = conversationHistory.slice(0, -1);
    historyWithoutLast.forEach(msg => {
      messages.push({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : msg.content
      });
    });

    // Add the latest user question with the image
    const lastUserMessage = conversationHistory[conversationHistory.length - 1];
    if (lastUserMessage && lastUserMessage.role === 'user') {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: lastUserMessage.content
          },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: base64Image
            }
          }
        ]
      });
    }
  } else {
    // Initial analysis - include image with prompt
    messages.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: prompt
        },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: base64Image
          }
        }
      ]
    });
  }

  const requestBody = {
    model: DEFAULT_MODEL,
    max_tokens: 1500,
    messages: messages
  };

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      let errorMessage = `Anthropic API error: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        console.error('Anthropic API error details (full):', JSON.stringify(errorData, null, 2));
        
        // Anthropic error format: { error: { type, message } }
        if (errorData.error) {
          const errorObj = errorData.error;
          // Try multiple possible error message fields
          errorMessage = errorObj.message || errorObj.type || JSON.stringify(errorObj) || errorMessage;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        } else {
          // If no standard error format, show the whole response
          errorMessage = JSON.stringify(errorData);
        }
        
        console.error('Anthropic API parsed error message:', errorMessage);
      } catch (parseError) {
        console.error('Could not parse Anthropic error response:', parseError);
        const text = await response.text().catch(() => '');
        console.error('Anthropic API raw error response:', text);
        errorMessage = `Anthropic API error ${response.status}: ${text || response.statusText}`;
      }
      throw new Error(errorMessage);
    }

    if (onChunk) {
      // Handle streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'content_block_delta' && data.delta?.text) {
                fullText += data.delta.text;
                onChunk(data.delta.text);
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

      // For streaming, we don't get usage in the stream, so return content only
      return {
        content: fullText,
        usage: null // Anthropic streaming doesn't include usage in stream
      };
    } else {
      const data = await response.json();
      const content = data.content?.[0]?.text || 'No analysis returned';
      
      // Extract usage information
      const usage = data.usage || {};
      return {
        content,
        usage: {
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
        }
      };
    }
  } catch (error) {
    // If it's already an API error with a message, throw it as-is
    if (error.message && (error.message.includes('API') || error.message.includes('Anthropic'))) {
      throw error;
    }
    // Otherwise wrap it
    throw new Error(`Failed to analyze chart: ${error.message}`);
  }
}

/**
 * Validate API key
 * @param {string} apiKey - Anthropic API key
 * @returns {Promise<boolean>}
 */
export async function validateApiKey(apiKey) {
  try {
    // Use exact same request format as working curl command
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 10,
        messages: [
          { role: 'user', content: 'Say hi' }
        ]
      })
    });
    
    // Check response status
    const status = response.status;
    console.log('Anthropic validation response status:', status);
    
    // 200-299 = success (key is valid)
    if (status >= 200 && status < 300) {
      const data = await response.json().catch(() => null);
      console.log('Anthropic validation success:', data?.type === 'message' ? 'Valid key' : 'Response received');
      return true;
    }
    
    // 401/403 = invalid key (definitely reject)
    if (status === 401 || status === 403) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Anthropic API key validation: Authentication failed', status, errorData);
      return false;
    }
    
    // 400 = bad request - check error details
    if (status === 400) {
      try {
        const errorData = await response.json();
        console.log('Anthropic validation 400 error:', errorData);
        const errorType = errorData.error?.type || '';
        const errorMessage = JSON.stringify(errorData).toLowerCase();
        
        // If it's an authentication error type, key is invalid
        if (errorType === 'authentication_error' || errorType === 'permission_error') {
          console.error('Anthropic API key validation: Auth error type', errorType);
          return false;
        }
        
        // If error message mentions auth issues, key is invalid
        if (errorMessage.includes('authentication') || 
            errorMessage.includes('unauthorized') || 
            errorMessage.includes('forbidden') ||
            errorMessage.includes('invalid api key')) {
          console.error('Anthropic API key validation: Auth-related error message');
          return false;
        }
        
        // Otherwise, assume key is valid but request might have other issues
        console.log('Anthropic API key validation: 400 error but not auth-related, assuming key is valid');
        return true;
      } catch (parseError) {
        console.log('Anthropic API key validation: Could not parse 400 error, assuming key might be valid');
        return true;
      }
    }
    
    // Other status codes - log and reject
    console.error('Anthropic API key validation: Unexpected status', status);
    return false;
  } catch (error) {
    // Network errors or other exceptions - log and return false
    console.error('Anthropic API key validation error:', error);
    return false;
  }
}
