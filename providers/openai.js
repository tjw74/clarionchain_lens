/**
 * OpenAI provider implementation
 * Uses GPT-4 Vision for chart analysis
 */

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o'; // Vision-capable model

/**
 * Create analysis prompt for Bitcoin chart
 * @param {Object} metadata - Chart metadata
 * @returns {Object} System and user prompts
 */
function createAnalysisPrompt(metadata) {
  const systemPrompt = `You are a professional Bitcoin on-chain market analyst. Analyze the provided Bitcoin price chart and provide structured technical and on-chain insights.

Your analysis must:
1. Identify trend direction (bullish, bearish, or neutral)
2. Identify key support and resistance levels
3. Assess volatility regime (low, moderate, high)
4. Provide on-chain implications based on chart patterns
5. Present 2-3 scenarios: bullish, base case, and bearish
6. State clear invalidation conditions for each scenario

Guidelines:
- Be concise and professional
- Avoid giving financial advice
- Focus on objective technical and on-chain analysis
- Use clear, structured formatting
- Base conclusions on visible chart patterns and indicators`;

  const userPrompt = `Analyze this Bitcoin chart from ${metadata.url || 'bitview.space'}.

Chart Title: ${metadata.title || 'Bitcoin Price Chart'}
Timestamp: ${metadata.timestamp || new Date().toISOString()}

Please provide a comprehensive analysis following the structure outlined in your instructions.`;

  return { systemPrompt, userPrompt };
}

/**
 * Analyze chart using OpenAI Vision API
 * @param {string} imageDataUrl - Base64 encoded chart image
 * @param {Object} metadata - Chart metadata
 * @param {string} apiKey - OpenAI API key
 * @param {Function} onChunk - Optional streaming callback
 * @returns {Promise<string>} Analysis text
 */
export async function analyzeChart(imageDataUrl, metadata, apiKey, onChunk = null) {
  if (!apiKey) {
    throw new Error('OpenAI API key is required');
  }

  // Extract base64 data (remove data:image/png;base64, prefix if present)
  const base64Image = imageDataUrl.includes(',') 
    ? imageDataUrl.split(',')[1] 
    : imageDataUrl;

  const { systemPrompt, userPrompt } = createAnalysisPrompt(metadata);

  const requestBody = {
    model: DEFAULT_MODEL,
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: userPrompt
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${base64Image}`
            }
          }
        ]
      }
    ],
    max_tokens: 1500,
    temperature: 0.7
  };

  // Add streaming if callback provided
  if (onChunk) {
    requestBody.stream = true;
  }

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error?.message || 
        `OpenAI API error: ${response.status} ${response.statusText}`
      );
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
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              const content = data.choices?.[0]?.delta?.content;
              if (content) {
                fullText += content;
                onChunk(content);
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

      return fullText;
    } else {
      // Handle non-streaming response
      const data = await response.json();
      return data.choices?.[0]?.message?.content || 'No analysis returned';
    }
  } catch (error) {
    if (error.message.includes('API')) {
      throw error;
    }
    throw new Error(`Failed to analyze chart: ${error.message}`);
  }
}

/**
 * Validate API key by making a test request
 * @param {string} apiKey - OpenAI API key
 * @returns {Promise<boolean>}
 */
export async function validateApiKey(apiKey) {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    return response.ok;
  } catch {
    return false;
  }
}
