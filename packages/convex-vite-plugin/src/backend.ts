import type { ChildProcess, StdioOptions } from "node:child_process";

import * as childProcess from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";

import { downloadConvexBinary, findUnusedPort, waitForHttpOk } from "./utils.ts";

/**
 * Options for creating a ConvexBackend instance.
 */
export interface ConvexBackendOptions {
  /** The instance name for the Convex backend */
  instanceName: string;
  /** The instance secret for the Convex backend */
  instanceSecret: string;
  /** The admin key for authenticating with the Convex backend */
  adminKey: string;
  /** The project directory containing the Convex functions (defaults to cwd) */
  projectDir?: string;
  /** How to handle stdio from the backend process */
  stdio?: StdioOptions;
}

/**
 * Manages a local Convex backend instance.
 * Handles starting, stopping, deploying, and setting environment variables.
 */
export class ConvexBackend {
  /** The port the backend is listening on */
  public port?: number;
  /** The port for the site proxy */
  public siteProxyPort?: number;
  /** The backend process */
  public process?: ChildProcess;
  /** The backend URL */
  public backendUrl?: string;

  private readonly projectDir: string;
  public backendDir: string;
  private readonly stdio: StdioOptions;
  private readonly instanceName: string;
  private readonly instanceSecret: string;
  private readonly adminKey: string;

  constructor(options: ConvexBackendOptions) {
    this.projectDir = options.projectDir ?? process.cwd();
    this.backendDir = path.join(this.projectDir, ".convex", crypto.randomBytes(16).toString("hex"));
    this.stdio = options.stdio ?? "inherit";
    this.instanceName = options.instanceName;
    this.instanceSecret = options.instanceSecret;
    this.adminKey = options.adminKey;
  }

  /**
   * Start the backend process.
   * @param backendDir - The directory to store backend state
   */
  async startBackend(backendDir: string): Promise<void> {
    const storageDir = path.join(backendDir, "convex_local_storage");
    fs.mkdirSync(storageDir, { recursive: true });

    const sqlitePath = path.join(backendDir, "convex_local_backend.sqlite3");
    const convexBinary = await downloadConvexBinary();

    this.port = await findUnusedPort();
    this.siteProxyPort = await findUnusedPort();

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

    await this.healthCheck();

    if (!this.process.pid) {
      throw new Error("Convex process failed to start - no PID assigned");
    }
  }

  private async healthCheck(): Promise<void> {
    if (!this.port) throw new Error("Port not set for health check");
    const url = `http://localhost:${this.port}/version`;
    await waitForHttpOk(url, 10_000);
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
        timeout: 60000,
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

    console.log(`[convex] Stopping backend...`);

    const pid = this.process.pid;
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      console.warn(`Failed to terminate Convex backend gracefully:`, error);
    }

    if (cleanup) {
      console.log(`[convex] Cleaning up backend files...`);
      await fsp.rm(this.backendDir, { recursive: true });
    }
  }
}
