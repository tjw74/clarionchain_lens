/**
 * Side panel logic
 * Handles UI interactions and coordinates between content script and background
 */

import { saveApiKey, getApiKey, hasApiKey } from './utils/storage.js';

// UI Elements
const providerSelect = document.getElementById('provider-select');
const apiKeyInput = document.getElementById('api-key-input');
const saveKeyBtn = document.getElementById('save-key-btn');
const apiKeyStatus = document.getElementById('api-key-status');
const manualSelectionCheckbox = document.getElementById('manual-selection');
const analyzeBtn = document.getElementById('analyze-btn');
const loadingIndicator = document.getElementById('loading-indicator');
const errorMessage = document.getElementById('error-message');
const analysisResult = document.getElementById('analysis-result');
const analysisContent = document.getElementById('analysis-content');
const copyBtn = document.getElementById('copy-btn');
const settingsContent = document.getElementById('settings-content');
const settingsHeader = document.getElementById('settings-header');

let currentProvider = 'openai';
let currentAnalysis = '';
let settingsCollapsed = true; // Collapsed by default

/**
 * Initialize side panel
 */
async function init() {
  // Load saved API key for current provider
  await loadApiKeyStatus();

  // Load collapsed state
  await loadCollapsedState();

  // Event listeners
  providerSelect.addEventListener('change', async (e) => {
    currentProvider = e.target.value;
    await loadApiKeyStatus();
  });

  saveKeyBtn.addEventListener('click', handleSaveApiKey);
  analyzeBtn.addEventListener('click', handleAnalyze);
  copyBtn.addEventListener('click', handleCopy);
  settingsHeader.addEventListener('click', toggleSettings);

  // Check if we're on bitview.space
  checkCurrentTab();
}

/**
 * Load collapsed state from storage
 */
async function loadCollapsedState() {
  const result = await chrome.storage.local.get(['settingsCollapsed']);
  // Default to collapsed (true) if not set
  settingsCollapsed = result.settingsCollapsed !== undefined ? result.settingsCollapsed : true;
  updateSettingsVisibility();
}

/**
 * Save collapsed state to storage
 */
async function saveCollapsedState() {
  await chrome.storage.local.set({ settingsCollapsed });
}

/**
 * Toggle settings section
 */
function toggleSettings() {
  settingsCollapsed = !settingsCollapsed;
  updateSettingsVisibility();
  saveCollapsedState();
}

/**
 * Update settings visibility based on collapsed state
 */
function updateSettingsVisibility() {
  if (settingsCollapsed) {
    settingsContent.style.display = 'none';
    settingsHeader.classList.add('collapsed');
  } else {
    settingsContent.style.display = 'block';
    settingsHeader.classList.remove('collapsed');
  }
}

/**
 * Check current tab and update UI accordingly
 */
async function checkCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.url || !tab.url.includes('bitview.space')) {
      showError('Please navigate to bitview.space to use this extension.');
      analyzeBtn.disabled = true;
    } else {
      analyzeBtn.disabled = false;
    }
  } catch (error) {
    console.error('Error checking tab:', error);
  }
}

/**
 * Load API key status for current provider
 */
async function loadApiKeyStatus() {
  const hasKey = await hasApiKey(currentProvider);
  
  if (hasKey) {
    const key = await getApiKey(currentProvider);
    apiKeyInput.value = key; // Show existing key (user can see it's saved)
    apiKeyStatus.textContent = '✓ API key saved';
    apiKeyStatus.className = 'status-message status-success';
    analyzeBtn.disabled = false;
  } else {
    apiKeyInput.value = '';
    apiKeyStatus.textContent = 'No API key configured';
    apiKeyStatus.className = 'status-message status-warning';
    analyzeBtn.disabled = true;
  }
}

/**
 * Handle API key save
 */
