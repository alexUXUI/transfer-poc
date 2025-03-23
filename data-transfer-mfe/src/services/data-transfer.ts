import { db, TransferSession, DataChunk } from "./db";
import {
  isServiceWorkerSupported,
  registerServiceWorker,
  isServiceWorkerActive,
  sendChunkToServiceWorker,
  setupServiceWorkerMessageListener,
} from "./service-worker";

// Constants for configuration
const DEFAULT_CHUNK_SIZE = 100;
const MAX_CONCURRENT_CHUNKS = 3;
const RETRY_DELAY = 3000;
const MAX_RETRIES = 3;

// Events for monitoring the transfer process
export interface TransferEvents {
  onSessionCreated?: (session: TransferSession) => void;
  onStatusChange?: (
    status: TransferSession["status"],
    session: TransferSession
  ) => void;
  onProgress?: (
    processed: number,
    total: number | null,
    percentage: number | null
  ) => void;
  onChunkProcessed?: (chunkId: string, success: boolean, items: number) => void;
  onComplete?: (session: TransferSession) => void;
  onError?: (error: Error, session?: TransferSession) => void;
  onPaused?: (session: TransferSession) => void;
  onResumed?: (session: TransferSession) => void;
}

// Main class for managing data transfers
export class DataTransferService {
  private session: TransferSession | null = null;
  private messageListenerCleanup: (() => void) | null = null;
  private polling = false;
  private pauseRequested = false;
  private retryCount = 0;
  private pendingChunks = new Set<string>();
  private events: TransferEvents = {};
  private activeDownload: AbortController | null = null;
  private downloadQueue: { skip: number; top: number }[] = [];
  private processingQueue = false;

  constructor() {
    this.init();
  }

  // Initialize the service
  private async init() {
    // Register the service worker if needed and wait for it to be ready
    if (isServiceWorkerSupported) {
      console.log("Initializing service worker...");
      const registration = await registerServiceWorker();

      if (!registration || !registration.active) {
        console.warn("Service worker registration failed or not activated yet");

        // Try again after a delay
        setTimeout(async () => {
          console.log("Retrying service worker registration...");
          await registerServiceWorker();
        }, 1000);
      } else {
        console.log("Service worker is active and ready");
      }
    }

    // Check for any active session on initialization
    try {
      const activeSession = await db.getActiveSession();
      if (activeSession) {
        this.session = activeSession;
        console.log("Restored active session:", activeSession);

        // Set up event handling if session is active
        if (activeSession.status === "active") {
          this.setupEventHandling();
          this.startPolling();
        }
      }
    } catch (error) {
      console.error("Error initializing data transfer service:", error);
    }

    // Set up beforeunload event to warn user if transfer is in progress
    window.addEventListener("beforeunload", this.handleBeforeUnload);

    // Add a periodic check for service worker health
    if (isServiceWorkerSupported) {
      setInterval(async () => {
        const isActive = await isServiceWorkerActive();
        console.log(
          `Service worker health check: ${isActive ? "active" : "inactive"}`
        );

        // If we have a session but the service worker is gone, we need to handle that
        if (!isActive && this.session && this.session.status === "active") {
          console.warn(
            "Service worker is inactive but transfer is active - attempting to recover"
          );

          // Try to re-register the service worker
          await registerServiceWorker();
        }
      }, 30000); // Check every 30 seconds
    }
  }

  // Set up service worker event handling
  private setupEventHandling() {
    if (isServiceWorkerSupported) {
      // Remove any existing listener
      if (this.messageListenerCleanup) {
        this.messageListenerCleanup();
      }

      // Add new listener
      this.messageListenerCleanup = setupServiceWorkerMessageListener(
        this.handleServiceWorkerMessage
      );
    }
  }

  // Handle messages from the service worker
  private handleServiceWorkerMessage = (event: MessageEvent) => {
    const { type, data } = event.data || {};

    if (type === "TRANSFER_CHUNK_RESULT") {
      this.handleChunkResult(
        data.chunkId,
        data.success,
        data.result,
        data.error
      );
    }
  };

  // Handle beforeunload event to warn user if transfer is in progress
  private handleBeforeUnload = (event: BeforeUnloadEvent) => {
    if (
      this.session &&
      (this.session.status === "active" || this.pendingChunks.size > 0)
    ) {
      const message =
        "Data transfer is in progress. Are you sure you want to leave?";
      event.preventDefault();
      event.returnValue = message;
      return message;
    }
  };

