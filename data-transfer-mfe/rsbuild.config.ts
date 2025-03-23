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
  output: {
    copy: [
      {
        from: "public/service-worker.js",
        to: ".",
      },
    ],
  },
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
      // CORS headers for cross-origin access
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",

      // Service Worker header - essential for cross-origin service worker
      "Service-Worker-Allowed": "*",
    },
  },
});
