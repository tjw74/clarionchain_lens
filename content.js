/**
 * Content script for bitview.space
 * Handles chart detection and communication with background script
 * Note: Content scripts cannot use ES modules, so capture utilities are inlined
 */

/**
 * Find the main chart container on bitview.space
 */
function findChartContainer() {
  const selectors = [
    '[data-chart]',
    '.chart-container',
    '.tradingview-widget-container',
    'canvas[class*="chart"]',
    '[id*="chart"]',
    '[class*="chart"]',
    'svg[class*="chart"]'
  ];
  
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 200 && rect.height > 200) {
        return element;
      }
    }
  }
  
  // Fallback: look for largest canvas or svg element
  const canvases = Array.from(document.querySelectorAll('canvas, svg'));
  if (canvases.length > 0) {
    const largest = canvases.reduce((max, el) => {
      const rect = el.getBoundingClientRect();
      const maxRect = max.getBoundingClientRect();
      return (rect.width * rect.height) > (maxRect.width * maxRect.height) ? el : max;
    });
    const rect = largest.getBoundingClientRect();
    if (rect.width > 200 && rect.height > 200) {
      return largest;
    }
  }
  
  return null;
}

/**
 * Get chart metadata from DOM
 */
function getChartMetadata(chartElement) {
  const metadata = {
    title: null,
    url: window.location.href,
    timestamp: new Date().toISOString()
  };
  
  const titleSelectors = ['h1', 'h2', '[class*="title"]', '[data-title]'];
  
  for (const selector of titleSelectors) {
    const titleEl = chartElement.closest('body')?.querySelector(selector);
    if (titleEl && titleEl.textContent.trim()) {
      metadata.title = titleEl.textContent.trim().substring(0, 100);
      break;
    }
  }
  
  if (!metadata.title) {
    metadata.title = document.title || 'Bitcoin Chart';
  }
  
  return metadata;
}

/**
 * Get bounding rectangle for chart element
 */
function getChartBounds(element) {
  const rect = element.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  
  return {
    x: Math.round(rect.left * dpr),
    y: Math.round(rect.top * dpr),
    width: Math.round(rect.width * dpr),
    height: Math.round(rect.height * dpr),
    devicePixelRatio: dpr
  };
}

/**
 * Crop image using OffscreenCanvas
 */
async function cropImage(imageDataUrl, bounds) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      try {
        const canvas = new OffscreenCanvas(bounds.width, bounds.height);
        const ctx = canvas.getContext('2d');
        
        ctx.drawImage(
          img,
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
          0,
          0,
          bounds.width,
          bounds.height
        );
        
        canvas.convertToBlob({ type: 'image/png', quality: 0.95 })
          .then(blob => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          })
          .catch(reject);
      } catch (error) {
        reject(error);
      }
    };
    
    img.onerror = reject;
    img.src = imageDataUrl;
  });
}

/**
 * Capture and crop chart from current page
 * Returns bounds and metadata - screenshot is handled by background script
 */
async function captureChart() {
  const chartElement = findChartContainer();
  
  if (!chartElement) {
    throw new Error('Chart container not found. Please ensure you are on bitview.space and the chart is visible.');
  }
  
  const bounds = getChartBounds(chartElement);
  const metadata = getChartMetadata(chartElement);
  
  // Return bounds and metadata - background script will handle screenshot
  return {
    bounds,
    metadata
  };
}

/**
 * Enable manual region selection mode
 */
function enableManualSelection() {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 999999;
      cursor: crosshair;
    `;
    
    const selectionBox = document.createElement('div');
    selectionBox.style.cssText = `
      position: absolute;
      border: 2px solid #00ff00;
      background: rgba(0, 255, 0, 0.1);
      pointer-events: none;
      display: none;
    `;
    
    overlay.appendChild(selectionBox);
    document.body.appendChild(overlay);
    
    let startX = 0;
    let startY = 0;
    let isSelecting = false;
    const dpr = window.devicePixelRatio || 1;
    
    overlay.addEventListener('mousedown', (e) => {
      isSelecting = true;
      startX = e.clientX;
      startY = e.clientY;
      selectionBox.style.display = 'block';
      selectionBox.style.left = startX + 'px';
      selectionBox.style.top = startY + 'px';
      selectionBox.style.width = '0px';
      selectionBox.style.height = '0px';
    });
    
    overlay.addEventListener('mousemove', (e) => {
      if (!isSelecting) return;
      
      const currentX = e.clientX;
      const currentY = e.clientY;
      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);
      
      selectionBox.style.left = left + 'px';
      selectionBox.style.top = top + 'px';
      selectionBox.style.width = width + 'px';
      selectionBox.style.height = height + 'px';
    });
    
    overlay.addEventListener('mouseup', (e) => {
      if (!isSelecting) return;
      isSelecting = false;
      
      const endX = e.clientX;
      const endY = e.clientY;
      
      const bounds = {
        x: Math.round(Math.min(startX, endX) * dpr),
        y: Math.round(Math.min(startY, endY) * dpr),
        width: Math.round(Math.abs(endX - startX) * dpr),
        height: Math.round(Math.abs(endY - startY) * dpr),
        devicePixelRatio: dpr
      };
      
      if (bounds.width < 50 || bounds.height < 50) {
        alert('Selection too small. Please select a larger area.');
        return;
      }
      
      document.body.removeChild(overlay);
      document.removeEventListener('keydown', cancelHandler);
      
      // Return bounds only - background script will handle screenshot
      resolve({ bounds });
    });
    
    const cancelHandler = (e) => {
      if (e.key === 'Escape') {
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        document.removeEventListener('keydown', cancelHandler);
        reject(new Error('Selection cancelled'));
      }
    };
    document.addEventListener('keydown', cancelHandler);
  });
}

/**
 * Initialize content script
 */
function init() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'captureChart') {
      handleCaptureChart(message.useManualSelection)
        .then(result => sendResponse({ success: true, data: result }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }
  });

  injectActiveIndicator();
}

/**
 * Handle chart capture request
 */
async function handleCaptureChart(useManualSelection = false) {
  try {
    if (useManualSelection) {
      // For manual selection, we still need to get screenshot from background
      // So we'll get bounds and let background handle screenshot
      const result = await enableManualSelection();
      return {
        bounds: result.bounds,
        metadata: {
          title: document.title || 'Bitcoin Chart',
          url: window.location.href,
          timestamp: new Date().toISOString()
        }
      };
    } else {
      return await captureChart();
    }
  } catch (error) {
    throw new Error(`Failed to capture chart: ${error.message}`);
  }
}

/**
 * Inject visual indicator that extension is active
 */
function injectActiveIndicator() {
  if (document.getElementById('clarionchain-indicator')) {
    return;
  }

  const indicator = document.createElement('div');
  indicator.id = 'clarionchain-indicator';
  indicator.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: rgba(0, 0, 0, 0.8);
    color: #00ff00;
    padding: 8px 12px;
    border-radius: 4px;
    font-family: monospace;
    font-size: 12px;
    z-index: 999998;
    border: 1px solid #00ff00;
    pointer-events: none;
  `;
  indicator.textContent = 'ClarionChain Lens Active';
  document.body.appendChild(indicator);

  setTimeout(() => {
    if (indicator.parentNode) {
      indicator.parentNode.removeChild(indicator);
    }
  }, 3000);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
