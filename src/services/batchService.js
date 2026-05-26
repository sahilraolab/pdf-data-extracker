const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const DATA_DIR   = path.join(__dirname, '../../data');
const STORE_PATH = path.join(DATA_DIR, 'scan-batches.json');

// ── File I/O ──────────────────────────────────────────────────────────────────

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ batches: [] }, null, 2), 'utf8');
  }
}

function loadStore() {
  try {
    ensureStore();
    const raw  = fs.readFileSync(STORE_PATH, 'utf8');
    const data = raw ? JSON.parse(raw) : {};
    return { batches: Array.isArray(data.batches) ? data.batches : [] };
  } catch (err) {
    logger.error(`batchService loadStore: ${err.message}`);
    return { batches: [] };
  }
}

function saveStore(store) {
  try {
    ensureStore();
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    logger.error(`batchService saveStore: ${err.message}`);
  }
}

// ── Save a new batch after PDF upload ────────────────────────────────────────

/**
 * Creates a new scan batch from the analysed PDF results.
 * Each order in the batch gets packedStatus=0 (unpacked) initially.
 *
 * @param {object} opts
 * @param {string}   opts.filename         - Original PDF filename
 * @param {object[]} opts.results          - Array of page result objects from filterService
 * @param {string[]} opts.deliveryPartners - Unique delivery partners found in the PDF
 * @returns {{ batchId: string, savedAt: string }}
 */
function saveBatch({ filename, results, deliveryPartners }) {
  const store   = loadStore();
  const batchId = uuidv4();
  const savedAt = new Date().toISOString();
  const dateKey = savedAt.split('T')[0]; // YYYY-MM-DD

  const orders = results.map(r => ({
    pageNumber:      r.pageNumber,
    orderNo:         r.orderNo         || '',
    awb:             r.awb             || '',
    sku:             r.sku             || '',
    deliveryPartner: r.deliveryPartner || '',
    customerName:    firstLine(r.customerAddress || r.billTo || ''),
    customerAddress: r.customerAddress || '',
    billTo:          r.billTo          || '',
    qty:             r.qty             || 1,
    isExchange:      Boolean(r.isExchangeMatch),
    packedStatus:    0,   // 0 = unpacked, 1 = packed/ready to ship
    packedAt:        null,
  }));

  store.batches.push({
    batchId,
    filename:         filename || 'unknown.pdf',
    savedAt,
    dateKey,
    totalPages:       results.length,
    deliveryPartners: deliveryPartners || [],
    orders,
  });

  saveStore(store);
  logger.info(`Batch saved: ${batchId} (${results.length} orders, ${filename})`);
  return { batchId, savedAt };
}

// ── Mark an order as packed ───────────────────────────────────────────────────

/**
 * Looks up an order by AWB number or order number across all batches from today,
 * marks it as packed (status 1), and returns the result.
 *
 * @param {string} code - AWB number or order number from barcode scan
 * @returns {{ batchId, order, alreadyPacked } | null}
 */
function markPacked(code) {
  if (!code) return null;
  const store   = loadStore();
  const today   = new Date().toISOString().split('T')[0];

  // Search today's batches first, then fall back to all batches
  const ordered = [
    ...store.batches.filter(b => b.dateKey === today).reverse(),
    ...store.batches.filter(b => b.dateKey !== today).reverse(),
  ];

  for (const batch of ordered) {
    const order = batch.orders.find(
      o => (o.awb && o.awb.toLowerCase() === code.toLowerCase()) ||
           (o.orderNo && o.orderNo === code)
    );
    if (order) {
      const alreadyPacked = order.packedStatus === 1;
      order.packedStatus  = 1;
      order.packedAt      = new Date().toISOString();
      saveStore(store);
      return { batchId: batch.batchId, order: { ...order }, alreadyPacked };
    }
  }

  return null;
}

// ── Query helpers ─────────────────────────────────────────────────────────────

/**
 * Returns stats for a given date (default today).
 *
 * @param {string} date - YYYY-MM-DD
 */
function getScanStats(date) {
  const d     = date || new Date().toISOString().split('T')[0];
  const store = loadStore();
  const batches = store.batches.filter(b => b.dateKey === d);

  let total = 0, packed = 0;
  const byPartner = {};

  for (const batch of batches) {
    for (const order of batch.orders) {
      total++;
      if (order.packedStatus === 1) packed++;
      const p = order.deliveryPartner || 'Unknown';
      if (!byPartner[p]) byPartner[p] = { total: 0, packed: 0 };
      byPartner[p].total++;
      if (order.packedStatus === 1) byPartner[p].packed++;
    }
  }

  return {
    date:     d,
    batches:  batches.length,
    total,
    packed,
    unpacked: total - packed,
    byPartner,
  };
}

/**
 * Lists batches for a given date, newest first. Omits full order arrays to keep response small.
 *
 * @param {string} date - YYYY-MM-DD
 */
function listBatches(date) {
  const d     = date || new Date().toISOString().split('T')[0];
  const store = loadStore();
  return store.batches
    .filter(b => b.dateKey === d)
    .map(b => ({
      batchId:          b.batchId,
      filename:         b.filename,
      savedAt:          b.savedAt,
      totalPages:       b.totalPages,
      deliveryPartners: b.deliveryPartners,
      packed:           b.orders.filter(o => o.packedStatus === 1).length,
      total:            b.orders.length,
    }))
    .reverse();
}

/**
 * Returns a full batch by ID.
 *
 * @param {string} batchId
 */
function getBatch(batchId) {
  const store = loadStore();
  return store.batches.find(b => b.batchId === batchId) || null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function firstLine(s) {
  if (!s || typeof s !== 'string') return '';
  return s.split(/\r?\n/).find(l => l.trim().length > 0) || s.trim();
}

module.exports = { saveBatch, markPacked, getScanStats, listBatches, getBatch };
