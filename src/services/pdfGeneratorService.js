const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const OUTPUT_DIR = path.join(__dirname, '../../output');

// Ensure output directory exists at startup
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Generates a new PDF containing only the specified pages from the source PDF.
 *
 * @param {string} sourcePdfPath - Absolute path to the original PDF
 * @param {number[]} pageNumbers - 1-based page numbers to include
 * @returns {Promise<{ outputPath: string, filename: string }>}
 */
async function generateFilteredPdf(sourcePdfPath, pageNumbers) {
  if (!pageNumbers || pageNumbers.length === 0) {
    throw new Error('No matched pages to generate PDF from');
  }

  if (!fs.existsSync(sourcePdfPath)) {
    throw new Error(`Source PDF not found: ${sourcePdfPath}`);
  }

  const sourceBytes = fs.readFileSync(sourcePdfPath);
  const sourcePdf = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });

  const totalSourcePages = sourcePdf.getPageCount();

  // Validate page numbers against actual page count
  const validPageNumbers = pageNumbers.filter(n => n >= 1 && n <= totalSourcePages);

  if (validPageNumbers.length === 0) {
    throw new Error(`None of the matched page numbers are valid (source has ${totalSourcePages} pages)`);
  }

  if (validPageNumbers.length !== pageNumbers.length) {
    logger.warn(
      `Some matched page numbers were out of range and skipped. Valid: ${validPageNumbers.join(', ')}`
    );
  }

  // Build new PDF with only matched pages
  const newPdf = await PDFDocument.create();

  // Copy pages preserving their original indices (pdf-lib uses 0-based)
  const zeroBasedIndices = validPageNumbers.map(n => n - 1);
  const copiedPages = await newPdf.copyPages(sourcePdf, zeroBasedIndices);

  for (const page of copiedPages) {
    newPdf.addPage(page);
  }

  const outputBytes = await newPdf.save();
  const filename = `filtered-${uuidv4()}.pdf`;
  const outputPath = path.join(OUTPUT_DIR, filename);

  fs.writeFileSync(outputPath, outputBytes);

  logger.info(`Generated filtered PDF: ${filename} (${validPageNumbers.length} page(s))`);

  return { outputPath, filename };
}

/**
 * Deletes a generated output file (cleanup after download).
 * Does not throw if the file is already gone.
 *
 * @param {string} filename
 */
function deleteOutputFile(filename) {
  const filePath = path.join(OUTPUT_DIR, filename);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info(`Deleted output file: ${filename}`);
    }
  } catch (err) {
    logger.error(`Could not delete output file ${filename}: ${err.message}`);
  }
}

module.exports = { generateFilteredPdf, deleteOutputFile };
