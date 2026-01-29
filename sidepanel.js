/**
 * Side panel logic
 * Handles UI interactions and coordinates between content script and background
 */

import { saveApiKey, getApiKey, hasApiKey, removeApiKey } from './utils/storage.js';
import { getUsageStats, formatCost } from './utils/cost.js';
import { saveConversation, updateConversation, getMostRecentConversation } from './utils/conversations.js';

// UI Elements
const providerSelect = document.getElementById('provider-select');
const apiKeyInput = document.getElementById('api-key-input');
const saveKeyBtn = document.getElementById('save-key-btn');
const apiKeyStatus = document.getElementById('api-key-status');
const manualSelectionCheckbox = document.getElementById('manual-selection');
const analyzeBtn = document.getElementById('analyze-btn');
const loadingIndicator = document.getElementById('loading-indicator');
const errorMessage = document.getElementById('error-message');
const chatContainer = document.getElementById('chat-container');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const copyConversationBtn = document.getElementById('copy-conversation-btn');
const settingsGear = document.getElementById('settings-gear');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings');
const costMetrics = document.getElementById('cost-metrics');
const apiKeyActions = document.getElementById('api-key-actions');
const removeKeyBtn = document.getElementById('remove-key-btn');
const providerCostsSection = document.getElementById('provider-costs-section');
const providerCostsContent = document.getElementById('provider-costs-content');
const providerCostsLoading = document.querySelector('.cost-loading');

let currentProvider = 'openai';
let conversationHistory = [];
let currentChartImage = null;
let currentChartMetadata = null;
let currentConversationId = null;

/**
 * Initialize side panel
 */
async function init() {
  // Load saved API key for current provider
  await loadApiKeyStatus();

  // Event listeners
  providerSelect.addEventListener('change', async (e) => {
    // Save current conversation before switching
    await saveCurrentConversation();
    
    currentProvider = e.target.value;
    await loadApiKeyStatus();
    await updateProviderCosts();
    
    // Start fresh conversation for new provider (but keep UI visible)
    conversationHistory = [];
    currentConversationId = null;
    // Don't clear the UI - user can continue or start new analysis
  });

  saveKeyBtn.addEventListener('click', handleSaveApiKey);
  removeKeyBtn.addEventListener('click', handleRemoveCurrentApiKey);
  analyzeBtn.addEventListener('click', handleAnalyze);
  sendBtn.addEventListener('click', handleSendMessage);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });
  copyConversationBtn.addEventListener('click', handleCopyConversation);
  settingsGear.addEventListener('click', openSettings);
  closeSettingsBtn.addEventListener('click', closeSettings);
  
  // Close modal when clicking outside
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      closeSettings();
    }
  });
  
  // Close modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsModal.style.display !== 'none') {
      closeSettings();
    }
  });

  // Check if we're on bitview.space
  checkCurrentTab();
  
  // Load and display cost metrics
  await updateCostMetrics();
  
  // Try to load most recent conversation
  await loadMostRecentConversation();
}

/**
 * Open settings modal
 */
async function openSettings() {
  settingsModal.style.display = 'flex';
  await updateProviderCosts();
}

/**
 * Close settings modal
 */
