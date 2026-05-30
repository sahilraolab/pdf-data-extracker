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

  // ── Strategy 1: Meesho 18-digit order number with suborder suffix ─────────
  // Format: 14-20 digits + underscore + digit(s) e.g. 287885513376041792_1
  // No \b — PDF text sometimes merges tokens (e.g. "Brown287885513376041792_1").
  const m0 = /(\d{14,20}_\d+)/.exec(text);
  if (m0) return m0[1].trim();

  // ── Strategy 2: Explicit "Purchase Order No." or "Order No." label ────────
  // Handles TAX INVOICE format: "Purchase Order No. 289919749289315136"
  // Uses a stricter char class to avoid grabbing nearby column headers.
  const m1 = /\bOrder\s*(?:No\.?|ID|Number|#)\s*[:\-]?\s*(\d{6,20})\b/i.exec(text);
  if (m1) return m1[1].trim();

  // ── Strategy 3: Sub Order label ──────────────────────────────────────────
  const m2 = /\bSub[\s\-]*Order\s*(?:No\.?|ID|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{4,19})/i.exec(text);
  if (m2) return m2[1].trim();

  // ── Strategy 4: Meesho 12-digit order numbers (start with 4) ─────────────
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

  // Shadowfax: SF + digits + known suffix (FPL for regular, MEO for exchange orders)
  const sf = /\b(SF[0-9A-Z]{8,18}(?:FPL|MEO))\b/i.exec(text);
  if (sf) return sf[1].trim();

  // Valmo: VL + digits (e.g. VL0084379313674)
  const valmo = /\b(VL[0-9]{10,16})\b/i.exec(text);
  if (valmo) return valmo[1].trim();

  // Common alphanumeric tracking: 2-4 uppercase letters + 8-16 digits + optional 0-3 letters
  const generic = /\b([A-Z]{2,4}[0-9]{8,16}[A-Z]{0,3})\b/.exec(text);
  if (generic) return generic[1].trim();

  // Pure-numeric tracking (Delhivery): 13-17 digit number that follows "Return Code" context
  const delhivery = /Return\s*Code[\s\S]{1,60}\n\s*(\d{13,17})\s*(?:\n|$)/i.exec(text);
  if (delhivery) return delhivery[1].trim();

  return '';
}

/**
 * Extracts SKU from the product details section.
 *
 * PDF text extraction merges all table cells without spaces:
 *   "646_Brown&GreyM1Brown287885513376041792_1"
 *   "646 black brownS1Black289919749289315136_1"
 *   "646_Brown&Grey30A1Brown286362706780018560_1"
 *
 * Row structure (right to left):
 *   [SKU][Size][Qty 1-2 digits][Color word][OrderNo 14-20digits_N]
 *
 * Strategy: anchor on the order number, then strip [Color][Qty][Size] from the
 * right side — whatever remains is the SKU.
 *
 * @param {string} productDetailsText
 * @param {string} fullPageText
 * @returns {string}
 */
// Known Meesho size codes, longest first so we match "XXL" before "L".
const MEESHO_SIZES = [
  'XXXXL','XXXL','4XL','3XL','2XL','XXL','XL','XS',
  '40D','40C','40B','40A','38D','38C','38B','38A',
  '36D','36C','36B','36A','34D','34C','34B','34A',
  '32D','32C','32B','32A','30D','30C','30B','30A',
  '28D','28C','28B','28A','26D','26C','26B','26A',
  '46','44','42','40','38','36','34','32','30','28','26',
  '16','14','12','10','8','6','4','2',
  'L','M','S',
];

/**
 * Extracts SKU from the product details section.
 *
 * PDF text extraction concatenates table cells without spaces:
 *   "646_Brown&GreyM1Brown287885513376041792_1"
 *   "646 black brownS1Black289919749289315136_1"
 *   "646_Brown&Grey30A1Brown286362706780018560_1"
 *
 * Row structure (right-to-left):
 *   [SKU][Size][Qty 1-2 digits][Color pure-letters][OrderNo 14-20digits_N]
 *
 * We strip each field off the right side in order.
 */
function extractSKU(productDetailsText, fullPageText) {
  const src = productDetailsText || fullPageText || '';
  if (!src) return '';

  // ── Strategy 1: anchor on order number, peel off fields right-to-left ───
  const lines = src.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    const orderNoIdx = line.search(/\d{14,20}_\d+/);
    if (orderNoIdx === -1) continue;

    // Everything before the order number: [SKU][Size][Qty][Color]
    let s = line.slice(0, orderNoIdx).trimEnd();

    // 1. Strip color — trailing sequence of only letters (stops at digit/special char)
    s = s.replace(/[A-Za-z]+$/, '').trimEnd();

    // 2. Strip qty — trailing 1-2 digits
    s = s.replace(/\d{1,2}$/, '').trimEnd();

    // 3. Strip size — match against known size list (longest first to avoid
    //    accidentally matching a single letter that's part of the SKU name)
    const sUpper = s.toUpperCase();
    for (const size of MEESHO_SIZES) {
      if (sUpper.endsWith(size)) {
        const candidate = s.slice(0, s.length - size.length).trimEnd();
        if (candidate.length >= 2) { s = candidate; break; }
      }
    }

    // 4. Strip merged header prefix if present
    //    "SKUSizeQtyColorOrder No.646_Brown&Grey" → "646_Brown&Grey"
    s = s.replace(/^[\s\S]*?Order\s*No\.?\s*/i, '').trim();
    s = s.replace(/^SKU\s*/i, '').trim();

    if (s) return s.slice(0, 60);
  }

  // ── Strategy 2: explicit "SKU:" label ────────────────────────────────────
  const labelMatch = /\bSKU\s*[:\-]\s*([^\n,;|]{1,40})/i.exec(src);
  if (labelMatch) return labelMatch[1].trim().slice(0, 50);

  return '';
}

module.exports = { extractSection, extractQty, extractOrderNo, extractAWB, extractSKU, extractDeliveryPartner };
