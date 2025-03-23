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
      shared: ["react", "react-dom"],
    }),
  ],
  output: {
    copy: [
      {
        from: "./public/service-worker.js",
        to: "service-worker.js",
      },
    ],
  },
  source: {
    alias: {
      // Add any aliases you need here
    },
  },
  server: {
    port: 2001,
  },
});
