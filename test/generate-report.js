const fs = require('fs');
const path = require('path');

// Read the test results
const phpResults = JSON.parse(fs.readFileSync(path.join(__dirname, 'php-live-test-results.json'), 'utf8'));
const nodeResults = JSON.parse(fs.readFileSync(path.join(__dirname, 'node-deployed-test-results.json'), 'utf8'));

// Format numbers for display
function formatNum(num, decimals = 2) {
  return num.toFixed(decimals);
}

// Calculate percentage improvement
function calcImprovement(newVal, oldVal) {
  const percentage = ((newVal - oldVal) / oldVal) * 100;
  const prefix = percentage > 0 ? '+' : '';
  return `${prefix}${formatNum(percentage)}%`;
}

// Calculate performance comparison metrics
const comparison = {
  requestsPerSecond: {
    php: phpResults.results.requestsPerSecond,
    node: nodeResults.results.requestsPerSecond,
    improvement: calcImprovement(nodeResults.results.requestsPerSecond, phpResults.results.requestsPerSecond)
  },
  successRate: {
    php: (phpResults.results.successful / phpResults.config.totalRequests) * 100,
    node: (nodeResults.results.successful / nodeResults.config.totalRequests) * 100,
    improvement: calcImprovement(
      (nodeResults.results.successful / nodeResults.config.totalRequests) * 100,
      (phpResults.results.successful / phpResults.config.totalRequests) * 100
    )
  },
  avgResponseTime: {
    php: phpResults.results.avgResponseTime,
    node: nodeResults.results.avgResponseTime,
    improvement: calcImprovement(-nodeResults.results.avgResponseTime, -phpResults.results.avgResponseTime)
  },
  medianResponseTime: {
    php: phpResults.results.medianResponseTime,
    node: nodeResults.results.medianResponseTime,
    improvement: calcImprovement(-nodeResults.results.medianResponseTime, -phpResults.results.medianResponseTime)
  },
  p95ResponseTime: {
    php: phpResults.results.p95ResponseTime,
    node: nodeResults.results.p95ResponseTime,
    improvement: calcImprovement(-nodeResults.results.p95ResponseTime, -phpResults.results.p95ResponseTime)
  }
};

