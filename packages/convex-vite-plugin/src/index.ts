import type { Logger, Plugin, ViteDevServer } from "vite";

import * as fs from "node:fs";
import * as path from "node:path";
import { createLogger } from "vite";

import { ConvexBackend } from "./backend.ts";
import { generateKeyPair } from "./keys.ts";
import { computeStateId, debounce, findUnusedPortSync, matchPattern } from "./utils.ts";

// Create a Vite logger with [convex] prefix for the plugin
const logger: Logger = createLogger("info", { prefix: "[convex]" });

// Track the running backend to handle Vite restarts.
// When vite.config.ts changes, Vite recreates the plugin, orphaning the old backend.
// This module-level variable lets us find and stop it before starting a new one.
let runningBackend: ConvexBackend | null = null;

// Delay before starting backend initialization to let Vite complete its internal setup.
// This is necessary because Vite's restart mechanism can leave the server in a transitional
// state where httpServer references the OLD server being shut down.
const BACKEND_INIT_DELAY_MS = 500;

// Track if we've registered process exit handlers (only need to do this once per process)
let exitHandlersRegistered = false;

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
  args?: Record<string, unknown> | undefined;
}

export interface ConvexLocalOptions {
  /** The instance name for the Convex backend (defaults to "convex-local") */
  instanceName?: string | undefined;
  /** The instance secret for the Convex backend (auto-generated if not provided) */
  instanceSecret?: string | undefined;
  /** The admin key for authenticating with the Convex backend (auto-generated if not provided) */
  adminKey?: string | undefined;
  /** Port for the Convex backend (dynamically assigned if not provided, starting from 3210) */
  port?: number | undefined;
  /** Port for the Convex site proxy / HTTP actions (dynamically assigned if not provided) */
  siteProxyPort?: number | undefined;
  /** The project directory containing the Convex functions (defaults to cwd) */
  projectDir?: string | undefined;
  /** The directory containing Convex functions, relative to projectDir (defaults to "convex") */
  convexDir?: string | undefined;
  /**
   * Optional suffix to include in the stateId hash.
   * Use this to run multiple unique backend instances even when cwd and git branch are the same.
   */
  stateIdSuffix?: string | undefined;
  /** Reset backend state before starting (delete existing data) */
  reset?: boolean | undefined;
  /**
   * Environment variables to set on the backend.
   * Can be a static object or a function that receives the Vite port.
   */
  envVars?:
    | Record<string, string>
    | ((vitePort: number) => Record<string, string> | Promise<Record<string, string>>)
    | undefined;
  /** File watching configuration */
  watch?:
    | {
        /** Glob patterns to watch (defaults to <convexDir>/*.ts and <convexDir>/**\/*.ts) */
        patterns?: string[] | undefined;
        /** Glob patterns to ignore (defaults to <convexDir>/_generated/**) */
        ignore?: string[] | undefined;
        /** Debounce delay in milliseconds (defaults to 500) */
        debounceMs?: number | undefined;
      }
    | undefined;
  /** How to handle stdio from the backend process */
  stdio?: "inherit" | "ignore" | undefined;
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
  onReady?: ConvexFunctionCall[] | undefined;
  /** Timeout for deploy operations in milliseconds (defaults to 60000) */
  deployTimeout?: number | undefined;
  /** Timeout for backend health check in milliseconds (defaults to 10000) */
  healthCheckTimeout?: number | undefined;
  /**
   * Pin to a specific Convex backend version (e.g., "precompiled-2024-12-17").
   * If not specified, uses the latest available version.
   */
  binaryVersion?: string | undefined;
  /** Directory to cache the Convex binary (defaults to ~/.convex-local-backend/releases) */
  binaryCacheDir?: string | undefined;
  /** How long to use a cached binary before checking for updates in milliseconds (defaults to 7 days) */
  binaryCacheTtl?: number | undefined;
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
  const convexDir = options.convexDir ?? "convex";
  const watchPatterns = options.watch?.patterns ?? [`${convexDir}/*.ts`, `${convexDir}/**/*.ts`];
  const ignorePatterns = options.watch?.ignore ?? [
    `${convexDir}/_generated/**`,
    `${convexDir}/_generated/*.ts`,
  ];
  const debounceMs = options.watch?.debounceMs ?? 500;
  const deployTimeout = options.deployTimeout ?? 60000;
  const healthCheckTimeout = options.healthCheckTimeout ?? 10000;
  const binaryCacheTtl = options.binaryCacheTtl ?? 7 * 24 * 60 * 60 * 1000; // 7 days

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
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Deploy failed: ${errMsg}`, {
        timestamp: true,
        ...(error instanceof Error && { error }),
      });
    } finally {
      isDeploying = false;
      if (pendingDeploy) {
        pendingDeploy = false;
        deploy();
      }
    }
  };

  const debouncedDeploy = debounce(deploy, debounceMs);

  // Find available ports in the ephemeral range - use provided ports or find unused ones dynamically
  const port = options.port ?? findUnusedPortSync(Math.floor(Math.random() * 10000) + 3210);
  const siteProxyPort = options.siteProxyPort ?? findUnusedPortSync(port + 1);
  const backendUrl = `http://localhost:${port}`;
  const siteUrl = `http://localhost:${siteProxyPort}`;

