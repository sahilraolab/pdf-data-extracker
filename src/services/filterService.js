const { parsePage } = require('../utils/parsePage');
const { matchesText, matchesQty, matchesExchange } = require('../utils/filterPage');
const logger = require('../utils/logger');

/**
 * Processes all pages through three independent filters.
 *
 * @param {string[]} pageTexts
 * @param {object}  opts
 * @param {string}  opts.filterText       - keyword to search in addresses (empty = filter disabled)
 * @param {boolean} opts.qtyFilter        - enable qty > 1 filter
 * @param {boolean} opts.exchangeFilter   - enable "exchange" heading filter
 * @param {boolean} opts.onlyMatched      - omit non-matching pages from results array
 *
 * @returns {{
 *   totalPages: number,
 *   matchedPages: number,
 *   matchedPageNumbers: number[],
 *   filtersApplied: { text: boolean, qty: boolean, exchange: boolean },
 *   results: Array<{
 *     pageNumber: number,
 *     customerAddress: string,
 *     billTo: string,
 *     qty: number,
 *     isTextMatch: boolean,
 *     isQtyMatch: boolean,
 *     isExchangeMatch: boolean,
 *     isMatch: boolean
 *   }>
 * }}
 */
function processPages(pageTexts, opts = {}) {
  const {
    filterText = '',
    qtyFilter = false,
    exchangeFilter = false,
    onlyMatched = false,
  } = opts;

  const textEnabled     = Boolean(filterText && filterText.trim());
  const qtyEnabled      = Boolean(qtyFilter);
  const exchangeEnabled = Boolean(exchangeFilter);
  const anyFilterOn     = textEnabled || qtyEnabled || exchangeEnabled;

  if (!Array.isArray(pageTexts) || pageTexts.length === 0) {
    return {
      totalPages: 0,
      matchedPages: 0,
      matchedPageNumbers: [],
      filtersApplied: { text: textEnabled, qty: qtyEnabled, exchange: exchangeEnabled },
      results: [],
    };
  }

  const results = [];
  const matchedPageNumbers = [];

  for (let i = 0; i < pageTexts.length; i++) {
    const pageNumber = i + 1;

    let parsed;
    try {
      parsed = parsePage(pageTexts[i], pageNumber);
    } catch (err) {
      logger.error(`Failed to parse page ${pageNumber}: ${err.message}`);
      parsed = { customerAddress: '', billTo: '', productDetails: '', qty: 0, rawText: '' };
    }

    // Evaluate each filter independently
    const isTextMatch     = textEnabled     ? matchesText(parsed, filterText) : false;
    const isQtyMatch      = qtyEnabled      ? matchesQty(parsed)              : false;
    const isExchangeMatch = exchangeEnabled ? matchesExchange(parsed)         : false;

    // A page is a match if at least one enabled filter hits
    // If no filters are on, nothing matches (return informational results only)
    const isMatch = anyFilterOn && (isTextMatch || isQtyMatch || isExchangeMatch);

    if (isMatch) {
      matchedPageNumbers.push(pageNumber);
      logger.info(
        `Page ${pageNumber}: MATCH — text=${isTextMatch}, qty=${isQtyMatch}, exchange=${isExchangeMatch}`
      );
    } else {
      logger.debug(
        `Page ${pageNumber}: no match — text=${isTextMatch}, qty=${isQtyMatch}, exchange=${isExchangeMatch}`
      );
    }

    const record = {
      pageNumber,
      customerAddress: parsed.customerAddress,
      billTo: parsed.billTo,
      qty: parsed.qty,
      isTextMatch,
      isQtyMatch,
      isExchangeMatch,
      isMatch,
    };

    if (!onlyMatched || isMatch) {
      results.push(record);
    }
  }

  return {
    totalPages: pageTexts.length,
    matchedPages: matchedPageNumbers.length,
    matchedPageNumbers,
    filtersApplied: { text: textEnabled, qty: qtyEnabled, exchange: exchangeEnabled },
    results,
  };
}

module.exports = { processPages };
