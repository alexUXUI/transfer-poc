import App from "./App";
import { createBridgeComponent } from "@module-federation/bridge-react";

export default createBridgeComponent({
  rootComponent: App,
});
