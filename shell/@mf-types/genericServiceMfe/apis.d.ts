
    export type RemoteKeys = 'genericServiceMfe/export-app';
    type PackageType<T> = T extends 'genericServiceMfe/export-app' ? typeof import('genericServiceMfe/export-app') :any;