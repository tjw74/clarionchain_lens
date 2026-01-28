/**
 * Background service worker
 * Handles API calls and secure key management
 * Never exposes keys to content scripts or page context
 */

import { getApiKey, hasApiKey } from './utils/storage.js';
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
});

/**
 * Handle chart analysis request
 * This runs in the background script to keep API keys secure
 */
async function handleAnalyzeChart({ imageDataUrl, metadata, provider }) {
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

  // Analyze chart
  const analysis = await providerModule.analyzeChart(imageDataUrl, metadata, apiKey);
  
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
