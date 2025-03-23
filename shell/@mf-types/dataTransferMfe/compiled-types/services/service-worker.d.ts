export declare const isServiceWorkerSupported: boolean;
export declare function registerServiceWorker(): Promise<ServiceWorkerRegistration | null>;
export declare function isServiceWorkerActive(): Promise<boolean>;
export declare function sendMessageToServiceWorker<T = any>(message: {
    type: string;
    data?: any;
}, timeout?: number): Promise<T>;
export declare function sendChunkToServiceWorker(chunkId: string, items: any[], targetUrl: string): Promise<void>;
export declare function setupServiceWorkerMessageListener(callback: (event: MessageEvent) => void): () => void;
export declare function pingServiceWorker(): Promise<{
    version: string;
    timestamp: string;
} | null>;
