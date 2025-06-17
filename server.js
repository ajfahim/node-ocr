const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { rateLimit } = require("express-rate-limit");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs").promises;
const winston = require("winston");
require("dotenv").config();

// Import the OCR service
const { performOcr } = require("./services/ocrService");

// Create Express app
const app = express();
const port = process.env.PORT || 3000;

// Configure logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(
      (info) => `${info.timestamp} ${info.level}: ${info.message}`
    )
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" })); // For parsing application/json with larger limit for base64
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Configure storage for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit, matching PHP version
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/bmp",
      "image/webp",
      "application/pdf",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only images and PDFs are allowed."));
    }
  },
});

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again after 15 minutes",
});

// Apply rate limiting to all requests
app.use(apiLimiter);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "public")));

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// OCR endpoint for base64 image data
app.post("/api/ocr/base64", async (req, res) => {
  try {
    const startTime = Date.now();

    // Validate request
    if (!req.body.imageBase64 || !req.body.originalFileName) {
      return res.status(400).json([
        {
          fileName: "N/A",
          success: false,
          error: "Missing required fields: imageBase64 and originalFileName.",
        },
      ]);
    }

    const { imageBase64, originalFileName } = req.body;
    let imageData, extractedMimeType;

    // Extract the base64 data and MIME type
    if (imageBase64.startsWith("data:")) {
      const matches = imageBase64.match(
        /^data:(image\/\w+|application\/pdf);base64,(.*)$/
      );
      if (matches) {
        extractedMimeType = matches[1];
        imageData = Buffer.from(matches[2], "base64");
      } else {
        return res.status(400).json([
          {
            fileName: originalFileName,
            success: false,
            error: "Invalid base64 image format.",
          },
        ]);
      }
    } else {
      // Raw base64 data
      try {
        imageData = Buffer.from(imageBase64, "base64");
        extractedMimeType = "application/octet-stream"; // Default MIME type
      } catch (error) {
        return res.status(400).json([
          {
            fileName: originalFileName,
            success: false,
            error: "Invalid base64 data.",
          },
        ]);
      }
    }

    // Validate size
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (imageData.length > maxSize) {
      return res.status(400).json([
        {
          fileName: originalFileName,
          success: false,
          error: `Decoded image exceeds maximum size of 10MB. Size: ${imageData.length} bytes.`,
        },
      ]);
    }

    // Process the image
    logger.info(
      `Processing image: ${originalFileName}, Size: ${imageData.length} bytes`
    );
    const result = await performOcr(
      imageData,
      originalFileName,
      extractedMimeType
    );
    const endTime = Date.now();

    // Add timing info
    result.timing.total_duration = (endTime - startTime) / 1000;

    // Return result in format similar to PHP version
    res.json([result]);
  } catch (error) {
    logger.error(`Error processing base64 image: ${error.message}`);
    res.status(500).json([
      {
        fileName: req.body.originalFileName || "N/A",
        success: false,
        error: `Server error: ${error.message}`,
      },
    ]);
  }
});

// OCR endpoint for file uploads
app.post("/api/ocr/upload", upload.array("images"), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json([
        {
          fileName: "N/A",
          success: false,
          error: "No files uploaded.",
        },
      ]);
    }

    // Process only the first file for now (can be expanded to process multiple)
    const file = req.files[0];
    const startTime = Date.now();

    logger.info(
      `Processing uploaded file: ${file.originalname}, Size: ${file.size} bytes, Type: ${file.mimetype}`
    );

    // Process the image
    const result = await performOcr(
      file.buffer,
      file.originalname,
      file.mimetype
    );
    const endTime = Date.now();

    // Add timing info
    result.timing.total_duration = (endTime - startTime) / 1000;

    // Return result in format similar to PHP version
    res.json([result]);
  } catch (error) {
    logger.error(`Error processing uploaded file: ${error.message}`);
    res.status(500).json([
      {
        fileName: req.files?.[0]?.originalname || "N/A",
        success: false,
        error: `Server error: ${error.message}`,
      },
    ]);
  }
});

// Error handler for multer errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json([
        {
          fileName: "N/A",
          success: false,
          error: "File exceeds 5MB size limit.",
        },
      ]);
    }
    return res.status(400).json([
      {
        fileName: "N/A",
        success: false,
        error: `Upload error: ${err.message}`,
      },
    ]);
  }

  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json([
    {
      fileName: "N/A",
      success: false,
      error: `Server error: ${err.message}`,
    },
  ]);
});

// Start server
app.listen(port, () => {
  logger.info(`OCR API server running on port ${port}`);
  console.log(`OCR API server running on port ${port}`);
});
