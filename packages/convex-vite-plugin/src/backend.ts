import type { ChildProcess, StdioOptions } from "node:child_process";
import type { Logger } from "vite";

import * as childProcess from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";

import { generateKeyPair } from "./keys.ts";
import { downloadConvexBinary, waitForHttpOk } from "./utils.ts";

/**
 * Options for creating a ConvexBackend instance.
 */
export interface ConvexBackendOptions {
  /** The instance name for the Convex backend (defaults to "convex-local") */
  instanceName?: string | undefined;
  /** The instance secret for the Convex backend (auto-generated if not provided) */
  instanceSecret?: string | undefined;
  /** The admin key for authenticating with the Convex backend (auto-generated if not provided) */
  adminKey?: string | undefined;
  /** Port for the backend (dynamically assigned if not provided, starting from 3210) */
  port?: number | undefined;
  /** Port for the site proxy (dynamically assigned if not provided) */
  siteProxyPort?: number | undefined;
  /** The project directory containing the Convex functions (defaults to cwd) */
  projectDir?: string | undefined;
  /** How to handle stdio from the backend process */
  stdio?: StdioOptions | undefined;
  /** Timeout for deploy operations in milliseconds (defaults to 60000) */
  deployTimeout?: number | undefined;
  /** Timeout for backend health check in milliseconds (defaults to 10000) */
  healthCheckTimeout?: number | undefined;
  /** Pin to a specific Convex backend version (e.g., "precompiled-2024-12-17") */
  binaryVersion?: string | undefined;
  /** Directory to cache the Convex binary (defaults to ~/.convex-local-backend/releases) */
  binaryCacheDir?: string | undefined;
  /** How long to use a cached binary before checking for updates in milliseconds (defaults to 7 days) */
  binaryCacheTtl?: number | undefined;
}

/**
 * Manages a local Convex backend instance.
 * Handles starting, stopping, deploying, and setting environment variables.
 */
export class ConvexBackend {
  /** The port the backend is listening on */
  public port: number | undefined;
  /** The port for the site proxy */
  public siteProxyPort: number | undefined;
  /** The backend process */
  public process: ChildProcess | undefined;
  /** The backend URL */
  public backendUrl?: string;

  private readonly projectDir: string;
  public backendDir: string;
  private readonly stdio: StdioOptions;
  private readonly instanceName: string;
  private readonly instanceSecret: string;
  private readonly adminKey: string;
  private readonly logger: Logger;
  private readonly deployTimeout: number;
  private readonly healthCheckTimeout: number;
  private readonly binaryVersion: string | undefined;
  private readonly binaryCacheDir: string | undefined;
  private readonly binaryCacheTtl: number;

  constructor(options: ConvexBackendOptions, logger: Logger) {
    this.logger = logger;
    this.projectDir = options.projectDir ?? process.cwd();
    this.backendDir = path.join(this.projectDir, ".convex", crypto.randomBytes(16).toString("hex"));
    this.stdio = options.stdio ?? "inherit";
    this.deployTimeout = options.deployTimeout ?? 60000;
    this.healthCheckTimeout = options.healthCheckTimeout ?? 10000;
    this.binaryVersion = options.binaryVersion;
    this.binaryCacheDir = options.binaryCacheDir;
    this.binaryCacheTtl = options.binaryCacheTtl ?? 7 * 24 * 60 * 60 * 1000; // 7 days

    // Use fixed ports if provided
    this.port = options.port ?? 3210;
    this.siteProxyPort = options.siteProxyPort ?? 3211;
    this.backendUrl = `http://127.0.0.1:${this.port}`;

    // Auto-generate keys if not provided
    this.instanceName = options.instanceName ?? "convex-local";

    if (options.instanceSecret && options.adminKey) {
      this.instanceSecret = options.instanceSecret;
      this.adminKey = options.adminKey;
    } else {
      const keys = generateKeyPair(this.instanceName);
      this.instanceSecret = keys.instanceSecret;
      this.adminKey = keys.adminKey;
    }
  }

  /**
   * Get the admin key for authenticating with the Convex backend.
   * Use this to create your own ConvexClient with admin privileges.
   */
  public getAdminKey(): string {
    return this.adminKey;
  }

