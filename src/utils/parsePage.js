const { extractSection, extractQty } = require('./extractSection');

/**
 * Parses a single page's raw text and extracts structured fields.
 *
 * @param {string} pageText - Raw text of the page
 * @param {number} pageNumber - 1-based page number (for logging)
 * @returns {{ customerAddress: string, billTo: string, productDetails: string, qty: number }}
 */
function parsePage(pageText, pageNumber) {
  if (!pageText || typeof pageText !== 'string') {
    return {
      customerAddress: '',
      billTo: '',
      productDetails: '',
      qty: 0,
    };
  }

  // Extract "Customer Address" section
  // Ends at "If undelivered" or related variants
  const customerAddress = extractSection(
    pageText,
    ['Customer Address', 'Customer  Address', 'CUSTOMER ADDRESS'],
    ['If undelivered', 'If Un-delivered', 'If  undelivered', 'BILL TO', 'Bill To']
  );

  // Extract "BILL TO / SHIP TO" section
  // Ends at "Sold by" or related variants
  const billTo = extractSection(
    pageText,
    ['BILL TO / SHIP TO', 'BILL TO/SHIP TO', 'Bill To / Ship To', 'BILL TO', 'Bill To'],
    ['Sold by', 'Sold By', 'SOLD BY', 'Product Details', 'PRODUCT DETAILS']
  );

  // Extract "Product Details" section
  // Ends at "TAX INVOICE" or related variants
  const productDetails = extractSection(
    pageText,
    ['Product Details', 'PRODUCT DETAILS', 'Product  Details'],
    ['TAX INVOICE', 'Tax Invoice', 'TAX  INVOICE', 'Grand Total', 'GRAND TOTAL']
  );

  const qty = extractQty(productDetails);

  return {
    customerAddress,
    billTo,
    productDetails,
    qty,
  };
}

module.exports = { parsePage };