  // Register event handlers
  public on(events: TransferEvents) {
    this.events = { ...this.events, ...events };
    return this;
  }

  // Start a new transfer session
  public async startTransfer(
    sourceUrl: string,
    targetUrl: string,
    chunkSize = DEFAULT_CHUNK_SIZE
  ): Promise<TransferSession> {
    try {
      // Try to register service worker, but don't make it critical
      if (isServiceWorkerSupported) {
        try {
          console.log("Checking for active service worker...");
          const registration = await navigator.serviceWorker.getRegistration();

          if (!registration || !registration.active) {
            console.log("No active service worker found, registering now...");
            await registerServiceWorker();
          } else {
            console.log("Service worker is already registered and active");
          }
        } catch (swError) {
          // Log but continue even if service worker fails
          console.warn(
            "Service worker setup failed, will use direct API calls:",
            swError
          );
        }
      } else {
        console.warn(
          "Service workers not supported in this browser, will use direct API calls"
        );
      }

      // Check for existing active session
      const existingSession = await db.getActiveSession();
      if (existingSession) {
        throw new Error(
          "A transfer session is already active. Please complete or cancel it first."
        );
      }

      // Create new session
      this.session = await db.createSession({
        sourceUrl,
        targetUrl,
        status: "initializing",
        totalItems: null,
        chunkSize,
      });

      // Set up event handling for service worker messages if possible
      this.setupEventHandling();

      // Notify of session creation
      if (this.events.onSessionCreated) {
        this.events.onSessionCreated(this.session);
      }

      // Start the transfer process
      await this.updateSessionStatus("active");
      this.startPolling();
      this.enqueueFetch(0, chunkSize);

      return this.session;
    } catch (error) {
      console.error("Error starting transfer:", error);
      if (this.events.onError) {
        this.events.onError(
          error instanceof Error ? error : new Error(String(error)),
          undefined
        );
      }
      throw error;
    }
  }

  // Pause the current transfer
  public async pauseTransfer(): Promise<TransferSession | null> {
    if (!this.session) {
      return null;
    }

    this.pauseRequested = true;

    // Cancel any active download
    if (this.activeDownload) {
      this.activeDownload.abort();
      this.activeDownload = null;
    }

    // Clear download queue
    this.downloadQueue = [];

    // Wait for pending chunks to complete
    if (this.pendingChunks.size > 0) {
      console.log(
        `Waiting for ${this.pendingChunks.size} pending chunks to complete before pausing...`
      );
    }

    try {
      await this.updateSessionStatus("paused");
      this.stopPolling();

      if (this.events.onPaused && this.session) {
        this.events.onPaused(this.session);
      }

      return this.session;
    } catch (error) {
      console.error("Error pausing transfer:", error);
      if (this.events.onError) {
        this.events.onError(
          error instanceof Error ? error : new Error(String(error)),
          this.session || undefined
        );
      }
      return null;
    }
  }

  // Resume a paused transfer
  public async resumeTransfer(): Promise<TransferSession | null> {
    if (!this.session || this.session.status !== "paused") {
      return null;
    }

    try {
      this.pauseRequested = false;
      await this.updateSessionStatus("active");
      this.setupEventHandling();
      this.startPolling();

      // Resume from where we left off
      if (this.session.lastChunkId) {
        const lastChunk = await db.getChunk(this.session.lastChunkId);
        if (lastChunk) {
          const nextSkip = this.session.processedItems;
          this.enqueueFetch(nextSkip, this.session.chunkSize);
        }
      } else {
        // Start from the beginning if we don't have a last chunk
        this.enqueueFetch(0, this.session.chunkSize);
      }

      if (this.events.onResumed && this.session) {
        this.events.onResumed(this.session);
      }

      return this.session;
    } catch (error) {
      console.error("Error resuming transfer:", error);
      if (this.events.onError) {
        this.events.onError(
          error instanceof Error ? error : new Error(String(error)),
          this.session || undefined
        );
      }
      return null;
    }
  }

