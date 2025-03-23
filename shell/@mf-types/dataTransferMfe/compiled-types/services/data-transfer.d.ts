import { TransferSession } from "./db";
export interface TransferEvents {
    onSessionCreated?: (session: TransferSession) => void;
    onStatusChange?: (status: TransferSession["status"], session: TransferSession) => void;
    onProgress?: (processed: number, total: number | null, percentage: number | null) => void;
    onChunkProcessed?: (chunkId: string, success: boolean, items: number) => void;
    onComplete?: (session: TransferSession) => void;
    onError?: (error: Error, session?: TransferSession) => void;
    onPaused?: (session: TransferSession) => void;
    onResumed?: (session: TransferSession) => void;
}
export declare class DataTransferService {
    private session;
    private messageListenerCleanup;
    private polling;
    private pauseRequested;
    private retryCount;
    private pendingChunks;
    private events;
    private activeDownload;
    private downloadQueue;
    private processingQueue;
    constructor();
    private init;
    private setupEventHandling;
    private handleServiceWorkerMessage;
    private handleBeforeUnload;
    on(events: TransferEvents): this;
    startTransfer(sourceUrl: string, targetUrl: string, chunkSize?: number): Promise<TransferSession>;
    pauseTransfer(): Promise<TransferSession | null>;
    resumeTransfer(): Promise<TransferSession | null>;
    cancelTransfer(): Promise<void>;
    getCurrentSession(): Promise<TransferSession | null>;
    isTransferInProgress(): boolean;
    private updateSessionStatus;
    private startPolling;
    private stopPolling;
    private pollPendingChunks;
    private processChunk;
    private handleChunkResult;
    private handleChunkError;
    private enqueueFetch;
    private processDownloadQueue;
    private fetchData;
    private cleanup;
    unmount(): void;
    private processChunkDirectly;
}
export declare const dataTransferService: DataTransferService;
