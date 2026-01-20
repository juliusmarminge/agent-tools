import type { Logger, Plugin, ViteDevServer } from "vite";

import * as fs from "node:fs";
import * as path from "node:path";
import { createLogger } from "vite";

import { ConvexBackend } from "./backend.ts";
import { generateKeyPair } from "./keys.ts";
import { computeStateId, debounce, matchPattern } from "./utils.ts";

// Create a Vite-style logger with [convex] prefix
const logger: Logger = createLogger("info", { prefix: "[convex]" });

interface PersistedKeys {
  instanceName: string;
  instanceSecret: string;
  adminKey: string;
}

function loadPersistedKeys(keysPath: string): PersistedKeys | null {
  try {
    if (fs.existsSync(keysPath)) {
      const data = fs.readFileSync(keysPath, "utf-8");
      return JSON.parse(data) as PersistedKeys;
    }
  } catch {
    // Ignore errors, will regenerate keys
  }
  return null;
}

function savePersistedKeys(keysPath: string, keys: PersistedKeys): void {
  const dir = path.dirname(keysPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keysPath, JSON.stringify(keys, null, 2));
}

/**
 * A function call to run on the backend.
 */
export interface ConvexFunctionCall {
  /** The function path (e.g., "myModule:myFunction" or "seed:default") */
  name: string;
  /** Arguments to pass to the function */
  args?: Record<string, unknown>;
}

export interface ConvexLocalOptions {
  /** The instance name for the Convex backend (defaults to "convex-local") */
  instanceName?: string;
  /** The instance secret for the Convex backend (auto-generated if not provided) */
  instanceSecret?: string;
  /** The admin key for authenticating with the Convex backend (auto-generated if not provided) */
  adminKey?: string;
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
  /**
   * Functions to run after the backend is ready (after initial deploy).
   * Useful for seeding data or running initialization scripts.
   *
   * @example
   * ```ts
   * onReady: [
   *   { name: "seed:default" },
   *   { name: "init:setup", args: { admin: true } },
   * ]
   * ```
   */
  onReady?: ConvexFunctionCall[];
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
 *     // Keys are auto-generated if not provided
 *     convexLocal(),
 *     // Or with custom instance name
 *     convexLocal({ instanceName: "my-app" }),
 *   ],
 * });
 * ```
 */
export function convexLocal(options: ConvexLocalOptions = {}): Plugin {
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
      logger.warn("Cannot deploy: backend not running", { timestamp: true });
      return;
    }

    if (isDeploying) {
      pendingDeploy = true;
      return;
    }

    isDeploying = true;
    logger.info("Deploying...", { timestamp: true });

    try {
      backend.deploy();
      logger.info("Deploy successful", { timestamp: true });
    } catch (error) {
      logger.error(`Deploy failed:`, { timestamp: true, error: error as Error });
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
      const keysPath = path.join(backendDir, "keys.json");
      const stateExists = fs.existsSync(backendDir);

      // Handle reset - delete existing state if requested
      if (options.reset && stateExists) {
        logger.info("Resetting backend state...", { timestamp: true });
        fs.rmSync(backendDir, { recursive: true, force: true });
      }

      // Load or generate keys
      let keys: PersistedKeys;
      const existingKeys = loadPersistedKeys(keysPath);

      if (existingKeys && !options.reset) {
        // Use existing keys for this state directory
        keys = existingKeys;
        logger.info("Loaded persisted keys", { timestamp: true });
      } else if (options.instanceSecret && options.adminKey) {
        // Use explicitly provided keys
        keys = {
          instanceName: options.instanceName ?? "convex-local",
          instanceSecret: options.instanceSecret,
          adminKey: options.adminKey,
        };
        savePersistedKeys(keysPath, keys);
        logger.info("Using provided keys", { timestamp: true });
      } else {
        // Generate new keys
        const instanceName = options.instanceName ?? "convex-local";
        const generated = generateKeyPair(instanceName);
        keys = {
          instanceName,
          instanceSecret: generated.instanceSecret,
          adminKey: generated.adminKey,
        };
        savePersistedKeys(keysPath, keys);
        logger.info("Generated new keys", { timestamp: true });
      }

      backend = new ConvexBackend(
        {
          instanceName: keys.instanceName,
          instanceSecret: keys.instanceSecret,
          adminKey: keys.adminKey,
          projectDir,
          stdio: options.stdio ?? "ignore",
        },
        logger,
      );

      // Override the random backendDir with our deterministic one
      backend.backendDir = backendDir;

      const isResume = stateExists && !options.reset;
      logger.info(
        isResume
          ? `Resuming backend from existing state (${stateId})...`
          : `Starting fresh backend (${stateId})...`,
        { timestamp: true },
      );

      await backend.startBackend(backendDir);
      logger.info(`Backend running on port ${backend.port}`, { timestamp: true });

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
          logger.info(`File changed: ${relativePath}`, { timestamp: true });
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

        logger.info(`Vite server port: ${vitePort}`, { timestamp: true });

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

          // Run onReady functions (e.g., seed scripts)
          if (options.onReady && options.onReady.length > 0) {
            logger.info(`Running ${options.onReady.length} startup function(s)...`, {
              timestamp: true,
            });
            for (const fn of options.onReady) {
              try {
                logger.info(`Running ${fn.name}...`, { timestamp: true });
                await backend.runFunction(fn.name, fn.args ?? {});
                logger.info(`${fn.name} completed`, { timestamp: true });
              } catch (error) {
                logger.error(`Failed to run ${fn.name}:`, {
                  timestamp: true,
                  error: error as Error,
                });
              }
            }
          }

          const backendUrl = `http://localhost:${backend.port}`;
          logger.info(`Backend ready at ${backendUrl}`, { timestamp: true });
        })();
      });
    },
  };
}

export default convexLocal;

// Re-export backend for advanced use cases
export { ConvexBackend, type ConvexBackendOptions } from "./backend.ts";

// Re-export key utilities for manual key generation
export { generateInstanceSecret, generateAdminKey, generateKeyPair } from "./keys.ts";
