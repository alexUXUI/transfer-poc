import { createRemoteComponent } from "@module-federation/bridge-react";
import { loadRemote } from "@module-federation/enhanced/runtime";
import { FallbackComp, FallbackErrorComp } from "./mfe-loading";

export const GenericServiceMfe = createRemoteComponent({
  loader: () => loadRemote("genericServiceMfe/export-app"),
  fallback: FallbackErrorComp,
  loading: FallbackComp,
});