function closeSettings() {
  settingsModal.style.display = 'none';
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
 * Provider display names
 */
const providerNames = {
  openai: 'OpenAI (GPT-4o)',
  anthropic: 'Anthropic (Claude)',
  google: 'Google (Gemini)'
};

/**
 * Handle removing current provider's API key
 */
async function handleRemoveCurrentApiKey() {
  if (!confirm(`Remove API key for ${providerNames[currentProvider]}?`)) {
    return;
  }
  
  try {
    await removeApiKey(currentProvider);
    await loadApiKeyStatus();
    
    // Update analyze button state
    const hasKey = await hasApiKey(currentProvider);
    analyzeBtn.disabled = !hasKey;
    
  } catch (error) {
    showError(`Failed to remove API key: ${error.message}`);
  }
}

/**
 * Load API key status for current provider
 */
async function loadApiKeyStatus() {
  const hasKey = await hasApiKey(currentProvider);
  
  if (hasKey) {
    // Don't show the actual key value for security
    apiKeyInput.value = '';
    apiKeyInput.placeholder = 'Key saved - enter new key to update';
    apiKeyStatus.textContent = '✓ API key saved';
    apiKeyStatus.className = 'status-message status-success';
    apiKeyActions.style.display = 'block';
    analyzeBtn.disabled = false;
  } else {
    apiKeyInput.value = '';
    apiKeyInput.placeholder = 'Enter your API key';
    apiKeyStatus.textContent = 'No API key configured';
    apiKeyStatus.className = 'status-message status-warning';
    apiKeyActions.style.display = 'none';
    analyzeBtn.disabled = true;
  }
}

/**
 * Update provider-specific costs display in settings
 */
async function updateProviderCosts() {
  const hasKey = await hasApiKey(currentProvider);
  
  if (!hasKey) {
    providerCostsSection.style.display = 'none';
    return;
  }
  
  providerCostsSection.style.display = 'block';
  providerCostsLoading.style.display = 'block';
  providerCostsContent.innerHTML = '';
  
  try {
    const apiKey = await getApiKey(currentProvider);
    
    // Fetch costs from background script (which can access APIs)
    const response = await chrome.runtime.sendMessage({
      action: 'getProviderCosts',
      provider: currentProvider,
      apiKey: apiKey
    });
    
    providerCostsLoading.style.display = 'none';
    
    if (response.success && response.costs) {
      const costs = response.costs;
      const total = formatCost(costs.thisMonthTotal);
      const avg = formatCost(costs.thisMonthAvg);
      const count = costs.totalCount || 0;
      
      providerCostsContent.innerHTML = `
        <div class="cost-item">
          <span class="cost-label">This Month:</span>
          <span class="cost-value">${total}</span>
        </div>
        <div class="cost-item">
          <span class="cost-label">Avg per Request:</span>
          <span class="cost-value">${avg}</span>
        </div>
        <div class="cost-item">
          <span class="cost-label">Requests:</span>
          <span class="cost-value">${count}</span>
        </div>
      `;
    } else {
      providerCostsContent.innerHTML = '<div style="color: #888888; font-size: 11px;">Unable to fetch costs. Using calculated estimates.</div>';
    }
  } catch (error) {
    console.error('Error updating provider costs:', error);
    providerCostsLoading.style.display = 'none';
    providerCostsContent.innerHTML = '<div style="color: #888888; font-size: 11px;">Error loading costs.</div>';
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
    console.log(`Validating API key for ${currentProvider}...`);
    const isValid = await validateApiKey(currentProvider, apiKey);
    console.log(`Validation result for ${currentProvider}:`, isValid);
    
    if (!isValid) {
      // Still save the key even if validation fails - user might want to use it anyway
      // Validation might fail due to network issues or API changes
      console.warn(`Validation failed for ${currentProvider}, but saving key anyway`);
      // Don't return early - save the key regardless
      // showError(`Invalid API key for ${currentProvider}. Please check your key and try again.`);
      // saveKeyBtn.disabled = false;
      // saveKeyBtn.textContent = 'Save';
      // return;
    }

    // Save key
    await saveApiKey(currentProvider, apiKey);
    
    // Update status
    await loadApiKeyStatus();
    await updateProviderCosts();
    
    apiKeyStatus.textContent = '✓ API key saved and validated';
    apiKeyStatus.className = 'status-message status-success';
    analyzeBtn.disabled = false;
    
    // Clear input for security
    apiKeyInput.value = '';
    apiKeyInput.placeholder = 'Key saved - enter new key to update';
    
    // Auto-close settings modal after saving
    setTimeout(() => {
      closeSettings();
    }, 500); // Small delay to show success message
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
    
    console.log(`Validation response for ${provider}:`, response);
    
    if (!response || !response.success) {
      console.error('Validation failed - no success response:', response);
      return false;
    }
    
    return response.isValid === true;
  } catch (error) {
    console.error('Validation error:', error);
    return false;
  }
}

/**
 * Handle analyze button click
 */
async function handleAnalyze() {
  // Reset UI for new analysis
  hideError();
  
  // Clear current UI state (but don't delete stored conversations)
  chatMessages.innerHTML = '';
  currentConversationId = null;
  conversationHistory = [];
  currentChartImage = null;
  currentChartMetadata = null;
  
  // Hide chat container initially, will show after analysis
  chatContainer.style.display = 'none';
  chatInput.value = '';
  chatInput.disabled = true;
  sendBtn.disabled = true;
  
  loadingIndicator.style.display = 'block';
  analyzeBtn.disabled = true;

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

    // Store chart data for follow-ups
    currentChartImage = imageDataUrl;
    currentChartMetadata = metadata;
    
    // Start a new conversation (reset ID for new analysis)
    currentConversationId = null;
    conversationHistory = [];

    // Send to background script for analysis (no conversation history for initial)
    const analysisResponse = await chrome.runtime.sendMessage({
      action: 'analyzeChart',
      data: {
        imageDataUrl,
        metadata,
        provider: currentProvider,
        conversationHistory: []
      }
    });

    if (!analysisResponse.success) {
      throw new Error(analysisResponse.error || 'Failed to analyze chart');
    }

    // Display result as first message
    const analysis = analysisResponse.data.analysis;
    addMessage('assistant', analysis);
    conversationHistory = [{ role: 'assistant', content: analysis }]; // Start fresh conversation
    
    // Save conversation (will create new one since currentConversationId is null)
    await saveCurrentConversation();
    
    // Update cost metrics after analysis
    await updateCostMetrics();

    // Show chat interface
    chatContainer.style.display = 'flex';
    chatInput.disabled = false;
    sendBtn.disabled = false;

  } catch (error) {
    showError(error.message || 'An error occurred during analysis');
  } finally {
    loadingIndicator.style.display = 'none';
    analyzeBtn.disabled = false;
  }
}

