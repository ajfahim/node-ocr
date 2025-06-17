/**
 * This script combines multiple Google service account credential JSON files into a single JSON array
 * for use as the GOOGLE_CREDENTIALS environment variable on Render.com
 * 
 * The output is printed to the console.
 * 
 * IMPORTANT: This script should only be run locally and should NOT be committed to version control.
 */

const fs = require('fs').promises;
const path = require('path');

async function combineCredentials() {
  try {
    const credentialsDir = path.join(__dirname, '..', 'secure_files');
    const files = await fs.readdir(credentialsDir);
    const credentialFiles = files.filter(file => 
      file.match(/credentials.*\.json/i)
    );
    
    console.log(`Found ${credentialFiles.length} credential files`);
    
    const credentials = [];
    
    for (const file of credentialFiles) {
      const filePath = path.join(credentialsDir, file);
      const content = await fs.readFile(filePath, 'utf8');
      try {
        const credentialObject = JSON.parse(content);
        credentials.push(credentialObject);
        console.log(`Successfully added ${file}`);
      } catch (error) {
        console.error(`Error parsing ${file}: ${error.message}`);
      }
    }
    
    // Create the JSON string with minimal whitespace for environment variable
    const jsonString = JSON.stringify(credentials);
    
    console.log('\n=== COPY THE FOLLOWING STRING FOR YOUR GOOGLE_CREDENTIALS ENVIRONMENT VARIABLE ===\n');
    console.log(jsonString);
    console.log('\n=== END OF CREDENTIALS STRING ===\n');
    
    console.log(`Combined ${credentials.length} credential files successfully.`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}

combineCredentials();
