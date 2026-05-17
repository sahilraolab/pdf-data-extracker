/**
 * Extracts a text section between a start marker and an end marker.
 * Handles real-world messy text: extra spaces, line breaks, inconsistent casing.
 *
 * @param {string} text - Full page text
 * @param {string|string[]} startMarkers - One or more possible start markers (case-insensitive)
 * @param {string|string[]} endMarkers - One or more possible end markers (case-insensitive)
 * @returns {string} Extracted and trimmed section, or empty string if not found
 */
function extractSection(text, startMarkers, endMarkers) {
  if (!text || typeof text !== 'string') return '';

  const starts = Array.isArray(startMarkers) ? startMarkers : [startMarkers];
  const ends = Array.isArray(endMarkers) ? endMarkers : [endMarkers];

  // Normalize text: collapse multiple spaces/newlines but keep structure readable
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Find the earliest matching start marker position
  let startIdx = -1;
  let matchedStartLen = 0;

  for (const marker of starts) {
    const escapedMarker = escapeRegex(marker);
    // Allow flexible whitespace between words in the marker
    const flexibleMarker = escapedMarker.replace(/\s+/g, '[\\s\\S]{0,10}');
    const regex = new RegExp(flexibleMarker, 'i');
    const match = regex.exec(normalized);
    if (match && (startIdx === -1 || match.index < startIdx)) {
      startIdx = match.index;
      matchedStartLen = match[0].length;
    }
  }

  if (startIdx === -1) return '';

  const contentStart = startIdx + matchedStartLen;
  const remaining = normalized.slice(contentStart);

  // Find the earliest matching end marker in the remaining text
  let endIdx = remaining.length;

  for (const marker of ends) {
    const escapedMarker = escapeRegex(marker);
    const flexibleMarker = escapedMarker.replace(/\s+/g, '[\\s\\S]{0,10}');
    const regex = new RegExp(flexibleMarker, 'i');
    const match = regex.exec(remaining);
    if (match && match.index < endIdx) {
      endIdx = match.index;
    }
  }

  const extracted = remaining.slice(0, endIdx).trim();

  // Clean up: normalize internal whitespace while preserving line breaks
  return extracted
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n');
}

/**
 * Escapes special regex characters in a string.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts the Qty value from a product details section.
 *
 * Handles multiple real-world formats:
 *   1. Explicit label:   "Qty: 3"  /  "QTY : 3"  /  "Quantity: 3"
 *   2. Table column:     header row contains "Qty", value is in the same
 *                        whitespace-column position on the next data row
 *                        e.g.  "SKU  Size  Qty  Color\nSKU01  L  2  Black"
 *   3. Inline number:    first standalone integer on a product data line
 *                        (last resort, ignores PIN codes / order IDs which
 *                        are typically ≥ 5 digits)
 *
 * @param {string} productDetailsText
 * @returns {number} Parsed qty, or 0 if not found
 */
function extractQty(productDetailsText) {
  if (!productDetailsText) return 0;

  // ── Strategy 1: explicit label anywhere in text ────────────────────────
  // Matches "Qty: 3" / "QTY : 3" / "Quantity: 3" / "Qnty 3"
  const labelMatch = /\b(?:qty|quantity|qnty)\s*[:\-]?\s*(\d{1,3})\b/i.exec(productDetailsText);
  if (labelMatch) {
    const val = parseFloat(labelMatch[1]);
    if (!isNaN(val)) return val;
  }

  // ── Strategy 1.5: number before the label ────────────────────────────
  // Handles formats like "2 Qnty" or "3 qty".
  const reverseMatch = /(\d{1,3})\s*(?:qty|quantity|qnty)\b/i.exec(productDetailsText);
  if (reverseMatch) {
    const val = parseFloat(reverseMatch[1]);
    if (!isNaN(val)) return val;
  }

  // ── Strategy 2: structured table / header scan ─────────────────────────
  const lines = productDetailsText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const headerIndex = lines.findIndex(line => /(?:qty|quantity|qnty)/i.test(line));
  if (headerIndex !== -1 && headerIndex + 1 < lines.length) {
    const headerTokens = lines[headerIndex].split(/\s+/);
    const dataTokens = lines[headerIndex + 1].split(/\s+/);
    const qtyColumn = headerTokens.findIndex(token => /^(?:qty|quantity|qnty)$/i.test(token));

    if (qtyColumn !== -1 && qtyColumn < dataTokens.length) {
      const val = parseInt(dataTokens[qtyColumn], 10);
      if (!isNaN(val)) return val;
    }

    // Compact cases with collapsed spacing: e.g. "brownS2Black284..." or "brown28A1Black..."
    const compactMatches = [];
    const compactQtyCandidates = [];
    for (let lineIndex = headerIndex + 1; lineIndex < lines.length; lineIndex += 1) {
      const compactRegex = /(?:\d*[A-Za-z]+)(\d{1,3})(?=[A-Za-z])/g;
      let compactMatch;
      while ((compactMatch = compactRegex.exec(lines[lineIndex])) !== null) {
        const valStr = compactMatch[1];
        const val = parseInt(valStr, 10);
        if (!isNaN(val)) {
          compactMatches.push(val);
          if (val <= 20) {
            compactQtyCandidates.push(val);
          } else if (valStr.length > 1) {
            const prefix = parseInt(valStr.slice(0, -1), 10);
            const lastDigit = parseInt(valStr.slice(-1), 10);
            if (!isNaN(prefix) && prefix > 0 && prefix <= 50 && lastDigit >= 1 && lastDigit <= 9) {
              compactQtyCandidates.push(lastDigit);
            }
          }
        }
      }
    }
    if (compactQtyCandidates.length > 0) {
      return compactQtyCandidates[compactQtyCandidates.length - 1];
    }
    if (compactMatches.length > 0) {
      return compactMatches[compactMatches.length - 1];
    }

    const numericMatches = [];
    for (let lineIndex = headerIndex + 1; lineIndex < lines.length; lineIndex += 1) {
      const fallbackRegex = /\b(\d{1,3})\b/g;
      let fallbackMatch;
      while ((fallbackMatch = fallbackRegex.exec(lines[lineIndex])) !== null) {
        const val = parseInt(fallbackMatch[1], 10);
        if (!isNaN(val)) numericMatches.push(val);
      }
    }
    if (numericMatches.length > 0) {
      const smallNumbers = numericMatches.filter(v => v > 0 && v <= 20);
      if (smallNumbers.length > 0) {
        return smallNumbers[0];
      }
      return numericMatches[numericMatches.length - 1];
    }
  }

  // ── Strategy 3: keyword-forward scan ───────────────────────────────────
  const labelOnlyMatch = productDetailsText.match(/(?:qty|quantity|qnty)/i);
  if (labelOnlyMatch && labelOnlyMatch.index !== undefined) {
    const afterKeyword = productDetailsText.slice(labelOnlyMatch.index + labelOnlyMatch[0].length);
    const tokenRegex = /[0-9A-Za-z_]+/g;
    let tkMatch;
    while ((tkMatch = tokenRegex.exec(afterKeyword)) !== null) {
      const token = tkMatch[0];

      const inlineQty = /\d{1,2}[A-Za-z]{1,2}(\d{1,2})(?!\d)/.exec(token);
      if (inlineQty) {
        const val = parseInt(inlineQty[1], 10);
        if (!isNaN(val)) return val;
      }

      const numericMatch = /^(\d{1,3})$/.exec(token);
      if (numericMatch) {
        return parseInt(numericMatch[1], 10);
      }
    }
  }

  return 0;
}

module.exports = { extractSection, extractQty };
