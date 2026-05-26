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

/**
 * Extracts an order number from page text.
 *
 * Handles:
 *  - "Order No: 401925123456"
 *  - "Order ID : ABC-123"
 *  - "Sub Order No. 401925789012"
 *  - Bare 12-digit numbers starting with 4 (Meesho format)
 *
 * @param {string} text - Full page text
 * @returns {string} Extracted order number, or empty string
 */
function extractOrderNo(text) {
  if (!text || typeof text !== 'string') return '';

  // Explicit label: Order No / Order ID / Order # / Order Number
  const m1 = /\bOrder\s*(?:No\.?|ID|Number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{4,19})/i.exec(text);
  if (m1) return m1[1].trim();

  // Sub Order label
  const m2 = /\bSub[\s\-]*Order\s*(?:No\.?|ID|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{4,19})/i.exec(text);
  if (m2) return m2[1].trim();

  // Meesho 12-digit order numbers (start with 4)
  const m3 = /\b(4\d{11})\b/.exec(text);
  if (m3) return m3[1];

  return '';
}

// ── Delivery partner names to detect ──────────────────────────────────────────
const KNOWN_PARTNERS = [
  'Shadowfax', 'Delhivery', 'Valmo', 'Ekart', 'Ecom Express', 'EcomExpress',
  'Xpressbees', 'Blue Dart', 'BlueDart', 'DTDC', 'Aramex', 'FedEx', 'Borzo',
  'Dunzo', 'Porter', 'Shiprocket', 'iThink', 'Maruti', 'Meesho Logistics',
];

/**
 * Extracts the delivery partner / courier name from page text.
 * Returns the matched partner name (canonical form) or empty string.
 *
 * @param {string} text - Full page text
 * @returns {string}
 */
function extractDeliveryPartner(text) {
  if (!text || typeof text !== 'string') return '';
  for (const partner of KNOWN_PARTNERS) {
    if (new RegExp(partner.replace(/\s+/g, '\\s*'), 'i').test(text)) {
      return partner;
    }
  }
  return '';
}

/**
 * Extracts the AWB / tracking number from page text.
 * Tries labeled extraction first, then known carrier patterns.
 *
 * @param {string} text - Full page text
 * @returns {string}
 */
function extractAWB(text) {
  if (!text || typeof text !== 'string') return '';

  // Labeled: "AWB No:", "AWB:", "AWB Number", "Tracking No:", "Track No."
  const labeled = /\b(?:AWB|Tracking|Track)\s*(?:No\.?|Number|ID|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-]{7,24})/i.exec(text);
  if (labeled) return labeled[1].trim();

  // Shadowfax pattern: SF + digits + FPL (e.g. SF3423634993FPL)
  const sf = /\b(SF[0-9A-Z]{8,18}FPL)\b/i.exec(text);
  if (sf) return sf[1].trim();

  // Common alphanumeric tracking: 2-4 uppercase letters + 8-16 digits + optional 0-3 letters
  const generic = /\b([A-Z]{2,4}[0-9]{8,16}[A-Z]{0,3})\b/.exec(text);
  if (generic) return generic[1].trim();

  return '';
}

/**
 * Extracts SKU / product variant from the product details section.
 * Handles: explicit "SKU:" label, table header "SKU" column, or first short code.
 *
 * @param {string} productDetailsText - Product details section text
 * @param {string} fullPageText - Full page text fallback
 * @returns {string}
 */
function extractSKU(productDetailsText, fullPageText) {
  const src = productDetailsText || fullPageText || '';
  if (!src) return '';

  // Explicit label: "SKU: 646 black brown" or "SKU 646BLK"
  const labelMatch = /\bSKU\s*[:\-]?\s*([A-Z0-9][^\n,;|]{1,40})/i.exec(src);
  if (labelMatch) {
    return labelMatch[1].trim().slice(0, 50);
  }

  // Table header: "SKU" on a header row, value on next data row at same column position
  const lines = src.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const hIdx  = lines.findIndex(l => /\bSKU\b/i.test(l));
  if (hIdx !== -1 && hIdx + 1 < lines.length) {
    const headerTokens = lines[hIdx].split(/\s+/);
    const dataTokens   = lines[hIdx + 1].split(/\s+/);
    const col = headerTokens.findIndex(t => /^SKU$/i.test(t));
    if (col !== -1 && col < dataTokens.length) {
      return dataTokens[col].trim();
    }
    // If data row exists, return first non-trivial token as likely SKU code
    if (dataTokens.length > 0 && dataTokens[0].length >= 2) {
      return dataTokens[0].trim().slice(0, 50);
    }
  }

  return '';
}

module.exports = { extractSection, extractQty, extractOrderNo, extractAWB, extractSKU, extractDeliveryPartner };
