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

  const lines = productDetailsText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  // ── Pass 1: explicit "Qty: N" / "Quantity: N" label ────────────────────
  const labelPattern = /(?:qty|quantity)\s*[:\-]\s*(\d+(?:\.\d+)?)/i;
  for (const line of lines) {
    const m = labelPattern.exec(line);
    if (m) {
      const val = parseFloat(m[1]);
      if (!isNaN(val) && val > 0) return val;
    }
  }

  // ── Pass 2: column-header table  ───────────────────────────────────────
  // Find a header line that contains the word "Qty" as a token.
  // Then resolve which token-index that is and pull the value from the
  // next non-empty data line at the same index.
  for (let i = 0; i < lines.length - 1; i++) {
    const headerParts = lines[i].split(/\s+/);
    const qtyColIdx = headerParts.findIndex(p => /^qty$/i.test(p));
    if (qtyColIdx === -1) continue;

    // Walk forward to find the first data row (skip blank / sub-header rows)
    for (let j = i + 1; j < lines.length; j++) {
      const dataParts = lines[j].split(/\s+/);
      if (dataParts.length <= qtyColIdx) continue;
      const val = parseFloat(dataParts[qtyColIdx]);
      if (!isNaN(val) && val >= 0) return val;
    }
  }

  // ── Pass 3: "Qty" keyword anywhere on the same line as a number ────────
  // e.g. "Qty 2" without colon, or "2 Qty" (some label formats)
  const loosePattern = /(?:qty|quantity)\D{0,5}(\d+)|(\d+)\D{0,5}(?:qty|quantity)/i;
  for (const line of lines) {
    const m = loosePattern.exec(line);
    if (m) {
      const val = parseFloat(m[1] || m[2]);
      if (!isNaN(val) && val > 0) return val;
    }
  }

  // ── Pass 4: first short standalone integer on any product data line ────
  // Ignores large numbers (PIN codes, order IDs) which are ≥ 5 digits.
  for (const line of lines) {
    // Skip pure header/label lines that have no digits at all
    if (!/\d/.test(line)) continue;
    const m = /(?:^|\s)(\d{1,4})(?:\s|$)/.exec(line);
    if (m) {
      const val = parseFloat(m[1]);
      if (!isNaN(val) && val > 0) return val;
    }
  }

  return 0;
}

module.exports = { extractSection, extractQty };
