const fs = require('fs');
const path = require('path');
const { extractPages } = require('../services/pdfParserService');
const { processPages } = require('../services/filterService');
const { generateFilteredPdf } = require('../services/pdfGeneratorService');
const logger = require('../utils/logger');

/**
 * POST /upload
 *
 * Accepts a PDF, parses all pages, applies filtering logic, optionally generates
 * a filtered PDF, and returns the structured result.
 *
 * Query params:
 *   - onlyMatched=true   → results array contains only matched pages
 *   - generatePdf=true   → also produce a downloadable filtered PDF
 */
async function uploadAndProcess(req, res) {
  const uploadedFilePath = req.file ? req.file.path : null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Please send a PDF as multipart/form-data with field name "file".' });
    }

    const onlyMatched    = req.query.onlyMatched === 'true';
    const generatePdf    = req.query.generatePdf === 'true';

    // Three independent filters — all come from multipart form fields
    const filterText     = (req.body.filterText     || '').trim();
    const qtyFilter      = req.body.qtyFilter      === 'true';
    const exchangeFilter = req.body.exchangeFilter === 'true';

    logger.info(
      `Processing: ${req.file.originalname} | filters — text="${filterText}" qty=${qtyFilter} exchange=${exchangeFilter}`
    );

    // Step 1: Extract per-page text
    const pageTexts = await extractPages(uploadedFilePath);

    if (pageTexts.length === 0) {
      return res.status(422).json({ error: 'Could not extract any text from the uploaded PDF.' });
    }

    // Step 2: Evaluate all three filters independently
    const { totalPages, matchedPages, matchedPageNumbers, filtersApplied, results } =
      processPages(pageTexts, { filterText, qtyFilter, exchangeFilter, onlyMatched });

    // Step 3: Optionally generate filtered PDF from matched pages
    let downloadUrl = null;

    if (generatePdf && matchedPageNumbers.length > 0) {
      const { filename } = await generateFilteredPdf(uploadedFilePath, matchedPageNumbers);
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      downloadUrl = `${baseUrl}/download/${filename}`;
    }

    const response = {
      totalPages,
      matchedPages,
      filtersApplied,
      results,
    };

    if (downloadUrl) {
      response.downloadUrl = downloadUrl;
    }

    if (matchedPages === 0) {
      response.message = 'No pages matched any of the enabled filters.';
    }

    return res.status(200).json(response);

  } catch (err) {
    logger.error(`Processing error: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  } finally {
    // Clean up uploaded temp file regardless of outcome
    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
      try {
        fs.unlinkSync(uploadedFilePath);
        logger.debug(`Cleaned up upload: ${uploadedFilePath}`);
      } catch (cleanupErr) {
        logger.warn(`Could not clean up upload file: ${cleanupErr.message}`);
      }
    }
  }
}

/**
 * GET /download/:filename
 *
 * Serves a generated filtered PDF file for download.
 * File persists for 1 hour (cleaned up by server startup job), so the
 * user can re-download without re-uploading.
 */
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

    const readStream = fs.createReadStream(filePath);
    readStream.on('error', err => {
      logger.error(`Stream error for ${safeName}: ${err.message}`);
      if (!res.headersSent) res.status(500).json({ error: 'Error streaming file.' });
    });
    readStream.pipe(res);
  } catch (err) {
    logger.error(`Download error: ${err.message}`);
    return res.status(500).json({ error: 'Could not serve file.' });
  }
}

module.exports = { uploadAndProcess, downloadFilteredPdf };
