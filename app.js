const express = require('express');
const path = require('path');
const fs = require('fs');
const upload = require('./src/middleware/upload');
const {
  uploadAndProcess,
  generateFromCache,
  downloadFilteredPdf,
  getCustomerHistoryRoute,
  cleanupOldCacheFiles,
} = require('./src/controllers/pdfController');
const { cleanupOldOutputFiles } = require('./src/services/pdfGeneratorService');
const { getOrdersByDate, getAllOrders, lookupOrder, recordScanEvent } = require('./src/services/customerHistoryService');
const logger = require('./src/utils/logger');

// ─── Mock admin data ──────────────────────────────────────────────────────────

const MOCK_USERS = [
  { id: 1,  name: 'Priya Sharma',    email: 'priya.sharma@gmail.com',       plan: 'professional', joined: '2024-12-01', lastActive: '2025-05-23', uploads: 156,  status: 'active' },
  { id: 2,  name: 'Rahul Gupta',     email: 'rahul.gupta@outlook.com',      plan: 'free',         joined: '2025-01-10', lastActive: '2025-05-20', uploads: 12,   status: 'active' },
  { id: 3,  name: 'Anjali Singh',    email: 'anjali.singh@yahoo.com',       plan: 'business',     joined: '2024-11-15', lastActive: '2025-05-22', uploads: 421,  status: 'active' },
  { id: 4,  name: 'Vikram Patel',    email: 'vikram.patel@company.com',     plan: 'professional', joined: '2025-02-01', lastActive: '2025-05-19', uploads: 89,   status: 'active' },
  { id: 5,  name: 'Sneha Reddy',     email: 'sneha.reddy@gmail.com',        plan: 'free',         joined: '2025-03-15', lastActive: '2025-04-30', uploads: 7,    status: 'inactive' },
  { id: 6,  name: 'Arjun Kumar',     email: 'arjun.kumar@business.in',      plan: 'business',     joined: '2024-10-20', lastActive: '2025-05-23', uploads: 892,  status: 'active' },
  { id: 7,  name: 'Meera Nair',      email: 'meera.nair@gmail.com',         plan: 'professional', joined: '2025-01-25', lastActive: '2025-05-21', uploads: 234,  status: 'active' },
  { id: 8,  name: 'Suresh Iyer',     email: 'suresh.iyer@email.com',        plan: 'free',         joined: '2025-04-01', lastActive: '2025-05-15', uploads: 4,    status: 'active' },
  { id: 9,  name: 'Kavita Joshi',    email: 'kavita.joshi@firm.com',        plan: 'business',     joined: '2024-09-10', lastActive: '2025-05-23', uploads: 1203, status: 'active' },
  { id: 10, name: 'Rohan Mehta',     email: 'rohan.mehta@startup.io',       plan: 'professional', joined: '2025-02-28', lastActive: '2025-05-18', uploads: 67,   status: 'active' },
  { id: 11, name: 'Pooja Verma',     email: 'pooja.verma@gmail.com',        plan: 'free',         joined: '2025-05-01', lastActive: '2025-05-10', uploads: 2,    status: 'active' },
  { id: 12, name: 'Aditya Bansal',   email: 'aditya.bansal@trader.com',     plan: 'professional', joined: '2024-12-20', lastActive: '2025-05-22', uploads: 445,  status: 'active' },
  { id: 13, name: 'Nisha Kapoor',    email: 'nisha.kapoor@shop.in',         plan: 'free',         joined: '2025-04-18', lastActive: '2025-05-05', uploads: 3,    status: 'inactive' },
  { id: 14, name: 'Deepak Mishra',   email: 'deepak.mishra@logistics.com',  plan: 'business',     joined: '2024-08-05', lastActive: '2025-05-24', uploads: 2187, status: 'active' },
  { id: 15, name: 'Swati Rao',       email: 'swati.rao@gmail.com',          plan: 'professional', joined: '2025-03-10', lastActive: '2025-05-20', uploads: 78,   status: 'active' },
];

