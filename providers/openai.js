/**
 * OpenAI provider implementation
 * Uses GPT-4 Vision for chart analysis
 */

import { getSystemPrompt, getUserPrompt } from '../utils/prompts.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o'; // Vision-capable model

/**
 * Create analysis prompt for Bitcoin chart
 * @param {Object} metadata - Chart metadata
 * @param {string} category - Prompt category
 * @returns {Object} System and user prompts
 */
function createAnalysisPrompt(metadata, category = 'market-analysis') {
  const systemPrompt = getSystemPrompt(category, metadata);
  const userPrompt = getUserPrompt(metadata);
  return { systemPrompt, userPrompt };
}

/**
 * Analyze chart using OpenAI Vision API
 * @param {string} imageDataUrl - Base64 encoded chart image
 * @param {Object} metadata - Chart metadata
 * @param {string} apiKey - OpenAI API key
 * @param {Function} onChunk - Optional streaming callback
 * @param {Array} conversationHistory - Previous conversation messages
 * @returns {Promise<string>} Analysis text
 */
export async function analyzeChart(imageDataUrl, metadata, apiKey, onChunk = null, conversationHistory = [], category = 'market-analysis') {
  if (!apiKey) {
    throw new Error('OpenAI API key is required');
  }

  // Extract base64 data (remove data:image/png;base64, prefix if present)
  const base64Image = imageDataUrl.includes(',') 
    ? imageDataUrl.split(',')[1] 
    : imageDataUrl;

  const { systemPrompt, userPrompt } = createAnalysisPrompt(metadata, category);

  // Build messages array
  const messages = [
    {
      role: 'system',
      content: systemPrompt
    }
  ];

  // If there's conversation history, this is a follow-up question
  if (conversationHistory.length > 0) {
    // Add all conversation history except the last user message (we'll add it with image)
    const historyWithoutLast = conversationHistory.slice(0, -1);
    historyWithoutLast.forEach(msg => {
      messages.push({
        role: msg.role,
        content: msg.content
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
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${base64Image}`
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
          text: userPrompt
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${base64Image}`
          }
        }
      ]
    });
  }

  const requestBody = {
    model: DEFAULT_MODEL,
    messages: messages,
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

      let usageData = null;
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
              
              // Capture usage data if present (usually in final chunk)
              if (data.usage) {
                usageData = data.usage;
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

      // Return content with usage info
      return {
        content: fullText,
        usage: usageData ? {
          inputTokens: usageData.prompt_tokens || 0,
          outputTokens: usageData.completion_tokens || 0,
          totalTokens: usageData.total_tokens || 0
        } : null
      };
    } else {
      // Handle non-streaming response
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || 'No analysis returned';
      
      // Extract usage information for cost tracking
      const usage = data.usage || {};
      return {
        content,
        usage: {
          inputTokens: usage.prompt_tokens || 0,
          outputTokens: usage.completion_tokens || 0,
          totalTokens: usage.total_tokens || 0
        }
      };
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
