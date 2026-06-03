const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const historyDir = path.join(__dirname, '../../data');

function safeUid(userId) {
  return String(userId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function historyPath(userId) {
  return path.join(historyDir, `customer-history-${safeUid(userId)}.json`);
}

// ─── File I/O ──────────────────────────────────────────────────────────────────

function ensureHistoryFile(userId) {
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
  const p = historyPath(userId);
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, JSON.stringify({ customers: {}, orders: [] }, null, 2), 'utf8');
  }
}

function loadStore(userId) {
  try {
    ensureHistoryFile(userId);
    const raw = fs.readFileSync(historyPath(userId), 'utf8');
    const data = raw ? JSON.parse(raw) : {};
    return {
      customers: data.customers || {},
      orders:    Array.isArray(data.orders) ? data.orders : [],
    };
  } catch (err) {
    logger.error(`Could not load customer history: ${err.message}`);
    return { customers: {}, orders: [] };
  }
}

function saveStore(store, userId) {
  try {
    ensureHistoryFile(userId);
    fs.writeFileSync(historyPath(userId), JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    logger.error(`Could not save customer history: ${err.message}`);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function normalizeKey(value) {
  return String(value || '')
    .trim().toLowerCase()
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstLine(value) {
  if (!value || typeof value !== 'string') return '';
  return value.split(/\r?\n/).find(l => l.trim().length > 0) || value.trim();
}

function deriveCustomerKey(page) {
  const src = page.customerAddress || page.billTo || '';
  if (!src.trim()) return '';
  return normalizeKey(firstLine(src));
}

// ─── Core: annotate results and persist ───────────────────────────────────────

function annotateAndPersistHistory(results, userId) {
  const store = loadStore(userId);
  const { customers, orders } = store;
  const now = new Date().toISOString();

  for (const page of results) {
    const customerKey = deriveCustomerKey(page);
    page.customerKey         = customerKey;
    page.knownCustomer        = false;
    page.knownCustomerAddress = false;
    page.knownBillTo          = false;

    if (!customerKey) continue;

    const existing = customers[customerKey];
    if (existing) {
      page.knownCustomer        = true;
      page.knownCustomerAddress = Boolean(existing.customerAddress?.trim());
      page.knownBillTo          = Boolean(existing.billTo?.trim());
    }

    const hasAddress = Boolean(page.customerAddress?.trim());
    const hasBillTo  = Boolean(page.billTo?.trim());
    const customerName = firstLine(page.customerAddress || page.billTo || '');

    if (!existing && (hasAddress || hasBillTo)) {
      customers[customerKey] = {
        customerKey,
        customerName,
        customerAddress: page.customerAddress || '',
        billTo: page.billTo || '',
        firstSeenAt: now,
        lastSeenAt:  now,
        sourceCount: 1,
        orders: [],
      };
    } else if (existing) {
      if (!existing.customerAddress && hasAddress) existing.customerAddress = page.customerAddress;
      if (!existing.billTo && hasBillTo)           existing.billTo = page.billTo;
      existing.lastSeenAt  = now;
      existing.sourceCount = (existing.sourceCount || 1) + 1;
      if (!Array.isArray(existing.orders)) existing.orders = [];
    }

    // Record the individual order event
    const orderEntry = {
      orderNo:     page.orderNo || '',
      qty:         page.qty || 0,
      isExchange:  Boolean(page.isExchangeMatch),
      processedAt: now,
      pageNumber:  page.pageNumber,
    };

    const cust = customers[customerKey];
    if (cust) {
      const isDuplicate = cust.orders.some(o => {
        if (page.orderNo && o.orderNo) return o.orderNo === page.orderNo;
        if (!page.orderNo && !o.orderNo) return o.pageNumber === page.pageNumber;
        return false;
      });
      if (!isDuplicate) {
        cust.orders.push(orderEntry);
      }
    }

    // Also push to the flat orders log for daily-view queries
    const isDuplicateFlat = orders.some(o => {
      if (page.orderNo && o.orderNo) return o.orderNo === page.orderNo;
      if (!page.orderNo && !o.orderNo) return o.customerKey === customerKey && o.pageNumber === page.pageNumber;
      return false;
    });
    if (!isDuplicateFlat) {
      orders.push({
        orderNo:         page.orderNo || '',
        customerKey,
        customerName:    customers[customerKey]?.customerName || customerName,
        customerAddress: page.customerAddress || '',
        billTo:          page.billTo || '',
        qty:             page.qty || 0,
        isExchange:      Boolean(page.isExchangeMatch),
        isRepeat:        Boolean(existing),
        processedAt:     now,
        pageNumber:      page.pageNumber,
      });
    }
  }

  saveStore({ customers, orders }, userId);
  return buildCustomerHistorySummary(customers);
}

// ─── Query helpers ─────────────────────────────────────────────────────────────

function buildCustomerHistorySummary(customersMap) {
  const list = Object.values(customersMap).map(c => ({
    ...c,
    isRepeat: Array.isArray(c.orders) && c.orders.length > 1,
  }));
  list.sort((a, b) => a.customerName.localeCompare(b.customerName));
  return {
    totalCustomers: list.length,
    customers: list,
  };
}

function getCustomerHistory(userId) {
  const { customers } = loadStore(userId);
  return buildCustomerHistorySummary(customers);
}

function getOrdersByDate(date, userId) {
  const { orders } = loadStore(userId);
  if (!date) return orders.slice().sort((a, b) => new Date(b.processedAt) - new Date(a.processedAt));
  return orders
    .filter(o => o.processedAt && o.processedAt.startsWith(date))
    .sort((a, b) => new Date(b.processedAt) - new Date(a.processedAt));
}

function getAllOrders(userId) {
  const { orders } = loadStore(userId);
  return orders.slice().sort((a, b) => new Date(b.processedAt) - new Date(a.processedAt));
}

module.exports = { annotateAndPersistHistory, getCustomerHistory, getOrdersByDate, getAllOrders };
