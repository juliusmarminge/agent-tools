import react from "@vitejs/plugin-react";
import { convexLocal } from "convex-vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    convexLocal({
      // reset: true,
      stdio: "ignore",
      stateIdSuffix: process.env.STATE_SUFFIX,
      envVars: (vitePort) => ({
        SITE_URL: `http://localhost:${vitePort}`,
      }),
    }),
  ],
});
