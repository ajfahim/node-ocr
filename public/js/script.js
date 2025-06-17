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
      const formData = new FormData();
      formData.append("imageBase64", imageBase64);
      formData.append("originalFileName", fileName);

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

    resultsArea.innerHTML = "<h2>Results:</h2>";
    loadingDiv.style.display = "block"; // Global loading indicator
    processButton.disabled = true;
    placeholderIdCounter = 0; // Reset for unique IDs per batch

    const allProcessingPromises = [];

    // First pass to create all placeholders for images and determine PDF pages for placeholders
    const fileTasks = [];
    for (const file of selectedFiles) {
      if (file.type.startsWith("image/")) {
        const placeholderId = `item-${placeholderIdCounter++}`;
        createPlaceholder(file.name, placeholderId);
        fileTasks.push({ type: "image", file, placeholderId });
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

    // Now execute the tasks
    for (const task of fileTasks) {
      if (task.type === "image") {
        allProcessingPromises.push(
          (async () => {
            try {
              const reader = new FileReader();
              const base64Image = await new Promise((resolve, reject) => {
                reader.onload = (event) => resolve(event.target.result);
                reader.onerror = (error) => reject(error);
                reader.readAsDataURL(task.file);
              });
              await sendImageDataForOcr(
                base64Image,
                task.file.name,
                task.placeholderId
              );
            } catch (readError) {
              console.error(
                `Error reading image file ${task.file.name}:`,
                readError
              );
              updatePlaceholderWithClientError(
                task.placeholderId,
                task.file.name,
                "Could not read the file."
              );
            }
          })()
        );
      } else if (task.type === "pdf-meta") {
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
