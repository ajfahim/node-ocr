const { google } = require("googleapis");
const fs = require("fs").promises;
const path = require("path");
const winston = require("winston");
const { Readable } = require("stream");
const os = require("os");
const { LRUCache } = require('lru-cache'); // Import the named export

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

// Enhanced connection pooling and caching settings
const clientPool = [];
const MAX_POOL_SIZE = 20; // Increased for higher concurrency

// Cache for credential files and their content
let cachedCredentialFiles = null;
const credentialContentCache = {}; // Cache credential file contents

// LRU Cache for authenticated clients
const clientCache = new LRUCache({
  max: MAX_POOL_SIZE, // Maximum number of clients to keep in cache
  ttl: 30 * 60 * 1000, // 30 minute TTL
  updateAgeOnGet: true, // Update cache entry age on access
});

// Get list of available credential files
async function getCredentialFiles() {
  // Check if we're in a cloud environment with credentials in environment variables
  if (process.env.GOOGLE_CREDENTIALS) {
    try {
      // Parse the JSON string containing an array of credential objects
      const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
      
      // Create temporary files for each credential
      const tempDir = path.join(os.tmpdir(), 'ocr-api-credentials');
      
      try {
        await fs.mkdir(tempDir, { recursive: true });
      } catch (err) {
        // Directory might already exist
      }
      
      const credentialFiles = [];
      
      // Write each credential to a temporary file
      for (let i = 0; i < credentials.length; i++) {
        const filePath = path.join(tempDir, `credentials${i + 1}.json`);
        await fs.writeFile(filePath, JSON.stringify(credentials[i]), 'utf8');
        credentialFiles.push(filePath);
      }
      
      logger.info(`Created ${credentialFiles.length} temporary credential files in ${tempDir}`);
      return credentialFiles;
    } catch (error) {
      logger.error(`Error processing GOOGLE_CREDENTIALS env var: ${error.message}`);
      return [];
    }
  } 
  
  // Fall back to file system for local development
  if (cachedCredentialFiles) {
    return cachedCredentialFiles;
  }

  try {
    const secureFilesDir = path.join(__dirname, "..", "secure_files");
    const files = await fs.readdir(secureFilesDir);
    cachedCredentialFiles = files
      .filter(
        (file) => file.startsWith("credentials") && file.endsWith(".json")
      )
      .map((file) => path.join(secureFilesDir, file));

    if (cachedCredentialFiles.length === 0) {
      throw new Error(
        "No Google Cloud credential files found in secure_files directory"
      );
    }

    return cachedCredentialFiles;
  } catch (error) {
    logger.error(`Error reading credential files: ${error.message}`);
    throw new Error(`Failed to read credential files: ${error.message}`);
  }
}

// Get Google API client using service account credentials with multi-credential rotation
async function getGoogleClient() {
  try {
    // Check for available client in the pool first (fastest path)
    if (clientPool.length > 0) {
      const pooledClient = clientPool.shift();
      logger.debug(`Using client from pool. Pool size now: ${clientPool.length}`);
      return pooledClient;
    }

    // Get all available credential files
    const credentialFiles = await getCredentialFiles();
    if (credentialFiles.length === 0) {
      throw new Error("No credential files available");
    }
    
    // Enhanced rotation - maintain separate clients per credential file
    // Select a credential file randomly to distribute load
    const credentialIndex = Math.floor(Math.random() * credentialFiles.length);
    const selectedCredentialPath = credentialFiles[credentialIndex];
    
    // Generate cache key based on the credential path for more clients
    const cacheKey = `google-client-${path.basename(selectedCredentialPath)}`;
    
    // Check if we have a cached client for this specific credential
    const cachedClient = clientCache.get(cacheKey);
    if (cachedClient) {
      logger.debug(`Using cached Google client for ${path.basename(selectedCredentialPath)}`);
      return cachedClient;
    }
    
    // Extract credential number for logging
    let credentialNumber = "unknown";
    const match = selectedCredentialPath.match(
      /credentials(\d+|zero|one|two|three|four|five|six|seven|eight|nine)\.json$/
    );
    if (match) {
      credentialNumber = match[1];
    }

    logger.info(`Creating new Google client with credential: ${path.basename(selectedCredentialPath)}`);

    // Read the credential file - use cached content when available
    let credentials;

    if (credentialContentCache[selectedCredentialPath]) {
      credentials = credentialContentCache[selectedCredentialPath];
    } else {
      const credentialContent = await fs.readFile(selectedCredentialPath, "utf8");
      credentials = JSON.parse(credentialContent);
      credentialContentCache[selectedCredentialPath] = credentials;
    }

    // Create and authorize client
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });

    const client = await auth.getClient();
    
    // Create the client object with drive service for reuse
    const clientObj = { 
      client, 
      credentialNumber,
      drive: google.drive({ version: "v3", auth: client }),
      created: Date.now()
    };
    
    // Store in cache
    clientCache.set(cacheKey, clientObj);
    
    return clientObj;
  } catch (error) {
    logger.error(`Authentication error: ${error.message}`);
    throw new Error(`Google API authentication failed: ${error.message}`);
  }
}

