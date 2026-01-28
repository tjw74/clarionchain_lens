# Quick Start Guide

## Installation (5 minutes)

### Step 1: Load Extension
1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `clarionchainai_ext` folder

### Step 2: Get API Key
Choose one provider:

**OpenAI (Recommended):**
- Visit https://platform.openai.com/api-keys
- Create new secret key
- Copy the key (starts with `sk-`)

**Anthropic:**
- Visit https://console.anthropic.com/
- Create API key
- Copy the key

**Google:**
- Visit https://makersuite.google.com/app/apikey
- Create API key
- Copy the key

### Step 3: Configure Extension
1. Navigate to https://bitview.space
2. Click the ClarionChain Lens extension icon
3. Select your provider from dropdown
4. Paste your API key
5. Click **Save**
6. Wait for "✓ API key saved and validated"

### Step 4: Analyze Chart
1. Ensure bitview.space chart is visible
2. Click **Analyze Chart** button
3. Wait 5-15 seconds for analysis
4. Review the structured Bitcoin market analysis

## Troubleshooting

**"Chart container not found"**
- Enable "Use manual region selection" checkbox
- Click Analyze Chart
- Drag to select the chart area manually

**"API key not configured"**
- Make sure you clicked Save after entering the key
- Check the status message shows "✓ API key saved"

**"Invalid API key"**
- Verify the key is correct (no extra spaces)
- Check you have credits/quota for the provider
- Try regenerating the API key

**Side panel won't open**
- Make sure you're on bitview.space
- Try clicking the extension icon again
- Check chrome://extensions/ for errors

## Features

✅ Automatic chart detection  
✅ Manual region selection fallback  
✅ Multiple AI providers (OpenAI, Anthropic, Google)  
✅ Secure API key storage  
✅ Structured market analysis  
✅ Copy to clipboard  
✅ Rate limiting protection  

## Architecture

- **Background Script**: Handles API calls (keys never exposed)
- **Content Script**: Detects and captures chart
- **Side Panel**: User interface for settings and results
- **Providers**: Modular AI provider implementations

## Next Steps

- Read `README.md` for detailed documentation
- See `ICONS.md` for icon creation instructions
- Check provider files for API-specific details
