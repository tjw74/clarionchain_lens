/**
 * Cost tracking utilities
 * Calculates costs from API usage and stores usage records
 */

// Provider pricing per million tokens (as of 2024)
const PRICING = {
  openai: {
    'gpt-4o': {
      input: 2.50,   // $2.50 per million tokens
      output: 10.00  // $10.00 per million tokens
    },
    'gpt-4o-mini': {
      input: 0.15,
      output: 0.60
    }
  },
  anthropic: {
    'claude-3-5-sonnet-20241022': {
      input: 3.00,
      output: 15.00
    },
    'claude-3-opus-20240229': {
      input: 15.00,
      output: 75.00
    },
    'claude-3-sonnet-20240229': {
      input: 3.00,
      output: 15.00
    },
    'claude-3-haiku-20240307': {
      input: 0.25,
      output: 1.25
    }
  },
  google: {
    'gemini-1.5-pro': {
      input: 1.25,
      output: 5.00
    },
    'gemini-1.5-flash': {
      input: 0.075,
      output: 0.30
    }
  }
};

/**
 * Calculate cost from token usage
 * @param {string} provider - Provider name
 * @param {string} model - Model name
 * @param {number} inputTokens - Input tokens used
 * @param {number} outputTokens - Output tokens used
 * @returns {number} Cost in USD
 */
export function calculateCost(provider, model, inputTokens, outputTokens) {
  const providerPricing = PRICING[provider];
  if (!providerPricing) {
    return 0;
  }

  const modelPricing = providerPricing[model] || providerPricing[Object.keys(providerPricing)[0]];
  if (!modelPricing) {
    return 0;
  }

  // Convert tokens to millions and multiply by price
  const inputCost = (inputTokens / 1_000_000) * modelPricing.input;
  const outputCost = (outputTokens / 1_000_000) * modelPricing.output;
  
  return inputCost + outputCost;
}

/**
 * Get current month start timestamp
 * @returns {number} Timestamp of first day of current month
 */
function getCurrentMonthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

/**
 * Record usage for an API call
 * @param {string} provider - Provider name
 * @param {string} model - Model name
 * @param {number} inputTokens - Input tokens used
 * @param {number} outputTokens - Output tokens used
 * @param {number} cost - Calculated cost
 * @returns {Promise<void>}
 */
export async function recordUsage(provider, model, inputTokens, outputTokens, cost) {
  const usageRecord = {
    timestamp: Date.now(),
    provider,
    model,
    inputTokens,
    outputTokens,
    cost
  };

  // Get existing usage records
  const result = await chrome.storage.local.get(['usage_records']);
  const records = result.usage_records || [];
  
  // Add new record
  records.push(usageRecord);
  
  // Keep only last 1000 records to prevent storage bloat
  const trimmedRecords = records.slice(-1000);
  
  await chrome.storage.local.set({ usage_records: trimmedRecords });
}

/**
 * Get usage statistics
 * @returns {Promise<Object>} Usage stats with thisMonthTotal, thisMonthAvg, totalCount
 */
export async function getUsageStats() {
  const result = await chrome.storage.local.get(['usage_records']);
  const records = result.usage_records || [];
  
  if (records.length === 0) {
    return {
      thisMonthTotal: 0,
      thisMonthAvg: 0,
      totalCount: 0
    };
  }

  const monthStart = getCurrentMonthStart();
  const thisMonthRecords = records.filter(r => r.timestamp >= monthStart);
  
  const thisMonthTotal = thisMonthRecords.reduce((sum, r) => sum + (r.cost || 0), 0);
  const thisMonthAvg = thisMonthRecords.length > 0 
    ? thisMonthTotal / thisMonthRecords.length 
    : 0;
  
  return {
    thisMonthTotal,
    thisMonthAvg,
    totalCount: thisMonthRecords.length
  };
}

/**
 * Format cost as currency string
 * @param {number} cost - Cost in USD
 * @returns {string} Formatted cost string
 */
export function formatCost(cost) {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}