async function handleSaveApiKey() {
  const apiKey = apiKeyInput.value.trim();
  
  if (!apiKey) {
    showError('Please enter an API key');
    return;
  }

  try {
    saveKeyBtn.disabled = true;
    saveKeyBtn.textContent = 'Saving...';

    // Validate API key
    const isValid = await validateApiKey(currentProvider, apiKey);
    
    if (!isValid) {
      showError(`Invalid API key for ${currentProvider}. Please check your key and try again.`);
      saveKeyBtn.disabled = false;
      saveKeyBtn.textContent = 'Save';
      return;
    }

    // Save key
    await saveApiKey(currentProvider, apiKey);
    
    apiKeyStatus.textContent = '✓ API key saved and validated';
    apiKeyStatus.className = 'status-message status-success';
    analyzeBtn.disabled = false;
    
    // Clear input for security
    apiKeyInput.value = '••••••••';
    
    // Auto-collapse settings after saving
    if (!settingsCollapsed) {
      settingsCollapsed = true;
      updateSettingsVisibility();
      saveCollapsedState();
    }
  } catch (error) {
    showError(`Failed to save API key: ${error.message}`);
  } finally {
    saveKeyBtn.disabled = false;
    saveKeyBtn.textContent = 'Save';
  }
}

/**
 * Validate API key with provider
 */
async function validateApiKey(provider, apiKey) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'validateApiKey',
      provider,
      apiKey
    });
    
    return response.success && response.isValid;
  } catch (error) {
    console.error('Validation error:', error);
    return false;
  }
}

/**
 * Handle analyze button click
 */
async function handleAnalyze() {
  // Reset UI
  hideError();
  analysisResult.style.display = 'none';
  loadingIndicator.style.display = 'block';
  analyzeBtn.disabled = true;
  currentAnalysis = '';

  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url || !tab.url.includes('bitview.space')) {
      throw new Error('Please navigate to bitview.space to analyze charts');
    }

    // Check API key
    const hasKey = await hasApiKey(currentProvider);
    if (!hasKey) {
      throw new Error(`Please configure an API key for ${currentProvider}`);
    }

    // Inject content script if needed and get chart bounds
    const useManualSelection = manualSelectionCheckbox.checked;
    
    // Send message to content script to get chart bounds
    const captureResponse = await chrome.tabs.sendMessage(tab.id, {
      action: 'captureChart',
      useManualSelection
    });

    if (!captureResponse.success) {
      throw new Error(captureResponse.error || 'Failed to capture chart');
    }

    const { bounds, metadata } = captureResponse.data;

    // Request screenshot capture and cropping from background script
    const screenshotResponse = await chrome.runtime.sendMessage({
      action: 'captureScreenshot',
      tabId: tab.id,
      bounds
    });

    if (!screenshotResponse.success) {
      throw new Error(screenshotResponse.error || 'Failed to capture screenshot');
    }

    const imageDataUrl = screenshotResponse.imageDataUrl;

    // Send to background script for analysis
    const analysisResponse = await chrome.runtime.sendMessage({
      action: 'analyzeChart',
      data: {
        imageDataUrl,
        metadata,
        provider: currentProvider
      }
    });

    if (!analysisResponse.success) {
      throw new Error(analysisResponse.error || 'Failed to analyze chart');
    }

    // Display result
    currentAnalysis = analysisResponse.data.analysis;
    displayAnalysis(currentAnalysis);

  } catch (error) {
    showError(error.message || 'An error occurred during analysis');
  } finally {
    loadingIndicator.style.display = 'none';
    analyzeBtn.disabled = false;
  }
}

/**
 * Display analysis result
 */
function displayAnalysis(text) {
  analysisContent.textContent = text;
  
  // Format text with basic markdown-like formatting
  let formatted = text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  
  formatted = '<p>' + formatted + '</p>';
  
  analysisContent.innerHTML = formatted;
  analysisResult.style.display = 'block';
}

/**
 * Handle copy to clipboard
 */
async function handleCopy() {
  if (!currentAnalysis) return;

  try {
    await navigator.clipboard.writeText(currentAnalysis);
    
    // Show feedback
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    copyBtn.classList.add('btn-success');
    
    setTimeout(() => {
      copyBtn.textContent = originalText;
      copyBtn.classList.remove('btn-success');
    }, 2000);
  } catch (error) {
    showError('Failed to copy to clipboard');
  }
}

/**
 * Show error message
 */
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
}

/**
 * Hide error message
 */
function hideError() {
  errorMessage.style.display = 'none';
}

// Initialize on load
init();
