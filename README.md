# PDF Data Extracter

A production-ready Node.js service that processes multi-page PDF invoice files, extracts structured sections (Customer Address, Bill To, Product Details), and filters pages based on configurable business rules.

## Filter Rules

A page is returned as **MATCHED** only when **both** conditions are true:

1. `customerAddress` **OR** `billTo` contains the word `Delhi` (case-insensitive)
2. Extracted `qty` from `Product Details` is **greater than 1** (missing qty → treated as 0)

---

## Project Structure

```
pdf-data-extracker/
├── app.js                          # Express server entry point
├── package.json
├── src/
│   ├── controllers/
│   │   └── pdfController.js        # Route handlers
│   ├── services/
│   │   ├── pdfParserService.js     # PDF → per-page text extraction
│   │   ├── filterService.js        # Parse + filter all pages
│   │   └── pdfGeneratorService.js  # Build filtered PDF with pdf-lib
│   ├── middleware/
│   │   └── upload.js               # Multer config (PDF-only, 50 MB cap)
│   └── utils/
│       ├── extractSection.js       # extractSection() + extractQty()
│       ├── parsePage.js            # parsePage() per-page struct builder
│       ├── filterPage.js           # filterPage() Delhi + qty logic
│       └── logger.js               # Winston logger
├── uploads/                        # Temp upload storage (auto-cleaned)
├── output/                         # Generated filtered PDFs (deleted on download)
└── logs/                           # combined.log + error.log
```

---

## Quick Start

### Prerequisites

- Node.js v16+
- npm

### Install

```bash
npm install
```

### Run

```bash
# Production
npm start

# Development (auto-reload)
npm run dev
```

Server listens on port `3000` by default. Override with `PORT=8080 npm start`.

---

## API Reference

### `GET /health`

Returns server status.

```json
{
  "status": "ok",
  "timestamp": "2026-04-19T10:00:00.000Z",
  "uptime": 42.5
}
```

---

### `POST /upload`

Upload and process a PDF file.

**Content-Type:** `multipart/form-data`  
**Field name:** `file`  
**Max size:** 50 MB  
**Accepted types:** PDF only

#### Query Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `onlyMatched` | boolean | `false` | If `true`, `results` contains only matched pages |
| `generatePdf` | boolean | `false` | If `true`, generates a downloadable filtered PDF |

#### Example (curl)

```bash
# Basic analysis
curl -X POST http://localhost:3000/upload \
  -F "file=@invoices.pdf"

# Only matched pages + download link
curl -X POST "http://localhost:3000/upload?onlyMatched=true&generatePdf=true" \
  -F "file=@invoices.pdf"
```

#### Response

```json
{
  "totalPages": 10,
  "matchedPages": 3,
  "results": [
    {
      "pageNumber": 1,
      "customerAddress": "Rajesh Kumar\n45 Nehru Place, New Delhi 110019",
      "billTo": "Sunita Verma\n12 Connaught Place, Delhi 110001",
      "qty": 3,
      "isMatch": true
    }
  ],
  "downloadUrl": "http://localhost:3000/download/filtered-<uuid>.pdf"
}
```

If no pages match, a `message` field is included:
```json
{
  "message": "No pages matched the filter criteria (Delhi address + qty > 1)."
}
```

---

### `GET /download/:filename`

Downloads a generated filtered PDF. **One-time only** — the file is deleted after download.

```bash
curl -O http://localhost:3000/download/filtered-<uuid>.pdf
```

---

## Parsing Logic

### Section Extraction (`extractSection`)

Sections are extracted with flexible regex that tolerates:
- Extra/inconsistent whitespace between words in markers
- Mixed case (case-insensitive matching)
- Multi-line content between markers

| Section | Start Marker | End Marker |
|---|---|---|
| Customer Address | `Customer Address` | `If undelivered` |
| Bill To | `BILL TO / SHIP TO` | `Sold by` |
| Product Details | `Product Details` | `TAX INVOICE` |

### Qty Extraction (`extractQty`)

Tries patterns in order:
1. `Qty: 3` / `QTY : 3` / `Quantity: 3`
2. Standalone integer in the product section

Returns `0` if no match found.

---

## Edge Cases Handled

- Missing sections → empty string / qty 0
- Broken formatting, extra spaces → flexible regex matching
- Multi-line addresses → newline-preserved extraction
- PDFs with zero matches → valid empty response with message
- File type validation → 415 error for non-PDF uploads
- File size limit → 413 error for files > 50 MB
- Path traversal in download filenames → sanitized with `path.basename`

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `LOG_LEVEL` | `info` | Winston log level (`debug`, `info`, `warn`, `error`) |
