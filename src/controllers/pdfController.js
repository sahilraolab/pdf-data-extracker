const fs = require('fs');
const path = require('path');
const { extractPages } = require('../services/pdfParserService');
const { processPages } = require('../services/filterService');
const { generateFilteredPdf, deleteOutputFile } = require('../services/pdfGeneratorService');
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

    const onlyMatched = req.query.onlyMatched === 'true';
    const generatePdf = req.query.generatePdf === 'true';

    logger.info(`Processing file: ${req.file.originalname} (${req.file.size} bytes)`);

    // Step 1: Extract per-page text
    const pageTexts = await extractPages(uploadedFilePath);

    if (pageTexts.length === 0) {
      return res.status(422).json({ error: 'Could not extract any text from the uploaded PDF.' });
    }

    // Step 2: Parse and filter pages
    const { totalPages, matchedPages, matchedPageNumbers, results } = processPages(pageTexts, onlyMatched);

    // Step 3: Optionally generate filtered PDF
    let downloadUrl = null;

    if (generatePdf && matchedPageNumbers.length > 0) {
      const { filename } = await generateFilteredPdf(uploadedFilePath, matchedPageNumbers);
      // Build absolute URL from request
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      downloadUrl = `${baseUrl}/download/${filename}`;
    }

    const response = {
      totalPages,
      matchedPages,
      results,
    };

    if (downloadUrl) {
      response.downloadUrl = downloadUrl;
    }

    if (matchedPages === 0) {
      response.message = 'No pages matched the filter criteria (Delhi address + qty > 1).';
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
 * Deletes the file after sending (one-time download).
 */
async function downloadFilteredPdf(req, res) {
  const { filename } = req.params;

  // Sanitize: prevent path traversal
  const safeName = path.basename(filename);
  if (safeName !== filename || !filename.endsWith('.pdf')) {
    return res.status(400).json({ error: 'Invalid filename.' });
  }

  const filePath = path.join(__dirname, '../../output', safeName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found or already downloaded.' });
  }

  try {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);

    const readStream = fs.createReadStream(filePath);
    readStream.on('error', err => {
      logger.error(`Stream error for ${safeName}: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming file.' });
      }
    });

    readStream.on('close', () => {
      deleteOutputFile(safeName);
    });

    readStream.pipe(res);
  } catch (err) {
    logger.error(`Download error: ${err.message}`);
    return res.status(500).json({ error: 'Could not serve file.' });
  }
}

module.exports = { uploadAndProcess, downloadFilteredPdf };
