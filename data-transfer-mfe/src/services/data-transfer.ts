import { db, TransferSession, DataChunk } from "./db";

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
    // Check for any active session on initialization
    try {
      const activeSession = await db.getActiveSession();
      if (activeSession) {
        this.session = activeSession;
        console.log("Restored active session:", activeSession);

        // Set up event handling if session is active
        if (activeSession.status === "active") {
          this.startPolling();
        }
      }
    } catch (error) {
      console.error("Error initializing data transfer service:", error);
    }

    // Set up beforeunload event to warn user if transfer is in progress
    window.addEventListener("beforeunload", this.handleBeforeUnload);
  }

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

  // Add a dedicated method to check for stuck transfers and resolve them
  private async checkTransferStatus(): Promise<void> {
    if (!this.session || this.session.totalItems === null) return;

    try {
      // Get the most up-to-date session data
      const currentSession = await db.getSession(this.session.id);
      if (!currentSession || currentSession.totalItems === null) return;

      const { processedItems, totalItems, status } = currentSession;

      console.log(
        `Checking transfer status: ${processedItems}/${totalItems} (${status})`
      );

      // If we're active but nothing is happening, check what's missing
      if (
        status === "active" &&
        processedItems < totalItems &&
        this.pendingChunks.size === 0 &&
        !this.activeDownload &&
        this.downloadQueue.length === 0
      ) {
        console.log(
          "Transfer appears stuck. Attempting to resume from current position."
        );

        // Calculate how many chunks we've processed and how many we should have
        const chunkSize = currentSession.chunkSize || DEFAULT_CHUNK_SIZE;
        const expectedChunks = Math.ceil(totalItems / chunkSize);
        const processedChunks = Math.ceil(processedItems / chunkSize);

        console.log(
          `Expected chunks: ${expectedChunks}, Processed chunks: ${processedChunks}`
        );

        if (processedChunks < expectedChunks) {
          // Resume fetching from where we left off
          const nextSkip = processedItems;
          console.log(`Resuming fetch from position ${nextSkip}`);
          this.enqueueFetch(nextSkip, chunkSize);
        }
      }

      // Check if we've actually completed but didn't mark as completed
      if (status === "active" && processedItems >= totalItems) {
        console.log(
          "All items processed but transfer not marked complete. Completing now."
        );
        await this.updateSessionStatus("completed");
        this.stopPolling();
      }
    } catch (error) {
      console.error("Error checking transfer status:", error);
    }
  }

  // Modify pollPendingChunks to periodically check transfer status
  private async pollPendingChunks() {
    if (!this.polling || !this.session || this.pauseRequested) {
      return;
    }

    try {
      // Periodically check transfer status to detect and fix stuck transfers
      await this.checkTransferStatus();

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
      // We'll always use the direct method now
      await this.processChunkDirectly(chunk);
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

  // Add a dedicated method to check if transfer is complete
  private async checkIfTransferComplete(
    session: TransferSession
  ): Promise<void> {
    // Skip if we don't know the total items
    if (!session || session.totalItems === null) return;

    try {
      // Get latest session data
      const freshSession = await db.getSession(session.id);
      if (!freshSession || freshSession.totalItems === null) return;

      const { processedItems, totalItems } = freshSession;

      console.log(
        `Completion check: ${processedItems}/${totalItems} items processed`
      );

      // Check if we've processed all items
      if (processedItems >= totalItems) {
        console.log(`All ${totalItems} items processed, completing transfer`);

        // Quick check to see if there are any pending chunks
        const pendingChunks = await db.getPendingChunks(session.id, 1);

        if (pendingChunks.length === 0 && this.pendingChunks.size === 0) {
          console.log("No pending chunks, marking transfer as complete");
          await this.updateSessionStatus("completed");
          this.stopPolling();

          if (this.events.onComplete) {
            this.events.onComplete(freshSession);
          }
        } else {
          console.log(
            `Found ${pendingChunks.length} pending chunks, waiting for them to complete`
          );
        }
      } else if (
        this.downloadQueue.length === 0 &&
        !this.activeDownload &&
        this.pendingChunks.size === 0
      ) {
        // We're still missing items but no activity is happening
        console.log(
          `Still missing ${totalItems - processedItems} items but no activity`
        );

        // Try to restart from where we left off
        this.enqueueFetch(processedItems, session.chunkSize);
      }
    } catch (error) {
      console.error("Error checking if transfer is complete:", error);
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
          // Get fresh session data to ensure accurate counting
          const freshSession = await db.getSession(currentSession.id);
          if (!freshSession) {
            throw new Error("Session not found when updating processed count");
          }

          // Calculate new count
          const updatedProcessedItems =
            freshSession.processedItems + itemsCount;

          // Cap the count at the total items if known
          const finalCount =
            freshSession.totalItems !== null
              ? Math.min(updatedProcessedItems, freshSession.totalItems)
              : updatedProcessedItems;

          // Update session in database
          const updatedSession = await db.updateSession(currentSession.id, {
            processedItems: finalCount,
            lastChunkId: chunkId,
          });

          this.session = updatedSession;

          // Directly force UI update with progress info
          console.log(`Updated progress to ${finalCount} items`);

          if (this.events.onProgress) {
            const percentage = updatedSession.totalItems
              ? Math.round((finalCount / updatedSession.totalItems) * 100)
              : null;

            this.events.onProgress(
              finalCount,
              updatedSession.totalItems,
              percentage
            );
          }

          // Check if we've completed all chunks
          await this.checkIfTransferComplete(updatedSession);
        }
      } else {
        // Handle failed chunk
        console.error(`Chunk ${chunkId} failed:`, error);
        if (this.events.onChunkProcessed) {
          this.events.onChunkProcessed(chunkId, false, 0);
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
      if (result.total != null) {
        console.log(`Setting total items to ${result.total}`);
        this.session = await db.updateSession(this.session.id, {
          totalItems: result.total,
        });
      }

      // Process the items
      const items = result.data || [];

      // If no items returned, check if we're done
      if (items.length === 0) {
        console.log("No items returned, checking if transfer is complete");
        const currentSession = await db.getSession(this.session.id);
        if (
          currentSession &&
          currentSession.totalItems !== null &&
          currentSession.processedItems >= currentSession.totalItems
        ) {
          console.log(
            `All ${currentSession.totalItems} items processed. Completing transfer.`
          );
          await this.updateSessionStatus("completed");
        } else {
          console.log(
            "No items returned but transfer not complete. This may indicate an issue."
          );
          // Try fetching from a different position
          if (currentSession && currentSession.processedItems > 0) {
            console.log(
              `Trying to resume from position ${currentSession.processedItems}`
            );
            this.enqueueFetch(currentSession.processedItems, top);
          }
        }
        return;
      }

      // Create a chunk and store it
      const chunk = await db.addChunk(this.session.id, items);
      console.log(`Created chunk ${chunk.id} with ${items.length} items`);

      // Get current session state
      const currentSession = await db.getSession(this.session.id);
      if (!currentSession) return;

      // Critical: Force an immediate update to UI
      if (this.events.onProgress) {
        this.forceProgressUpdate(currentSession.processedItems);
      }

      // Calculate next position
      const nextSkip = skip + items.length;

      // Check if we're done or need to fetch more
      if (currentSession.totalItems !== null) {
        if (nextSkip >= currentSession.totalItems) {
          console.log(
            `Reached total items count (${nextSkip} >= ${currentSession.totalItems}), no more fetches needed`
          );
          // We don't mark as completed here - that will happen when all chunks are processed
        } else {
          // We have more items to fetch
          console.log(
            `Fetched ${nextSkip} of ${currentSession.totalItems}, continuing fetch`
          );
          this.enqueueFetch(nextSkip, top);
        }
      } else if (items.length >= top) {
        // If we don't know the total but got a full page, fetch more
        console.log(`Got full page of ${items.length} items, fetching more`);
        this.enqueueFetch(nextSkip, top);
      } else {
        // We got less than a full page and don't know the total
        console.log(
          `Got partial page (${items.length} < ${top}) and no total, assuming done`
        );
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

  // This is the direct processing method (previously was a fallback, now it's the only method)
  private async processChunkDirectly(chunk: DataChunk): Promise<void> {
    if (!this.session) return;

    // Log the operation
    console.log(
      `Processing chunk ${chunk.id} with ${chunk.items.length} items`
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
      console.log(`Success for chunk ${chunk.id}`, result);

      // 4. Handle the successful result
      await this.handleChunkResult(chunk.id, true, result);
    } catch (error) {
      console.error(`Error processing chunk ${chunk.id}:`, error);
      await this.handleChunkError(
        chunk.id,
        error instanceof Error ? error : new Error(String(error)),
        this.session || undefined
      );
    }
  }

  // Clean up all resources
  private cleanup() {
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
    this.cleanup();
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
