# Unicode Font Setup for PDF Annotations

To enable full Unicode character support (Greek letters like β, α, Ω, etc.) in PDF annotations, you need to download the Noto Sans Regular font.

## Quick Setup

1. **Download the font:**
   - Visit: https://fonts.google.com/noto/specimen/Noto+Sans
   - Click "Download family" or use this direct link: https://fonts.google.com/download?family=Noto%20Sans
   - Extract the ZIP file
   - Find `NotoSans-Regular.ttf` in the extracted folder

2. **Place the font file:**
   - Copy `NotoSans-Regular.ttf` to the `public/` folder in your project
   - The file should be at: `public/NotoSans-Regular.ttf`

3. **Verify:**
   - The file should be approximately 285KB
   - Restart your dev server if it's running
   - Try saving a PDF with Unicode characters - they should now be preserved!

## Alternative: Use a CDN (if local file doesn't work)

The code will automatically try to download from CDN if the local file is not found, but CDN downloads may fail due to CORS restrictions.

## Troubleshooting

- If you see "Unknown font format" error: The font file may be corrupted. Re-download it.
- If Unicode characters are still replaced: Check the browser console for font loading errors.
- If the font file is HTML instead of TTF: The download link redirected. Use the Google Fonts website directly.