  // Cancel the current transfer
  public async cancelTransfer(): Promise<void> {
    if (!this.session) {
      return;
    }

    // Stop any active processes
    this.pauseRequested = true;
    this.stopPolling();

    if (this.activeDownload) {
      this.activeDownload.abort();
      this.activeDownload = null;
    }

    // Clear download queue
    this.downloadQueue = [];

    try {
      // Update session status
      await this.updateSessionStatus("failed", "Transfer cancelled by user");

      // Clean up
      this.cleanup();
    } catch (error) {
      console.error("Error cancelling transfer:", error);
      if (this.events.onError) {
        this.events.onError(
          error instanceof Error ? error : new Error(String(error)),
          this.session || undefined
        );
      }
    }
  }

  // Get the current session
  public async getCurrentSession(): Promise<TransferSession | null> {
    if (this.session) {
      return this.session;
    }

    // Try to get from database
    try {
      const session = await db.getActiveSession();
      return session || null; // Convert undefined to null explicitly
    } catch (error) {
      console.error("Error getting current session:", error);
      return null;
    }
  }

  // Check if a transfer is in progress
  public isTransferInProgress(): boolean {
    return !!this.session && this.session.status === "active";
  }

  // Update the session status
  private async updateSessionStatus(
    status: TransferSession["status"],
    error?: string
  ): Promise<TransferSession> {
    if (!this.session) {
      throw new Error("No active session");
    }

    try {
      this.session = await db.updateSession(this.session.id, { status, error });

      // Notify status change
      if (this.events.onStatusChange) {
        this.events.onStatusChange(status, this.session);
      }

      // Handle completion
      if (status === "completed" && this.events.onComplete) {
        this.events.onComplete(this.session);
        this.cleanup();
      }

      return this.session;
    } catch (error) {
      console.error("Error updating session status:", error);
      throw error;
    }
  }

  // Start polling for chunks to process
  private startPolling() {
    if (this.polling) return;

    this.polling = true;
    this.pollPendingChunks();
  }

  // Stop polling
  private stopPolling() {
    this.polling = false;
  }

  // Poll for pending chunks to process
  private async pollPendingChunks() {
    if (!this.polling || !this.session || this.pauseRequested) {
      return;
    }

    try {
      // Don't process more if we're at concurrent limit
      if (this.pendingChunks.size >= MAX_CONCURRENT_CHUNKS) {
        setTimeout(() => this.pollPendingChunks(), 500);
        return;
      }

      // Get pending chunks
      const pendingChunks = await db.getPendingChunks(
        this.session.id,
        MAX_CONCURRENT_CHUNKS - this.pendingChunks.size
      );

      // Process each chunk
      for (const chunk of pendingChunks) {
        this.processChunk(chunk);
      }

      // Continue polling
      setTimeout(() => this.pollPendingChunks(), 500);
    } catch (error) {
      console.error("Error polling pending chunks:", error);
      setTimeout(() => this.pollPendingChunks(), RETRY_DELAY);
    }
  }

  // Process a data chunk
  private async processChunk(chunk: DataChunk) {
    if (this.pendingChunks.has(chunk.id) || !this.session) {
      return;
    }

    // Mark as processing
    this.pendingChunks.add(chunk.id);
    await db.updateChunkStatus(chunk.id, "processing");

    // Always increment processing count to keep UI updated
    this.setProcessingCount(this.pendingChunks.size);

    try {
      // Check if service worker is available
      const swActive = await isServiceWorkerActive();

      if (!swActive) {
        // Use direct method without retrying SW registration
        console.log(`Using direct processing for chunk ${chunk.id}`);
        await this.processChunkDirectly(chunk);
        return;
      }

      // If service worker is active, use it
      console.log(`Using service worker to process chunk ${chunk.id}`);
      try {
        await sendChunkToServiceWorker(
          chunk.id,
          chunk.items,
          this.session.targetUrl
        );
      } catch (swError) {
        // Fallback to direct method
        console.warn("Service worker error, using direct method:", swError);
        await this.processChunkDirectly(chunk);
      }
    } catch (error) {
      console.error("Error processing chunk:", error);
      await this.handleChunkError(
        chunk.id,
        error instanceof Error ? error : new Error(String(error)),
        this.session || undefined
      );
    }
  }

  // Helper method to update processing count (call this wherever pendingChunks size changes)
  private setProcessingCount(count: number) {
    if (this.events.onChunkProcessed) {
      // This will trigger UI updates for processing chunks count
      this.events.onChunkProcessed("processing-update", true, 0);
    }
  }

