import { createRemoteComponent } from "@module-federation/bridge-react";
import { loadRemote } from "@module-federation/enhanced/runtime";
import { FallbackComp, FallbackErrorComp } from "./mfe-loading";

export const DataTransferMfe = createRemoteComponent({
  loader: () => loadRemote("dataTransferMfe/export-app"),
  fallback: FallbackErrorComp,
  loading: FallbackComp,
});
