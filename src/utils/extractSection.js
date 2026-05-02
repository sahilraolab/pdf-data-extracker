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
  // Matches "Qty: 3" / "QTY : 3" / "Quantity: 3"
  const labelMatch = /\b(?:qty|quantity)\s*[:\-]\s*(\d+)/i.exec(productDetailsText);
  if (labelMatch) {
    const val = parseFloat(labelMatch[1]);
    if (!isNaN(val)) return val;
  }

  // ── Strategy 2: structured table / header scan ─────────────────────────
  // If the Product Details section includes a header row with Qty, attempt
  // to parse the first data row immediately following it.
  const lines = productDetailsText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const headerIndex = lines.findIndex(line => /Qty/i.test(line));
  if (headerIndex !== -1 && headerIndex + 1 < lines.length) {
    const dataLine = lines[headerIndex + 1];

    // Common compact PDF extraction pattern: SKU + Size + Qty + Color + OrderNo
    // can be rendered as e.g. "646_Brown&Grey32A1Brown27802964...".
    const compactMatch = /\d{1,2}[A-Za-z]{1,2}(\d{1,2})(?!\d)/.exec(dataLine);
    if (compactMatch) {
      const val = parseInt(compactMatch[1], 10);
      if (!isNaN(val)) return val;
    }
  }

  // ── Strategy 3: keyword-forward scan ───────────────────────────────────
  // Find the "Qty" keyword (column header or inline label without colon),
  // then scan FORWARD in the remaining text for the first plausible integer.
  const qtyKeyPos = productDetailsText.search(/Qty/i);
  if (qtyKeyPos !== -1) {
    const afterKeyword = productDetailsText.slice(qtyKeyPos + 3);
    const tokenRegex = /[0-9A-Za-z_]+/g;
    let tkMatch;
    while ((tkMatch = tokenRegex.exec(afterKeyword)) !== null) {
      const token = tkMatch[0];

      // First try patterns like "32A1" or "28B2" where qty follows size.
      const inlineQty = /\d{1,2}[A-Za-z]{1,2}(\d{1,2})(?!\d)/.exec(token);
      if (inlineQty) {
        const val = parseInt(inlineQty[1], 10);
        if (!isNaN(val)) return val;
      }

      // Then accept a standalone small number token.
      const numericMatch = /^(\d{1,2})$/.exec(token);
      if (numericMatch) {
        return parseInt(numericMatch[1], 10);
      }
    }
  }

  return 0;
}

module.exports = { extractSection, extractQty };