  /**
   * Spawn the backend process.
   * Returns immediately after spawning - does not wait for the backend to be ready.
   * Call waitForReady() to ensure the backend is accepting connections.
   * @param backendDir - The directory to store backend state
   */
  async spawn(backendDir: string): Promise<void> {
    const storageDir = path.join(backendDir, "convex_local_storage");
    fs.mkdirSync(storageDir, { recursive: true });

    const sqlitePath = path.join(backendDir, "convex_local_backend.sqlite3");
    const convexBinary = await downloadConvexBinary(
      {
        cacheTtlMs: this.binaryCacheTtl,
        version: this.binaryVersion,
        cacheDir: this.binaryCacheDir,
      },
      this.logger,
    );

    this.process = childProcess.spawn(
      convexBinary,
      [
        "--port",
        String(this.port),
        "--site-proxy-port",
        String(this.siteProxyPort),
        "--instance-name",
        this.instanceName,
        "--instance-secret",
        this.instanceSecret,
        "--local-storage",
        storageDir,
        sqlitePath,
      ],
      {
        cwd: backendDir,
        stdio: this.stdio,
      },
    );

    if (!this.process.pid) {
      throw new Error("Convex process failed to start - no PID assigned");
    }

    this.logger.info(`Backend spawned on port ${this.port} (waiting for ready...)`, {
      timestamp: true,
    });
  }

  /**
   * Wait for the backend to be ready to accept connections.
   * Call this after spawn() before making any API calls.
   */
  async waitForReady(): Promise<void> {
    await this.healthCheck();

    this.logger.info("Backend ready", { timestamp: true });
    this.logger.info(`  Instance name:   ${this.instanceName}`, { timestamp: true });
    this.logger.info(`  Instance secret: ${this.instanceSecret}`, { timestamp: true });
    this.logger.info(`  Admin key:       ${this.adminKey}`, { timestamp: true });
    this.logger.info(`  Backend URL:     ${this.backendUrl}`, { timestamp: true });
  }

  /**
   * Start the backend process and wait for it to be ready.
   * Convenience method that combines spawn() and waitForReady().
   * @param backendDir - The directory to store backend state
   */
  async startBackend(backendDir: string): Promise<void> {
    await this.spawn(backendDir);
    await this.waitForReady();
  }

  private async healthCheck(): Promise<void> {
    if (!this.port) throw new Error("Port not set for health check");
    const url = `http://localhost:${this.port}/version`;
    await waitForHttpOk(url, this.healthCheckTimeout);
  }

  /**
   * Deploy Convex functions to the backend.
   */
  deploy(): void {
    if (!this.port) throw new Error("Backend not started");

    const backendUrl = `http://localhost:${this.port}`;

    const deployResult = childProcess.spawnSync(
      "bun",
      ["convex", "deploy", "--admin-key", this.adminKey, "--url", backendUrl],
      {
        cwd: this.projectDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: this.deployTimeout,
      },
    );

    if (deployResult.error) {
      throw new Error(`Failed to spawn convex deploy: ${deployResult.error.message}`);
    }

    if (deployResult.status !== 0) {
      throw new Error(
        `Failed to deploy (exit code ${deployResult.status}):\n${deployResult.stdout + deployResult.stderr}`,
      );
    }
  }

  /**
   * Set an environment variable on the backend.
   */
  async setEnv(name: string, value: string): Promise<void> {
    if (!this.port) throw new Error("Backend not started");

    const backendUrl = `http://localhost:${this.port}`;

    const response = await fetch(`${backendUrl}/api/v1/update_environment_variables`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Convex ${this.adminKey}`,
      },
      body: JSON.stringify({
        changes: [{ name, value }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to set ${name} env via API (${response.status}): ${errorText}`);
    }
  }

  /**
   * Run a Convex function (query, mutation, or action) on the backend.
   * @param functionName - The function path (e.g., "myModule:myFunction")
   * @param args - Arguments to pass to the function
   * @returns The function result
   */
  async runFunction(functionName: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.port) throw new Error("Backend not started");

    const backendUrl = `http://localhost:${this.port}`;

    const response = await fetch(`${backendUrl}/api/function`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Convex-Client": "convex-vite-plugin",
        Authorization: `Convex ${this.adminKey}`,
      },
      body: JSON.stringify({
        path: functionName,
        format: "json",
        args,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to run ${functionName} (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    return result.value;
  }

  /**
   * Stop the backend process.
   * @param cleanup - Whether to delete the backend state directory
   */
  async stop(cleanup = true): Promise<void> {
    if (!this.process || this.process.pid === undefined) return;

    const pid = this.process.pid;
    try {
      // Use SIGKILL for immediate termination
      process.kill(pid, "SIGKILL");
    } catch {
      // Process might already be dead
    }
    this.process = undefined;

    if (cleanup) {
      this.logger.info("Cleaning up backend files...", { timestamp: true });
      await fsp.rm(this.backendDir, { recursive: true });
    }
  }
}
