/**
 * Conversation history management
 * Stores and retrieves conversation history with automatic cleanup
 */

const MAX_CONVERSATIONS = 15; // Keep last 15 conversations
const STORAGE_KEY = 'conversation_history';

/**
 * Get all stored conversations
 * @returns {Promise<Array>} Array of conversation objects
 */
export async function getAllConversations() {
  const result = await chrome.storage.local.get([STORAGE_KEY]);
  return result[STORAGE_KEY] || [];
}

/**
 * Save a conversation
 * @param {string} provider - Provider name
 * @param {Array} messages - Array of message objects {role, content}
 * @param {string} chartImage - Base64 image data URL
 * @param {Object} metadata - Chart metadata
 * @param {string} category - Prompt category used
 * @returns {Promise<string>} Conversation ID
 */
export async function saveConversation(provider, messages, chartImage, metadata, category = 'market-analysis') {
  const conversations = await getAllConversations();
  
  // Create new conversation
  const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const conversation = {
    id: conversationId,
    timestamp: Date.now(),
    provider,
    category,
    messages: [...messages], // Copy array
    chartImage,
    metadata: { ...metadata } // Copy object
  };
  
  // Add to beginning (most recent first)
  conversations.unshift(conversation);
  
  // Keep only last MAX_CONVERSATIONS
  const trimmedConversations = conversations.slice(0, MAX_CONVERSATIONS);
  
  await chrome.storage.local.set({ [STORAGE_KEY]: trimmedConversations });
  
  return conversationId;
}

/**
 * Update an existing conversation
 * @param {string} conversationId - Conversation ID
 * @param {Array} messages - Updated messages array
 * @returns {Promise<void>}
 */
export async function updateConversation(conversationId, messages) {
  const conversations = await getAllConversations();
  const index = conversations.findIndex(c => c.id === conversationId);
  
  if (index !== -1) {
    conversations[index].messages = [...messages];
    conversations[index].timestamp = Date.now(); // Update timestamp
    await chrome.storage.local.set({ [STORAGE_KEY]: conversations });
  }
}

/**
 * Get the most recent conversation
 * @returns {Promise<Object|null>} Most recent conversation or null
 */
export async function getMostRecentConversation() {
  const conversations = await getAllConversations();
  return conversations.length > 0 ? conversations[0] : null;
}

/**
 * Get conversation by ID
 * @param {string} conversationId - Conversation ID
 * @returns {Promise<Object|null>} Conversation or null
 */
export async function getConversationById(conversationId) {
  const conversations = await getAllConversations();
  return conversations.find(c => c.id === conversationId) || null;
}

/**
 * Delete a conversation
 * @param {string} conversationId - Conversation ID
 * @returns {Promise<void>}
 */
export async function deleteConversation(conversationId) {
  const conversations = await getAllConversations();
  const filtered = conversations.filter(c => c.id !== conversationId);
  await chrome.storage.local.set({ [STORAGE_KEY]: filtered });
}

/**
 * Clear all conversations
 * @returns {Promise<void>}
 */
export async function clearAllConversations() {
  await chrome.storage.local.remove([STORAGE_KEY]);
}

/**
 * Get storage size estimate (for monitoring)
 * @returns {Promise<number>} Approximate size in bytes
 */
export async function getStorageSize() {
  const conversations = await getAllConversations();
  const jsonString = JSON.stringify(conversations);
  return new Blob([jsonString]).size;
}
