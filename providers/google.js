/**
 * Google (Gemini) provider implementation
 * Placeholder for future implementation
 */

const GOOGLE_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent';
const DEFAULT_MODEL = 'gemini-pro-vision';

import { getSystemPrompt, getUserPrompt } from '../utils/prompts.js';

/**
 * Create analysis prompt for Bitcoin chart
 * @param {Object} metadata - Chart metadata
 * @param {string} category - Prompt category
 * @returns {string} Analysis prompt
 */
function createAnalysisPrompt(metadata, category = 'market-analysis') {
  const systemPrompt = getSystemPrompt(category, metadata);
  const userPrompt = getUserPrompt(metadata);
  // Google combines system and user prompts
  return `${systemPrompt}\n\n${userPrompt}`;
}

/**
 * Analyze chart using Google Gemini API
 * @param {string} imageDataUrl - Base64 encoded chart image
 * @param {Object} metadata - Chart metadata
 * @param {string} apiKey - Google API key
 * @param {Function} onChunk - Optional streaming callback (not supported by Gemini)
 * @param {Array} conversationHistory - Previous conversation messages
 * @returns {Promise<string>} Analysis text
 */
export async function analyzeChart(imageDataUrl, metadata, apiKey, onChunk = null, conversationHistory = [], category = 'market-analysis') {
  if (!apiKey) {
    throw new Error('Google API key is required');
  }

  // Extract base64 data
  const base64Image = imageDataUrl.includes(',') 
    ? imageDataUrl.split(',')[1] 
    : imageDataUrl;

  const prompt = createAnalysisPrompt(metadata, category);

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: prompt
          },
          {
            inline_data: {
              mime_type: 'image/png',
              data: base64Image
            }
          }
        ]
      }
    ],
    generationConfig: {
      maxOutputTokens: 1500,
      temperature: 0.7
    }
  };

  try {
    const url = `${GOOGLE_API_URL}?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error?.message || 
        `Google API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No analysis returned';
    
    // Extract usage information
    const usage = data.usageMetadata || {};
    
    // Call onChunk with full text if provided (Gemini doesn't support streaming in this format)
    if (onChunk) {
      onChunk(text);
    }
    
    return {
      content: text,
      usage: {
        inputTokens: usage.promptTokenCount || 0,
        outputTokens: usage.candidatesTokenCount || 0,
        totalTokens: usage.totalTokenCount || 0
      }
    };
  } catch (error) {
    if (error.message.includes('API')) {
      throw error;
    }
    throw new Error(`Failed to analyze chart: ${error.message}`);
  }
}

/**
 * Validate API key
 * @param {string} apiKey - Google API key
 * @returns {Promise<boolean>}
 */
export async function validateApiKey(apiKey) {
  try {
    const url = `${GOOGLE_API_URL}?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: 'test' }]
        }]
      })
    });
    return response.status !== 401 && response.status !== 403;
  } catch {
    return false;
  }
}