const MOCK_PAYMENTS = [
  { id: 'TXN2505240001', user: 'Kavita Joshi',  email: 'kavita.joshi@firm.com',       plan: 'business',     amount: 2999, date: '2025-05-24', status: 'success' },
  { id: 'TXN2505230001', user: 'Priya Sharma',  email: 'priya.sharma@gmail.com',      plan: 'professional', amount: 999,  date: '2025-05-23', status: 'success' },
  { id: 'TXN2505220001', user: 'Meera Nair',    email: 'meera.nair@gmail.com',        plan: 'professional', amount: 999,  date: '2025-05-22', status: 'success' },
  { id: 'TXN2505210001', user: 'Arjun Kumar',   email: 'arjun.kumar@business.in',     plan: 'business',     amount: 2999, date: '2025-05-21', status: 'success' },
  { id: 'TXN2505200001', user: 'Vikram Patel',  email: 'vikram.patel@company.com',    plan: 'professional', amount: 999,  date: '2025-05-20', status: 'success' },
  { id: 'TXN2505190001', user: 'Swati Rao',     email: 'swati.rao@gmail.com',         plan: 'professional', amount: 999,  date: '2025-05-19', status: 'success' },
  { id: 'TXN2505180001', user: 'Rohan Mehta',   email: 'rohan.mehta@startup.io',      plan: 'professional', amount: 999,  date: '2025-05-18', status: 'success' },
  { id: 'TXN2505170001', user: 'Unknown User',  email: 'test@example.com',            plan: 'professional', amount: 999,  date: '2025-05-17', status: 'failed' },
  { id: 'TXN2505150001', user: 'Aditya Bansal', email: 'aditya.bansal@trader.com',    plan: 'professional', amount: 999,  date: '2025-05-15', status: 'success' },
  { id: 'TXN2505100001', user: 'Anjali Singh',  email: 'anjali.singh@yahoo.com',      plan: 'business',     amount: 2999, date: '2025-05-10', status: 'success' },
  { id: 'TXN2505050001', user: 'Deepak Mishra', email: 'deepak.mishra@logistics.com', plan: 'business',     amount: 2999, date: '2025-05-05', status: 'success' },
  { id: 'TXN2505020001', user: 'Kavita Joshi',  email: 'kavita.joshi@firm.com',       plan: 'business',     amount: 2999, date: '2025-05-02', status: 'success' },
  { id: 'TXN2504250001', user: 'Priya Sharma',  email: 'priya.sharma@gmail.com',      plan: 'professional', amount: 999,  date: '2025-04-25', status: 'success' },
  { id: 'TXN2504200001', user: 'Arjun Kumar',   email: 'arjun.kumar@business.in',     plan: 'business',     amount: 2999, date: '2025-04-20', status: 'success' },
  { id: 'TXN2504150001', user: 'Meera Nair',    email: 'meera.nair@gmail.com',        plan: 'professional', amount: 999,  date: '2025-04-15', status: 'success' },
];