  // Handle chunk processing result
  private async handleChunkResult(
    chunkId: string,
    success: boolean,
    result?: any,
    error?: string
  ) {
    console.log(`Handling chunk result for ${chunkId}: ${success}`);
    this.pendingChunks.delete(chunkId);

    const currentSession = this.session;
    if (!currentSession) {
      return console.warn("No active session to handle chunk result");
    }

    try {
      // Get chunk to determine number of items
      const chunk = await db.getChunk(chunkId);
      if (!chunk) {
        return console.warn(`Chunk ${chunkId} not found`);
      }

      // Update chunk status in database
      await db.updateChunkStatus(
        chunkId,
        success ? "completed" : "failed",
        error
      );

      // If successful, update processed count in the session
      if (success) {
        const itemsCount = chunk.items.length;
        if (itemsCount > 0) {
          const updatedProcessedItems =
            currentSession.processedItems + itemsCount;

          // Update session in database
          const updatedSession = await db.updateSession(currentSession.id, {
            processedItems: updatedProcessedItems,
          });

          this.session = updatedSession;

          // Force UI to update with new count
          this.forceProgressUpdate(updatedProcessedItems);

          // Also notify through event callback
          if (this.events.onChunkProcessed) {
            this.events.onChunkProcessed(chunkId, true, itemsCount);
          }
        }
      } else {
        // Handle failed chunk
        console.error(`Chunk ${chunkId} failed:`, error);
        if (this.events.onChunkProcessed) {
          this.events.onChunkProcessed(chunkId, false, 0);
        }
      }

      // Check if all items have been processed
      if (currentSession.totalItems !== null) {
        const sessionFromDb = await db.getSession(currentSession.id);
        const totalProcessed = sessionFromDb?.processedItems || 0;
        const isComplete = totalProcessed >= currentSession.totalItems;

        if (isComplete) {
          console.log("All items processed, marking transfer as complete");
          try {
            const completedSession = await this.updateSessionStatus(
              "completed"
            );
            this.stopPolling();
            if (this.events.onComplete) {
              this.events.onComplete(completedSession);
            }
          } catch (error) {
            console.error("Error completing transfer:", error);
          }
        }
      }
    } catch (err) {
      console.error(`Error handling chunk result for ${chunkId}:`, err);
      if (this.events.onError) {
        this.events.onError(
          err instanceof Error ? err : new Error(String(err)),
          this.session || undefined
        );
      }
    }
  }

  // Handle chunk processing error
  private async handleChunkError(
    chunkId: string,
    error: Error,
    session?: TransferSession
  ) {
    if (!this.session) return;

    try {
      const chunk = await db.getChunk(chunkId);
      if (!chunk) return;

      // Update chunk status
      await db.updateChunkStatus(chunkId, "failed", error.message);

      // Notify of chunk failure
      if (this.events.onChunkProcessed) {
        this.events.onChunkProcessed(chunkId, false, chunk.items.length);
      }

      // Increment retry count
      this.retryCount++;

      if (this.retryCount < MAX_RETRIES) {
        // Retry the chunk after a delay
        console.log(
          `Retrying chunk ${chunkId} after delay (attempt ${this.retryCount})`
        );
        setTimeout(async () => {
          await db.updateChunkStatus(chunkId, "pending");
          this.pendingChunks.delete(chunkId);
        }, RETRY_DELAY);
      } else {
        // Too many retries, fail the transfer
        console.error(
          `Too many retries (${this.retryCount}). Failing transfer.`
        );
        await this.updateSessionStatus(
          "failed",
          `Failed after ${MAX_RETRIES} retries: ${error.message}`
        );

        if (this.events.onError) {
          this.events.onError(
            new Error(
              `Transfer failed after ${MAX_RETRIES} retries: ${error.message}`
            ),
            session || undefined
          );
        }

        this.cleanup();
      }
    } catch (error) {
      console.error("Error handling chunk error:", error);
      if (this.events.onError) {
        this.events.onError(
          error instanceof Error ? error : new Error(String(error)),
          session || undefined
        );
      }
    }
  }

  // Queue a data fetch
  private enqueueFetch(skip: number, top: number) {
    this.downloadQueue.push({ skip, top });
    this.processDownloadQueue();
  }