// Main OCR function that processes an image and returns the extracted text - optimized version
async function performOcr(imageData, originalFileName, mimeType) {
  // Single structure for timing and results like PHP version
  const overallStartTime = Date.now();
  const result = {
    fileName: originalFileName,
    success: false,
    text: "",
    error: "",
    timing: {
      "0_start_js_function": 0
    },
    credentialUsed: "unknown",
  };

  let googleDocId = null;
  let googleClient = null;

  try {
    // Fast path: Get authenticated Google client from pool
    googleClient = await getGoogleClient();
    result.credentialUsed = googleClient.credentialNumber;
    
    // Get the drive service (already instantiated)
    const drive = googleClient.drive;

    // 1. Direct upload as Google Document (triggers OCR) - one step like PHP
    const uploadStartTime = Date.now();

    // Create minimal file metadata (same as PHP)
    const safeFileName = "ocr_gdoc_node_" + 
      originalFileName.replace(/[^a-zA-Z0-9._-]/g, "_") + 
      "_" + Date.now();
      
    const fileMetadata = {
      name: safeFileName,
      mimeType: "application/vnd.google-apps.document", // Convert to Google Doc for OCR
    };

    // STREAMLINED: Optimized upload directly from binary data like PHP
    // Avoid creating streams when possible - direct upload is faster
    let response;
    
    // Two optimized paths - choose the most efficient based on data type
    if (Buffer.isBuffer(imageData)) {
      // Direct binary upload - most efficient
      response = await drive.files.create({
        requestBody: fileMetadata,
        media: {
          mimeType: mimeType,
          body: imageData // Direct buffer upload
        },
        fields: 'id' // Only request ID to minimize response size
      });
    } else {
      // Fallback to stream method if not buffer
      const bufferStream = new Readable();
      bufferStream.push(imageData);
      bufferStream.push(null);
      
      response = await drive.files.create({
        requestBody: fileMetadata,
        media: {
          mimeType: mimeType,
          body: bufferStream
        },
        fields: 'id' // Only request ID to minimize response size
      });
    }

    googleDocId = response.data.id;
    result.timing["1_upload_and_convert_to_gdoc_ocr"] = (Date.now() - uploadStartTime) / 1000;

    if (!googleDocId) {
      throw new Error("Failed to upload image as Google Doc or get its ID.");
    }
    result.timing["after_gdoc_creation"] = (Date.now() - overallStartTime) / 1000;

    // 2. Export the Google Doc as plain text - optimized like PHP
    const exportStartTime = Date.now();
    
    // STREAMLINED: Set alt=media like PHP to get direct content
    const exportResponse = await drive.files.export({
      fileId: googleDocId,
      mimeType: "text/plain",
      alt: "media" // Get direct media content instead of JSON response
    }, {
      responseType: "text" // Get text directly when possible
    });

    // Get text with minimal transformation
    let extractedText;
    if (typeof exportResponse.data === "string") {
      // Direct text - fastest path
      extractedText = exportResponse.data;
    } else {
      // Fallback - handle other response types
      extractedText = Buffer.from(exportResponse.data).toString("utf8");
    }

    // Set success result
    result.success = true;
    result.text = extractedText;
    result.timing["2_export_doc_as_text"] = (Date.now() - exportStartTime) / 1000;
    result.timing["after_export"] = (Date.now() - overallStartTime) / 1000;
    
  } catch (error) {
    // Streamlined error handling - only log details if needed
    logger.error(`OCR error for ${originalFileName}: ${error.message}`);
    
    // Match PHP format for errors
    if (error.errors && error.errors.length > 0) {
      result.error = `Google API Error: ${error.message}. Details: ${error.errors[0].message || 'Unknown'}`;
    } else {
      result.error = `Processing Error: ${error.message}`;
    }
  } finally {
    // Always return the client to the pool for reuse
    if (googleClient && clientPool.length < MAX_POOL_SIZE) {
      clientPool.push(googleClient);
    }
    
    // 3. Delete the temporary Google Doc from Drive
    const deleteStartTime = Date.now();
    const deleteErrors = [];
    
    if (googleDocId) {
      try {
        // Use the existing client that already has authorization
        const drive = googleClient ? googleClient.drive : 
                      (await getGoogleClient()).drive;
        
        await drive.files.delete({ fileId: googleDocId });
      } catch (deleteError) {
        const deleteErrorMsg = `Failed to delete temporary Google Doc ${googleDocId}: ${deleteError.message}`;
        logger.error(deleteErrorMsg);
        deleteErrors.push(deleteErrorMsg);
      }
    }
    
    // Handle delete errors in the same way as PHP
    if (deleteErrors.length > 0) {
      if (!result.error) {
        result.error = deleteErrors.join("; ");
      } else {
        result.error += "; Cleanup errors: " + deleteErrors.join("; ");
      }
    }

    result.timing["3_delete_temp_gdoc"] = (Date.now() - deleteStartTime) / 1000;
    result.timing["total_duration_js_script"] = (Date.now() - overallStartTime) / 1000;
  }

  return result;
}

module.exports = {
  performOcr,
};
