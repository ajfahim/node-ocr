/**
 * Direct API OCR Service
 * Uses direct axios calls to Google APIs instead of the Google API client library
 * for better performance and less overhead
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const { Readable } = require('stream');
const os = require('os');
const { LRUCache } = require('lru-cache');

// Track temporary credential files created at runtime
const createdTempFiles = new Set();
let cleanupRegistered = false;

async function cleanupTempFiles() {
  for (const file of Array.from(createdTempFiles)) {
    try {
      await fs.unlink(file);
      createdTempFiles.delete(file);
    } catch (err) {
      logger.error(`Failed to delete temp credential file ${file}: ${err.message}`);
    }
  }
  // Attempt to remove the temp directory if empty
  const tempDir = path.join(os.tmpdir(), 'ocr-api-credentials');
  try {
    await fs.rmdir(tempDir);
  } catch (err) {
    // Directory may not be empty or may not exist
  }
}

function registerTempCleanup() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  process.on('exit', () => {
    cleanupTempFiles().catch(() => {});
  });
  ['SIGINT', 'SIGTERM'].forEach(sig => {
    process.on(sig, async () => {
      await cleanupTempFiles();
      process.exit();
    });
  });
}

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
const MAX_POOL_SIZE = 20; 

// Token cache - store authenticated tokens with a longer TTL than clients
const tokenCache = new LRUCache({
  max: 20, // Maximum number of tokens to keep
  ttl: 45 * 60 * 1000, // 45 minutes TTL (tokens expire at 60 mins)
});

// Cache for credential files
let cachedCredentialFiles = null;
const credentialContentCache = {}; // Cache credential file contents

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

      registerTempCleanup();

      const credentialFiles = [];

      // Write each credential to a temporary file
      for (let i = 0; i < credentials.length; i++) {
        const filePath = path.join(tempDir, `credentials${i + 1}.json`);
        await fs.writeFile(filePath, JSON.stringify(credentials[i]), 'utf8');
        credentialFiles.push(filePath);
        createdTempFiles.add(filePath);
        credentialContentCache[filePath] = credentials[i];
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

/**
 * Generate a JWT token for Google API authentication
 * This is much lighter weight than using the Google API client library
 */
async function generateJWT(credentials) {
  try {
    // Create a JWT for Google API authentication
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 3600; // 1 hour expiration
    
    const payload = {
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/drive',
      aud: 'https://oauth2.googleapis.com/token',
      exp,
      iat
    };
    
    // JWT parts
    const header = { alg: 'RS256', typ: 'JWT' };
    
    // Base64 encode header and payload
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    
    // Create signing input
    const signInput = `${encodedHeader}.${encodedPayload}`;
    
    // Sign with private key
    const crypto = require('crypto');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signInput);
    
    // Get private key from credentials
    const privateKey = credentials.private_key;
    
    // Create signature
    const signature = sign.sign(privateKey, 'base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    
    // Combine to form JWT
    const jwt = `${signInput}.${signature}`;
    
    return jwt;
  } catch (error) {
    logger.error(`Error generating JWT: ${error.message}`);
    throw new Error(`Failed to generate JWT: ${error.message}`);
  }
}

/**
 * Get an access token using a JWT
 * Direct API call instead of using Google Auth library
 */
