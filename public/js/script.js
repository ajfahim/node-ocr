document.addEventListener("DOMContentLoaded", () => {
  const imageUpload = document.getElementById("imageUpload");
  const processButton = document.getElementById("processButton");
  const resultsArea = document.getElementById("resultsArea");
  const loadingDiv = document.getElementById("loading");
  const fileChosenText = document.getElementById("file-chosen-text");

  let selectedFiles = [];
  let placeholderIdCounter = 0;

  // Ensure PDF.js worker is set if the library is loaded
  if (typeof pdfjsLib !== "undefined") {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      pdfjsLib.GlobalWorkerOptions.workerSrc ||
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  } else {
    console.warn("PDF.js library not found. PDF processing will not work.");
  }

  imageUpload.addEventListener("change", (event) => {
    selectedFiles = Array.from(event.target.files);
    if (selectedFiles.length > 0) {
      fileChosenText.textContent = `${
        selectedFiles.length
      } file(s) chosen: ${selectedFiles.map((f) => f.name).join(", ")}`;
      processButton.disabled = false;
    } else {
      fileChosenText.textContent = "No files chosen";
      processButton.disabled = true;
    }
  });

  function createPlaceholder(fileName, placeholderId) {
    const placeholderDiv = document.createElement("div");
    placeholderDiv.id = placeholderId;
    placeholderDiv.classList.add("result-item", "processing");
    placeholderDiv.innerHTML = `<h3>${escapeHTML(
      fileName
    )}</h3><p class="status-message">Processing...</p><div class="spinner-local" style="display:block;"></div>`;
    resultsArea.appendChild(placeholderDiv);
  }

  function updatePlaceholder(
    placeholderId,
    resultData,
    originalFileNameForDisplay
  ) {
    const placeholderDiv = document.getElementById(placeholderId);
    if (!placeholderDiv) {
      console.error("Placeholder not found for ID:", placeholderId);
      return;
    }

    placeholderDiv.classList.remove("processing");
    const localSpinner = placeholderDiv.querySelector(".spinner-local");
    if (localSpinner) localSpinner.style.display = "none";

    if (resultData.success) {
      placeholderDiv.classList.add("success");
    } else {
      placeholderDiv.classList.add("error");
    }

    let displayName = resultData.fileName || originalFileNameForDisplay;
    let content = `<h3>${escapeHTML(displayName)} (Credential: ${escapeHTML(
      resultData.credentialUsed || "N/A"
    )})</h3>`;

    if (resultData.success && resultData.text !== undefined) {
      content += `<pre>${escapeHTML(resultData.text)}</pre>`;
    } else {
      content += `<p class="error-message">Error: ${escapeHTML(
        resultData.error || "Unknown OCR error"
      )}</p>`;
    }
    placeholderDiv.innerHTML = content;
  }

  function updatePlaceholderWithClientError(
    placeholderId,
    fileNameForDisplay,
    errorMessage
  ) {
    const placeholderDiv = document.getElementById(placeholderId);
    if (!placeholderDiv) return;

    placeholderDiv.classList.remove("processing");
    placeholderDiv.classList.add("error");
    const localSpinner = placeholderDiv.querySelector(".spinner-local");
    if (localSpinner) localSpinner.style.display = "none";

    placeholderDiv.innerHTML = `<h3>Error with ${escapeHTML(
      fileNameForDisplay
    )}</h3><p class="error-message">${escapeHTML(errorMessage)}</p>`;
  }

  function sendImageDataForOcr(imageBase64, fileName, placeholderId) {
    return new Promise((resolve, reject) => {
      fetch("/api/ocr/base64", {
        method: "POST",
        body: JSON.stringify({ imageBase64, originalFileName: fileName }),
        headers: {
          "Content-Type": "application/json",
        },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          return response.json();
        })
        .then((results) => {
          if (results && results.length > 0) {
            updatePlaceholder(placeholderId, results[0], fileName);
          } else {
            updatePlaceholder(
              placeholderId,
              {
                success: false,
                error: "Unexpected server response format.",
                fileName: fileName,
                credentialUsed: "N/A",
              },
              fileName
            );
          }
          resolve();
        })
        .catch((error) => {
          console.error(`Error processing ${fileName}:`, error);
          updatePlaceholder(
            placeholderId,
            {
              success: false,
              error: "Network error or invalid response from server.",
              fileName: fileName,
              credentialUsed: "N/A",
            },
            fileName
          );
          resolve(); // Resolve even on error to not break Promise.all
        });
    });
  }

  processButton.addEventListener("click", async () => {
    if (selectedFiles.length === 0) {
      alert("Please select one or more files to process.");
      return;
    }
    if (
      typeof pdfjsLib === "undefined" &&
      selectedFiles.some((f) => f.type === "application/pdf")
    ) {
      alert(
        "PDF.js library is not loaded. PDF processing is disabled for PDF files."
      );
    }

    // Show loading indicator
    loadingDiv.style.display = "block";
    processButton.disabled = true;
    resultsArea.innerHTML = "<h2>Processing...</h2>";

    // Prepare tasks list for processing
    const fileTasks = [];

    // Loop through all selected files and determine processing strategy
    for (const file of selectedFiles) {
      if (file.type.startsWith("image/")) {
        // Image task
        const placeholderId = `item-${placeholderIdCounter++}`;
        createPlaceholder(file.name, placeholderId);
        fileTasks.push({
          type: "image",
          file: file,
          placeholderId: placeholderId,
        });
      } else if (
        file.type === "application/pdf" &&
        typeof pdfjsLib !== "undefined"
      ) {
        // For PDFs, we need to load the doc to know the number of pages first
        // This task will resolve with an array of page tasks
        fileTasks.push({
          type: "pdf-meta",
          file,
          promise: (async () => {
            try {
              const arrayBuffer = await file.arrayBuffer();
              const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer })
                .promise;
              const pageTasks = [];
              for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
                const pageFileName = `${file.name}-page-${pageNum}.png`;
                const placeholderId = `item-${placeholderIdCounter++}`;
                createPlaceholder(pageFileName, placeholderId);
                pageTasks.push({
                  type: "pdf-page",
                  pdfDoc,
                  pageNum,
                  pageFileName,
                  placeholderId,
                });
              }
              return pageTasks;
            } catch (pdfLoadError) {
              console.error(
                `Error loading PDF ${file.name} for page counting:`,
                pdfLoadError
              );
              const placeholderId = `item-${placeholderIdCounter++}`;
              createPlaceholder(file.name, placeholderId);
              updatePlaceholderWithClientError(
                placeholderId,
                file.name,
                `Failed to load PDF: ${pdfLoadError.message}`
              );
              return []; // Return empty array on failure to load PDF meta
            }
          })(),
        });
      } else if (file.type === "application/pdf") {
        const placeholderId = `item-${placeholderIdCounter++}`;
        createPlaceholder(file.name, placeholderId);
        updatePlaceholderWithClientError(
          placeholderId,
          file.name,
          "PDF.js library not loaded. Skipping PDF."
        );
      }
    }

    // Prepare for batch processing of all image files
    const batchProcessImages = async () => {
      // Get all image tasks
      const imageTasks = fileTasks.filter((task) => task.type === "image");
      if (imageTasks.length === 0) return;

      try {
        // Convert all images to base64 in parallel
        const imageDataPromises = imageTasks.map((task) => {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => {
              resolve({
                placeholderId: task.placeholderId,
                imageBase64: event.target.result,
                originalFileName: task.file.name,
              });
            };
            reader.onerror = (error) => reject({ task, error });
            reader.readAsDataURL(task.file);
          });
        });

        // Wait for all images to be processed to base64
        const imagesData = await Promise.all(imageDataPromises);

        // Send the batch to the server
        const response = await fetch("/api/ocr/base64", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(imagesData),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const batchResults = await response.json();
        console.log("Batch processing results:", batchResults);

        // Process the results
        if (batchResults.results && Array.isArray(batchResults.results)) {
          // Map results to placeholders using file names
          const fileNameToPlaceholderId = {};
          imageTasks.forEach((task) => {
            fileNameToPlaceholderId[task.file.name] = task.placeholderId;
          });

          batchResults.results.forEach((result) => {
            const placeholderId = fileNameToPlaceholderId[result.fileName];
            if (placeholderId) {
              updatePlaceholder(placeholderId, result, result.fileName);
            }
          });

          // Add batch processing summary
          const summaryDiv = document.createElement("div");
          summaryDiv.className = "batch-summary";
          summaryDiv.innerHTML = `
            <h3>Batch Processing Summary</h3>
            <p>Processed ${
              batchResults.meta.processedCount
            } files in ${batchResults.meta.batchProcessingTime.toFixed(
            2
          )} seconds</p>
          `;
          resultsArea.insertBefore(summaryDiv, resultsArea.firstChild);
        }
      } catch (error) {
        console.error("Batch processing error:", error);
        imageTasks.forEach((task) => {
          updatePlaceholderWithClientError(
            task.placeholderId,
            task.file.name,
            `Batch processing error: ${error.message}`
          );
        });
      }
    };

    // Now execute the tasks
    const allProcessingPromises = [];

    // Add batch image processing promise
    allProcessingPromises.push(batchProcessImages());

    // Process PDF files individually as before
    for (const task of fileTasks) {
      if (task.type === "pdf-meta") {
        allProcessingPromises.push(
          (async () => {
            const pageTasks = await task.promise; // Get array of page tasks
            const pdfPageProcessingPromises = pageTasks.map((pageTask) =>
              (async () => {
                try {
                  const page = await pageTask.pdfDoc.getPage(pageTask.pageNum);
                  const viewport = page.getViewport({ scale: 1.5 });
                  const canvas = document.createElement("canvas");
                  canvas.height = viewport.height;
                  canvas.width = viewport.width;
                  const context = canvas.getContext("2d");
                  await page.render({
                    canvasContext: context,
                    viewport: viewport,
                  }).promise;
                  const imageBase64 = canvas.toDataURL("image/png");
                  await sendImageDataForOcr(
                    imageBase64,
                    pageTask.pageFileName,
                    pageTask.placeholderId
                  );
                } catch (pageRenderError) {
                  console.error(
                    `Error rendering PDF page ${pageTask.pageFileName}:`,
                    pageRenderError
                  );
                  updatePlaceholderWithClientError(
                    pageTask.placeholderId,
                    pageTask.pageFileName,
                    `Page rendering error: ${pageRenderError.message}`
                  );
                }
              })()
            );
            await Promise.all(pdfPageProcessingPromises);
          })()
        );
      }
    }

    try {
      await Promise.all(allProcessingPromises);
    } catch (error) {
      console.error("A critical error occurred in processing promises:", error);
    } finally {
      loadingDiv.style.display = "none"; // Hide global loading indicator
      processButton.disabled = false;
      imageUpload.value = "";
      selectedFiles = [];
      fileChosenText.textContent = "No files chosen";
    }
  });

  function escapeHTML(str) {
    if (typeof str !== "string") return "";
    return str.replace(/[&<>"'\/]/g, function (match) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
        "/": "&#x2F;",
      }[match];
    });
  }

  processButton.disabled = true;
});
