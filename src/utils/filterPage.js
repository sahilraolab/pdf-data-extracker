/**
 * Determines whether a parsed page matches the filter conditions:
 *
 * Condition 1: customerAddress OR billTo contains "Delhi" (case-insensitive)
 * Condition 2: qty > 1
 *
 * @param {{ customerAddress: string, billTo: string, qty: number }} parsedData
 * @returns {boolean}
 */
function filterPage({ customerAddress, billTo, qty }) {
  const delhiRegex = /delhi/i;

  const hasDelhi =
    delhiRegex.test(customerAddress || '') ||
    delhiRegex.test(billTo || '');

  const hasQtyAboveOne = typeof qty === 'number' && qty > 1;

  return hasDelhi && hasQtyAboveOne;
}

module.exports = { filterPage };