  // Process the download queue
  private async processDownloadQueue() {
    if (
      this.processingQueue ||
      !this.session ||
      this.pauseRequested ||
      this.activeDownload
    ) {
      return;
    }

    this.processingQueue = true;

    try {
      while (this.downloadQueue.length > 0 && !this.pauseRequested) {
        const { skip, top } = this.downloadQueue.shift()!;
        await this.fetchData(skip, top);
      }
    } catch (error) {
      console.error("Error processing download queue:", error);

      if (this.events.onError) {
        this.events.onError(
          error instanceof Error ? error : new Error(String(error)),
          this.session || undefined
        );
      }
    } finally {
      this.processingQueue = false;
    }
  }

  // Fetch data from the source
  private async fetchData(skip: number, top: number) {
    if (!this.session || this.pauseRequested) {
      return;
    }

    this.activeDownload = new AbortController();

    try {
      console.log(
        `Fetching data from ${this.session.sourceUrl} (skip=${skip}, top=${top})`
      );

      // Fetch data from source
      const response = await fetch(
        `${this.session.sourceUrl}?skip=${skip}&top=${top}`,
        {
          signal: this.activeDownload.signal,
        }
      );

      if (!response.ok) {
        throw new Error(
          `HTTP error ${response.status}: ${response.statusText}`
        );
      }

      const result = await response.json();
      console.log(
        `Fetched data: ${result.data?.length || 0} items, total: ${
          result.total
        }`
      );

      // Cancel if paused during fetch
      if (this.pauseRequested) {
        return;
      }

      // Update total count if we get it from response
      if (result.total != null && this.session.totalItems === null) {
        console.log(`Setting total items to ${result.total}`);
        this.session = await db.updateSession(this.session.id, {
          totalItems: result.total,
        });
      }

      // Process the items
      const items = result.data || [];

      // If no items returned, we're done
      if (items.length === 0) {
        console.log("No items returned, marking transfer as completed");
        await this.updateSessionStatus("completed");
        return;
      }

      // Create a chunk and store it
      const chunk = await db.addChunk(this.session.id, items);
      console.log(`Created chunk ${chunk.id} with ${items.length} items`);

      // Check and update the processedItems count if needed
      if (this.session && this.events.onProgress) {
        const currentSession = await db.getSession(this.session.id);
        if (currentSession) {
          // Update UI with current processed count to keep it fresh
          this.forceProgressUpdate(currentSession.processedItems || 0);
        }
      }

      // Queue the next fetch if needed
      if (items.length >= top) {
        // Use >= to handle edge cases
        console.log(`Queueing next fetch from skip=${skip + top}`);
        this.enqueueFetch(skip + top, top);
      } else {
        // If we got fewer items than requested, check if we've got all data
        console.log(
          `Got ${items.length} items, which is less than the requested ${top}`
        );

        // Get latest session data
        const latestSession = await db.getSession(this.session.id);
        if (latestSession && latestSession.totalItems !== null) {
          const expectedTotal = latestSession.totalItems;
          const fetchedSoFar = skip + items.length;

          if (fetchedSoFar < expectedTotal) {
            // We haven't fetched all items yet, continue
            console.log(
              `Fetched ${fetchedSoFar} of ${expectedTotal} items, continuing...`
            );
            this.enqueueFetch(skip + items.length, top);
          } else {
            console.log(
              `Reached end of data (${fetchedSoFar} of ${expectedTotal}), completing soon`
            );
          }
        } else {
          console.log("Reached end of data, completing soon");
        }
      }
    } catch (error: unknown) {
      // Type error as unknown
      if (error instanceof Error && error.name === "AbortError") {
        console.log("Data fetch aborted");
      } else {
        console.error("Error fetching data:", error);

        if (this.events.onError) {
          this.events.onError(
            error instanceof Error ? error : new Error(String(error)),
            this.session || undefined
          );
        }

        // Try again with exponential backoff if not aborted
        this.retryCount++;

        if (this.retryCount < MAX_RETRIES) {
          const delay = RETRY_DELAY * Math.pow(2, this.retryCount - 1);
          console.log(
            `Retrying fetch after ${delay}ms (attempt ${this.retryCount})`
          );

          setTimeout(() => {
            this.enqueueFetch(skip, top);
          }, delay);
        } else {
          await this.updateSessionStatus(
            "failed",
            `Failed to fetch data after ${MAX_RETRIES} attempts: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    } finally {
      this.activeDownload = null;
    }
  }

  // Clean up all resources
  private cleanup() {
    // Remove event listeners
    if (this.messageListenerCleanup) {
      this.messageListenerCleanup();
      this.messageListenerCleanup = null;
    }

    // Reset state
    this.pendingChunks.clear();
    this.pauseRequested = false;
    this.polling = false;
    this.retryCount = 0;
    this.downloadQueue = [];

    if (this.activeDownload) {
      this.activeDownload.abort();
      this.activeDownload = null;
    }

    // Don't reset session to allow querying final status
  }

  // Clean up when unmounting
  public unmount() {
    window.removeEventListener("beforeunload", this.handleBeforeUnload);

    // Don't cancel the transfer, just clean up the listeners
    if (this.messageListenerCleanup) {
      this.messageListenerCleanup();
      this.messageListenerCleanup = null;
    }
  }

  // This is a direct processing method that bypasses the service worker
  private async processChunkDirectly(chunk: DataChunk): Promise<void> {
    if (!this.session) return;

    // Log the operation
    console.log(
      `DIRECT: Processing chunk ${chunk.id} with ${chunk.items.length} items`
    );

    try {
      // 1. Make the direct API call to the target server
      const response = await fetch(this.session.targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chunk.items),
        cache: "no-store", // Prevent caching
      });

      // 2. Check if the API call was successful
      if (!response.ok) {
        throw new Error(
          `HTTP error ${response.status}: ${response.statusText}`
        );
      }

      // 3. Parse the response
      const result = await response.json();
      console.log(`DIRECT: Success for chunk ${chunk.id}`, result);

      // 4. Mark the chunk as completed
      await db.updateChunkStatus(chunk.id, "completed");

      // 5. Get the current processed count
      const itemCount = chunk.items.length;

      // 6. Update the session's processed count
      const updatedSession = await db.updateSession(this.session.id, {
        processedItems: (this.session.processedItems || 0) + itemCount,
        lastChunkId: chunk.id,
      });

      // 7. Update our local reference
      this.session = updatedSession;

      // 8. Notify the UI of the updated progress
      const processedCount = updatedSession.processedItems;
      console.log(`DIRECT: Updated progress to ${processedCount} items`);

      if (this.events.onProgress) {
        const percentage = updatedSession.totalItems
          ? Math.round((processedCount / updatedSession.totalItems) * 100)
          : null;

        this.events.onProgress(
          processedCount,
          updatedSession.totalItems,
          percentage
        );
      }

      // 9. Notify that the chunk processing was successful
      if (this.events.onChunkProcessed) {
        this.events.onChunkProcessed(chunk.id, true, itemCount);
      }

      // 10. Remove from pending chunks
      this.pendingChunks.delete(chunk.id);

      // 11. Reset retry count
      this.retryCount = 0;

      // 12. Check if we've completed all items
      if (
        updatedSession.totalItems &&
        processedCount >= updatedSession.totalItems
      ) {
        console.log(
          `DIRECT: All ${updatedSession.totalItems} items processed, completing transfer`
        );
        await this.updateSessionStatus("completed");
      }
    } catch (error) {
      console.error(`DIRECT: Error processing chunk ${chunk.id}:`, error);

      // Handle retry logic
      this.retryCount++;
      if (this.retryCount < MAX_RETRIES) {
        console.log(
          `DIRECT: Will retry chunk ${chunk.id} (attempt ${this.retryCount})`
        );
        setTimeout(async () => {
          await db.updateChunkStatus(chunk.id, "pending");
          this.pendingChunks.delete(chunk.id);
        }, RETRY_DELAY);
      } else {
        await this.handleChunkError(
          chunk.id,
          error instanceof Error ? error : new Error(String(error)),
          this.session || undefined
        );
      }
    }
  }

  // Function to update session with higher priority
  private forceProgressUpdate(processedCount: number): void {
    // Only update if we have a session and events listener
    if (!this.session || !this.events.onProgress) return;

    try {
      console.log(`Forcing progress update with count: ${processedCount}`);

      // Directly trigger progress event with current values
      const percentage = this.session.totalItems
        ? Math.round((processedCount / this.session.totalItems) * 100)
        : null;

      this.events.onProgress(
        processedCount,
        this.session.totalItems,
        percentage
      );

      // Also notify of status change to trigger UI updates
      if (this.events.onStatusChange && this.session.status === "active") {
        this.events.onStatusChange("active", this.session);
      }
    } catch (error) {
      console.error("Error forcing progress update:", error);
    }
  }
}

// Export a singleton instance
export const dataTransferService = new DataTransferService();
