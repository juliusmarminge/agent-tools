import react from "@vitejs/plugin-react";
import { convexLocal } from "convex-vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    convexLocal({
      instanceName: "my-app",
      instanceSecret: "secret",
      adminKey: "admin-key",
    }),
  ],
});
