import React, { useEffect, useState, useCallback } from "react";
import { dataTransferService, TransferEvents } from "../services/data-transfer";
import { TransferSession } from "../services/db";

// Constants
const SOURCE_URL = "http://localhost:3000/specification";
const TARGET_URL = "http://localhost:3001/upload";

interface DataTransferProps {
  onUnmount?: () => void;
}

// Statuses displayed to user
const statusMessages = {
  initializing: "Preparing transfer...",
  active: "Transferring data...",
  paused: "Transfer paused",
  completed: "Transfer completed",
  failed: "Transfer failed",
};

// Simple notification function instead of toast
const showNotification = (
  message: string,
  type: "success" | "error" | "info" = "info"
) => {
  console.log(`[${type.toUpperCase()}] ${message}`);
  // You could implement a custom notification UI here if needed
};

const DataTransfer: React.FC<DataTransferProps> = ({ onUnmount }) => {
  // State
  const [session, setSession] = useState<TransferSession | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [processedItems, setProcessedItems] = useState(0);
  const [totalItems, setTotalItems] = useState<number | null>(null);
  const [percentage, setPercentage] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processingChunks, setProcessingChunks] = useState(0);
  const [successfulChunks, setSuccessfulChunks] = useState(0);
  const [failedChunks, setFailedChunks] = useState(0);
  const [isBrowserSupported, setIsBrowserSupported] = useState(true);

  // Check if the browser is supported
  useEffect(() => {
    // IndexedDB is required
    const isSupported = "indexedDB" in window;
    setIsBrowserSupported(isSupported);

    if (!isSupported) {
      setError("Your browser does not support required features (IndexedDB).");
    }
  }, []);

  // Set up event handlers for the data transfer service
  useEffect(() => {
    // Define event handlers
    const events: TransferEvents = {
      onSessionCreated: (newSession) => {
        setSession(newSession);
        console.log("Session created:", newSession);
      },

      onStatusChange: (status, updatedSession) => {
        setSession(updatedSession);
        console.log(`Status changed to ${status}`);

        if (status === "completed") {
          showNotification("Data transfer completed successfully!", "success");
        } else if (status === "failed") {
          showNotification(
            `Transfer failed: ${updatedSession.error || "Unknown error"}`,
            "error"
          );
        } else if (status === "paused") {
          showNotification("Transfer paused", "info");
        } else if (status === "active") {
          showNotification("Transfer active", "info");
        }
      },

      onProgress: (processed, total, percent) => {
        // Simply apply the progress values directly - no calculation or extra logic
        setProcessedItems(processed);
        if (total !== null) setTotalItems(total);
        if (percent !== null) setPercentage(percent);
      },

      onChunkProcessed: (chunkId, success, items) => {
        if (success) {
          setSuccessfulChunks((prev) => prev + 1);
        } else {
          setFailedChunks((prev) => prev + 1);
        }
        setProcessingChunks((prev) => Math.max(0, prev - 1));
      },

      onError: (err) => {
        setError(err.message);
        showNotification(`Error: ${err.message}`, "error");
      },
    };

    // Register event handlers
    dataTransferService.on(events);

    // Check for existing session
    const checkSession = async () => {
      try {
        const existingSession = await dataTransferService.getCurrentSession();
        if (existingSession) {
          setSession(existingSession);
          setProcessedItems(existingSession.processedItems);
          setTotalItems(existingSession.totalItems);

          if (
            existingSession.totalItems !== null &&
            existingSession.processedItems > 0
          ) {
            setPercentage(
              Math.round(
                (existingSession.processedItems / existingSession.totalItems) *
                  100
              )
            );
          }

          // The service will handle auto-resuming, but make sure the UI reflects the current state
          if (existingSession.status === "active") {
            showNotification("Transfer is in progress", "info");
          }
        }
      } catch (error) {
        console.error("Error checking session:", error);
      }
    };

    checkSession();

    // Cleanup when the component unmounts
    return () => {
      // Don't stop the transfer, just notify parent component
      if (onUnmount) {
        onUnmount();
      }
    };
  }, [onUnmount]);

  // Single unified UI refresh effect - SIMPLIFIED
  useEffect(() => {
    // Only run if we need to keep the UI updated
    if (!session) return;

    // Set up an interval to refresh the UI from the database
    const refreshInterval = setInterval(async () => {
      try {
        const currentSession = await dataTransferService.getCurrentSession();
        if (!currentSession) return;

        // Update all state directly from the database
        setSession(currentSession);
        setProcessedItems(currentSession.processedItems);

        if (currentSession.totalItems !== null) {
          setTotalItems(currentSession.totalItems);
          // Calculate percentage but don't update separate state for chunks
          const calcPercentage = Math.round(
            (currentSession.processedItems / currentSession.totalItems) * 100
          );
          setPercentage(calcPercentage);
        }

        // Calculate chunks directly from the database value
        const chunkSize = currentSession.chunkSize || 100;
        const chunks = Math.ceil(currentSession.processedItems / chunkSize);
        setSuccessfulChunks(chunks);
      } catch (error) {
        // Silent error handling
      }
    }, 250);

    return () => clearInterval(refreshInterval);
  }, [session]);

  // Add a reset mechanism when session gets into a bad state
  useEffect(() => {
    if (!session) return;

    // Detect if processing is stuck with no activity for a long time
    let lastProcessedCount = session.processedItems;
    let stuckCounter = 0;

    const stuckDetector = setInterval(() => {
      if (session.status !== "active") return;

      // Compare if processedItems has changed
      if (session.processedItems === lastProcessedCount) {
        stuckCounter++;
        if (stuckCounter > 20) {
          // About 5 seconds with no activity
          console.log("Flushing chunks...");
          // Refresh session data directly from database
          dataTransferService.getCurrentSession().then((currentSession) => {
            if (currentSession) {
              setSession(currentSession);
              setProcessedItems(currentSession.processedItems);
              setTotalItems(currentSession.totalItems);
              if (currentSession.totalItems !== null) {
                setPercentage(
                  Math.round(
                    (currentSession.processedItems /
                      currentSession.totalItems) *
                      100
                  )
                );
              }
            }
          });
          stuckCounter = 0;
        }
      } else {
        // Reset counter if we have activity
        stuckCounter = 0;
        lastProcessedCount = session.processedItems;
      }
    }, 250);

    return () => clearInterval(stuckDetector);
  }, [session?.id]);

  // Start transfer
  const startTransfer = useCallback(async () => {
    try {
      setIsStarting(true);
      setError(null);
      setProcessedItems(0);
      setTotalItems(null);
      setPercentage(null);
      setSuccessfulChunks(0);
      setFailedChunks(0);
      setProcessingChunks(0);

      await dataTransferService.startTransfer(SOURCE_URL, TARGET_URL, 100);
    } catch (error) {
      console.error("Error starting transfer:", error);
      setError(
        error instanceof Error
          ? error.message
          : "Unknown error starting transfer"
      );
      showNotification(
        `Failed to start transfer: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        "error"
      );
    } finally {
      setIsStarting(false);
    }
  }, []);

  // Pause transfer
  const pauseTransfer = useCallback(async () => {
    try {
      await dataTransferService.pauseTransfer();
    } catch (error) {
      console.error("Error pausing transfer:", error);
      showNotification(
        `Failed to pause transfer: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        "error"
      );
    }
  }, []);

  // Resume transfer
  const resumeTransfer = useCallback(async () => {
    try {
      await dataTransferService.resumeTransfer();
    } catch (error) {
      console.error("Error resuming transfer:", error);
      showNotification(
        `Failed to resume transfer: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        "error"
      );
    }
  }, []);

  // Cancel transfer
  const cancelTransfer = useCallback(async () => {
    try {
      await dataTransferService.cancelTransfer();
    } catch (error) {
      console.error("Error cancelling transfer:", error);
      showNotification(
        `Failed to cancel transfer: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        "error"
      );
    }
  }, []);

  if (!isBrowserSupported) {
    return (
      <div className="data-transfer-container">
        <div className="error-message">
          <h3>Browser Not Supported</h3>
          <p>
            Your browser does not support the required features for data
            transfer (IndexedDB).
          </p>
          <p>
            Please try using a modern browser like Chrome, Firefox, Edge or
            Safari.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="data-transfer-container">
      <h2>Data Transfer</h2>

      <div
        className="debug-banner"
        style={{
          backgroundColor: "#fff3cd",
          border: "1px solid #ffeeba",
          color: "#856404",
          padding: "10px",
          borderRadius: "4px",
          marginBottom: "15px",
          fontWeight: "bold",
        }}
      >
        TESTING MODE: Synthetic delays enabled (3s fetch + 10s processing)
      </div>

      {error && (
        <div className="error-message">
          <h3>Error</h3>
          <p>{error}</p>
        </div>
      )}

      <div className="status-section">
        <h3>Status</h3>
        <div className="status-info">
          <p>
            <strong>Status:</strong>{" "}
            {session ? statusMessages[session.status] : "Ready to start"}
          </p>

          {session && (
            <>
              <div className="progress-details">
                <p className="progress-count">
                  <strong>Progress:</strong>{" "}
                  <span className="progress-numbers">
                    {processedItems} items processed
                    {totalItems !== null && ` of ${totalItems}`}
                  </span>
                  {percentage !== null && (
                    <span className="progress-percentage">({percentage}%)</span>
                  )}
                </p>

                <p>
                  <strong>Chunks:</strong> {successfulChunks} successful,{" "}
                  {failedChunks} failed, {processingChunks} in progress
                </p>
              </div>
            </>
          )}
        </div>

        {session && session.status === "active" && (
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{
                width: percentage !== null ? `${percentage}%` : "0%",
                transition: "width 0.05s linear",
              }}
            />
            <div className="progress-bar-text">
              {percentage !== null ? `${percentage}%` : "Processing..."}
            </div>
          </div>
        )}
      </div>

      <div className="controls-section">
        {!session && (
          <button
            onClick={startTransfer}
            disabled={isStarting || !isBrowserSupported}
            className="start-button"
          >
            {isStarting ? "Starting..." : "Start Transfer"}
          </button>
        )}

        {session && session.status === "active" && (
          <button onClick={pauseTransfer} className="pause-button">
            Pause Transfer
          </button>
        )}

        {session && session.status === "paused" && (
          <button onClick={resumeTransfer} className="resume-button">
            Resume Transfer
          </button>
        )}

        {session && ["active", "paused", "failed"].includes(session.status) && (
          <button onClick={cancelTransfer} className="cancel-button">
            Cancel Transfer
          </button>
        )}

        {session && session.status === "completed" && (
          <button onClick={startTransfer} className="start-button">
            Start New Transfer
          </button>
        )}
      </div>

      {session && session.status === "failed" && session.error && (
        <div className="error-details">
          <h3>Error Details</h3>
          <pre>{session.error}</pre>
        </div>
      )}

      <div className="info-section">
        <p>
          <strong>Source:</strong> {SOURCE_URL}
        </p>
        <p>
          <strong>Target:</strong> {TARGET_URL}
        </p>
      </div>
    </div>
  );
};

export default DataTransfer;
