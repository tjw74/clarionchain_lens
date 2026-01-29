#!/bin/bash

# Script to resize logo to required icon sizes
# Usage: ./resize-icons.sh your-logo.png

if [ -z "$1" ]; then
    echo "Usage: ./resize-icons.sh <path-to-your-logo.png>"
    echo "Example: ./resize-icons.sh ~/Desktop/my-logo.png"
    exit 1
fi

LOGO_FILE="$1"
ICONS_DIR="icons"

# Check if logo file exists
if [ ! -f "$LOGO_FILE" ]; then
    echo "Error: Logo file not found: $LOGO_FILE"
    exit 1
fi

# Create icons directory if it doesn't exist
mkdir -p "$ICONS_DIR"

# Resize to 16x16
echo "Creating icon16.png (16x16)..."
sips -z 16 16 "$LOGO_FILE" --out "$ICONS_DIR/icon16.png"

# Resize to 48x48
echo "Creating icon48.png (48x48)..."
sips -z 48 48 "$LOGO_FILE" --out "$ICONS_DIR/icon48.png"

# Resize to 128x128
echo "Creating icon128.png (128x128)..."
sips -z 128 128 "$LOGO_FILE" --out "$ICONS_DIR/icon128.png"

echo ""
echo "✓ All icons created successfully in $ICONS_DIR/"
echo "  - icon16.png (16x16)"
echo "  - icon48.png (48x48)"
echo "  - icon128.png (128x128)"