/**
 * Add a message to the chat
 */
function addMessage(role, content) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${role}`;
  
  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${role}`;
  
  if (role === 'assistant') {
    // Format markdown for assistant messages
    bubble.innerHTML = formatMessage(content);
  } else {
    bubble.textContent = content;
  }
  
  messageDiv.appendChild(bubble);
  chatMessages.appendChild(messageDiv);
  
  // Auto-scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Format message content with markdown
 */
function formatMessage(text) {
  let formatted = text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/#{3}\s+(.*?)(?=\n|$)/g, '<h3>$1</h3>')
    .replace(/#{2}\s+(.*?)(?=\n|$)/g, '<h2>$1</h2>')
    .replace(/#{1}\s+(.*?)(?=\n|$)/g, '<h1>$1</h1>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  
  formatted = '<p>' + formatted + '</p>';
  return formatted;
}

/**
 * Load the most recent conversation from storage
 */
async function loadMostRecentConversation() {
  try {
    const recent = await getMostRecentConversation();
    if (recent && recent.messages && recent.messages.length > 0) {
      // Restore conversation state
      currentConversationId = recent.id;
      conversationHistory = [...recent.messages];
      currentChartImage = recent.chartImage;
      currentChartMetadata = recent.metadata;
      currentProvider = recent.provider;
      
      // Update provider select to match
      providerSelect.value = currentProvider;
      await loadApiKeyStatus();
      
      // Restore UI
      chatMessages.innerHTML = '';
      conversationHistory.forEach(msg => {
        addMessage(msg.role, msg.content);
      });
      
      // Show chat interface if there are messages
      if (conversationHistory.length > 0) {
        chatContainer.style.display = 'flex';
        chatInput.disabled = false;
        sendBtn.disabled = false;
      }
    }
  } catch (error) {
    console.error('Error loading conversation:', error);
  }
}

/**
 * Save current conversation to storage
 */
async function saveCurrentConversation() {
  if (conversationHistory.length === 0 || !currentChartImage) {
    return;
  }
  
  try {
    if (currentConversationId) {
      // Update existing conversation
      await updateConversation(currentConversationId, conversationHistory);
    } else {
      // Create new conversation
      currentConversationId = await saveConversation(
        currentProvider,
        conversationHistory,
        currentChartImage,
        currentChartMetadata || {}
      );
    }
  } catch (error) {
    console.error('Error saving conversation:', error);
  }
}

/**
 * Handle sending a follow-up message
 */
async function handleSendMessage() {
  const question = chatInput.value.trim();
  if (!question || !currentChartImage) return;

  // Add user message to UI
  addMessage('user', question);
  conversationHistory.push({ role: 'user', content: question });

  // Clear input and disable
  chatInput.value = '';
  chatInput.disabled = true;
  sendBtn.disabled = true;

  // Show loading indicator
  const loadingMsg = document.createElement('div');
  loadingMsg.className = 'chat-message assistant';
  loadingMsg.innerHTML = '<div class="message-bubble assistant"><div class="spinner" style="width: 16px; height: 16px; margin: 0 auto;"></div></div>';
  chatMessages.appendChild(loadingMsg);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  try {
    // Send to background script with conversation history (include the user question)
    const response = await chrome.runtime.sendMessage({
      action: 'analyzeChart',
      data: {
        imageDataUrl: currentChartImage,
        metadata: currentChartMetadata,
        provider: currentProvider,
        conversationHistory: conversationHistory // Include full history including the question
      }
    });

    // Remove loading indicator
    chatMessages.removeChild(loadingMsg);

    if (!response.success) {
      throw new Error(response.error || 'Failed to get response');
    }

    // Add assistant response
    const assistantResponse = response.data.analysis;
    addMessage('assistant', assistantResponse);
    conversationHistory.push({ role: 'assistant', content: assistantResponse });
    
    // Save conversation
    await saveCurrentConversation();
    
    // Update cost metrics after analysis
    await updateCostMetrics();

  } catch (error) {
    // Remove loading indicator
    if (loadingMsg.parentNode) {
      chatMessages.removeChild(loadingMsg);
    }
    addMessage('assistant', `Error: ${error.message}`);
  } finally {
    chatInput.disabled = false;
    sendBtn.disabled = false;
    chatInput.focus();
  }
}

/**
 * Update cost metrics display
 */
async function updateCostMetrics() {
  try {
    const stats = await getUsageStats();
    const thisMonth = formatCost(stats.thisMonthTotal);
    const avg = formatCost(stats.thisMonthAvg);
    
    if (stats.totalCount === 0) {
      costMetrics.textContent = '';
    } else {
      costMetrics.textContent = `This Month: ${thisMonth} | Avg: ${avg}`;
    }
  } catch (error) {
    console.error('Error updating cost metrics:', error);
    costMetrics.textContent = '';
  }
}

/**
 * Handle copying entire conversation to clipboard
 */
async function handleCopyConversation() {
  if (conversationHistory.length === 0) return;

  try {
    const conversationText = conversationHistory
      .map(msg => {
        const role = msg.role === 'user' ? 'You' : 'AI';
        return `${role}: ${msg.content}`;
      })
      .join('\n\n');
    
    await navigator.clipboard.writeText(conversationText);
    
    // Show feedback
    const originalText = copyConversationBtn.textContent;
    copyConversationBtn.textContent = 'Copied!';
    copyConversationBtn.classList.add('btn-success');
    
    setTimeout(() => {
      copyConversationBtn.textContent = originalText;
      copyConversationBtn.classList.remove('btn-success');
    }, 2000);
  } catch (error) {
    showError('Failed to copy conversation to clipboard');
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
