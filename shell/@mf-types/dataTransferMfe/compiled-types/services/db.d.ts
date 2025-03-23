import { DBSchema } from "idb";
interface DataTransferDB extends DBSchema {
    dataChunks: {
        key: string;
        value: {
            id: string;
            sessionId: string;
            items: any[];
            status: "pending" | "processing" | "completed" | "failed";
            createdAt: number;
            processedAt?: number;
            error?: string;
        };
        indexes: {
            "by-status": string;
        };
    };
    transferSessions: {
        key: string;
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
declare class DataTransferDatabase {
    private db;
    constructor();
    private initDatabase;
    createSession(sessionData: Omit<DataTransferDB["transferSessions"]["value"], "id" | "createdAt" | "updatedAt" | "processedItems">): Promise<{
        processedItems: number;
        createdAt: number;
        updatedAt: number;
        sourceUrl: string;
        targetUrl: string;
        status: "initializing" | "active" | "paused" | "completed" | "failed";
        totalItems: number | null;
        chunkSize: number;
        error?: string | undefined;
        lastChunkId?: string | undefined;
        id: string;
    }>;
    getSession(sessionId: string): Promise<{
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
    } | undefined>;
    updateSession(sessionId: string, updates: Partial<Omit<DataTransferDB["transferSessions"]["value"], "id" | "createdAt">>): Promise<{
        updatedAt: number;
        processedItems: number;
        sourceUrl: string;
        targetUrl: string;
        status: "initializing" | "active" | "paused" | "completed" | "failed";
        totalItems: number | null;
        chunkSize: number;
        error?: string;
        lastChunkId?: string;
        id: string;
        createdAt: number;
    }>;
    getActiveSession(): Promise<{
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
    } | undefined>;
    addChunk(sessionId: string, items: any[]): Promise<{
        id: string;
        sessionId: string;
        items: any[];
        status: "pending";
        createdAt: number;
    }>;
    getChunk(chunkId: string): Promise<{
        id: string;
        sessionId: string;
        items: any[];
        status: "pending" | "processing" | "completed" | "failed";
        createdAt: number;
        processedAt?: number;
        error?: string;
    } | undefined>;
    updateChunkStatus(chunkId: string, status: DataTransferDB["dataChunks"]["value"]["status"], error?: string): Promise<{
        error?: string;
        status: "pending" | "processing" | "completed" | "failed";
        processedAt: number;
        id: string;
        sessionId: string;
        items: any[];
        createdAt: number;
    }>;
    getPendingChunks(sessionId: string, limit?: number): Promise<{
        id: string;
        sessionId: string;
        items: any[];
        status: "pending" | "processing" | "completed" | "failed";
        createdAt: number;
        processedAt?: number;
        error?: string;
    }[]>;
    getSessionChunks(sessionId: string): Promise<{
        id: string;
        sessionId: string;
        items: any[];
        status: "pending" | "processing" | "completed" | "failed";
        createdAt: number;
        processedAt?: number;
        error?: string;
    }[]>;
    clearCompletedChunks(sessionId: string): Promise<void>;
}
export declare const db: DataTransferDatabase;
export type TransferSession = DataTransferDB["transferSessions"]["value"];
export type DataChunk = DataTransferDB["dataChunks"]["value"];
export {};
