// This file contains the service worker code as a string
// We'll use this to create a Blob and register it dynamically

export const serviceWorkerCode = `
// Service Worker for data transfer operations
const SW_VERSION = "1.0.0";
const CACHE_NAME = "data-transfer-cache-v1";

// Install event - set up any caches needed
self.addEventListener("install", (event) => {
  console.log("[Service Worker] Installing Service Worker...", SW_VERSION);
  self.skipWaiting(); // Ensure service worker activates immediately
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  console.log("[Service Worker] Activating Service Worker...", SW_VERSION);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log("[Service Worker] Removing old cache:", name);
            return caches.delete(name);
          }
        })
      );
    })
  );
  return self.clients.claim(); // Take control of clients immediately
});

// Message event - handle messages from the main thread
self.addEventListener("message", (event) => {
  console.log("[Service Worker] Message received:", event.data);
  const { type, data } = event.data;

  switch (type) {
    case "PING":
      event.ports[0].postMessage({
        type: "PONG",
        data: { version: SW_VERSION, timestamp: new Date().toISOString() },
      });
      break;

    case "TRANSFER_CHUNK":
      // Process data transfer in the background
      event.waitUntil(
        processDataTransfer(data.items, data.targetUrl)
          .then((result) => {
            // Notify all clients of the result
            self.clients.matchAll().then((clients) => {
              clients.forEach((client) => {
                client.postMessage({
                  type: "TRANSFER_CHUNK_RESULT",
                  data: {
                    chunkId: data.chunkId,
                    success: true,
                    result,
                  },
                });
              });
            });
          })
          .catch((error) => {
            // Notify all clients of the error
            self.clients.matchAll().then((clients) => {
              clients.forEach((client) => {
                client.postMessage({
                  type: "TRANSFER_CHUNK_RESULT",
                  data: {
                    chunkId: data.chunkId,
                    success: false,
                    error: error.message || "Unknown error",
                  },
                });
              });
            });
          })
      );
      break;

    default:
      console.log("[Service Worker] Unknown message type:", type);
  }
});

// Function to process data transfer
async function processDataTransfer(items, targetUrl) {
  console.log(
    \`[Service Worker] Processing \${items.length} items to \${targetUrl}\`
  );

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(items),
    });

    if (!response.ok) {
      throw new Error(\`HTTP error \${response.status}: \${response.statusText}\`);
    }

    const result = await response.json();
    console.log("[Service Worker] Transfer successful:", result);
    return result;
  } catch (error) {
    console.error("[Service Worker] Transfer failed:", error);
    throw error;
  }
}
`;