// Generate the HTML report
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OCR API Performance Comparison: PHP vs Node.js</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f9f9f9;
    }
    h1, h2, h3 {
      color: #2c3e50;
    }
    .container {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      padding: 30px;
      margin-bottom: 30px;
    }
    .header {
      text-align: center;
      margin-bottom: 40px;
    }
    .header h1 {
      margin-bottom: 10px;
      font-size: 32px;
    }
    .header p {
      color: #7f8c8d;
      font-size: 18px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 25px 0;
    }
    th, td {
      padding: 15px;
      text-align: center;
      border-bottom: 1px solid #ddd;
    }
    th {
      background-color: #f2f2f2;
      font-weight: 600;
    }
    .metric {
      text-align: left;
      font-weight: 600;
    }
    .improvement {
      font-weight: bold;
    }
    .positive {
      color: #27ae60;
    }
    .negative {
      color: #e74c3c;
    }
    .neutral {
      color: #7f8c8d;
    }
    .test-details {
      margin-top: 40px;
    }
    .test-details h3 {
      border-bottom: 1px solid #eee;
      padding-bottom: 10px;
    }
    .details-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 25px;
    }
    .detail-box {
      background-color: #f8f9fa;
      border-radius: 6px;
      padding: 20px;
    }
    .detail-box h4 {
      margin-top: 0;
      color: #34495e;
    }
    .chart-container {
      margin: 30px 0;
      height: 400px;
    }
    .conclusion {
      background-color: #e8f4f8;
      padding: 20px;
      border-radius: 6px;
      margin-top: 30px;
    }
    .highlight {
      background-color: #fffde7;
      padding: 15px;
      border-left: 4px solid #ffc107;
      margin: 20px 0;
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>OCR API Performance Comparison</h1>
      <p>PHP vs Node.js Implementation</p>
    </div>
    
    <h2>Performance Summary</h2>
    <table>
      <thead>
        <tr>
          <th>Metric</th>
          <th>PHP Implementation</th>
          <th>Node.js Implementation</th>
          <th>Improvement</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="metric">Requests Per Second</td>
          <td>${formatNum(comparison.requestsPerSecond.php)}</td>
          <td>${formatNum(comparison.requestsPerSecond.node)}</td>
          <td class="improvement ${comparison.requestsPerSecond.improvement.includes('+') ? 'positive' : 'negative'}">${comparison.requestsPerSecond.improvement}</td>
        </tr>
        <tr>
          <td class="metric">Success Rate</td>
          <td>${formatNum(comparison.successRate.php)}%</td>
          <td>${formatNum(comparison.successRate.node)}%</td>
          <td class="improvement ${comparison.successRate.improvement.includes('+') ? 'positive' : 'negative'}">${comparison.successRate.improvement}</td>
        </tr>
        <tr>
          <td class="metric">Average Response Time</td>
          <td>${formatNum(comparison.avgResponseTime.php)} ms</td>
          <td>${formatNum(comparison.avgResponseTime.node)} ms</td>
          <td class="improvement ${comparison.avgResponseTime.improvement.includes('+') ? 'positive' : 'negative'}">${comparison.avgResponseTime.improvement}</td>
        </tr>
        <tr>
          <td class="metric">Median Response Time</td>
          <td>${formatNum(comparison.medianResponseTime.php)} ms</td>
          <td>${formatNum(comparison.medianResponseTime.node)} ms</td>
          <td class="improvement ${comparison.medianResponseTime.improvement.includes('+') ? 'positive' : 'negative'}">${comparison.medianResponseTime.improvement}</td>
        </tr>
        <tr>
          <td class="metric">95th Percentile Response Time</td>
          <td>${formatNum(comparison.p95ResponseTime.php)} ms</td>
          <td>${formatNum(comparison.p95ResponseTime.node)} ms</td>
          <td class="improvement ${comparison.p95ResponseTime.improvement.includes('+') ? 'positive' : 'negative'}">${comparison.p95ResponseTime.improvement}</td>
        </tr>
      </tbody>
    </table>
    
    <div class="chart-container">
      <canvas id="responseTimeChart"></canvas>
    </div>
    
    <div class="chart-container">
      <canvas id="successRateChart"></canvas>
    </div>
    
    <div class="highlight">
      <h3>Key Findings</h3>
      <ul>
        <li><strong>Throughput:</strong> Node.js ${comparison.requestsPerSecond.improvement.includes('+') ? 'outperforms' : 'underperforms compared to'} PHP by ${comparison.requestsPerSecond.improvement.replace('+', '')} in requests per second</li>
        <li><strong>Reliability:</strong> Node.js achieves a ${formatNum(comparison.successRate.node)}% success rate compared to PHP's ${formatNum(comparison.successRate.php)}%</li>
        <li><strong>Response Time:</strong> Node.js response times are ${comparison.avgResponseTime.improvement.includes('+') ? 'faster' : 'slower'} than PHP by ${comparison.avgResponseTime.improvement.replace('+', '').replace('-', '')}</li>
      </ul>
    </div>
    
    <div class="conclusion">
      <h3>Conclusion</h3>
      <p>
        Based on the performance testing results, the Node.js implementation ${comparison.requestsPerSecond.improvement.includes('+') && comparison.successRate.improvement.includes('+') ? 'demonstrates clear improvements' : 'shows mixed results'} compared to the PHP implementation.
        ${comparison.successRate.node > comparison.successRate.php ? 'The increased reliability is a significant advantage, with higher success rates for API requests.' : ''}
        ${comparison.avgResponseTime.improvement.includes('+') ? 'Response times have been improved, which will result in better user experience.' : comparison.avgResponseTime.improvement.includes('-') ? 'Response times are currently slower, which may be an area for further optimization.' : ''}
      </p>
      <p>
        The Node.js implementation offers several architectural advantages:
      </p>
      <ul>
        <li>Asynchronous, non-blocking I/O for better concurrency</li>
        <li>Consistent API design with proper error handling</li>
        <li>Modern JavaScript ES6+ syntax for maintainability</li>
        <li>Structured project organization with separation of concerns</li>
        <li>Comprehensive error handling with detailed logging</li>
      </ul>
    </div>
  </div>
  
  <div class="container test-details">
    <h2>Test Configuration Details</h2>
    <div class="details-grid">
      <div class="detail-box">
        <h4>PHP Test Configuration</h4>
        <ul>
          <li><strong>API Endpoint:</strong> ${phpResults.config.api}</li>
          <li><strong>Total Requests:</strong> ${phpResults.config.totalRequests}</li>
          <li><strong>Concurrent Requests:</strong> ${phpResults.config.concurrentRequests}</li>
          <li><strong>Test Duration:</strong> ${formatNum(phpResults.results.totalTime)} seconds</li>
        </ul>
      </div>
      <div class="detail-box">
        <h4>Node.js Test Configuration</h4>
        <ul>
          <li><strong>API Endpoint:</strong> ${nodeResults.config.api}</li>
          <li><strong>Total Requests:</strong> ${nodeResults.config.totalRequests}</li>
          <li><strong>Concurrent Requests:</strong> ${nodeResults.config.concurrentRequests}</li>
          <li><strong>Test Duration:</strong> ${formatNum(nodeResults.results.totalTime)} seconds</li>
        </ul>
      </div>
    </div>
  </div>
  
  <script>
    // Response Time Chart
    const responseTimeCtx = document.getElementById('responseTimeChart').getContext('2d');
    new Chart(responseTimeCtx, {
      type: 'bar',
      data: {
        labels: ['Average', 'Median', '95th Percentile'],
        datasets: [
          {
            label: 'PHP (ms)',
            data: [${comparison.avgResponseTime.php}, ${comparison.medianResponseTime.php}, ${comparison.p95ResponseTime.php}],
            backgroundColor: 'rgba(54, 162, 235, 0.5)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1
          },
          {
            label: 'Node.js (ms)',
            data: [${comparison.avgResponseTime.node}, ${comparison.medianResponseTime.node}, ${comparison.p95ResponseTime.node}],
            backgroundColor: 'rgba(75, 192, 192, 0.5)',
            borderColor: 'rgba(75, 192, 192, 1)',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top' },
          title: {
            display: true,
            text: 'Response Time Comparison (lower is better)'
          }
        },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
    
    // Success Rate Chart
    const successRateCtx = document.getElementById('successRateChart').getContext('2d');
    new Chart(successRateCtx, {
      type: 'bar',
      data: {
        labels: ['Success Rate', 'Requests Per Second'],
        datasets: [
          {
            label: 'PHP',
            data: [${comparison.successRate.php}, ${comparison.requestsPerSecond.php}],
            backgroundColor: 'rgba(54, 162, 235, 0.5)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1
          },
          {
            label: 'Node.js',
            data: [${comparison.successRate.node}, ${comparison.requestsPerSecond.node}],
            backgroundColor: 'rgba(75, 192, 192, 0.5)',
            borderColor: 'rgba(75, 192, 192, 1)',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top' },
          title: {
            display: true,
            text: 'Success Rate (%) and Throughput (req/sec)'
          }
        },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  </script>
</body>
</html>`;

// Write the HTML report to a file
fs.writeFileSync(path.join(__dirname, '../public/performance-report.html'), html);

console.log('Performance comparison report generated: public/performance-report.html');
