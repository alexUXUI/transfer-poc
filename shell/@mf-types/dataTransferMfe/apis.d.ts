
    export type RemoteKeys = 'dataTransferMfe/export-app';
    type PackageType<T> = T extends 'dataTransferMfe/export-app' ? typeof import('dataTransferMfe/export-app') :any;