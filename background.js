/**
 * Background service worker
 * Handles API calls and secure key management
 * Never exposes keys to content scripts or page context
 */

import { getApiKey, hasApiKey } from './utils/storage.js';
import { calculateCost, recordUsage, getProviderCosts } from './utils/cost.js';
import * as openaiProvider from './providers/openai.js';
import * as anthropicProvider from './providers/anthropic.js';
import * as googleProvider from './providers/google.js';

// Rate limiting: debounce analysis requests
let lastAnalysisTime = 0;
const MIN_ANALYSIS_INTERVAL = 5000; // 5 seconds

/**
 * Get provider module based on provider name
 */
function getProvider(provider) {
  switch (provider) {
    case 'openai':
      return openaiProvider;
    case 'anthropic':
      return anthropicProvider;
    case 'google':
      return googleProvider;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Crop image using OffscreenCanvas (background script context)
 * Uses createImageBitmap which is available in service workers
 */
async function cropImage(imageDataUrl, bounds) {
  try {
    // Convert data URL to blob
    const response = await fetch(imageDataUrl);
    const blob = await response.blob();
    
    // Create image bitmap (available in service workers)
    const imageBitmap = await createImageBitmap(blob);
    
    // Create offscreen canvas for cropping
    const canvas = new OffscreenCanvas(bounds.width, bounds.height);
    const ctx = canvas.getContext('2d');
    
    // Draw cropped portion
    ctx.drawImage(
      imageBitmap,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      0,
      0,
      bounds.width,
      bounds.height
    );
    
    // Convert to blob then to base64 data URL
    const croppedBlob = await canvas.convertToBlob({ type: 'image/png', quality: 0.95 });
    
    // Convert blob to data URL
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(croppedBlob);
    });
  } catch (error) {
    throw new Error(`Failed to crop image: ${error.message}`);
  }
}

/**
 * Capture screenshot and crop chart
 */
async function captureAndCropChart(tabId, bounds) {
  try {
    // Validate bounds
    if (!bounds || typeof bounds.x !== 'number' || typeof bounds.y !== 'number' || 
        typeof bounds.width !== 'number' || typeof bounds.height !== 'number') {
      throw new Error('Invalid bounds provided');
    }
    
    if (bounds.width <= 0 || bounds.height <= 0) {
      throw new Error('Bounds width and height must be greater than 0');
    }
    
    // Get the window ID for the tab
    const tab = await chrome.tabs.get(tabId);
    if (!tab) {
      throw new Error('Tab not found');
    }
    
    const windowId = tab.windowId;
    
    // Capture visible tab
    const imageDataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: 'png',
      quality: 100
    });
    
    if (!imageDataUrl) {
      throw new Error('Failed to capture screenshot - no image data returned');
    }
    
    // Crop the image
    const croppedImage = await cropImage(imageDataUrl, bounds);
    
    return croppedImage;
  } catch (error) {
    throw new Error(`Failed to capture screenshot: ${error.message}`);
  }
}

/**
 * Handle messages from content script and side panel
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle async operations
  if (message.action === 'captureScreenshot') {
    // Get tab ID from message or sender
    const tabId = message.tabId || sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'Tab ID not available' });
      return true;
    }
    captureAndCropChart(tabId, message.bounds)
      .then(imageDataUrl => sendResponse({ success: true, imageDataUrl }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }

  if (message.action === 'analyzeChart') {
    handleAnalyzeChart(message.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }

  if (message.action === 'checkApiKey') {
    hasApiKey(message.provider)
      .then(hasKey => sendResponse({ success: true, hasKey }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'validateApiKey') {
    validateApiKey(message.provider, message.apiKey)
      .then(isValid => sendResponse({ success: true, isValid }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'getProviderCosts') {
    handleGetProviderCosts(message.provider, message.apiKey)
      .then(costs => sendResponse({ success: true, costs }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

/**
 * Handle provider costs request
 */
async function handleGetProviderCosts(provider, apiKey) {
  // If no API key provided, try to get it from storage
  if (!apiKey) {
    apiKey = await getApiKey(provider);
  }
  
  if (!apiKey) {
    // No key, return zero costs
    return {
      thisMonthTotal: 0,
      thisMonthAvg: 0,
      totalCount: 0
    };
  }
  
  // Fetch costs using the cost utility
  return await getProviderCosts(provider, apiKey);
}

/**
 * Handle chart analysis request
 * This runs in the background script to keep API keys secure
 */
async function handleAnalyzeChart({ imageDataUrl, metadata, provider, conversationHistory = [] }) {
  // Rate limiting
  const now = Date.now();
  if (now - lastAnalysisTime < MIN_ANALYSIS_INTERVAL) {
    throw new Error(`Please wait ${Math.ceil((MIN_ANALYSIS_INTERVAL - (now - lastAnalysisTime)) / 1000)} seconds before analyzing again`);
  }
  lastAnalysisTime = now;

  // Get API key
  const apiKey = await getApiKey(provider);
  if (!apiKey) {
    throw new Error(`API key not configured for ${provider}. Please add your API key in settings.`);
  }

  // Get provider module
  const providerModule = getProvider(provider);

  // Analyze chart with conversation history
  const result = await providerModule.analyzeChart(imageDataUrl, metadata, apiKey, null, conversationHistory);
  
  // Extract analysis content and usage
  let analysis;
  let usage = null;
  
  if (typeof result === 'string') {
    // Legacy format - just string content
    analysis = result;
  } else if (result && typeof result === 'object') {
    // New format - object with content and usage
    analysis = result.content || result;
    usage = result.usage || null;
  } else {
    analysis = result;
  }
  
  // Track cost if usage data is available
  if (usage && usage.inputTokens && usage.outputTokens) {
    const model = provider === 'openai' ? 'gpt-4o' : 
                  provider === 'anthropic' ? 'claude-sonnet-4-5-20250929' :
                  provider === 'google' ? 'gemini-1.5-pro' : 'gpt-4o';
    
    const cost = calculateCost(provider, model, usage.inputTokens, usage.outputTokens);
    await recordUsage(provider, model, usage.inputTokens, usage.outputTokens, cost);
  }
  
  return { analysis };
}

/**
 * Validate API key for a provider
 */
async function validateApiKey(provider, apiKey) {
  const providerModule = getProvider(provider);
  return await providerModule.validateApiKey(apiKey);
}

/**
 * Open side panel when extension icon is clicked
 */
chrome.action.onClicked.addListener((tab) => {
  // Only open on bitview.space
  if (tab.url && tab.url.includes('bitview.space')) {
    chrome.sidePanel.open({ windowId: tab.windowId });
  } else {
    chrome.tabs.create({ url: 'https://bitview.space' });
  }
});

/**
 * Set side panel for bitview.space
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({
    path: 'sidepanel.html',
    enabled: true
  });
});
