const fs = require("fs");
const path = require("path");
const axios = require("axios");

// Configuration
const CONCURRENT_REQUESTS = 10; // Increased concurrency for stronger test
const API_URL = "https://ocr3.thisblogg.top/ocr.php";
const TEST_IMAGE = path.join(__dirname, "test-image.jpg");
const TOTAL_REQUESTS = 1; // Testing with 1000 requests to check extreme load

async function runLoadTest() {
  console.log(
    `Starting load test on live PHP API with ${CONCURRENT_REQUESTS} concurrent requests`
  );
  console.log(`Total requests to be sent: ${TOTAL_REQUESTS}`);

  const startTime = Date.now();
  const imageBase64 = fs.readFileSync(TEST_IMAGE, { encoding: "base64" });

  // Create an array of request promises
  const requests = [];
  const responseData = {
    success: 0,
    failed: 0,
    timing: [],
  };

  for (let i = 0; i < TOTAL_REQUESTS; i++) {
    requests.push(
      (async () => {
        const reqStartTime = Date.now();
        try {
          const response = await axios.post(
            API_URL,
            {
              imageBase64: `data:image/jpeg;base64,${imageBase64}`,
              originalFileName: `test-image-${i}.jpg`,
            },
            {
              headers: {
                "Content-Type": "application/json",
              },
              timeout: 60000, // 60 second timeout for each request
            }
          );

          const requestTime = Date.now() - reqStartTime;
          responseData.timing.push(requestTime);
          responseData.success++;

          return {
            status: response.status,
            timing: requestTime,
            success: true,
          };
        } catch (error) {
          console.error(`Request ${i} failed:`, error.message);
          responseData.failed++;
          return {
            status: error.response?.status || "network-error",
            timing: Date.now() - reqStartTime,
            success: false,
            error: error.message,
          };
        }
      })()
    );

    // Wait for the current batch to complete if we've reached the concurrency limit
    if (requests.length >= CONCURRENT_REQUESTS || i === TOTAL_REQUESTS - 1) {
      await Promise.all(requests);
      requests.length = 0; // Clear the array for the next batch
      console.log(`Processed ${Math.min(i + 1, TOTAL_REQUESTS)} requests...`);
    }
  }

  const totalTime = (Date.now() - startTime) / 1000;

  // Calculate statistics
  const avgResponseTime =
    responseData.timing.length > 0
      ? responseData.timing.reduce((a, b) => a + b, 0) /
        responseData.timing.length
      : 0;

  responseData.timing.sort((a, b) => a - b);
  const medianResponseTime =
    responseData.timing.length > 0
      ? responseData.timing[Math.floor(responseData.timing.length / 2)]
      : 0;

  const p95ResponseTime =
    responseData.timing.length > 0
      ? responseData.timing[Math.floor(responseData.timing.length * 0.95)]
      : 0;

  const requestsPerSecond = TOTAL_REQUESTS / totalTime;

  console.log("\nTest Results:");
  console.log("---------------------------------");
  console.log(`Total Time: ${totalTime.toFixed(2)} seconds`);
  console.log(`Successful Requests: ${responseData.success}`);
  console.log(`Failed Requests: ${responseData.failed}`);
  console.log(`Requests Per Second: ${requestsPerSecond.toFixed(2)}`);
  console.log(`Average Response Time: ${avgResponseTime.toFixed(2)} ms`);
  console.log(`Median Response Time: ${medianResponseTime} ms`);
  console.log(`95th Percentile Response Time: ${p95ResponseTime} ms`);

  // Save results to file
  fs.writeFileSync(
    path.join(__dirname, "php-live-test-results.json"),
    JSON.stringify(
      {
        config: {
          concurrentRequests: CONCURRENT_REQUESTS,
          totalRequests: TOTAL_REQUESTS,
          api: API_URL,
        },
        results: {
          totalTime,
          successful: responseData.success,
          failed: responseData.failed,
          requestsPerSecond,
          avgResponseTime,
          medianResponseTime,
          p95ResponseTime,
          allTimings: responseData.timing,
        },
      },
      null,
      2
    )
  );

  console.log("\nResults saved to test/php-live-test-results.json");
}

runLoadTest().catch(console.error);
