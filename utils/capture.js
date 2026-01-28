/**
 * Chart capture utilities
 * Handles detection, screenshot, and cropping of chart area
 */

/**
 * Find the main chart container on bitview.space
 * Uses multiple selectors as fallback
 * @returns {HTMLElement|null}
 */
export function findChartContainer() {
  // Try multiple selectors for bitview.space chart
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
      // Verify it's actually visible and has reasonable dimensions
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
 * @param {HTMLElement} chartElement - The chart container element
 * @returns {Object} Chart metadata
 */
export function getChartMetadata(chartElement) {
  const metadata = {
    title: null,
    url: window.location.href,
    timestamp: new Date().toISOString()
  };
  
  // Try to find chart title
  const titleSelectors = [
    'h1',
    'h2',
    '[class*="title"]',
    '[data-title]'
  ];
  
  for (const selector of titleSelectors) {
    const titleEl = chartElement.closest('body')?.querySelector(selector);
    if (titleEl && titleEl.textContent.trim()) {
      metadata.title = titleEl.textContent.trim().substring(0, 100);
      break;
    }
  }
  
  // If no title found, use page title
  if (!metadata.title) {
    metadata.title = document.title || 'Bitcoin Chart';
  }
  
  return metadata;
}

/**
 * Get bounding rectangle for chart element
 * Accounts for devicePixelRatio for accurate cropping
 * @param {HTMLElement} element - Chart element
 * @returns {Object} Bounding rect with pixel ratio
 */
export function getChartBounds(element) {
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
 * @param {string} imageDataUrl - Base64 image data URL
 * @param {Object} bounds - Crop bounds {x, y, width, height}
 * @returns {Promise<string>} Cropped image as base64 data URL
 */
export async function cropImage(imageDataUrl, bounds) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      try {
        // Create offscreen canvas for cropping
        const canvas = new OffscreenCanvas(bounds.width, bounds.height);
        const ctx = canvas.getContext('2d');
        
        // Draw cropped portion
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
        
        // Convert to blob then to base64
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
 * @returns {Promise<Object>} {imageDataUrl, metadata, bounds}
 */
export async function captureChart() {
  // Find chart container
  const chartElement = findChartContainer();
  
  if (!chartElement) {
    throw new Error('Chart container not found. Please ensure you are on bitview.space and the chart is visible.');
  }
  
  // Get chart bounds
  const bounds = getChartBounds(chartElement);
  
  // Get metadata
  const metadata = getChartMetadata(chartElement);
  
  // Request screenshot from background script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: 'png',
    quality: 100
  });
  
  // Crop the image
  const croppedImage = await cropImage(imageDataUrl, bounds);
  
  return {
    imageDataUrl: croppedImage,
    metadata,
    bounds
  };
}

/**
 * Enable manual region selection mode
 * Creates overlay for user to select chart area
 * @returns {Promise<Object>} {imageDataUrl, bounds}
 */
export function enableManualSelection() {
  return new Promise((resolve, reject) => {
    // Create overlay
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
    
    overlay.addEventListener('mouseup', async (e) => {
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
      
      // Remove overlay
      document.body.removeChild(overlay);
      
      // Capture screenshot
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: 'png',
          quality: 100
        });
        
        const croppedImage = await cropImage(imageDataUrl, bounds);
        resolve({ imageDataUrl: croppedImage, bounds });
      } catch (error) {
        reject(error);
      }
    });
    
    // Cancel on escape
    const cancelHandler = (e) => {
      if (e.key === 'Escape') {
        document.body.removeChild(overlay);
        document.removeEventListener('keydown', cancelHandler);
        reject(new Error('Selection cancelled'));
      }
    };
    document.addEventListener('keydown', cancelHandler);
  });
}
