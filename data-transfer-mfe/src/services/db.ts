import { openDB, DBSchema, IDBPDatabase } from "idb";

// Define our database schema
interface DataTransferDB extends DBSchema {
  // Store for data chunks to be processed
  dataChunks: {
    key: string; // chunkId
    value: {
      id: string;
      sessionId: string;
      items: any[];
      status: "pending" | "processing" | "completed" | "failed";
      createdAt: number;
      processedAt?: number;
      error?: string;
    };
    indexes: { "by-status": string };
  };

  // Store for transfer session metadata
  transferSessions: {
    key: string; // sessionId
    value: {
      id: string;
      sourceUrl: string;
      targetUrl: string;
      status: "initializing" | "active" | "paused" | "completed" | "failed";
      totalItems: number | null;
      processedItems: number;
      chunkSize: number;
      createdAt: number;
      updatedAt: number;
      error?: string;
      lastChunkId?: string;
    };
  };
}

// Database version and name
const DB_NAME = "data-transfer-db";
const DB_VERSION = 1;

// Class to handle database operations
class DataTransferDatabase {
  private db: Promise<IDBPDatabase<DataTransferDB>>;

  constructor() {
    this.db = this.initDatabase();
  }

  // Initialize the database
  private async initDatabase(): Promise<IDBPDatabase<DataTransferDB>> {
    return openDB<DataTransferDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Create stores if they don't exist
        if (!db.objectStoreNames.contains("dataChunks")) {
          const chunkStore = db.createObjectStore("dataChunks", {
            keyPath: "id",
          });
          chunkStore.createIndex("by-status", "status");
        }

        if (!db.objectStoreNames.contains("transferSessions")) {
          db.createObjectStore("transferSessions", { keyPath: "id" });
        }
      },
    });
  }

  // Add this function at the beginning of the DataTransferDatabase class
  private logOperation(operation: string, details: any): void {
    console.log(`[DB-OPERATION] ${operation}:`, details);
  }

  // Session methods
  async createSession(
    sessionData: Omit<
      DataTransferDB["transferSessions"]["value"],
      "id" | "createdAt" | "updatedAt" | "processedItems"
    >
  ) {
    const sessionId = `session_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 11)}`;
    const timestamp = Date.now();

    const session = {
      id: sessionId,
      ...sessionData,
      processedItems: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const db = await this.db;
    await db.put("transferSessions", session);

    return session;
  }

  async getSession(sessionId: string) {
    const db = await this.db;
    return db.get("transferSessions", sessionId);
  }

  // Then modify the updateSession method to add additional logging
  async updateSession(
    sessionId: string,
    updates: Partial<
      Omit<DataTransferDB["transferSessions"]["value"], "id" | "createdAt">
    >
  ) {
    this.logOperation("UPDATE-SESSION-START", { sessionId, updates });

    const db = await this.db;
    const session = await db.get("transferSessions", sessionId);

    if (!session) {
      const error = `Session not found: ${sessionId}`;
      this.logOperation("UPDATE-SESSION-ERROR", error);
      throw new Error(error);
    }

    const updatedSession = {
      ...session,
      ...updates,
      updatedAt: Date.now(),
    };

    await db.put("transferSessions", updatedSession);
    this.logOperation("UPDATE-SESSION-SUCCESS", updatedSession);
    return updatedSession;
  }

  async getActiveSession() {
    const db = await this.db;
    const allSessions = await db.getAll("transferSessions");
    return allSessions.find((session) =>
      ["initializing", "active", "paused"].includes(session.status)
    );
  }

  // Chunk methods
  async addChunk(sessionId: string, items: any[]) {
    const chunkId = `chunk_${sessionId}_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 9)}`;

    const chunk = {
      id: chunkId,
      sessionId,
      items,
      status: "pending" as const,
      createdAt: Date.now(),
    };

    const db = await this.db;
    await db.put("dataChunks", chunk);

    return chunk;
  }

  async getChunk(chunkId: string) {
    const db = await this.db;
    return db.get("dataChunks", chunkId);
  }

  async updateChunkStatus(
    chunkId: string,
    status: DataTransferDB["dataChunks"]["value"]["status"],
    error?: string
  ) {
    const db = await this.db;
    const chunk = await db.get("dataChunks", chunkId);

    if (!chunk) {
      throw new Error(`Chunk not found: ${chunkId}`);
    }

    const updatedChunk = {
      ...chunk,
      status,
      processedAt: Date.now(),
      ...(error ? { error } : {}),
    };

    await db.put("dataChunks", updatedChunk);
    return updatedChunk;
  }

  async getPendingChunks(sessionId: string, limit = 5) {
    const db = await this.db;
    const index = db.transaction("dataChunks").store.index("by-status");
    const pendingChunks = await index.getAll("pending");

    return pendingChunks
      .filter((chunk) => chunk.sessionId === sessionId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit);
  }

  async getSessionChunks(sessionId: string) {
    const db = await this.db;
    const allChunks = await db.getAll("dataChunks");
    return allChunks.filter((chunk) => chunk.sessionId === sessionId);
  }

  async clearCompletedChunks(sessionId: string) {
    const db = await this.db;
    const tx = db.transaction("dataChunks", "readwrite");
    const index = tx.store.index("by-status");
    const completedChunks = await index.getAll("completed");

    for (const chunk of completedChunks) {
      if (chunk.sessionId === sessionId) {
        await tx.store.delete(chunk.id);
      }
    }

    await tx.done;
  }
}

// Export a singleton instance
export const db = new DataTransferDatabase();

// Export types
export type TransferSession = DataTransferDB["transferSessions"]["value"];
export type DataChunk = DataTransferDB["dataChunks"]["value"];