async function getAccessToken(credentials) {
  try {
    // Check token cache first
    const cacheKey = credentials.client_email;
    const cachedToken = tokenCache.get(cacheKey);
    
    if (cachedToken) {
      logger.debug(`Using cached token for ${cacheKey}`);
      return cachedToken;
    }
    
    // Generate a new JWT
    const jwt = await generateJWT(credentials);
    
    // Exchange JWT for access token
    const response = await axios.post(
      'https://oauth2.googleapis.com/token',
      {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      },
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    
    const accessToken = response.data.access_token;

    // Cache the token
    tokenCache.set(cacheKey, accessToken);

    // Remove temporary credential files once a token is generated
    if (createdTempFiles.size > 0) {
      cleanupTempFiles().catch(() => {});
    }

    return accessToken;
  } catch (error) {
    logger.error(`Error getting access token: ${error.message}`);
    if (error.response) {
      logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
    }
    throw new Error(`Failed to get access token: ${error.message}`);
  }
}

/**
 * Get authentication credentials from a random credential file
 */
async function getRandomCredentials() {
  const credentialFiles = await getCredentialFiles();
  if (credentialFiles.length === 0) {
    throw new Error('No credential files available');
  }
  
  // Select a random credential file for load balancing
  const credentialIndex = Math.floor(Math.random() * credentialFiles.length);
  const selectedCredentialPath = credentialFiles[credentialIndex];
  
  // Get credential number for logging
  let credentialNumber = "unknown";
  const match = selectedCredentialPath.match(
    /credentials(\d+|zero|one|two|three|four|five|six|seven|eight|nine)\.json$/
  );
  if (match) {
    credentialNumber = match[1];
  }
  
  // Load credentials from cache or file
  let credentials;
  if (credentialContentCache[selectedCredentialPath]) {
    credentials = credentialContentCache[selectedCredentialPath];
  } else {
    const content = await fs.readFile(selectedCredentialPath, 'utf8');
    credentials = JSON.parse(content);
    credentialContentCache[selectedCredentialPath] = credentials;
  }
  
  return { credentials, credentialNumber };
}

/**
 * Perform OCR using direct API calls to Google's services
 * This implementation uses direct axios calls instead of the Google API client library
 */
async function performOcr(imageData, originalFileName, mimeType) {
  const startTime = Date.now();
  const result = {
    fileName: originalFileName,
    success: false,
    text: "",
    error: "",
    timing: {
      "0_start_direct_api": 0
    },
    credentialUsed: "unknown",
  };
  
  let googleDocId = null;
  let accessToken = null;
  
  try {
    // 1. Get credentials and access token
    const authStartTime = Date.now();
    const { credentials, credentialNumber } = await getRandomCredentials();
    result.credentialUsed = credentialNumber;
    
    // Get an access token directly without using Google Auth library
    accessToken = await getAccessToken(credentials);
    result.timing["1_auth_token"] = (Date.now() - authStartTime) / 1000;
    
    // 2. Upload file to Drive and convert to Google Doc in one step
    const uploadStartTime = Date.now();
    
    // Create a safe filename
    const safeFileName = "ocr_direct_" + 
      originalFileName.replace(/[^a-zA-Z0-9._-]/g, "_") + 
      "_" + Date.now();
    
    // Prepare metadata for multipart upload
    const metadata = {
      name: safeFileName,
      mimeType: "application/vnd.google-apps.document" // Convert to Google Doc
    };
    
    const boundary = '-------' + Math.random().toString(16).slice(2);
    
    // Create multipart body
    let requestBody = '';
    // Metadata part
    requestBody += `--${boundary}\r\n`;
    requestBody += 'Content-Type: application/json; charset=UTF-8\r\n\r\n';
    requestBody += JSON.stringify(metadata) + '\r\n';
    
    // File content part
    requestBody += `--${boundary}\r\n`;
    requestBody += `Content-Type: ${mimeType}\r\n\r\n`;
    
    // Create the full request body
    const bufferContent = Buffer.isBuffer(imageData) ? imageData : Buffer.from(imageData);
    const multipartRequestBody = Buffer.concat([
      Buffer.from(requestBody, 'utf8'),
      bufferContent,
      Buffer.from(`\r\n--${boundary}--`, 'utf8')
    ]);
    
    // Direct upload to Drive API
    const uploadResponse = await axios.post(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      multipartRequestBody,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': multipartRequestBody.length
        }
      }
    );
    
    googleDocId = uploadResponse.data.id;
    if (!googleDocId) {
      throw new Error('Failed to get document ID from upload response');
    }
    
    result.timing["2_upload_to_gdoc"] = (Date.now() - uploadStartTime) / 1000;
    
    // 3. Export the Google Doc as plain text
    const exportStartTime = Date.now();
    
    const exportResponse = await axios.get(
      `https://www.googleapis.com/drive/v3/files/${googleDocId}/export?mimeType=text/plain&alt=media`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        responseType: 'text'
      }
    );
    
    const extractedText = exportResponse.data;
    result.success = true;
    result.text = extractedText;
    result.timing["3_export_as_text"] = (Date.now() - exportStartTime) / 1000;
    
  } catch (error) {
    logger.error(`OCR error for ${originalFileName}: ${error.message}`);
    
    if (error.response) {
      logger.error(`Response status: ${error.response.status}`);
      logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
      
      result.error = `API Error (${error.response.status}): ${error.message}`;
      if (error.response.data && error.response.data.error) {
        result.error += ` - ${error.response.data.error.message || 'Unknown API error'}`;
      }
    } else {
      result.error = `Processing Error: ${error.message}`;
    }
  } finally {
    // Delete the temporary Google Doc
    if (googleDocId && accessToken) {
      const deleteStartTime = Date.now();
      try {
        await axios.delete(
          `https://www.googleapis.com/drive/v3/files/${googleDocId}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          }
        );
        result.timing["4_delete_temp_doc"] = (Date.now() - deleteStartTime) / 1000;
      } catch (deleteError) {
        logger.error(`Failed to delete temp doc ${googleDocId}: ${deleteError.message}`);
        
        if (!result.error) {
          result.error = `Cleanup Error: ${deleteError.message}`;
        } else {
          result.error += `; Cleanup Error: ${deleteError.message}`;
        }
      }
    }
    
    // Add total duration
    result.timing["total_duration_direct_api"] = (Date.now() - startTime) / 1000;
  }
  
  return result;
}

/**
 * Pre-warm authentication tokens for better performance
 * This should be called during server startup to prepare tokens in advance
 */
async function preWarmAuthTokens() {
  try {
    logger.info('Pre-warming authentication tokens...');
    const credentialFiles = await getCredentialFiles();
    const warmupPromises = [];
    
    // Pre-authenticate all available credentials
    for (const credentialFile of credentialFiles) {
      warmupPromises.push((async () => {
        try {
          const content = await fs.readFile(credentialFile, 'utf8');
          const credentials = JSON.parse(content);
          
          // Cache the credential content
          credentialContentCache[credentialFile] = credentials;
          
          // Get and cache the token
          await getAccessToken(credentials);
          
          logger.info(`Pre-warmed token for ${credentials.client_email}`);
        } catch (error) {
          logger.error(`Failed to pre-warm token for ${credentialFile}: ${error.message}`);
        }
      })());
    }
    
    await Promise.all(warmupPromises);
    logger.info(`Pre-warmed ${warmupPromises.length} authentication tokens`);
    if (createdTempFiles.size > 0) {
      await cleanupTempFiles();
    }
  } catch (error) {
    logger.error(`Error during token pre-warming: ${error.message}`);
  }
}

module.exports = {
  performOcr,
  preWarmAuthTokens
};
