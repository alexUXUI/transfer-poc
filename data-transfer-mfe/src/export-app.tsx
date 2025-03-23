import App from "./App.tsx";
import { createBridgeComponent } from "@module-federation/bridge-react";

export default createBridgeComponent({
  rootComponent: App,
});
