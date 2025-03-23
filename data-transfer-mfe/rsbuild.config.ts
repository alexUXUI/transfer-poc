import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";

export default defineConfig({
  server: {
    port: 2001,
  },
  plugins: [
    pluginReact(),
    pluginModuleFederation({
      name: "dataTransferMfe",
      exposes: {
        "./export-app": "./src/export-app.tsx",
      },
      shared: ["react", "react-dom"],
    }),
  ],
});
