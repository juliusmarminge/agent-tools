import react from "@vitejs/plugin-react";
import { convexLocal } from "convex-vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    convexLocal({
      reset: process.env.RESET_LOCAL_BACKEND === "true" || process.env.RESET_LOCAL_BACKEND === "1",
      stateIdSuffix: process.env.LOCAL_BACKEND_STATE_ID_SUFFIX,
      envVars: (vitePort) => ({
        SITE_URL: `http://localhost:${vitePort}`,
      }),
      onReady: [{ name: "functions:seed" }],
    }),
  ],
});
