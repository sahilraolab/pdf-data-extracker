const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const historyDir = path.join(__dirname, '../../data');
const historyPath = path.join(historyDir, 'customer-history.json');

function ensureHistoryFile() {
  if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir, { recursive: true });
  }
  if (!fs.existsSync(historyPath)) {
    fs.writeFileSync(historyPath, JSON.stringify({ customers: {} }, null, 2), 'utf8');
  }
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstLine(value) {
  if (!value || typeof value !== 'string') return '';
  return value.split(/\r?\n/).find(line => line.trim().length > 0) || value.trim();
}

function loadHistory() {
  try {
    ensureHistoryFile();
    const raw = fs.readFileSync(historyPath, 'utf8');
    const data = raw ? JSON.parse(raw) : { customers: {} };
    return data.customers || {};
  } catch (err) {
    logger.error(`Could not load customer history: ${err.message}`);
    return {};
  }
}

function saveHistory(customers) {
  try {
    ensureHistoryFile();
    fs.writeFileSync(historyPath, JSON.stringify({ customers }, null, 2), 'utf8');
  } catch (err) {
    logger.error(`Could not save customer history: ${err.message}`);
  }
}

function deriveCustomerKey(page) {
  const source = page.customerAddress || page.billTo || '';
  if (!source.trim()) return '';
  return normalizeKey(firstLine(source));
}

function buildCustomerHistorySummary(customersMap) {
  return {
    totalCustomers: Object.keys(customersMap).length,
    customers: Object.values(customersMap).sort((a, b) => a.customerName.localeCompare(b.customerName)),
  };
}

function annotateAndPersistHistory(results) {
  const existingCustomers = loadHistory();
  const updatedCustomers = { ...existingCustomers };

  for (const page of results) {
    const customerKey = deriveCustomerKey(page);
    page.customerKey = customerKey;
    page.knownCustomer = false;
    page.knownCustomerAddress = false;
    page.knownBillTo = false;

    if (!customerKey) {
      continue;
    }

    const existing = existingCustomers[customerKey];
    if (existing) {
      page.knownCustomer = true;
      page.knownCustomerAddress = Boolean(existing.customerAddress && existing.customerAddress.trim());
      page.knownBillTo = Boolean(existing.billTo && existing.billTo.trim());
    }

    const hasAddress = Boolean(page.customerAddress && page.customerAddress.trim());
    const hasBillTo = Boolean(page.billTo && page.billTo.trim());
    const customerName = firstLine(page.customerAddress || page.billTo || '');

    if (!existing && (hasAddress || hasBillTo)) {
      updatedCustomers[customerKey] = {
        customerKey,
        customerName,
        customerAddress: page.customerAddress || '',
        billTo: page.billTo || '',
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        sourceCount: 1,
      };
    } else if (existing) {
      let updated = false;
      if (!existing.customerAddress && hasAddress) {
        existing.customerAddress = page.customerAddress;
        updated = true;
      }
      if (!existing.billTo && hasBillTo) {
        existing.billTo = page.billTo;
        updated = true;
      }
      if (updated) {
        existing.lastSeenAt = new Date().toISOString();
      }
      existing.sourceCount = (existing.sourceCount || 1) + 1;
      updatedCustomers[customerKey] = existing;
    }
  }

  saveHistory(updatedCustomers);
  return buildCustomerHistorySummary(updatedCustomers);
}

function getCustomerHistory() {
  const customers = loadHistory();
  return buildCustomerHistorySummary(customers);
}

module.exports = { annotateAndPersistHistory, getCustomerHistory };
