# ClarionChain Lens

A production-ready Chrome Extension (Manifest V3) that provides AI-powered Bitcoin on-chain chart analysis for [bitview.space](https://bitview.space).

## Features

- 🎯 **Precise Chart Capture**: Automatically detects and crops the Bitcoin chart area from bitview.space
- 🤖 **AI Analysis**: Sends chart images to LLM providers (OpenAI, Anthropic, Google) for structured market analysis
- 🔒 **Secure BYOK**: Bring Your Own Key (BYOK) - API keys stored securely in extension storage
- 🎨 **Modern UI**: Clean, dark-mode side panel interface
- 📊 **Structured Analysis**: Provides trend direction, support/resistance, volatility, scenarios, and invalidation conditions
- 🛡️ **Security First**: API keys never exposed to page context, all API calls from background script

## Architecture

```
clarionchainai_ext/
├── manifest.json          # Extension manifest (Manifest V3)
├── background.js          # Service worker (API calls, key management)
├── content.js            # Content script (chart detection, DOM interaction)
├── sidepanel.html        # Side panel UI
├── sidepanel.js          # Side panel logic
├── styles.css            # Dark mode styling
├── providers/
│   ├── openai.js         # OpenAI GPT-4o implementation
│   ├── anthropic.js      # Anthropic Claude implementation
│   └── google.js         # Google Gemini implementation
└── utils/
    └── storage.js        # Secure API key storage utilities
```

## Installation

### 1. Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `clarionchainai_ext` directory
5. The extension icon should appear in your toolbar

### 2. Configure API Key

1. Navigate to [bitview.space](https://bitview.space)
2. Click the ClarionChain Lens extension icon (or open side panel)
3. Select your AI provider (OpenAI, Anthropic, or Google)
4. Enter your API key in the settings section
5. Click **Save** (the key will be validated automatically)
6. The status will show "✓ API key saved and validated"

### 3. Analyze a Chart

1. Ensure you're on bitview.space with a chart visible
2. Open the side panel (click extension icon)
3. Click **Analyze Chart**
4. Wait for analysis (typically 5-15 seconds)
5. Review the structured analysis in the results panel
6. Use **Copy** button to copy analysis to clipboard

## API Key Setup

### OpenAI

1. Go to [OpenAI API Keys](https://platform.openai.com/api-keys)
2. Create a new API key
3. Copy the key and paste it into the extension settings
4. Ensure you have credits/quota for GPT-4o model

### Anthropic

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Navigate to API Keys section
3. Create a new API key
4. Copy the key and paste it into the extension settings

### Google (Gemini)

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Create a new API key
3. Copy the key and paste it into the extension settings
4. Enable the Gemini API in Google Cloud Console if needed

## How It Works

### Chart Capture Flow

1. **Content Script** (`content.js`) detects the chart container on bitview.space
2. Uses multiple fallback selectors to find the chart element
3. Calculates precise bounding rectangle using `getBoundingClientRect()` and `devicePixelRatio`
4. Requests screenshot via `chrome.tabs.captureVisibleTab()`
5. Crops the image using `OffscreenCanvas` to extract only the chart area
6. Returns base64-encoded PNG image

### Analysis Flow

1. **Side Panel** (`sidepanel.js`) sends capture request to content script
2. Content script captures and crops chart
3. Side panel sends image + metadata to **Background Script** (`background.js`)
4. Background script retrieves API key from secure storage
5. Background script calls provider API (OpenAI/Anthropic/Google)
6. Provider analyzes chart using vision-capable model
7. Analysis is returned and displayed in side panel

### Security Model

- **API keys** stored in `chrome.storage.local` (never in page context)
- **Background script** is the only component that accesses API keys
- **Content scripts** cannot access storage directly
- **Page scripts** have no access to extension APIs or keys
- **Rate limiting** prevents abuse (5-second debounce)

## Manual Region Selection

If automatic chart detection fails:

1. Enable **"Use manual region selection"** checkbox in settings
2. Click **Analyze Chart**
3. Click and drag to select the chart area on the page
4. Release mouse button to capture
5. Press `Escape` to cancel selection

## Extending to New Providers

The extension uses a modular provider architecture. To add a new provider:

1. Create `providers/newprovider.js`:

```javascript
export async function analyzeChart(imageDataUrl, metadata, apiKey, onChunk = null) {
  // Implementation
}

export async function validateApiKey(apiKey) {
  // Implementation
}
```

2. Add provider option to `sidepanel.html`:

```html
<option value="newprovider">New Provider</option>
```

3. Import and register in `background.js`:

```javascript
import * as newproviderProvider from './providers/newprovider.js';

function getProvider(provider) {
  switch (provider) {
    // ... existing cases
    case 'newprovider':
      return newproviderProvider;
  }
}
```

4. Add host permission in `manifest.json` if needed:

```json
"host_permissions": [
  "https://api.newprovider.com/*"
]
```

## Troubleshooting

### Chart Not Detected

- Ensure you're on `https://bitview.space`
- Try enabling "Use manual region selection"
- Check browser console for errors (F12)

### API Key Invalid

- Verify the key is correct (no extra spaces)
- Check that the key has proper permissions/quota
- For OpenAI, ensure GPT-4o access is enabled
- Try regenerating the API key

### Analysis Fails

- Check your API quota/credits
- Verify internet connection
- Check browser console for detailed error messages
- Ensure rate limiting hasn't triggered (wait 5 seconds between requests)

### Side Panel Not Opening

- Ensure you're on bitview.space
- Try clicking the extension icon again
- Check `chrome://extensions/` for errors
- Reload the extension if needed

## Development

### File Structure

- **Manifest V3**: Uses service worker instead of background page
- **ES Modules**: All scripts use `import/export` syntax
- **Modular Design**: Provider logic separated for easy extension
- **Security**: Keys isolated in background script

### Testing

1. Load extension in developer mode
2. Navigate to bitview.space
3. Test chart capture (check console for errors)
4. Test API key validation
5. Test full analysis flow
6. Test error handling (invalid keys, network errors)

## Permissions Explained

- `storage`: Store API keys securely
- `activeTab`: Capture visible tab screenshots
- `scripting`: Inject content scripts
- `sidePanel`: Display side panel UI
- `https://bitview.space/*`: Access bitview.space
- `https://api.openai.com/*`: Call OpenAI API
- `https://api.anthropic.com/*`: Call Anthropic API
- `https://generativelanguage.googleapis.com/*`: Call Google API

## License

This extension is provided as-is for production use. Ensure compliance with:
- OpenAI/Anthropic/Google API terms of service
- Chrome Web Store policies (if publishing)
- Data privacy regulations (GDPR, etc.)

## Support

For issues or questions:
1. Check browser console for errors
2. Verify API keys and quotas
3. Ensure you're on the correct website (bitview.space)
4. Try manual region selection if automatic detection fails

---

**Note**: This extension requires users to provide their own API keys. No backend infrastructure is needed - all processing happens client-side in the browser extension.
