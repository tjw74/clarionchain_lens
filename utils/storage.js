/**
 * Secure storage utilities for API keys
 * Keys are stored in chrome.storage.local and never exposed to page context
 */

/**
 * Save API key for a provider
 * @param {string} provider - Provider name ('openai', 'anthropic', 'google')
 * @param {string} apiKey - The API key to store
 * @returns {Promise<void>}
 */
export async function saveApiKey(provider, apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('API key cannot be empty');
  }
  
  const key = `api_key_${provider}`;
  await chrome.storage.local.set({ [key]: apiKey.trim() });
}

/**
 * Get API key for a provider
 * @param {string} provider - Provider name
 * @returns {Promise<string|null>}
 */
export async function getApiKey(provider) {
  const key = `api_key_${provider}`;
  const result = await chrome.storage.local.get([key]);
  return result[key] || null;
}

/**
 * Remove API key for a provider
 * @param {string} provider - Provider name
 * @returns {Promise<void>}
 */
export async function removeApiKey(provider) {
  const key = `api_key_${provider}`;
  await chrome.storage.local.remove([key]);
}

/**
 * Get all stored API keys (for status display)
 * @returns {Promise<Object>} Object with provider keys
 */
export async function getAllApiKeys() {
  const keys = await chrome.storage.local.get(null);
  const apiKeys = {};
  
  for (const [key, value] of Object.entries(keys)) {
    if (key.startsWith('api_key_')) {
      const provider = key.replace('api_key_', '');
      apiKeys[provider] = value ? '***' + value.slice(-4) : null;
    }
  }
  
  return apiKeys;
}

/**
 * Check if a provider has an API key configured
 * @param {string} provider - Provider name
 * @returns {Promise<boolean>}
 */
export async function hasApiKey(provider) {
  const key = await getApiKey(provider);
  return key !== null && key.length > 0;
}
