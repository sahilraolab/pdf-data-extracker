'use strict';

require('dotenv').config();

const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const cookieParser = require('cookie-parser');

const upload     = require('./src/middleware/upload');
const { requireAuth, requireAdmin } = require('./src/middleware/authMiddleware');

const authCtrl   = require('./src/controllers/authController');
const adminCtrl  = require('./src/controllers/adminController');
const {
  uploadAndProcess,
  generateFromCache,
  downloadFilteredPdf,
  getCustomerHistoryRoute,
  cleanupOldCacheFiles,
} = require('./src/controllers/pdfController');
const { cleanupOldOutputFiles } = require('./src/services/pdfGeneratorService');
const { getOrdersByDate, getAllOrders } = require('./src/services/customerHistoryService');
const { saveBatch, markPacked, getScanStats, getBatch, listBatches } = require('./src/services/batchService');
const { seedAdmin, incrementUploadCount } = require('./src/services/authService');
const { leads } = require('./src/services/dbService');
const logger = require('./src/utils/logger');

// Ensure logs dir
fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });

const app  = express();
const PORT = process.env.PORT || 3000;
const pub  = p => path.join(__dirname, 'public', p);

// ── Middleware ─────────────────────────────────────────────────────────────────

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Serve public folder for assets (CSS/images/fonts) but NOT HTML via static
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use((req, _res, next) => { logger.info(`${req.method} ${req.originalUrl}`); next(); });

// ── Public page routes ─────────────────────────────────────────────────────────

app.get('/',         (_req, res) => res.sendFile(pub('home.html')));
app.get('/home',     (_req, res) => res.sendFile(pub('home.html')));
app.get('/login',    (_req, res) => res.sendFile(pub('login.html')));
app.get('/about',    (_req, res) => res.sendFile(pub('about.html')));
app.get('/privacy',  (_req, res) => res.sendFile(pub('privacy.html')));
app.get('/terms',    (_req, res) => res.sendFile(pub('terms.html')));
app.get('/contact',  (_req, res) => res.sendFile(pub('contact.html')));
app.get('/plans',    (_req, res) => res.redirect(301, '/contact'));

// ── Protected page routes ──────────────────────────────────────────────────────

app.get('/tool',      requireAuth, (_req, res) => res.sendFile(pub('index.html')));
app.get('/scan',      requireAuth, (_req, res) => res.sendFile(pub('scan.html')));
app.get('/dashboard', requireAuth, (_req, res) => res.sendFile(pub('dashboard.html')));
app.get('/admin',     requireAuth, requireAdmin, (_req, res) => res.sendFile(pub('admin.html')));

// ── Auth API ───────────────────────────────────────────────────────────────────

app.post('/api/auth/login',            authCtrl.postLogin);
app.post('/api/auth/logout',           requireAuth, authCtrl.postLogout);
app.get ('/api/auth/me',               requireAuth, authCtrl.getMe);
app.post('/api/auth/impersonate/:userId', requireAuth, requireAdmin, authCtrl.postImpersonate);
app.post('/api/auth/exit-impersonate', requireAuth, authCtrl.postExitImpersonate);

// ── Admin API ──────────────────────────────────────────────────────────────────

app.get   ('/api/admin/stats',          requireAuth, requireAdmin, adminCtrl.getStats);
app.get   ('/api/admin/users',          requireAuth, requireAdmin, adminCtrl.getUsers);
app.post  ('/api/admin/users',          requireAuth, requireAdmin, adminCtrl.postUser);
app.patch ('/api/admin/users/:id',      requireAuth, requireAdmin, adminCtrl.patchUser);
app.delete('/api/admin/users/:id',      requireAuth, requireAdmin, adminCtrl.deleteUser);
app.post  ('/api/admin/users/:id/toggle',    requireAuth, requireAdmin, adminCtrl.toggleUser);
app.post  ('/api/admin/users/:id/force-logout', requireAuth, requireAdmin, adminCtrl.forceLogout);

// ── Leads API ─────────────────────────────────────────────────────────────────

