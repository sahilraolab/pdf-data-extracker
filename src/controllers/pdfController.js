const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { extractPages }                             = require('../services/pdfParserService');
const { processPages }                             = require('../services/filterService');
const { generateFilteredPdf }                      = require('../services/pdfGeneratorService');
const { annotateAndPersistHistory, getCustomerHistory } = require('../services/customerHistoryService');
const { saveBatch } = require('../services/batchService');
const logger = require('../utils/logger');

// ─── Upload cache ──────────────────────────────────────────────────────────────
// After analysis the original upload is deleted, but we keep a copy here so the
// user can generate any of the 4 download PDFs without re-uploading the file.
// Files expire after 1 hour (cleaned up by the periodic job in app.js).

const CACHE_DIR = path.join(__dirname, '../../uploads/cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function cacheUploadedFile(sourcePath) {
  const uploadId  = uuidv4();
  const destPath  = path.join(CACHE_DIR, `${uploadId}.pdf`);
  fs.copyFileSync(sourcePath, destPath);
  return uploadId;
}

// ─── POST /upload ──────────────────────────────────────────────────────────────

async function uploadAndProcess(req, res) {
  const uploadedFilePath = req.file ? req.file.path : null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Please send a PDF as multipart/form-data with field name "file".' });
    }

    const filterText     = (req.body.filterText     || '').trim();
    const qtyFilter      = req.body.qtyFilter      === 'true';
    const exchangeFilter = req.body.exchangeFilter === 'true';

    logger.info(`Processing: ${req.file.originalname} | text="${filterText}" qty=${qtyFilter} exchange=${exchangeFilter}`);

    const pageTexts = await extractPages(uploadedFilePath);
    if (pageTexts.length === 0) {
      return res.status(422).json({ error: 'Could not extract any text from the uploaded PDF.' });
    }

    const {
      totalPages,
      matchedPages,
      matchedPageNumbers,
      keywordPageNumbers,
      qtyPageNumbers,
      exchangePageNumbers,
      unmatchedPageNumbers,
      filtersApplied,
      results,
    } = processPages(pageTexts, { filterText, qtyFilter, exchangeFilter });

    annotateAndPersistHistory(results);

    // Derive unique delivery partners from results
    const deliveryPartners = [...new Set(
      results.map(r => r.deliveryPartner).filter(Boolean)
    )].sort();

    // Save dated batch for barcode scan workflow
    const { batchId, savedAt: batchSavedAt } = saveBatch({
      filename:         req.file.originalname,
      results,
      deliveryPartners,
    });

    // Cache file so download buttons work without re-uploading
    const uploadId = cacheUploadedFile(uploadedFilePath);

    const response = {
      totalPages,
      matchedPages,
      filtersApplied,
      results,
      uploadId,
      batchId,
      batchSavedAt,
      deliveryPartners,
      downloadBuckets: {
        keyword:   keywordPageNumbers,
        qty:       qtyPageNumbers,
        exchange:  exchangePageNumbers,
        unmatched: unmatchedPageNumbers,
      },
    };

    if (matchedPages === 0) {
      response.message = 'No pages matched any of the enabled filters.';
    }

    return res.status(200).json(response);

  } catch (err) {
    logger.error(`Processing error: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  } finally {
    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
      try { fs.unlinkSync(uploadedFilePath); } catch (_) {}
    }
  }
}

// ─── POST /generate-pdf ────────────────────────────────────────────────────────
// Generates a filtered PDF from a previously cached upload without re-uploading.

async function generateFromCache(req, res) {
  const { uploadId, mode, pageNumbers } = req.body;

  if (!uploadId || typeof uploadId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid uploadId.' });
  }
  // Strict UUID-v4 check prevents path traversal
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) {
    return res.status(400).json({ error: 'Invalid uploadId format.' });
  }
  if (!Array.isArray(pageNumbers) || pageNumbers.length === 0) {
    return res.status(400).json({ error: 'pageNumbers must be a non-empty array.' });
  }

  const cachedPath = path.join(CACHE_DIR, `${uploadId}.pdf`);
  if (!fs.existsSync(cachedPath)) {
    return res.status(410).json({ error: 'Session expired. Please re-upload the PDF and analyse again.' });
  }

  try {
    const { filename } = await generateFilteredPdf(cachedPath, pageNumbers);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return res.json({
      downloadUrl: `${baseUrl}/download/${filename}`,
      pageCount: pageNumbers.length,
      mode: mode || 'custom',
    });
  } catch (err) {
    logger.error(`generateFromCache error: ${err.message}`);
    return res.status(500).json({ error: 'Could not generate PDF.', details: err.message });
  }
}

// ─── GET /download/:filename ───────────────────────────────────────────────────

async function downloadFilteredPdf(req, res) {
  const { filename } = req.params;
  const safeName = path.basename(filename);
  if (safeName !== filename || !filename.endsWith('.pdf')) {
    return res.status(400).json({ error: 'Invalid filename.' });
  }

  const filePath = path.join(__dirname, '../../output', safeName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found. It may have expired (files are kept for 1 hour).' });
  }

  try {
    const stat = fs.statSync(filePath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="filtered-invoices.pdf"`);
    res.setHeader('Content-Length', stat.size);
    const stream = fs.createReadStream(filePath);
    stream.on('error', err => {
      logger.error(`Stream error for ${safeName}: ${err.message}`);
      if (!res.headersSent) res.status(500).json({ error: 'Error streaming file.' });
    });
    stream.pipe(res);
  } catch (err) {
    logger.error(`Download error: ${err.message}`);
    return res.status(500).json({ error: 'Could not serve file.' });
  }
}

// ─── GET /customer-history ─────────────────────────────────────────────────────

async function getCustomerHistoryRoute(_req, res) {
  try {
    return res.status(200).json(getCustomerHistory());
  } catch (err) {
    logger.error(`Customer history error: ${err.message}`);
    return res.status(500).json({ error: 'Unable to load customer history.' });
  }
}

// ─── Cache cleanup (called by app.js on schedule) ─────────────────────────────

function cleanupOldCacheFiles(maxAgeMs = 60 * 60 * 1000) {
  try {
    const now = Date.now();
    for (const file of fs.readdirSync(CACHE_DIR)) {
      const fp   = path.join(CACHE_DIR, file);
      const stat = fs.statSync(fp);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(fp);
        logger.info(`Auto-cleaned cache file: ${file}`);
      }
    }
  } catch (err) {
    logger.warn(`Cache cleanup error: ${err.message}`);
  }
}

module.exports = {
  uploadAndProcess,
  generateFromCache,
  downloadFilteredPdf,
  getCustomerHistoryRoute,
  cleanupOldCacheFiles,
};
