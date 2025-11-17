#!/bin/bash
# Script to download Noto Sans Regular font for Unicode support in PDFs

cd "$(dirname "$0")/public"

echo "Downloading NotoSans-Regular.ttf..."

# Try multiple methods to download the font
if command -v wget &> /dev/null; then
    wget -q --show-progress "https://github.com/google/fonts/raw/main/ofl/notosans/NotoSans-Regular.ttf" -O NotoSans-Regular.ttf
elif command -v curl &> /dev/null; then
    # Use curl with proper redirect handling
    curl -L --fail --location-trusted \
        -H "Accept: application/octet-stream" \
        -H "User-Agent: Mozilla/5.0" \
        "https://github.com/google/fonts/raw/main/ofl/notosans/NotoSans-Regular.ttf" \
        -o NotoSans-Regular.ttf
else
    echo "Error: Neither wget nor curl found. Please download the font manually:"
    echo "1. Visit: https://github.com/google/fonts/tree/main/ofl/notosans"
    echo "2. Click on NotoSans-Regular.ttf"
    echo "3. Click 'Download' or 'View Raw'"
    echo "4. Save the file to: $(pwd)/NotoSans-Regular.ttf"
    exit 1
fi

# Verify the download
if [ -f NotoSans-Regular.ttf ]; then
    SIZE=$(stat -f%z NotoSans-Regular.ttf 2>/dev/null || stat -c%s NotoSans-Regular.ttf 2>/dev/null)
    if [ "$SIZE" -gt 100000 ]; then
        FILE_TYPE=$(file NotoSans-Regular.ttf)
        if echo "$FILE_TYPE" | grep -q "TrueType\|font\|TTF"; then
            echo "✓ Font downloaded successfully! ($(($SIZE / 1024))KB)"
        else
            echo "⚠ Warning: Downloaded file may not be a valid font file"
            echo "File type: $FILE_TYPE"
            echo "Please download manually from: https://fonts.google.com/noto/specimen/Noto+Sans"
        fi
    else
        echo "⚠ Warning: Downloaded file is too small ($SIZE bytes). May be corrupted."
    fi
else
    echo "✗ Download failed. Please download manually."
    exit 1
fi

