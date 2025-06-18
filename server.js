const express = require("express");
const cors = require("cors");
const multer = require("multer");
// Rate limiting removed for performance testing
// const { rateLimit } = require("express-rate-limit");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs").promises;
const winston = require("winston");
require("dotenv").config();

// Import the direct API OCR service (much faster than Google API client-based service)
const { performOcr, preWarmAuthTokens } = require("./services/directApiOcrService");

// Create Express app
const app = express();
const port = process.env.PORT || 5000;

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
// Use the same 5MB limit for JSON bodies and form uploads
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

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

// Rate limiting completely removed for performance testing

// Simple request counter for monitoring load instead
let requestCount = 0;
app.use((req, res, next) => {
  requestCount++;
  if (requestCount % 100 === 0) {
    logger.info(`Request count: ${requestCount}`);
  }
  next();
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "public")));

// Health check endpoint for monitoring
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

// OCR endpoint for base64 image data
app.post("/api/ocr/base64", async (req, res) => {
  try {
    const globalStartTime = Date.now();
    let results = [];
    
    // Check if we have an array of images or a single image
    const isArrayOfImages = Array.isArray(req.body);
    const imageDataArray = isArrayOfImages ? req.body : [req.body];
    
    // Validate that we have at least one image
    if (imageDataArray.length === 0) {
      return res.status(400).json([
        {
          fileName: "N/A",
          success: false,
          error: "No image data provided.",
        },
      ]);
    }
    
    // Process all images in parallel
    const processingPromises = imageDataArray.map(async (imageItem) => {
      const itemStartTime = Date.now();
      
      // Validate this item has required fields
      if (!imageItem.imageBase64 || !imageItem.originalFileName) {
        return {
          fileName: imageItem.originalFileName || "N/A",
          success: false,
          error: "Missing required fields: imageBase64 and/or originalFileName.",
          timing: { item_duration: (Date.now() - itemStartTime) / 1000 }
        };
      }
      
      const { imageBase64, originalFileName } = imageItem;
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
          return {
            fileName: originalFileName,
            success: false,
            error: "Invalid base64 image format.",
            timing: { item_duration: (Date.now() - itemStartTime) / 1000 }
          };
        }
      } else {
        // Raw base64 data
        try {
          imageData = Buffer.from(imageBase64, "base64");
          extractedMimeType = "application/octet-stream"; // Default MIME type
        } catch (error) {
          return {
            fileName: originalFileName,
            success: false,
            error: "Invalid base64 data.",
            timing: { item_duration: (Date.now() - itemStartTime) / 1000 }
          };
        }
      }
      
      // Validate size
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (imageData.length > maxSize) {
        return {
          fileName: originalFileName,
          success: false,
          error: `Decoded image exceeds maximum size of 5MB. Size: ${imageData.length} bytes.`,
          timing: { item_duration: (Date.now() - itemStartTime) / 1000 }
        };
      }
      
      // Process the image
      logger.info(
        `Processing image: ${originalFileName}, Size: ${imageData.length} bytes`
      );
      
      try {
        const result = await performOcr(
          imageData,
          originalFileName,
          extractedMimeType
        );
        
        // Add timing info for this specific image
        result.timing.item_duration = (Date.now() - itemStartTime) / 1000;
        
        return result;
      } catch (ocrError) {
        logger.error(`Error in OCR for ${originalFileName}: ${ocrError.message}`);
        return {
          fileName: originalFileName,
          success: false,
          error: `OCR processing error: ${ocrError.message}`,
          timing: { item_duration: (Date.now() - itemStartTime) / 1000 }
        };
      }
    });
    
    // Wait for all images to be processed in parallel
    results = await Promise.all(processingPromises);
    
    // Add overall processing time metadata
    const globalProcessingTime = (Date.now() - globalStartTime) / 1000;
    const metaInfo = {
      batchProcessingTime: globalProcessingTime,
      processedCount: results.length,
    };
    
    logger.info(`Batch processing complete. Processed ${results.length} images in ${globalProcessingTime.toFixed(2)}s`);
    
    // Return all results
    res.json({
      meta: metaInfo,
      results: results
    });
  } catch (error) {
    logger.error(`Error processing batch of images: ${error.message}`);
    res.status(500).json([
      {
        fileName: "batch-processing",
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
app.listen(port, async () => {
  logger.info(`OCR API server running on port ${port}`);
  console.log(`OCR API server running on port ${port}`);
  
  // Pre-warm auth tokens for better performance
  try {
    await preWarmAuthTokens();
    logger.info('Authentication tokens pre-warmed and ready for use');
  } catch (error) {
    logger.error(`Failed to pre-warm authentication tokens: ${error.message}`);
  }
});
