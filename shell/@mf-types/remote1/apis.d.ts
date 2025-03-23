
    export type RemoteKeys = 'remote1/export-app';
    type PackageType<T> = T extends 'remote1/export-app' ? typeof import('remote1/export-app') :any;