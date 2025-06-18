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

// Connection pooling and caching
const clientPool = [];
const MAX_POOL_SIZE = 10; // Adjust based on expected load

// Cache for credential files
let cachedCredentialFiles = null;

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

// Get Google API client using service account credentials with connection pooling
async function getGoogleClient() {
  try {
    // Check for available client in the pool
    if (clientPool.length > 0) {
      const pooledClient = clientPool.shift();
      logger.debug(`Using client from pool. Pool size now: ${clientPool.length}`);
      return pooledClient;
    }

    // Check cache for existing client
    const cacheKey = 'google-client';
    const cachedClient = clientCache.get(cacheKey);
    if (cachedClient) {
      logger.debug('Using cached Google client');
      return cachedClient;
    }

    // No cached client, create a new one
    const credentialFiles = await getCredentialFiles();
    // Rotate through credential files for load balancing
    const credentialIndex = Math.floor(Math.random() * credentialFiles.length);
    const selectedCredentialPath = credentialFiles[credentialIndex];

    // Extract credential number for logging
    let credentialNumber = "unknown";
    const match = selectedCredentialPath.match(
      /credentials(\d+|zero|one|two|three|four|five|six|seven|eight|nine)\.json$/
    );
    if (match) {
      credentialNumber = match[1];
    }

    logger.info(
      `Creating new Google client with credential: ${path.basename(selectedCredentialPath)}`
    );

    // Read the credential file
    const credentialContent = await fs.readFile(selectedCredentialPath, "utf8");
    const credentials = JSON.parse(credentialContent);

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

// Main OCR function that processes an image and returns the extracted text
async function performOcr(imageData, originalFileName, mimeType) {
  const result = {
    fileName: originalFileName,
    success: false,
    text: "",
    error: "",
    timing: {},
    credentialUsed: "unknown",
  };

  const startTime = Date.now();
  result.timing["0_start"] = 0;

  let googleDocId = null;
  let googleClient = null;

  try {
    // Get authenticated Google client from pool
    const clientStartTime = Date.now();
    googleClient = await getGoogleClient();
    result.credentialUsed = googleClient.credentialNumber;
    result.timing["0.5_get_client"] = (Date.now() - clientStartTime) / 1000;

    // Use the already instantiated drive service
    const drive = googleClient.drive;

    // 1. Upload the image directly as a Google Document (triggers OCR)
    const uploadStartTime = Date.now();

    // Create a safe filename
    const safeFileName =
      "ocr_gdoc_node_" +
      originalFileName.replace(/[^a-zA-Z0-9._-]/g, "_") +
      "_" +
      Date.now();

    const fileMetadata = {
      name: safeFileName,
      mimeType: "application/vnd.google-apps.document", // Tell Drive to convert to Google Doc
    };

    // Upload the file to Google Drive and convert to Google Doc
    logger.info(`Uploading image to Google Drive: ${safeFileName}`);
    
    // Create a readable stream from buffer for Google Drive API
    const bufferStream = new Readable();
    bufferStream.push(imageData);
    bufferStream.push(null); // Mark end of stream
    
    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: {
        mimeType: mimeType,
        body: bufferStream
      },
      fields: 'id'
    });

    googleDocId = response.data.id;
    result.timing["1_upload_and_convert_to_gdoc_ocr"] =
      (Date.now() - uploadStartTime) / 1000;

    if (!googleDocId) {
      throw new Error("Failed to upload image as Google Doc or get its ID.");
    }

    // 2. Export the Google Doc as plain text
    const exportStartTime = Date.now();
    logger.info(`Exporting Google Doc as text: ${googleDocId}`);

    const exportResponse = await drive.files.export(
      {
        fileId: googleDocId,
        mimeType: "text/plain",
      },
      {
        responseType: "arraybuffer",
      }
    );

    // Convert the exported text to string
    const extractedText = Buffer.from(exportResponse.data).toString("utf8");

    // Update result
    result.success = true;
    result.text = extractedText;
    result.timing["2_export_doc_as_text"] =
      (Date.now() - exportStartTime) / 1000;
  } catch (error) {
    logger.error(`OCR error for ${originalFileName}: ${error.message}`);
    result.error = `Processing Error: ${error.message}`;
  } finally {
    // Return client to the pool if we have one and pool isn't full
    if (googleClient && clientPool.length < MAX_POOL_SIZE) {
      clientPool.push(googleClient);
      logger.debug(`Returned client to pool. Pool size now: ${clientPool.length}`);
    }
    
    // 3. Delete the temporary Google Doc from Drive
    const deleteStartTime = Date.now();
    if (googleDocId) {
      try {
        logger.info(`Deleting temporary Google Doc: ${googleDocId}`);
        // Use the existing client if possible, or get a new one
        const drive = googleClient ? googleClient.drive : 
                      google.drive({
                        version: "v3",
                        auth: (await getGoogleClient()).client,
                      });
        await drive.files.delete({
          fileId: googleDocId,
        });
        result.timing["3_delete_temp_gdoc"] =
          (Date.now() - deleteStartTime) / 1000;
      } catch (deleteError) {
        const deleteErrorMsg = `Failed to delete temporary Google Doc ${googleDocId}: ${deleteError.message}`;
        logger.error(deleteErrorMsg);

        if (!result.error) {
          result.error = deleteErrorMsg;
        } else {
          result.error += `; Cleanup errors: ${deleteErrorMsg}`;
        }
      }
    }

    // Add total duration
    result.timing["total_duration"] = (Date.now() - startTime) / 1000;
  }

  return result;
}

module.exports = {
  performOcr,
};
