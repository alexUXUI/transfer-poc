// Service Worker registration and communication
import { serviceWorkerCode } from "./service-worker-code";

// Check if service workers are supported in the browser
export const isServiceWorkerSupported = "serviceWorker" in navigator;

// The MFE origin where the service worker is hosted
const MFE_ORIGIN = "http://localhost:2001";

// Register the service worker
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isServiceWorkerSupported) {
    console.warn("Service workers are not supported in this browser");
    return null;
  }

  try {
    // Check if we already have an active service worker
    const existingRegistration =
      await navigator.serviceWorker.getRegistration();
    if (existingRegistration?.active) {
      console.log(
        "Found existing active service worker:",
        existingRegistration
      );
      return existingRegistration;
    }

    // Determine if we're running in the MFE or as a federated module
    const isMfeOrigin = window.location.origin.includes("2001");

    // Use the appropriate origin for service worker
    const swUrl = isMfeOrigin
      ? "/service-worker.js"
      : `${MFE_ORIGIN}/service-worker.js`;

    console.log(`Registering service worker from: ${swUrl}`);

    // Try using the standard service worker file
    let registration: ServiceWorkerRegistration;

    try {
      // Using the standard method to register service worker
      registration = await navigator.serviceWorker.register(swUrl, {
        scope: "/",
      });
      console.log("Service Worker registered successfully using file path");
    } catch (fileError) {
      console.warn(
        "Failed to register service worker using file path:",
        fileError
      );

      // Fallback to blob URL method if file doesn't exist
      console.log("Trying to register service worker using Blob URL...");
      const blob = new Blob([serviceWorkerCode], {
        type: "application/javascript",
      });
      const blobURL = URL.createObjectURL(blob);

      registration = await navigator.serviceWorker.register(blobURL, {
        scope: "/",
      });
      console.log("Service Worker registered successfully using Blob URL");

      // Clean up the blob URL after registration
      URL.revokeObjectURL(blobURL);
    }

    // Wait for the service worker to activate
    if (registration.installing) {
      console.log("Service worker installing...");

      // Wait for the service worker to become active
      await new Promise<void>((resolve) => {
        const stateChangeListener = (e: Event) => {
          if ((e.target as ServiceWorker).state === "activated") {
            console.log("Service worker activated");
            registration.installing?.removeEventListener(
              "statechange",
              stateChangeListener
            );
            resolve();
          }
        };
        if (registration.installing) {
          registration.installing.addEventListener(
            "statechange",
            stateChangeListener
          );
        } else {
          // If there's no installing service worker, it's likely already activated
          resolve();
        }
      });
    }

    return registration;
  } catch (error) {
    console.error("Service Worker registration failed:", error);
    return null;
  }
}

// Check if the service worker is active - making this more reliable
export async function isServiceWorkerActive(): Promise<boolean> {
  if (!isServiceWorkerSupported) return false;

  try {
    const registration = await navigator.serviceWorker.getRegistration();

    // Check if we have an active service worker
    if (registration?.active) {
      // Try to ping the service worker to verify it's responsive
      try {
        // Add a timeout to the ping check
        const pingPromise = pingServiceWorker();
        const timeoutPromise = new Promise<null>((_, reject) => {
          setTimeout(
            () => reject(new Error("Service worker ping timed out")),
            500
          );
        });

        // Race the ping against a timeout
        const pingResult = await Promise.race([pingPromise, timeoutPromise]);
        return pingResult !== null;
      } catch (err) {
        console.log("Service worker ping failed:", err);
        return false;
      }
    }

    return false;
  } catch (error) {
    console.error("Error checking service worker status:", error);
    return false;
  }
}

// Send a message to the service worker and wait for response
export async function sendMessageToServiceWorker<T = any>(
  message: { type: string; data?: any },
  timeout = 5000
): Promise<T> {
  return new Promise(async (resolve, reject) => {
    if (!isServiceWorkerSupported) {
      return reject(
        new Error("Service workers are not supported in this browser")
      );
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration || !registration.active) {
        return reject(new Error("No active service worker found"));
      }

      // Create a message channel for the response
      const messageChannel = new MessageChannel();

      // Set up a timeout
      const timeoutId = setTimeout(() => {
        messageChannel.port1.close();
        reject(new Error(`Service worker response timeout after ${timeout}ms`));
      }, timeout);

      // Listen for the response
      messageChannel.port1.onmessage = (event) => {
        clearTimeout(timeoutId);
        resolve(event.data);
      };

      // Send the message
      registration.active.postMessage(message, [messageChannel.port2]);
    } catch (error) {
      reject(error);
    }
  });
}

// Send a data chunk to be processed by the service worker
export async function sendChunkToServiceWorker(
  chunkId: string,
  items: any[],
  targetUrl: string
): Promise<void> {
  if (!isServiceWorkerSupported) {
    throw new Error("Service workers are not supported in this browser");
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration || !registration.active) {
      throw new Error("No active service worker found");
    }

    // Create a message channel for potential responses
    const messageChannel = new MessageChannel();

    // Set up a timeout for acknowledgment
    const transferPromise = new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        messageChannel.port1.close();
        reject(new Error("Service worker did not acknowledge chunk transfer"));
      }, 2000);

      // Listen for acknowledgment
      messageChannel.port1.onmessage = (event) => {
        if (event.data?.type === "CHUNK_RECEIVED") {
          clearTimeout(timeoutId);
          resolve();
        }
      };

      // Send the message with the message channel - we know active exists from check above
      if (registration.active) {
        registration.active.postMessage(
          {
            type: "TRANSFER_CHUNK",
            data: {
              chunkId,
              items,
              targetUrl,
            },
          },
          [messageChannel.port2]
        );
      } else {
        // This should never happen but is needed for TypeScript
        reject(new Error("Service worker disappeared unexpectedly"));
      }
    });

    // Wait for acknowledgment or timeout
    await transferPromise;
  } catch (error) {
    console.error("Error sending chunk to service worker:", error);
    throw error;
  }
}

// Setup the service worker message listener
export function setupServiceWorkerMessageListener(
  callback: (event: MessageEvent) => void
): () => void {
  if (!isServiceWorkerSupported) {
    console.warn("Service workers are not supported in this browser");
    return () => {};
  }

  // Add the event listener
  navigator.serviceWorker.addEventListener("message", callback);

  // Return a function to remove the listener
  return () => {
    navigator.serviceWorker.removeEventListener("message", callback);
  };
}

// Ping the service worker to check if it's responsive
export async function pingServiceWorker(): Promise<{
  version: string;
  timestamp: string;
} | null> {
  try {
    const response = await sendMessageToServiceWorker<{
      type: string;
      data: { version: string; timestamp: string };
    }>({
      type: "PING",
    });

    if (response.type === "PONG") {
      return response.data;
    }
    return null;
  } catch (error) {
    console.error("Error pinging service worker:", error);
    return null;
  }
}
