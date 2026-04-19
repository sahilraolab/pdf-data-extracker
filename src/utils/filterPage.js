/**
 * Evaluates two independent filter conditions for a parsed page.
 *
 * isDelhiMatch: customerAddress OR billTo contains "Delhi" (case-insensitive)
 * isQtyMatch:   extracted qty > 1
 *
 * These are intentionally separate — a page can satisfy one without the other.
 * isMatch (the primary match flag) is based on Delhi only.
 *
 * @param {{ customerAddress: string, billTo: string, qty: number }} parsedData
 * @returns {{ isMatch: boolean, isDelhiMatch: boolean, isQtyMatch: boolean }}
 */
function filterPage({ customerAddress, billTo, qty }) {
  const isDelhiMatch =
    /delhi/i.test(customerAddress || '') ||
    /delhi/i.test(billTo || '');

  const isQtyMatch = typeof qty === 'number' && qty > 1;

  return {
    isMatch: isDelhiMatch,
    isDelhiMatch,
    isQtyMatch,
  };
}

module.exports = { filterPage };
