import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { app as apiApp } from "./server.js";

const expressPlugin = {
  name: 'express-plugin',
  configureServer(server) {
    server.middlewares.use(apiApp);
  },
  configurePreviewServer(server) {
    server.middlewares.use(apiApp);
  }
};

export default defineConfig({
  plugins: [react(), expressPlugin],
  server: {
    port: 6132,
    host: "0.0.0.0"
  },
  preview: {
    port: 6132,
    host: "0.0.0.0"
  }
});