// Public: anyone can submit a lead from the contact page
app.post('/api/leads', async (req, res) => {
  try {
    const { name, email, biz, message } = req.body || {};
    if (!name?.trim() || !email?.trim() || !message?.trim())
      return res.status(400).json({ error: 'Name, email, and message are required.' });
    if (!email.includes('@'))
      return res.status(400).json({ error: 'Enter a valid email address.' });
    const doc = await leads.insertAsync({
      name:      name.trim(),
      email:     email.trim().toLowerCase(),
      biz:       biz?.trim() || '',
      message:   message.trim(),
      status:    'new',        // new | contacted | closed
      createdAt: new Date().toISOString(),
      notes:     '',
    });
    logger.info(`[LEAD] New lead: ${email.trim()} — ${name.trim()}`);
    res.status(201).json({ ok: true, id: doc._id });
  } catch (err) {
    logger.error(`[LEAD] insert error: ${err.message}`);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Admin: list all leads
app.get('/api/admin/leads', requireAuth, requireAdmin, async (req, res) => {
  try {
    const all = await leads.findAsync({});
    all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(all);
  } catch { res.status(500).json({ error: 'Server error.' }); }
});

// Admin: update lead status or notes
app.patch('/api/admin/leads/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, notes } = req.body || {};
    const $set = {};
    if (status) $set.status = status;
    if (notes  !== undefined) $set.notes = notes;
    await leads.updateAsync({ _id: req.params.id }, { $set }, {});
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error.' }); }
});

// Admin: delete a lead
app.delete('/api/admin/leads/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await leads.removeAsync({ _id: req.params.id }, {});
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error.' }); }
});

// ── Orders API (protected) ────────────────────────────────────────────────────

app.get('/api/orders', requireAuth, (req, res) => {
  try {
    if (req.query.all === 'true') return res.json(getAllOrders());
    const date = req.query.date || new Date().toISOString().split('T')[0];
    return res.json(getOrdersByDate(date));
  } catch (err) {
    logger.error(`Orders API error: ${err.message}`);
    return res.status(500).json({ error: 'Unable to load orders.' });
  }
});

// ── Barcode scan ecosystem (protected) ───────────────────────────────────────

app.get('/api/scan/stats', requireAuth, (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    return res.json(getScanStats(date));
  } catch (err) {
    logger.error(`Scan stats error: ${err.message}`);
    return res.status(500).json({ error: 'Unable to load scan stats.' });
  }
});

app.get('/api/scan/batches', requireAuth, (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    return res.json(listBatches(date));
  } catch (err) {
    logger.error(`List batches error: ${err.message}`);
    return res.status(500).json({ error: 'Unable to list batches.' });
  }
});

app.get('/api/scan/batch/:batchId', requireAuth, (req, res) => {
  try {
    const batch = getBatch(req.params.batchId);
    if (!batch) return res.status(404).json({ error: 'Batch not found.' });
    return res.json(batch);
  } catch (err) {
    logger.error(`Get batch error: ${err.message}`);
    return res.status(500).json({ error: 'Unable to load batch.' });
  }
});

app.post('/api/scan/mark-packed', requireAuth, (req, res) => {
  const { code } = req.body || {};
  if (!code || typeof code !== 'string' || code.trim().length < 3) {
    return res.status(400).json({ error: 'code (AWB or order number) is required.' });
  }
  const result = markPacked(code.trim());
  if (!result) return res.json({ found: false, code: code.trim() });
  return res.json({ found: true, ...result });
});

// ── PDF routes (protected) ────────────────────────────────────────────────────

app.post('/upload', requireAuth, upload.single('file'), async (req, res, next) => {
  // Track upload count for the user
  if (req.sessionUser?._id) incrementUploadCount(req.sessionUser._id).catch(() => {});
  return uploadAndProcess(req, res, next);
});

app.post('/generate-pdf',          requireAuth, generateFromCache);
app.get ('/download/:filename',    requireAuth, downloadFilteredPdf);
app.get ('/customer-history',      requireAuth, getCustomerHistoryRoute);

// ── Health (public) ────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString(), uptime: process.uptime() }));

// ── Error handlers ─────────────────────────────────────────────────────────────

app.use((err, req, res, _next) => {
  if (err?.message === 'Only PDF files are accepted')
    return res.status(415).json({ error: err.message });
  if (err?.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ error: 'File too large. Maximum 50 MB.' });
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  return res.status(500).json({ error: 'Server error', details: err.message });
});

// 404 fallback
app.use((req, res) => {
  if (req.method === 'GET') return res.sendFile(pub('home.html'));
  res.status(404).json({ error: 'Not found.' });
});

// ── Start ──────────────────────────────────────────────────────────────────────

async function start() {
  await seedAdmin();
  app.listen(PORT, () => {
    logger.info(`PDF Suite running on port ${PORT}`);
    cleanupOldOutputFiles();
    cleanupOldCacheFiles();
    setInterval(() => { cleanupOldOutputFiles(); cleanupOldCacheFiles(); }, 60 * 60 * 1000);
  });
}

start().catch(err => { logger.error('Startup failed:', err.message); process.exit(1); });

module.exports = app;
