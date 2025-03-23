
    export type RemoteKeys = 'remote2/export-app';
    type PackageType<T> = T extends 'remote2/export-app' ? typeof import('remote2/export-app') :any;