import react from "@vitejs/plugin-react";
import { convexLocal } from "convex-vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    convexLocal({
      reset: process.env.RESET_LOCAL_BACKEND === "true" || process.env.RESET_LOCAL_BACKEND === "1",
      stateIdSuffix: process.env.LOCAL_BACKEND_STATE_ID_SUFFIX,
      envVars: ({ resolvedUrls }) => ({
        SITE_URL: resolvedUrls?.local[0] ?? "http://localhost:5173",
      }),
      // Seed on startup
      // onReady: [{ name: "functions:seed" }],
    }),
  ],
});
