const pdfParse = require('pdf-parse');
const fs = require('fs');
const logger = require('../utils/logger');

/**
 * Reads a PDF file from disk and returns an array of page text strings.
 * pdf-parse renders all pages into a single text block using a custom render
 * that inserts page-break markers so we can split them reliably.
 *
 * @param {string} filePath - Absolute path to the PDF file
 * @returns {Promise<string[]>} Array of page text strings (index 0 = page 1)
 */
async function extractPages(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const dataBuffer = fs.readFileSync(filePath);

  const PAGE_SEPARATOR = '\x00__PAGE_BREAK__\x00';
  let pageTexts = [];

  const options = {
    // Override the default page renderer to capture per-page text
    pagerender: function (pageData) {
      return pageData.getTextContent({ normalizeWhitespace: false }).then(function (textContent) {
        let lastY = null;
        let text = '';

        for (const item of textContent.items) {
          // Insert newline when Y position changes significantly (new line in PDF)
          if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
            text += '\n';
          }
          text += item.str;
          lastY = item.transform[5];
        }

        pageTexts.push(text);
        return text + PAGE_SEPARATOR;
      });
    },
  };

  await pdfParse(dataBuffer, options);

  if (pageTexts.length === 0) {
    // Fallback: pdf-parse may not call pagerender on all versions; parse the combined text
    logger.warn('pagerender produced no results — falling back to combined text split');
    const fallback = await pdfParse(dataBuffer);
    pageTexts = splitByFormFeed(fallback.text);
  }

  logger.info(`Extracted ${pageTexts.length} page(s) from PDF`);
  return pageTexts;
}

/**
 * Fallback: split combined PDF text by form-feed character (\f) which pdf-parse
 * inserts between pages in its default output.
 *
 * @param {string} combinedText
 * @returns {string[]}
 */
function splitByFormFeed(combinedText) {
  const pages = combinedText.split(/\f/);
  return pages.map(p => p.trim()).filter(p => p.length > 0);
}

module.exports = { extractPages };
