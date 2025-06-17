const { google } = require("googleapis");
const fs = require("fs").promises;
const path = require("path");
const winston = require("winston");
const { Readable } = require("stream");
const os = require("os");

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

// Credential cache to avoid reading files repeatedly
let cachedCredentialFiles = null;

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

// Get Google API client using service account credentials
async function getGoogleClient() {
  try {
    const credentialFiles = await getCredentialFiles();
    // Randomly select one credential file
    const selectedCredentialPath =
      credentialFiles[Math.floor(Math.random() * credentialFiles.length)];

    // Extract credential number for logging
    let credentialNumber = "unknown";
    const match = selectedCredentialPath.match(
      /credentials(\d+|zero|one|two|three|four|five|six|seven|eight|nine)\.json$/
    );
    if (match) {
      credentialNumber = match[1];
    }

    logger.info(
      `Using credential file: ${path.basename(selectedCredentialPath)}`
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
    return { client, credentialNumber };
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

  try {
    // Get authenticated Google client
    const { client, credentialNumber } = await getGoogleClient();
    result.credentialUsed = credentialNumber;

    // Create Drive service
    const drive = google.drive({ version: "v3", auth: client });

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
    // 3. Delete the temporary Google Doc from Drive
    const deleteStartTime = Date.now();
    if (googleDocId) {
      try {
        logger.info(`Deleting temporary Google Doc: ${googleDocId}`);
        const drive = google.drive({
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