// Ensure log directory exists before logger writes to it
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// Request logger
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.originalUrl}`);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// ─── Page routes ──────────────────────────────────────────────────────────────

app.get('/plans',     (_req, res) => res.sendFile(path.join(__dirname, 'public', 'plans.html')));
app.get('/admin',     (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/dashboard', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// ─── Admin API ────────────────────────────────────────────────────────────────

app.get('/api/admin/stats', (_req, res) => {
  const planDist = {
    free:         MOCK_USERS.filter(u => u.plan === 'free').length,
    professional: MOCK_USERS.filter(u => u.plan === 'professional').length,
    business:     MOCK_USERS.filter(u => u.plan === 'business').length,
  };
  const successPayments = MOCK_PAYMENTS.filter(p => p.status === 'success');
  const monthlyRevenue  = successPayments
    .filter(p => p.date.startsWith('2025-05'))
    .reduce((s, p) => s + p.amount, 0);

  res.json({
    totalUsers:           MOCK_USERS.length,
    newUsersThisMonth:    MOCK_USERS.filter(u => u.joined.startsWith('2025-05')).length,
    activeSubscriptions:  MOCK_USERS.filter(u => u.status === 'active' && u.plan !== 'free').length,
    monthlyRevenue,
    revenueGrowth:        18,
    totalUploads:         MOCK_USERS.reduce((s, u) => s + u.uploads, 0),
    monthlyUploads:       312,
    planDistribution:     planDist,
  });
});

app.get('/api/admin/users',    (_req, res) => res.json(MOCK_USERS));
app.get('/api/admin/payments', (_req, res) => res.json(MOCK_PAYMENTS));

// ─── Orders API ───────────────────────────────────────────────────────────────

// GET /api/orders?date=YYYY-MM-DD  → orders for a specific date (default: today)
// GET /api/orders?all=true         → all stored orders
app.get('/api/orders', (req, res) => {
  try {
    if (req.query.all === 'true') {
      return res.json(getAllOrders());
    }
    const date = req.query.date || new Date().toISOString().split('T')[0];
    return res.json(getOrdersByDate(date));
  } catch (err) {
    logger.error(`Orders API error: ${err.message}`);
    return res.status(500).json({ error: 'Unable to load orders.' });
  }
});

// ─── Order lookup & scan-event endpoints (used by meesho-scan integration) ───

// GET /api/orders/lookup?orderNo=XXX
// Returns { found: true, order: {...} } or { found: false }
app.get('/api/orders/lookup', (req, res) => {
  const { orderNo } = req.query;
  if (!orderNo || typeof orderNo !== 'string' || orderNo.length > 64) {
    return res.status(400).json({ error: 'orderNo is required.' });
  }
  const result = lookupOrder(orderNo.trim());
  if (!result) return res.json({ found: false });
  return res.json({ found: true, order: result });
});

// POST /api/orders/scan-event
// Body: { orderNo, awb, scanStatus, claimStatus, claimId, claimType, packetState, claimWindowDays, scannedAt }
// Called by meesho-scan when a claim is filed against an order that was found in a PDF.
app.post('/api/orders/scan-event', (req, res) => {
  const { orderNo, awb, scanStatus, claimStatus, claimId, claimType, packetState, claimWindowDays, scannedAt } = req.body || {};
  if (!orderNo || !awb) {
    return res.status(400).json({ error: 'orderNo and awb are required.' });
  }
  const ok = recordScanEvent(String(orderNo), {
    awb:             String(awb),
    scanStatus:      scanStatus  || 'scanned',
    claimStatus:     claimStatus || null,
    claimId:         claimId     || null,
    claimType:       claimType   || null,
    packetState:     packetState || null,
    claimWindowDays: claimWindowDays != null ? Number(claimWindowDays) : null,
    scannedAt:       scannedAt   || new Date().toISOString(),
  });
  if (!ok) return res.status(404).json({ error: 'Order not found in PDF records.' });
  return res.json({ ok: true });
});

// ─── Generate PDF from cache (no re-upload needed) ───────────────────────────

app.post('/generate-pdf', generateFromCache);

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Upload and process PDF
// Query params:
//   onlyMatched=true  → results contains only matched pages
//   generatePdf=true  → also produce downloadable filtered PDF
//   downloadMode=keyword|qty|exchange|unmatched
//       → selects which pages are included in the generated PDF
app.post('/upload', upload.single('file'), uploadAndProcess);

// Download generated filtered PDF (one-time)
app.get('/download/:filename', downloadFilteredPdf);

// Customer history dashboard data
app.get('/customer-history', getCustomerHistoryRoute);

// ─── Error Handlers ───────────────────────────────────────────────────────────

// Multer file validation errors
app.use((err, req, res, _next) => {
  if (err && err.message === 'Only PDF files are accepted') {
    return res.status(415).json({ error: err.message });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Maximum allowed size is 50 MB.' });
  }

  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  return res.status(500).json({ error: 'Unexpected server error', details: err.message });
});

// 404 fallback — serve index.html for unknown GET routes so the UI is reachable
app.use((req, res) => {
  if (req.method === 'GET') {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.status(404).json({ error: 'Route not found.' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  logger.info(`PDF processing server running on port ${PORT}`);
  logger.info(`Health: http://localhost:${PORT}/health`);
  logger.info(`Upload: POST http://localhost:${PORT}/upload`);

  // Clean up stale output and cache files from a previous run
  cleanupOldOutputFiles();
  cleanupOldCacheFiles();
  // Also run cleanup every hour
  setInterval(() => { cleanupOldOutputFiles(); cleanupOldCacheFiles(); }, 60 * 60 * 1000);
});

module.exports = app;
