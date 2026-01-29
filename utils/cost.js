/**
 * Cost tracking utilities
 * Calculates costs from API usage and stores usage records
 * Attempts to fetch actual costs from provider APIs when admin keys are available
 */

// Provider pricing per million tokens (fallback when API costs unavailable)
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
    'claude-3-haiku-20240307': {
      input: 0.25,
      output: 1.25
    },
    'claude-sonnet-4-5-20250929': {
      input: 3.00,
      output: 15.00
    },
    'claude-3-7-sonnet-20250219': {
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

/**
 * Get current month start timestamp in Unix seconds
 * @returns {number} Unix timestamp of first day of current month
 */
function getCurrentMonthStartUnix() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return Math.floor(monthStart.getTime() / 1000);
}

/**
 * Get current month end timestamp in Unix seconds
 * @returns {number} Unix timestamp of last moment of current month
 */
function getCurrentMonthEndUnix() {
  const now = new Date();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return Math.floor(monthEnd.getTime() / 1000);
}

/**
 * Fetch actual costs from OpenAI API
 * @param {string} apiKey - OpenAI API key (can be admin key)
 * @returns {Promise<{thisMonthTotal: number, thisMonthAvg: number, totalCount: number}|null>}
 */
export async function fetchOpenAICosts(apiKey) {
  if (!apiKey) return null;
  
  try {
    const monthStart = getCurrentMonthStartUnix();
    const monthEnd = getCurrentMonthEndUnix();
    
    const response = await fetch(
      `https://api.openai.com/v1/organization/costs?start_time=${monthStart}&end_time=${monthEnd}&bucket_width=1d&limit=31`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      // If not admin key or other error, return null to use fallback
      return null;
    }
    
    const data = await response.json();
    let totalCost = 0;
    let requestCount = 0;
    
    // Sum costs from all buckets
    if (data.data && Array.isArray(data.data)) {
      for (const bucket of data.data) {
        if (bucket.results && Array.isArray(bucket.results)) {
          for (const result of bucket.results) {
            if (result.amount && result.amount.value) {
              totalCost += parseFloat(result.amount.value);
              requestCount++;
            }
          }
        }
      }
    }
    
    return {
      thisMonthTotal: totalCost,
      thisMonthAvg: requestCount > 0 ? totalCost / requestCount : 0,
      totalCount: requestCount
    };
  } catch (error) {
    console.error('Error fetching OpenAI costs:', error);
    return null; // Fallback to token calculation
  }
}

/**
 * Fetch actual costs from Anthropic API
 * @param {string} apiKey - Anthropic API key (must be admin key: sk-ant-admin...)
 * @returns {Promise<{thisMonthTotal: number, thisMonthAvg: number, totalCount: number}|null>}
 */
export async function fetchAnthropicCosts(apiKey) {
  if (!apiKey || !apiKey.startsWith('sk-ant-admin')) {
    // Admin keys start with sk-ant-admin
    return null;
  }
  
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    
    const startTime = monthStart.toISOString();
    const endTime = monthEnd.toISOString();
    
    const response = await fetch(
      `https://api.anthropic.com/v1/organizations/cost_report?starting_at=${encodeURIComponent(startTime)}&ending_at=${encodeURIComponent(endTime)}&bucket_width=1d&limit=31`,
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    let totalCost = 0;
    let bucketCount = 0;
    
    // Sum costs from all buckets
    // Anthropic returns costs as decimal strings in cents
    if (data.data && Array.isArray(data.data)) {
      for (const bucket of data.data) {
        if (bucket.results && Array.isArray(bucket.results)) {
          for (const result of bucket.results) {
            if (result.amount && result.amount.value) {
              // Convert from cents (decimal string) to dollars
              const costInCents = parseFloat(result.amount.value);
              totalCost += costInCents / 100;
              bucketCount++;
            }
          }
        }
      }
    }
    
    return {
      thisMonthTotal: totalCost,
      thisMonthAvg: bucketCount > 0 ? totalCost / bucketCount : 0,
      totalCount: bucketCount
    };
  } catch (error) {
    console.error('Error fetching Anthropic costs:', error);
    return null; // Fallback to token calculation
  }
}

/**
 * Get usage statistics for a specific provider
 * @param {string} provider - Provider name
 * @returns {Promise<Object>} Usage stats with thisMonthTotal, thisMonthAvg, totalCount
 */
export async function getProviderUsageStats(provider) {
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
  const thisMonthRecords = records.filter(r => 
    r.timestamp >= monthStart && r.provider === provider
  );
  
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
 * Get provider costs from API if available, otherwise from stored records
 * @param {string} provider - Provider name
 * @param {string} apiKey - API key (can be admin key for OpenAI/Anthropic)
 * @returns {Promise<Object>} Cost stats
 */
export async function getProviderCosts(provider, apiKey) {
  // Try to fetch from API first
  let apiCosts = null;
  
  if (provider === 'openai') {
    apiCosts = await fetchOpenAICosts(apiKey);
  } else if (provider === 'anthropic') {
    apiCosts = await fetchAnthropicCosts(apiKey);
  }
  // Google doesn't have a direct cost API
  
  // If API costs available (even if totalCount is 0), use them
  if (apiCosts !== null) {
    return apiCosts;
  }
  
  // Otherwise fallback to stored usage records (calculated from tokens)
  return await getProviderUsageStats(provider);
}
