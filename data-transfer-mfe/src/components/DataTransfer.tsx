import React, { useEffect, useState, useCallback } from "react";
import { dataTransferService, TransferEvents } from "../services/data-transfer";
import { TransferSession } from "../services/db";
import { isServiceWorkerSupported } from "../services/service-worker";

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
    // Service workers and IndexedDB are required
    const isSupported = isServiceWorkerSupported && "indexedDB" in window;
    setIsBrowserSupported(isSupported);

    if (!isSupported) {
      setError(
        "Your browser does not support required features (Service Workers and IndexedDB)."
      );
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

          // Set up more frequent UI refresh for active transfers
          const activeRefreshInterval = setInterval(() => {
            dataTransferService.getCurrentSession().then((currentSession) => {
              if (currentSession) {
                setProcessedItems(currentSession.processedItems);
                if (currentSession.totalItems !== null) {
                  setTotalItems(currentSession.totalItems);
                  const newPercentage = Math.round(
                    (currentSession.processedItems /
                      currentSession.totalItems) *
                      100
                  );
                  setPercentage(newPercentage);
                }
              }
            });
          }, 250); // Very frequent updates during active transfers

          // Clean up interval when component unmounts or transfer status changes
          return () => clearInterval(activeRefreshInterval);
        }
      },

      onProgress: (processed, total, percent) => {
        console.log(
          `Progress update received: ${processed}/${total} (${percent}%)`
        );
        setProcessedItems(processed);
        if (total !== null) setTotalItems(total);
        if (percent !== null) setPercentage(percent);

        // Force UI refresh if needed
        if (processed > 0 && session?.processedItems === 0) {
          console.log("Forcing session update due to progress change");
          // Update the session state to trigger UI refresh
          if (session) {
            setSession({
              ...session,
              processedItems: processed,
              totalItems: total !== null ? total : session.totalItems,
            });
          }
        }
      },

      onChunkProcessed: (chunkId, success, items) => {
        if (success) {
          // Update the successful chunks count
          setSuccessfulChunks((prev) => prev + 1);

          // CRITICAL FIX: Directly increment processed items when a chunk succeeds
          if (items > 0) {
            console.log(
              `UI SYNC: Adding ${items} processed items directly from chunk success`
            );
            // Use functional update to ensure we're using latest state
            setProcessedItems((prev) => {
              const newCount = prev + items;
              console.log(
                `Updating processed items from ${prev} to ${newCount}`
              );

              // Update percentage directly here to ensure immediate UI refresh
              if (totalItems) {
                const newPercentage = Math.round((newCount / totalItems) * 100);
                setPercentage(newPercentage);
              }

              // Also update session to reflect changes immediately
              if (session) {
                const updatedSession = {
                  ...session,
                  processedItems: newCount,
                };
                setSession(updatedSession);
              }

              return newCount;
            });
          }
        } else {
          setFailedChunks((prev) => prev + 1);
        }
        setProcessingChunks((prev) => Math.max(0, prev - 1));

        // Force a UI refresh by requesting current session data
        dataTransferService.getCurrentSession().then((currentSession) => {
          if (currentSession) {
            setSession(currentSession);
            setProcessedItems(currentSession.processedItems);
            if (currentSession.totalItems !== null) {
              setTotalItems(currentSession.totalItems);
              const newPercentage = Math.round(
                (currentSession.processedItems / currentSession.totalItems) *
                  100
              );
              setPercentage(newPercentage);
            }
          }
        });
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

  // Force refresh UI state after chunks are processed
  useEffect(() => {
    // Direct function to sync UI state with database
    const syncUIWithDatabase = async () => {
      if (!session) return;

      try {
        // Directly query database for the most accurate data
        const currentSession = await dataTransferService.getCurrentSession();
        if (!currentSession) return;

        // Forcefully update all state values to ensure UI reflects reality
        console.log(
          `SYNC: DB shows ${currentSession.processedItems}/${currentSession.totalItems} items processed`
        );

        // Always update these values to ensure UI is in sync
        setProcessedItems(currentSession.processedItems);
        setTotalItems(currentSession.totalItems);

        // Update percentage
        if (
          currentSession.totalItems !== null &&
          currentSession.totalItems > 0
        ) {
          const newPercentage = Math.round(
            (currentSession.processedItems / currentSession.totalItems) * 100
          );
          setPercentage(newPercentage);
        }

        // Update other values
        setSession(currentSession);

        // Update chunk statistics based on processed items
        if (currentSession.processedItems > 0) {
          const chunksProcessed = Math.floor(
            currentSession.processedItems / 100
          );
          setSuccessfulChunks(chunksProcessed);
        }
      } catch (error) {
        console.error("Sync error:", error);
      }
    };

    // Run sync immediately
    syncUIWithDatabase();

    // Fast polling interval during active transfers
    const intervalId = setInterval(() => {
      if (session?.status === "active") {
        syncUIWithDatabase();
      }
    }, 500); // Poll every 500ms during active transfers

    return () => clearInterval(intervalId);
  }, [session?.id, session?.status, processedItems]);

  // Add a real-time UI refresh effect for when session is active
  useEffect(() => {
    // Only run this when session is active
    if (!session || session.status !== "active") return;

    console.log("Setting up active session UI refresh timer");

    // Function to fetch the latest data directly from DB
    const refreshFromDatabase = async () => {
      try {
        const freshSession = await dataTransferService.getCurrentSession();
        if (freshSession && freshSession.processedItems !== processedItems) {
          console.log(
            `Refresh: DB shows ${freshSession.processedItems} items processed vs UI ${processedItems}`
          );

          // Update all state values to match DB
          setProcessedItems(freshSession.processedItems);
          if (freshSession.totalItems !== null) {
            setTotalItems(freshSession.totalItems);
            if (freshSession.processedItems > 0) {
              const newPercentage = Math.round(
                (freshSession.processedItems / freshSession.totalItems) * 100
              );
              setPercentage(newPercentage);
            }
          }
        }
      } catch (error) {
        console.error("Error refreshing from database:", error);
      }
    };

    // Run once immediately on session active
    refreshFromDatabase();

    // Set up a timer to refresh every 500ms while session is active
    const timerId = setInterval(refreshFromDatabase, 500);

    return () => clearInterval(timerId);
  }, [session?.status, session?.id, processedItems]);

  // Add a dedicated UI refresh effect - this is crucial for keeping the UI updated
  useEffect(() => {
    let isMounted = true;

    // This function will continuously poll the database for updates
    const pollForUpdates = async () => {
      if (!isMounted) return;

      try {
        const currentSession = await dataTransferService.getCurrentSession();
        if (currentSession) {
          // Update UI with very minimal processing
          setSession(currentSession);
          setProcessedItems(currentSession.processedItems);

          if (currentSession.totalItems !== null) {
            setTotalItems(currentSession.totalItems);
            setPercentage(
              Math.round(
                (currentSession.processedItems / currentSession.totalItems) *
                  100
              )
            );
          }
        }
      } catch (err) {
        // Silent error - don't log to avoid console spam
      }

      // Continue polling at a faster rate (60ms)
      if (isMounted) {
        setTimeout(pollForUpdates, 60);
      }
    };

    // Start polling
    pollForUpdates();

    // Clean up when unmounting
    return () => {
      isMounted = false;
    };
  }, []);

  // Update chunk counts when session updates
  useEffect(() => {
    if (!session) return;

    // Calculate successful chunks based on processed items
    if (session.processedItems > 0 && session.chunkSize > 0) {
      const estimatedSuccessfulChunks = Math.ceil(
        session.processedItems / session.chunkSize
      );
      setSuccessfulChunks(estimatedSuccessfulChunks);
    }

    // Update progress text based on session status
    if (session.status === "active" && session.totalItems) {
      const progressText = `${session.processedItems} of ${session.totalItems} items processed`;
      console.log(`Updated progress text: ${progressText}`);
    }
  }, [session]);

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
            transfer (Service Workers and IndexedDB).
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
