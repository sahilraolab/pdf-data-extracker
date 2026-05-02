const express = require('express');
const path = require('path');
const fs = require('fs');
const upload = require('./src/middleware/upload');
const { uploadAndProcess, downloadFilteredPdf } = require('./src/controllers/pdfController');
const { cleanupOldOutputFiles } = require('./src/services/pdfGeneratorService');
const logger = require('./src/utils/logger');

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

  // Clean up any output files left over from a previous run
  cleanupOldOutputFiles();
  // Also run cleanup every hour
  setInterval(cleanupOldOutputFiles, 60 * 60 * 1000);
});

module.exports = app;
