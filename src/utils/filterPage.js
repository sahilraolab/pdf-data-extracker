/**
 * Three independent, composable page-filter functions.
 * Each takes parsedData and returns a boolean.
 * They are never merged — callers decide which to enable and how to combine.
 */

/**
 * Filter 1 — Keyword / text search
 * Checks customerAddress and billTo for any user-supplied word or phrase.
 *
 * @param {{ customerAddress: string, billTo: string }} parsedData
 * @param {string} searchText  — the keyword entered by the user
 * @returns {boolean}
 */
function matchesText(parsedData, searchText) {
  if (!searchText || !searchText.trim()) return false;
  const regex = new RegExp(searchText.trim(), 'i');
  return (
    regex.test(parsedData.customerAddress || '') ||
    regex.test(parsedData.billTo || '')
  );
}

/**
 * Filter 2 — Qty > 1
 * True when the extracted quantity from Product Details is greater than 1.
 *
 * @param {{ qty: number }} parsedData
 * @returns {boolean}
 */
function matchesQty(parsedData) {
  return typeof parsedData.qty === 'number' && parsedData.qty > 1;
}
/**
 * Filter 3 — Exchange heading
 * True when the word "exchange" appears anywhere on the page
 * (covers headings like "Exchange Policy", "Exchange Order", etc.)
 *
 * @param {{ rawText: string }} parsedData
 * @returns {boolean}
 */
function matchesExchange(parsedData) {
  return /exchange/i.test(parsedData.rawText || '');
}

module.exports = { matchesText, matchesQty, matchesExchange };
