// Service Worker for data transfer operations
const SW_VERSION = "1.0.2";
const CACHE_NAME = "data-transfer-cache-v1";

// Log functionality
const logSW = (level, ...args) => {
  const prefix = "[Service Worker]";
  switch (level) {
    case "error":
      console.error(prefix, ...args);
      break;
    case "warn":
      console.warn(prefix, ...args);
      break;
    default:
      console.log(prefix, ...args);
  }
};

// Install event - set up any caches needed
self.addEventListener("install", (event) => {
  logSW("info", "Installing Service Worker...", SW_VERSION);
  self.skipWaiting(); // Ensure service worker activates immediately
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  logSW("info", "Activating Service Worker...", SW_VERSION);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            logSW("info", "Removing old cache:", name);
            return caches.delete(name);
          }
        })
      );
    })
  );
  logSW("info", "Taking control of clients...");
  return self.clients.claim(); // Take control of clients immediately
});

// Function to broadcast a message to all clients
const broadcastToClients = async (message) => {
  try {
    const clients = await self.clients.matchAll();
    logSW("info", `Broadcasting to ${clients.length} clients`);

    clients.forEach((client) => {
      client.postMessage(message);
    });
  } catch (error) {
    logSW("error", "Error broadcasting to clients:", error);
  }
};

// Message event - handle messages from the main thread
self.addEventListener("message", (event) => {
  logSW("info", "Message received:", event.data);
  const { type, data } = event.data;

  switch (type) {
    case "PING":
      try {
        logSW("info", "Ping received, sending PONG...");
        event.ports[0].postMessage({
          type: "PONG",
          data: { version: SW_VERSION, timestamp: new Date().toISOString() },
        });
      } catch (error) {
        logSW("error", "Error handling PING:", error);
      }
      break;

    case "TRANSFER_CHUNK":
      // Process data transfer in the background
      logSW(
        "info",
        `Processing chunk ${data.chunkId} with ${data.items.length} items`
      );

      event.waitUntil(
        processDataTransfer(data.items, data.targetUrl, data.chunkId)
          .then((result) => {
            // Notify all clients of the result
            broadcastToClients({
              type: "TRANSFER_CHUNK_RESULT",
              data: {
                chunkId: data.chunkId,
                success: true,
                result,
              },
            });
          })
          .catch((error) => {
            logSW("error", `Error processing chunk ${data.chunkId}:`, error);

            // Notify all clients of the error
            broadcastToClients({
              type: "TRANSFER_CHUNK_RESULT",
              data: {
                chunkId: data.chunkId,
                success: false,
                error: error.message || "Unknown error",
              },
            });
          })
      );
      break;

    default:
      logSW("warn", "Unknown message type:", type);
  }
});

// Function to process data transfer
async function processDataTransfer(items, targetUrl, chunkId) {
  logSW(
    "info",
    `Processing chunk ${chunkId}: ${items.length} items to ${targetUrl}`
  );

  try {
    // Handle empty items array
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error("No items to process");
    }

    // Direct fetch without using service worker cache
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(items),
      // Bypass service worker cache
      cache: "no-store",
      // Add credentials if needed
      credentials: "same-origin",
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(
        `HTTP error ${response.status}: ${response.statusText}. ${responseText}`
      );
    }

    const result = await response.json();
    logSW("info", `Chunk ${chunkId} transfer successful:`, result);
    return result;
  } catch (error) {
    logSW("error", `Chunk ${chunkId} transfer failed:`, error);
    throw error;
  }
}
