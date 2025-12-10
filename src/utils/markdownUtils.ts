/**
 * Sanitize broken KaTeX patterns that models sometimes generate
 * Fixes common issues like: \pm; (semicolon after operator), numbers with commas, etc.
 */
function sanitizeKaTeX(content: string): string {
    // Remove semicolons immediately after operators (e.g., \pm; -> \pm)
    content = content.replace(/\\(pm|times|div|approx|leq|geq|neq|pm|mp|ast);/g, '\\$1')
    
    // Remove commas from numbers in math mode: 28,000 -> 28000
    // Pattern: $ or $$ followed by content with comma-separated numbers
    content = content.replace(/(\$\$?[^$]*\d+),(\d{3}[^$]*\$\$?)/g, '$1$2')
    
    // Remove trailing commas in math expressions: "42," -> "42"
    content = content.replace(/(\$\$?)([^$]*\d),(\s*\$\$?)/g, '$1$2$3')
    
    // Remove spacing commands that break in KaTeX: \; \: \quad \qquad
    content = content.replace(/\\[;:]/g, ' ')
    content = content.replace(/\\quad\b/g, ' ')
    
    return content
}

/**
 * Preprocess markdown content to clean Unicode and wrap unwrapped math expressions
 */
export function preprocessMathContent(content: string): string {
    if (!content || typeof content !== 'string') {
        return ''
    }

    // Note: Logging is handled in the message rendering section to avoid duplicate logs during streaming

    // Step 0: Sanitize broken KaTeX patterns before any other processing
    let sanitized = sanitizeKaTeX(content)

    // Step 1: Clean Unicode spaces and problematic characters
    // Replace various Unicode spaces with regular space
    let cleaned = sanitized.replace(/[\u2000-\u200B\u202F\u205F\u3000]/g, ' ')

    // Replace non-breaking hyphen (U+2011) with regular hyphen for KaTeX compatibility
    // This must happen BEFORE protecting math expressions so it normalizes inside math too
    cleaned = cleaned.replace(/\u2011/g, '-')

    // Also normalize in HTML content (e.g., <br>, <strong>, etc.)
    cleaned = cleaned.replace(/(<[^>]*>)([^<]*)(<\/[^>]*>)/g, (match, openTag, content, closeTag) => {
        const normalizedContent = content.replace(/\u2011/g, '-')
        return normalizedContent !== content ? openTag + normalizedContent + closeTag : match
    })

    // Replace en-dash (8211) and em-dash (8212) with regular hyphens for LaTeX compatibility
    cleaned = cleaned.replace(/[\u2013\u2014]/g, '-')
    // Replace other problematic Unicode characters that KaTeX doesn't recognize
    cleaned = cleaned.replace(/[\u2018\u2019]/g, "'") // Left/right single quotation marks
    cleaned = cleaned.replace(/[\u201C\u201D]/g, '"') // Left/right double quotation marks
    cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n')

    // Step 2: Normalize problematic characters INSIDE math expressions before protecting them
    // This ensures math expressions are clean before they're passed to KaTeX
    cleaned = cleaned.replace(/\$\$[\s\S]*?\$\$/g, (match) => {
        // Normalize non-breaking hyphen and other problematic chars inside block math
        return match.replace(/\u2011/g, '-').replace(/[\u2013\u2014]/g, '-')
    })

    cleaned = cleaned.replace(/\$[^$\n]+?\$/g, (match) => {
        // Normalize non-breaking hyphen and other problematic chars inside inline math
        return match.replace(/\u2011/g, '-').replace(/[\u2013\u2014]/g, '-')
    })

    // Step 3: Protect already-wrapped math expressions using placeholders
    const protectedMath: string[] = []
    const mathPlaceholder = (index: number) => `__MATH_PLACEHOLDER_${index}__`

    // Protect block math ($$...$$) - this is what the model will use per the prompt
    cleaned = cleaned.replace(/\$\$[\s\S]*?\$\$/g, (match) => {
        // Normalize thousand separators inside protected math: convert {,} to comma
        const normalized = match.replace(/(\d+)\{,\}(\d+)/g, '$1,$2')
        protectedMath.push(normalized)
        return mathPlaceholder(protectedMath.length - 1)
    })

    // Protect inline math in both formats:
    // 1. \(...\) - what the model will use per the prompt (remark-math supports this directly)
    // 2. $...$ - legacy format, also supported
    // We'll keep \(...\) as-is since remark-math supports it, but convert to $...$ for consistency
    cleaned = cleaned.replace(/\\\(([\s\S]*?)\\\)/g, (_match, content) => {
        // Normalize problematic characters in LaTeX math content
        let normalizedContent = content.replace(/\u2011/g, '-').replace(/[\u2013\u2014]/g, '-')
        // Also normalize thousand separators inside math: convert {,} to comma
        normalizedContent = normalizedContent.replace(/(\d+)\{,\}(\d+)/g, '$1,$2')
        // Convert to $...$ format for consistency (remark-math supports both, but $...$ is more common)
        const converted = `$${normalizedContent}$`
        protectedMath.push(converted)
        return mathPlaceholder(protectedMath.length - 1)
    })

    // Protect inline math ($...$)
    cleaned = cleaned.replace(/\$[^$\n]+?\$/g, (match) => {
        // Normalize thousand separators inside protected math: convert {,} to comma
        const normalized = match.replace(/(\d+)\{,\}(\d+)/g, '$1,$2')
        protectedMath.push(normalized)
        return mathPlaceholder(protectedMath.length - 1)
    })

    // Convert LaTeX display math (\[...\]) to $$...$$ format for remark-math compatibility
    // Note: Model should use $$...$$ per prompt, but we keep this for legacy/fallback
    // IMPORTANT: Normalize thousand separators {,} to , inside these blocks
    cleaned = cleaned.replace(/\\\[([\s\S]*?)\\\]/g, (_match, content) => {
        // Normalize problematic characters in LaTeX math content
        let normalizedContent = content.replace(/\u2011/g, '-').replace(/[\u2013\u2014]/g, '-')
        // Also normalize thousand separators inside math: convert {,} to comma
        normalizedContent = normalizedContent.replace(/(\d+)\{,\}(\d+)/g, '$1,$2')
        const converted = `$$${normalizedContent}$$`
        protectedMath.push(converted)
        return mathPlaceholder(protectedMath.length - 1)
    })

    // Step 3: Find and wrap parenthesized expressions that contain LaTeX
    const parenthesizedMatches: Array<{ match: string; index: number }> = []
    const parenthesizedRegex = /\(([^()]*?(?:[\\_^]|\\[a-zA-Z@]+\{[^}]*\}|\\pm|\\sim|\\times|\\div|\\sqrt|\\frac|\\text\{|\\approx|\\leq|\\geq|\\neq|\\sum|\\int|\\prod|=\s*\\[a-zA-Z@]+|~\s*\\[a-zA-Z@]+)[^()]*?)\)/g
    let match

    while ((match = parenthesizedRegex.exec(cleaned)) !== null) {
        const fullMatch = match[0]
        const matchIndex = match.index

        // Check if already wrapped or in protected area
        const charBefore = matchIndex > 0 ? cleaned[matchIndex - 1] : ''
        const charAfter = matchIndex + fullMatch.length < cleaned.length ? cleaned[matchIndex + fullMatch.length] : ''

        if (charBefore === '$' && charAfter === '$') continue
        if (cleaned.substring(Math.max(0, matchIndex - 2), matchIndex).includes('](')) continue
        if (charBefore === '`' || charAfter === '`') continue
        if (cleaned.substring(Math.max(0, matchIndex - 10), matchIndex + fullMatch.length + 10).includes('__MATH_PLACEHOLDER')) continue

        parenthesizedMatches.push({ match: fullMatch, index: matchIndex })
    }

    // Step 4: Find complete math expressions (not just in parentheses)
    const expressionMatches: Array<{ match: string; index: number }> = []
    const expressionRegex = /\\[a-zA-Z@]+(?:_[a-zA-Z0-9{}]+|\^[a-zA-Z0-9{}]+)?\s*[~±≤≥≠≈=]\s*[^.,;:!?\n]{5,150}?(?=\s|$|[.,;:!?]|\\[a-zA-Z@]|_[a-zA-Z0-9]|\^[a-zA-Z0-9])/g

    let exprMatch
    while ((exprMatch = expressionRegex.exec(cleaned)) !== null) {
        const matchIndex = exprMatch.index
        let matchStr = exprMatch[0]

        const operatorIndex = Math.max(
            matchStr.indexOf('~'),
            matchStr.indexOf('='),
            matchStr.indexOf('±'),
            matchStr.indexOf('≤'),
            matchStr.indexOf('≥'),
            matchStr.indexOf('≠'),
            matchStr.indexOf('≈')
        )
        if (operatorIndex === -1 || operatorIndex === matchStr.length - 1) {
            continue
        }
        const afterOperator = matchStr.substring(operatorIndex + 1)
        if (!/\\[a-zA-Z@]+|_[a-zA-Z0-9{}]|\^[a-zA-Z0-9{}]/.test(afterOperator)) {
            continue
        }

        const sentenceEnd = /[.,;:!?]/.exec(matchStr)
        if (sentenceEnd && sentenceEnd.index > 10 && sentenceEnd.index < matchStr.length - 5) {
            matchStr = matchStr.substring(0, sentenceEnd.index + 1)
        }

        const charBefore = matchIndex > 0 ? cleaned[matchIndex - 1] : ''
        const charAfter = matchIndex + matchStr.length < cleaned.length ? cleaned[matchIndex + matchStr.length] : ''

        if (charBefore === '$' || charAfter === '$') continue
        if (charBefore === '`' || charAfter === '`') continue
        if (cleaned.substring(Math.max(0, matchIndex - 10), matchIndex + matchStr.length + 10).includes('__MATH_PLACEHOLDER')) continue

        const isInParentheses = parenthesizedMatches.some(m => {
            const mStart = m.index
            const mEnd = mStart + m.match.length
            return matchIndex >= mStart && matchIndex + matchStr.length <= mEnd
        })

        if (!isInParentheses && matchStr.length > 10) {
            expressionMatches.push({ match: matchStr, index: matchIndex })
        }
    }

    // Step 5: Find complex math expressions with nested braces
    const complexMatches: Array<{ match: string; index: number }> = []

    const findBalancedBraces = (str: string, startIndex: number): number => {
        let depth = 0
        let i = startIndex
        while (i < str.length) {
            if (str[i] === '{') depth++
            else if (str[i] === '}') {
                depth--
                if (depth === 0) return i + 1
            }
            i++
        }
        return -1
    }

    const sqrtWithIndexRegex = /\\sqrt\[[^\]]+\](?=\{)/g
    let sqrtMatch
    while ((sqrtMatch = sqrtWithIndexRegex.exec(cleaned)) !== null) {
        const matchIndex = sqrtMatch.index
        const afterCommand = matchIndex + sqrtMatch[0].length

        if (cleaned[afterCommand] === '{') {
            const braceEnd = findBalancedBraces(cleaned, afterCommand)
            if (braceEnd !== -1) {
                const fullMatch = cleaned.substring(matchIndex, braceEnd)
                const charBefore = matchIndex > 0 ? cleaned[matchIndex - 1] : ''
                const charAfter = braceEnd < cleaned.length ? cleaned[braceEnd] : ''

                if (charBefore !== '$' && charAfter !== '$' &&
                    !cleaned.substring(Math.max(0, matchIndex - 10), braceEnd + 10).includes('__MATH_PLACEHOLDER')) {
                    complexMatches.push({ match: fullMatch, index: matchIndex })
                }
            }
        }
    }

    const complexRegex = /\\(sqrt|frac|text|overline|underline)(?=\{)/g
    let complexMatch
    while ((complexMatch = complexRegex.exec(cleaned)) !== null) {
        const matchIndex = complexMatch.index
        const command = complexMatch[1]
        const afterCommand = matchIndex + complexMatch[0].length

        if (cleaned[afterCommand] !== '{') continue

        if (command === 'frac') {
            const firstBraceEnd = findBalancedBraces(cleaned, afterCommand)
            if (firstBraceEnd === -1) continue
            if (cleaned[firstBraceEnd] !== '{') continue
            const secondBraceEnd = findBalancedBraces(cleaned, firstBraceEnd)
            if (secondBraceEnd === -1) continue
            const fullMatch = cleaned.substring(matchIndex, secondBraceEnd)

            const charBefore = matchIndex > 0 ? cleaned[matchIndex - 1] : ''
            const charAfter = secondBraceEnd < cleaned.length ? cleaned[secondBraceEnd] : ''

            if (charBefore !== '$' && charAfter !== '$' &&
                !cleaned.substring(Math.max(0, matchIndex - 10), secondBraceEnd + 10).includes('__MATH_PLACEHOLDER')) {
                complexMatches.push({ match: fullMatch, index: matchIndex })
            }
        } else {
            const braceEnd = findBalancedBraces(cleaned, afterCommand)
            if (braceEnd === -1) continue
            const fullMatch = cleaned.substring(matchIndex, braceEnd)

            const charBefore = matchIndex > 0 ? cleaned[matchIndex - 1] : ''
            const charAfter = braceEnd < cleaned.length ? cleaned[braceEnd] : ''

            if (charBefore !== '$' && charAfter !== '$' &&
                !cleaned.substring(Math.max(0, matchIndex - 10), braceEnd + 10).includes('__MATH_PLACEHOLDER')) {
                const isAlreadyMatched = parenthesizedMatches.some(m => {
                    const mStart = m.index
                    const mEnd = mStart + m.match.length
                    return matchIndex >= mStart && braceEnd <= mEnd
                }) || expressionMatches.some(m => {
                    const mStart = m.index
                    const mEnd = mStart + m.match.length
                    return matchIndex >= mStart && braceEnd <= mEnd
                })

                if (!isAlreadyMatched) {
                    complexMatches.push({ match: fullMatch, index: matchIndex })
                }
            }
        }
    }

    // Step 6a: Find and wrap thousand separator patterns
    // Handle multiple formats: {,} (e.g., 42{,}000), spaces (e.g., 40 000), and commas (e.g., 1,000)
    // First, normalize space-separated numbers to comma-separated for consistency
    // Pattern: $40 000 or 40 000 (with space as thousand separator)
    // Match: 1-3 digits, followed by one or more groups of space + 3 digits, with word boundary
    cleaned = cleaned.replace(/(\$?\s*)(\d{1,3}(?:\s+\d{3})+)(\b)/g, (_match, prefix, numberPart, suffix) => {
        // Convert space-separated to comma-separated: "40 000" -> "40,000"
        const normalized = numberPart.replace(/\s+/g, ',')
        // If it's a dollar amount, wrap it in math delimiters
        if (prefix.trim().startsWith('$')) {
            return `$${normalized}$${suffix}`
        }
        // Otherwise, just normalize the spaces to commas (will be wrapped later if needed)
        return prefix + normalized + suffix
    })

    // Also handle dollar amounts with regular commas that aren't wrapped yet
    // Pattern: $1,000 (not already in math delimiters)
    // Match $ followed by comma-separated number, but not if already wrapped in $$
    // IMPORTANT: Only match if NOT already wrapped (i.e., not followed by $)
    cleaned = cleaned.replace(/\$(\d{1,3}(?:,\d{3})+)(?![$])/g, (_match, numberPart, offset, string) => {
        // Check if the $ before is not part of $$ (already wrapped)
        const charBefore = offset > 0 ? string[offset - 1] : ''
        if (charBefore === '$') {
            // Already wrapped in $$, don't modify
            return _match
        }
        // Check if already wrapped (has $ after the number)
        const matchEnd = offset + _match.length
        if (matchEnd < string.length && string[matchEnd] === '$') {
            // Already wrapped, don't modify
            return _match
        }
        // Wrap the dollar amount in math delimiters, preserving any space after
        const charAfter = matchEnd < string.length ? string[matchEnd] : ''
        // If there's a space or punctuation after, preserve it
        if (charAfter === ' ' || /[.,;:!?)]/.test(charAfter)) {
            return `$${numberPart}$${charAfter}`
        }
        // Otherwise, just wrap it
        return `$${numberPart}$`
    })

    // Step 6b: Find and wrap {,} patterns (e.g., 42{,}000, $42{,}000, [42{,}000], \40{,}000)
    const thousandSeparatorRegex = /(\d+)\{,\}(\d+)/g
    const thousandSeparatorMatches: Array<{ numberPart: string; fullMatch: string; startIndex: number; endIndex: number; prefix: string; suffix: string }> = []

    let thousandMatch
    while ((thousandMatch = thousandSeparatorRegex.exec(cleaned)) !== null) {
        const matchIndex = thousandMatch.index
        const fullMatch = thousandMatch[0]

        // Check if already wrapped or in protected area
        const charBefore = matchIndex > 0 ? cleaned[matchIndex - 1] : ''
        const charAfter = matchIndex + fullMatch.length < cleaned.length ? cleaned[matchIndex + fullMatch.length] : ''

        if (charBefore === '$' || charAfter === '$') continue
        if (cleaned.substring(Math.max(0, matchIndex - 10), matchIndex + fullMatch.length + 10).includes('__MATH_PLACEHOLDER')) continue

        // Look for surrounding numbers to get the full number
        // Look backwards for digits
        let start = matchIndex
        while (start > 0 && /\d/.test(cleaned[start - 1])) {
            start--
        }

        // Look forwards for digits
        let end = matchIndex + fullMatch.length
        while (end < cleaned.length && /\d/.test(cleaned[end])) {
            end++
        }

        const numberPart = cleaned.substring(start, end)
        // Check for prefix (e.g. $)
        const prefixStart = Math.max(0, start - 5)
        const prefix = cleaned.substring(prefixStart, start)
        const suffix = cleaned.substring(end, Math.min(cleaned.length, end + 5))

        thousandSeparatorMatches.push({
            numberPart,
            fullMatch: numberPart, // The full number including {,}
            startIndex: start,
            endIndex: end,
            prefix,
            suffix
        })
    }

    // Apply wrappings (working backwards to preserve indices)
    const allMatches = [
        ...parenthesizedMatches.map(m => ({ ...m, type: 'parentheses' })),
        ...expressionMatches.map(m => ({ ...m, type: 'expression' })),
        ...complexMatches.map(m => ({ ...m, type: 'complex' })),
        ...thousandSeparatorMatches.map(m => ({
            match: m.fullMatch,
            index: m.startIndex,
            type: 'thousand',
            isThousand: true,
            replacement: m.numberPart.replace(/\{,\}/g, ',') // Convert {,} to comma
        }))
    ].sort((a, b) => a.index - b.index)

    // Filter out overlapping matches (prioritize longer/complex matches)
    const filteredMatches = []
    for (let i = 0; i < allMatches.length; i++) {
        const current = allMatches[i]
        let overlap = false

        for (let j = 0; j < filteredMatches.length; j++) {
            const existing = filteredMatches[j]
            const currentEnd = current.index + current.match.length
            const existingEnd = existing.index + existing.match.length

            if (current.index < existingEnd && currentEnd > existing.index) {
                // Overlap detected - keep the one that encompasses the other or is longer
                if (current.match.length > existing.match.length) {
                    filteredMatches[j] = current
                }
                overlap = true
                break
            }
        }

        if (!overlap) {
            filteredMatches.push(current)
        }
    }

    // Apply replacements from end to start
    filteredMatches.sort((a, b) => b.index - a.index)

    for (const m of filteredMatches) {
        const before = cleaned.substring(0, m.index)
        const after = cleaned.substring(m.index + m.match.length)

        if (m.type === 'thousand') {
            // For thousand separators, we replace {,} with comma and wrap in $...$
            // But we need to be careful about context (e.g. if it's $42{,}000)
            const replacement = (m as any).replacement
            cleaned = before + `$${replacement}$` + after
        } else {
            // For other math, just wrap in $...$
            cleaned = before + `$${m.match}$` + after
        }
    }

    // Step 7: Restore protected math
    protectedMath.forEach((math, index) => {
        cleaned = cleaned.replace(mathPlaceholder(index), math)
    })

    return cleaned
}