  logger.info(`Using ports: backend=${port}, siteProxy=${siteProxyPort}`, { timestamp: true });

  // Compute deterministic state directory based on git branch + cwd + optional suffix
  const stateId = computeStateId(projectDir, options.stateIdSuffix);
  const backendDir = path.join(projectDir, ".convex", stateId);

  return {
    name: "vite-plugin-convex-local",
    enforce: "pre",

    config(config, env) {
      // Only activate in dev mode
      if (env.command !== "serve") return;

      // Defer killing the old backend to avoid blocking Vite's config phase
      if (runningBackend?.process?.pid) {
        const pid = runningBackend.process.pid;
        runningBackend = null;
        // Kill async via setImmediate to not block config()
        setImmediate(() => {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // Process might already be dead
          }
        });
      }

      // Return config modifications to inject the URLs (synchronous!)
      return {
        define: {
          ...config.define,
          "import.meta.env.VITE_CONVEX_URL": JSON.stringify(backendUrl),
          "import.meta.env.VITE_CONVEX_SITE_URL": JSON.stringify(siteUrl),
        },
      };
    },

    configureServer(server: ViteDevServer) {
      // Register process exit handlers once to clean up the backend on shutdown.
      // We use a module-level flag because configureServer is called on every restart,
      // and we don't want to accumulate handlers.
      if (!exitHandlersRegistered) {
        exitHandlersRegistered = true;
        const handleExit = () => {
          if (runningBackend?.process?.pid) {
            try {
              process.kill(runningBackend.process.pid, "SIGKILL");
            } catch {
              // Process might already be dead
            }
          }
          process.exit(0);
        };
        process.once("SIGINT", handleExit);
        process.once("SIGTERM", handleExit);
      }

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
      const convexDirPath = path.join(projectDir, convexDir);
      server.watcher.add(convexDirPath);

      server.watcher.on("change", handleFileChange);
      server.watcher.on("add", handleFileChange);
      server.watcher.on("unlink", handleFileChange);

      // Start backend initialization asynchronously (doesn't block Vite)
      const startBackendInit = (vitePort: number) => {
        void (async () => {
          try {
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
              keys = existingKeys;
              logger.info("Loaded persisted keys", { timestamp: true });
            } else if (options.instanceSecret && options.adminKey) {
              keys = {
                instanceName: options.instanceName ?? "convex-local",
                instanceSecret: options.instanceSecret,
                adminKey: options.adminKey,
              };
              savePersistedKeys(keysPath, keys);
              logger.info("Using provided keys", { timestamp: true });
            } else {
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

            // Create and start backend
            backend = new ConvexBackend(
              {
                instanceName: keys.instanceName,
                instanceSecret: keys.instanceSecret,
                adminKey: keys.adminKey,
                port,
                siteProxyPort,
                projectDir,
                stdio: options.stdio ?? "ignore",
                deployTimeout,
                healthCheckTimeout,
                binaryVersion: options.binaryVersion,
                binaryCacheDir: options.binaryCacheDir,
                binaryCacheTtl,
              },
              logger,
            );
            backend.backendDir = backendDir;

            const isResume = stateExists && !options.reset;
            logger.info(
              isResume
                ? `Resuming backend from existing state (${stateId})...`
                : `Starting fresh backend (${stateId})...`,
              { timestamp: true },
            );

            await backend.spawn(backendDir);
            runningBackend = backend;

            // Wait for backend to be ready before making API calls
            await backend.waitForReady();

            // Set user-provided env vars
            if (options.envVars) {
              const envVars =
                typeof options.envVars === "function"
                  ? await options.envVars(vitePort)
                  : options.envVars;

              for (const [name, value] of Object.entries(envVars)) {
                await backend.setEnv(name, value);
                logger.info(`Set environment variable: ${name} = ${value}`, { timestamp: true });
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
                  const errMsg = error instanceof Error ? error.message : String(error);
                  logger.error(`Failed to run ${fn.name}: ${errMsg}`, {
                    timestamp: true,
                    ...(error instanceof Error && { error }),
                  });
                }
              }
            }

            const backendUrl = `http://localhost:${backend.port}`;
            logger.info(`Backend ready at ${backendUrl}`, { timestamp: true });
          } catch (error) {
            logger.error(`Backend initialization failed: ${String(error)}`, { timestamp: true });
          }
        })();
      };

      // Delay initialization to ensure Vite has completed its internal setup.
      // We get the actual Vite port from httpServer.address() since server.config.server.port
      // only shows the configured port, not the actual port if Vite had to find an available one.
      setTimeout(() => {
        const address = server.httpServer?.address();
        const vitePort =
          address && typeof address === "object"
            ? address.port
            : (server.config.server.port ?? 5173);
        startBackendInit(vitePort);
      }, BACKEND_INIT_DELAY_MS);
    },
  };
}

export default convexLocal;

declare global {
  interface ImportMetaEnv {
    VITE_CONVEX_URL: string;
    VITE_CONVEX_SITE_URL: string;
  }
}
