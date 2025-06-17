# Node.js OCR API

A high-performance OCR API that uses Google Drive for text extraction. This API provides significantly better concurrency and performance compared to traditional PHP implementations.

## Features

- Upload images as base64 or file upload
- PDF to image conversion in the browser
- Multiple Google Service Account credential rotation for load distribution
- Non-blocking asynchronous processing
- Rate limiting and security middleware
- Clean and modern UI

## API Endpoints

### POST /api/ocr/base64

Accepts base64-encoded image data for OCR processing.

**Request Body:**

```json
{
  "imageBase64": "data:image/jpeg;base64,...",
  "originalFileName": "example.jpg"
}
```

**Response:**

```json
{
  "success": true,
  "fileName": "example.jpg",
  "text": "Extracted text content...",
  "timing": {
    "0_start": 0,
    "1_upload_and_convert_to_gdoc_ocr": 2.345,
    "2_export_doc_as_text": 1.234,
    "3_delete_temp_gdoc": 0.432,
    "total_duration": 4.011
  }
}
```

### POST /api/ocr/upload

Accepts multipart/form-data with an image file for OCR processing.

## Environment Setup

### Local Development

1. Create a `secure_files` directory in the project root
2. Place Google Service Account JSON credentials files named `credentials1.json`, `credentials2.json`, etc. in the `secure_files` directory
3. Install dependencies: `npm install` or `pnpm install`
4. Run the server: `npm run dev` or `pnpm dev`

### Production Deployment (Render.com)

For production deployment, set the following environment variables:

- `GOOGLE_CREDENTIALS`: A JSON string containing an array of Google Service Account credentials

Example:
```
GOOGLE_CREDENTIALS=[{"type":"service_account","project_id":"..."},{"type":"service_account","project_id":"..."}]
```

## Performance

Performance testing has shown significant improvements over PHP implementations:
- Higher throughput (requests/second)
- Lower response times
- Better handling of concurrent requests
