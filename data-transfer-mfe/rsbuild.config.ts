import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";

export default defineConfig({
  plugins: [
    pluginReact(),
    pluginModuleFederation({
      name: "dataTransferMfe",
      exposes: {
        "./export-app": "./src/export-app.tsx",
      },
      shared: {
        react: { singleton: true, eager: true },
        "react-dom": { singleton: true, eager: true },
      },
    }),
  ],
  source: {
    // Any source configuration you need
  },
  dev: {
    assetPrefix: "auto",
  },
  server: {
    port: 2001,
    cors: true,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  },
});
