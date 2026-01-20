import type { Plugin, ViteDevServer } from "vite";

import * as fs from "node:fs";
import * as path from "node:path";

import { ConvexBackend } from "./backend.ts";
import { computeStateId, debounce, matchPattern } from "./utils.ts";

/**
 * Options for the convexLocal Vite plugin.
 */
export interface ConvexLocalOptions {
  /** The instance name for the Convex backend */
  instanceName: string;
  /** The instance secret for the Convex backend */
  instanceSecret: string;
  /** The admin key for authenticating with the Convex backend */
  adminKey: string;
  /** The project directory containing the Convex functions (defaults to cwd) */
  projectDir?: string;
  /** Reset backend state before starting (delete existing data) */
  reset?: boolean;
  /**
   * Environment variables to set on the backend.
   * Can be a static object or a function that receives the Vite port.
   */
  envVars?:
    | Record<string, string>
    | ((vitePort: number) => Record<string, string> | Promise<Record<string, string>>);
  /** File watching configuration */
  watch?: {
    /** Glob patterns to watch (defaults to convex/*.ts and convex/**\/*.ts) */
    patterns?: string[];
    /** Glob patterns to ignore (defaults to convex/_generated/**) */
    ignore?: string[];
    /** Debounce delay in milliseconds (defaults to 500) */
    debounceMs?: number;
  };
  /** How to handle stdio from the backend process */
  stdio?: "inherit" | "ignore";
}

/**
 * A Vite plugin that runs a local Convex backend during development.
 *
 * This plugin will:
 * - Start a local Convex backend when Vite dev server starts
 * - Deploy your Convex functions on startup
 * - Watch for changes in your convex/ directory and redeploy automatically
 * - Inject VITE_CONVEX_URL and VITE_CONVEX_SITE_URL environment variables
 * - Clean up when the dev server stops
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { convexLocal } from "convex-vite-plugin";
 *
 * export default defineConfig({
 *   plugins: [
 *     convexLocal({
 *       instanceName: "my-app",
 *       instanceSecret: "secret",
 *       adminKey: "admin-key",
 *     }),
 *   ],
 * });
 * ```
 */
export function convexLocal(options: ConvexLocalOptions): Plugin {
  let backend: ConvexBackend | null = null;
  let isDeploying = false;
  let pendingDeploy = false;

  const projectDir = options.projectDir ?? process.cwd();
  const watchPatterns = options.watch?.patterns ?? ["convex/*.ts", "convex/**/*.ts"];
  const ignorePatterns = options.watch?.ignore ?? [
    "convex/_generated/**",
    "convex/_generated/*.ts",
  ];
  const debounceMs = options.watch?.debounceMs ?? 500;

  const shouldWatch = (filePath: string): boolean => {
    const relativePath = filePath.startsWith(projectDir)
      ? filePath.slice(projectDir.length + 1)
      : filePath;
    const matches = watchPatterns.some((p) => matchPattern(relativePath, p));
    const ignored = ignorePatterns.some((p) => matchPattern(relativePath, p));
    return matches && !ignored;
  };

  const deploy = (): void => {
    if (!backend?.port) {
      console.warn("[convex] Cannot deploy: backend not running");
      return;
    }

    if (isDeploying) {
      pendingDeploy = true;
      return;
    }

    isDeploying = true;
    console.log("[convex] Deploying...");

    try {
      backend.deploy();
      console.log("[convex] Deploy successful");
    } catch (error: unknown) {
      console.error("[convex] Deploy failed:", error);
    } finally {
      isDeploying = false;
      if (pendingDeploy) {
        pendingDeploy = false;
        deploy();
      }
    }
  };

  const debouncedDeploy = debounce(deploy, debounceMs);

  return {
    name: "vite-plugin-convex-local",
    enforce: "pre",

    async config(config, env) {
      // Only activate in dev mode
      if (env.command !== "serve") return;

      // Compute deterministic state directory based on git branch + cwd
      const stateId = computeStateId(projectDir);
      const backendDir = path.join(projectDir, ".convex", stateId);
      const stateExists = fs.existsSync(backendDir);

      // Handle reset - delete existing state if requested
      if (options.reset && stateExists) {
        console.log("[convex] Resetting backend state...");
        fs.rmSync(backendDir, { recursive: true, force: true });
      }

      backend = new ConvexBackend({
        instanceName: options.instanceName,
        instanceSecret: options.instanceSecret,
        adminKey: options.adminKey,
        projectDir,
        stdio: options.stdio ?? "inherit",
      });

      // Override the random backendDir with our deterministic one
      backend.backendDir = backendDir;

      const isResume = stateExists && !options.reset;
      console.log(
        isResume
          ? `[convex] Resuming backend from existing state (${stateId})...`
          : `[convex] Starting fresh backend (${stateId})...`,
      );

      await backend.startBackend(backendDir);
      console.log(`[convex] Backend running on port ${backend.port}`);

      const backendUrl = `http://localhost:${backend.port}`;
      const siteUrl = `http://localhost:${backend.siteProxyPort}`;

      // Return config modifications to inject the URLs
      return {
        define: {
          ...config.define,
          "import.meta.env.VITE_CONVEX_URL": JSON.stringify(backendUrl),
          "import.meta.env.VITE_CONVEX_SITE_URL": JSON.stringify(siteUrl),
        },
      };
    },

    configureServer(server: ViteDevServer) {
      if (!backend) return;

      const cleanup = async () => {
        if (backend) {
          // Don't delete the state directory - preserve for next run
          await backend.stop(false);
          backend = null;
        }
      };

      server.httpServer?.on("close", () => {
        void cleanup();
      });

      process.on("SIGINT", () => {
        void cleanup().then(() => process.exit(0));
      });
      process.on("SIGTERM", () => {
        void cleanup().then(() => process.exit(0));
      });

      const handleFileChange = (filePath: string) => {
        if (shouldWatch(filePath)) {
          const relativePath = filePath.startsWith(projectDir)
            ? filePath.slice(projectDir.length + 1)
            : filePath;
          console.log(`[convex] File changed: ${relativePath}`);
          debouncedDeploy();
        }
      };

      // Explicitly add convex directory to watcher (not in Vite's module graph)
      const convexDir = path.join(projectDir, "convex");
      server.watcher.add(convexDir);

      server.watcher.on("change", handleFileChange);
      server.watcher.on("add", handleFileChange);
      server.watcher.on("unlink", handleFileChange);

      // Wait for the server to actually be listening to get the real port
      server.httpServer?.once("listening", () => {
        const addr = server.httpServer?.address();
        const vitePort =
          addr && typeof addr === "object" ? addr.port : (server.config.server.port ?? 3000);

        console.log(`[convex] Vite server port: ${vitePort}`);

        // Set env vars and deploy asynchronously
        void (async () => {
          if (!backend) return;

          // Set IS_TEST env var
          await backend.setEnv("IS_TEST", "true");

          // Set user-provided env vars
          if (options.envVars) {
            const envVars =
              typeof options.envVars === "function"
                ? await options.envVars(vitePort)
                : options.envVars;

            for (const [name, value] of Object.entries(envVars)) {
              await backend.setEnv(name, value);
            }
          }

          // Initial deploy
          deploy();

          const backendUrl = `http://localhost:${backend.port}`;
          console.log(`[convex] Backend ready at ${backendUrl}`);
        })();
      });
    },
  };
}

export default convexLocal;

// Re-export backend for advanced use cases
export { ConvexBackend, type ConvexBackendOptions } from "./backend.ts";
