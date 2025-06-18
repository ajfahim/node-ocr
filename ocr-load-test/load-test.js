const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

class OCRLoadTester {
  constructor() {
    // Updated endpoints based on original test scripts
    this.jsAppUrl = "http://164.68.116.189/api/ocr/base64"; // Full endpoint path
    this.phpAppUrl = "https://ocr3.thisblogg.top/ocr.php"; // Full endpoint path
    this.results = {
      javascript: [],
      php: [],
    };
    this.testStartTime = null;
    this.testEndTime = null;
  }

  // Use the test image file
  createTestImage() {
    // We now have an actual test image file to use
    const testImagePath = "./test-image.jpg";

    // Verify test image exists
    if (!fs.existsSync(testImagePath)) {
      console.log("Warning: Test image not found at " + testImagePath);
      console.log("Creating a text file as fallback...");
      // Create a simple text file that can be used for OCR testing
      const testContent =
        "This is a test document for OCR processing. It contains sample text to extract.";
      fs.writeFileSync("./test-document.txt", testContent);
      return "./test-document.txt";
    }

    console.log("Using test image: " + testImagePath);
    return testImagePath;
  }

  // Test JavaScript application
  async testJavaScriptApp(testImage, userId) {
    const startTime = Date.now();

    try {
      // Check if image file exists, otherwise use text file
      const filePath = fs.existsSync(testImage)
        ? testImage
        : "./test-document.txt";
      // Read file and convert to base64
      const imageBase64 = fs.readFileSync(filePath, { encoding: "base64" });

      // Using approach from original test scripts with base64 encoding
      const response = await axios.post(
        this.jsAppUrl,
        {
          imageBase64: `data:image/jpeg;base64,${imageBase64}`,
          originalFileName: `test-image-${userId}.jpg`,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "User-Agent": `LoadTest-User-${userId}`,
          },
          timeout: 30000, // 30 second timeout
        }
      );

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      return {
        success: true,
        responseTime,
        status: response.status,
        userId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const endTime = Date.now();
      const responseTime = endTime - startTime;

      return {
        success: false,
        responseTime,
        error: error.message,
        userId,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Test PHP application
  async testPHPApp(testImage, userId) {
    const startTime = Date.now();

    try {
      // Check if image file exists, otherwise use text file
      const filePath = fs.existsSync(testImage)
        ? testImage
        : "./test-document.txt";
      // Read file and convert to base64
      const imageBase64 = fs.readFileSync(filePath, { encoding: "base64" });

      // Using approach from original test scripts with base64 encoding
      const response = await axios.post(
        this.phpAppUrl,
        {
          imageBase64: `data:image/jpeg;base64,${imageBase64}`,
          originalFileName: `test-image-${userId}.jpg`,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "User-Agent": `LoadTest-User-${userId}`,
          },
          timeout: 30000, // 30 second timeout
        }
      );

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      return {
        success: true,
        responseTime,
        status: response.status,
        userId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const endTime = Date.now();
      const responseTime = endTime - startTime;

      return {
        success: false,
        responseTime,
        error: error.message,
        userId,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Run concurrent load test
  async runLoadTest(concurrentUsers = 10, testDuration = 60000) {
    console.log(
      `Starting load test with ${concurrentUsers} concurrent users for ${
        testDuration / 1000
      } seconds...`
    );

    const testImage = this.createTestImage();
    this.testStartTime = Date.now();

    // Create arrays to hold all test promises
    const jsPromises = [];
    const phpPromises = [];

    // Function to continuously test until duration is reached
    const continuousTest = async (appType, userId) => {
      const userResults = [];
      const endTime = this.testStartTime + testDuration;

      while (Date.now() < endTime) {
        let result;
        if (appType === "javascript") {
          result = await this.testJavaScriptApp(testImage, userId);
        } else {
          result = await this.testPHPApp(testImage, userId);
        }

        userResults.push(result);

        // Small delay between requests from same user
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      return userResults;
    };

    // Start concurrent users for both applications
    for (let i = 0; i < concurrentUsers; i++) {
      jsPromises.push(continuousTest("javascript", i + 1));
      phpPromises.push(continuousTest("php", i + 1));
    }

    // Wait for all tests to complete
    console.log("Running tests...");
    const [jsResults, phpResults] = await Promise.allSettled([
      Promise.all(jsPromises),
      Promise.all(phpPromises),
    ]);

    this.testEndTime = Date.now();

    // Process results
    if (jsResults.status === "fulfilled") {
      this.results.javascript = jsResults.value.flat();
    }
    if (phpResults.status === "fulfilled") {
      this.results.php = phpResults.value.flat();
    }

    this.generateReport();
  }

  // Generate performance report
  generateReport() {
    console.log("\n=== LOAD TEST RESULTS ===\n");

    const totalDuration = this.testEndTime - this.testStartTime;
    console.log(`Total Test Duration: ${totalDuration / 1000} seconds\n`);

    // Analyze JavaScript app results
    this.analyzeResults("JavaScript Application", this.results.javascript);

    console.log("\n" + "=".repeat(50) + "\n");

    // Analyze PHP app results
    this.analyzeResults("PHP Application", this.results.php);

    // Save detailed results to files
    this.saveResults();
  }

  analyzeResults(appName, results) {
    console.log(`${appName} Results:`);
    console.log(`Total Requests: ${results.length}`);

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    console.log(`Successful Requests: ${successful.length}`);
    console.log(`Failed Requests: ${failed.length}`);
    console.log(
      `Success Rate: ${((successful.length / results.length) * 100).toFixed(
        2
      )}%`
    );

    if (successful.length > 0) {
      const responseTimes = successful.map((r) => r.responseTime);
      const avgResponseTime =
        responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const minResponseTime = Math.min(...responseTimes);
      const maxResponseTime = Math.max(...responseTimes);

      console.log(`Average Response Time: ${avgResponseTime.toFixed(2)}ms`);
      console.log(`Min Response Time: ${minResponseTime}ms`);
      console.log(`Max Response Time: ${maxResponseTime}ms`);

      // Calculate requests per second
      const totalDuration = this.testEndTime - this.testStartTime;
      const requestsPerSecond = (
        results.length /
        (totalDuration / 1000)
      ).toFixed(2);
      console.log(`Requests per Second: ${requestsPerSecond}`);
    }

    if (failed.length > 0) {
      console.log("\nError Summary:");
      const errorCounts = {};
      failed.forEach((r) => {
        const error = r.error || "Unknown error";
        errorCounts[error] = (errorCounts[error] || 0) + 1;
      });

      Object.entries(errorCounts).forEach(([error, count]) => {
        console.log(`  ${error}: ${count} occurrences`);
      });
    }
  }

  saveResults() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    // Save JavaScript results
    fs.writeFileSync(
      `javascript-results-${timestamp}.json`,
      JSON.stringify(this.results.javascript, null, 2)
    );

    // Save PHP results
    fs.writeFileSync(
      `php-results-${timestamp}.json`,
      JSON.stringify(this.results.php, null, 2)
    );

    // Save summary report
    const summary = {
      testDuration: this.testEndTime - this.testStartTime,
      javascript: this.getSummaryStats(this.results.javascript),
      php: this.getSummaryStats(this.results.php),
      timestamp: new Date().toISOString(),
    };

    fs.writeFileSync(
      `load-test-summary-${timestamp}.json`,
      JSON.stringify(summary, null, 2)
    );

    console.log(
      `\nDetailed results saved to files with timestamp: ${timestamp}`
    );
  }

  getSummaryStats(results) {
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    if (successful.length === 0) {
      return {
        totalRequests: results.length,
        successfulRequests: 0,
        failedRequests: failed.length,
        successRate: 0,
        avgResponseTime: 0,
        minResponseTime: 0,
        maxResponseTime: 0,
      };
    }

    const responseTimes = successful.map((r) => r.responseTime);

    return {
      totalRequests: results.length,
      successfulRequests: successful.length,
      failedRequests: failed.length,
      successRate: (successful.length / results.length) * 100,
      avgResponseTime:
        responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length,
      minResponseTime: Math.min(...responseTimes),
      maxResponseTime: Math.max(...responseTimes),
    };
  }
}

// Usage example
async function runTest() {
  const tester = new OCRLoadTester();

  // Test with different load levels to determine max user capacity
  const testConfigs = [
    { users: 5, duration: 30000 }, // 5 users for 30 seconds (warmup)
    { users: 10, duration: 60000 }, // 10 users for 1 minute
    { users: 20, duration: 60000 }, // 20 users for 1 minute
    { users: 30, duration: 60000 }, // 30 users for 1 minute
    { users: 50, duration: 60000 }, // 50 users for 1 minute
    { users: 75, duration: 60000 }, // 75 users for 1 minute
    { users: 100, duration: 60000 }, // 100 users for 1 minute
    { users: 150, duration: 60000 }, // 150 users for 1 minute (if previous tests succeed)
  ];

  console.log("Starting comprehensive load testing...\n");

  for (const config of testConfigs) {
    console.log(
      `\nTesting with ${config.users} concurrent users for ${
        config.duration / 1000
      } seconds...`
    );
    await tester.runLoadTest(config.users, config.duration);

    // Wait between tests
    console.log("Waiting 30 seconds before next test...");
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }

  console.log("\nAll load tests completed!");
}

// Run the test if this file is executed directly
if (require.main === module) {
  runTest().catch(console.error);
}

module.exports = OCRLoadTester;
