# Processing Mathematical Expressions from groq/compound Model

## Key Findings

Based on research and testing, here's how to properly process mathematical expressions from the `groq/compound` model:

### 1. Response Format
- Standard Groq API format: `choices[0].message.content`
- May include optional `reasoning` field (if configured)
- Mathematical expressions are often in LaTeX format but **not always wrapped in `$...$` delimiters**

### 2. Common Issues
- **Unwrapped LaTeX**: Expressions like `\varepsilon_i \sim \text{Normal}(0, \sigma^2)` appear without `$` delimiters
- **Unicode characters**: En-dash (`–`, U+2013), em-dash (`—`, U+2014), and curly quotes cause KaTeX warnings
- **Mixed formatting**: Some expressions are wrapped, others are not

### 3. Best Practices

#### Preprocessing Steps:
1. **Clean Unicode characters** before math detection
   - Replace en-dash/em-dash with regular hyphens
   - Replace curly quotes with straight quotes
   - Normalize Unicode spaces

2. **Protect already-wrapped math** using placeholders
   - `$...$` (inline math)
   - `$$...$$` (block math)
   - `\[...\]` (display math)

3. **Detect and wrap unwrapped math** in this order:
   - Parenthesized expressions: `(Y_i = \beta_0 + \beta_1 X_i)`
   - Complete expressions: `\varepsilon_i \sim \text{Normal}(0, \sigma^2)`
   - Standalone elements: `Y_i`, `\beta_0`, `\pm`, `\text{Normal}`

4. **Restore protected math** after processing

#### Detection Patterns:
- LaTeX commands: `\beta`, `\varepsilon`, `\text{...}`
- Subscripts/superscripts: `Y_i`, `X_{i,j}`, `\beta_0`
- Math operators: `\pm`, `\sim`, `\times`, `\div`
- Greek letters: `\alpha`, `\beta`, `\gamma`, `\sigma`
- Complex expressions: `\sqrt{...}`, `\frac{...}{...}`

### 4. Current Implementation

The `preprocessMathContent()` function in `ChatGPTEmbedded.tsx` handles:
- ✅ Unicode cleaning
- ✅ Protection of already-wrapped math
- ✅ Detection of parenthesized math expressions
- ✅ Detection of complete math expressions with operators
- ✅ Detection of standalone math elements
- ✅ Proper wrapping order to avoid conflicts

### 5. Recommendations

1. **Keep preprocessing aggressive but safe**: The current approach is good - it detects math patterns and wraps them while avoiding false positives.

2. **Monitor for edge cases**: Watch for:
   - Math expressions split across lines
   - Math in code blocks (should be skipped)
   - Math in markdown links (should be skipped)

3. **Consider model-specific instructions**: For compound model, you could add a system instruction to encourage proper LaTeX formatting, but preprocessing should handle it regardless.

4. **Test with various math expressions**:
   - Simple: `Y_i`, `\beta_0`
   - Medium: `(Y_i = \beta_0 + \beta_1 X_i)`
   - Complex: `\varepsilon_i \sim \text{Normal}(0, \sigma^2)`
   - Very complex: `\sqrt{\frac{\text{SSE}}{N-2}}`

### 6. Future Improvements

- Consider handling `reasoning` field if compound model starts using it
- Add support for more LaTeX commands as needed
- Consider caching preprocessed content for performance
- Add unit tests for edge cases

