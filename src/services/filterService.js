const { parsePage } = require('../utils/parsePage');
const { filterPage } = require('../utils/filterPage');
const logger = require('../utils/logger');

/**
 * Processes an array of page texts: parses each, applies filter, builds result set.
 *
 * @param {string[]} pageTexts - Array of raw page text strings
 * @param {boolean} onlyMatched - If true, results array contains only matched pages
 * @returns {{
 *   totalPages: number,
 *   matchedPages: number,
 *   matchedPageNumbers: number[],
 *   results: Array<{
 *     pageNumber: number,
 *     customerAddress: string,
 *     billTo: string,
 *     qty: number,
 *     isMatch: boolean
 *   }>
 * }}
 */
function processPages(pageTexts, onlyMatched = false) {
  if (!Array.isArray(pageTexts) || pageTexts.length === 0) {
    return {
      totalPages: 0,
      matchedPages: 0,
      matchedPageNumbers: [],
      results: [],
    };
  }

  const results = [];
  const matchedPageNumbers = [];

  for (let i = 0; i < pageTexts.length; i++) {
    const pageNumber = i + 1;
    const pageText = pageTexts[i];

    let parsed;
    try {
      parsed = parsePage(pageText, pageNumber);
    } catch (err) {
      logger.error(`Failed to parse page ${pageNumber}: ${err.message}`);
      parsed = { customerAddress: '', billTo: '', productDetails: '', qty: 0 };
    }

    const { isMatch, isDelhiMatch, isQtyMatch } = filterPage(parsed);

    if (isMatch) {
      matchedPageNumbers.push(pageNumber);
      logger.info(`Page ${pageNumber}: MATCH (delhi=true, qty=${parsed.qty}, qtyMatch=${isQtyMatch})`);
    } else {
      logger.debug(`Page ${pageNumber}: NO MATCH (delhi=false, qty=${parsed.qty})`);
    }

    const record = {
      pageNumber,
      customerAddress: parsed.customerAddress,
      billTo: parsed.billTo,
      qty: parsed.qty,
      isDelhiMatch,
      isQtyMatch,
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
    results,
  };
}

module.exports = { processPages };
