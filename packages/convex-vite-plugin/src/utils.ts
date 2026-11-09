import * as ChildProcess from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { ConvexLogger } from "./logger.ts";

export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

/**
 * Detect the package manager from npm_config_user_agent.
 * Format: "<pm>/<version> node/<version> <os> <arch>"
 * Examples:
 *   - "npm/10.2.0 node/v20.9.0 darwin arm64"
 *   - "yarn/4.0.0 npm/? node/v20.9.0 darwin arm64"
 *   - "pnpm/8.10.0 npm/? node/v20.9.0 darwin arm64"
 *   - "bun/1.0.0 node/v20.9.0 darwin arm64"
 */
export function detectPackageManager(): PackageManager {
  const userAgent = process.env.npm_config_user_agent;
  if (!userAgent) return "npm"; // Default fallback

  if (userAgent.startsWith("bun/")) return "bun";
  if (userAgent.startsWith("pnpm/")) return "pnpm";
  if (userAgent.startsWith("yarn/")) return "yarn";
  return "npm";
}

/**
 * Get the command and args to execute a local binary.
 */
export function getExecCommand(pm: PackageManager): { cmd: string; args: string[] } {
  switch (pm) {
    case "bun":
      return { cmd: "bunx", args: [] };
    case "pnpm":
      return { cmd: "pnpm", args: ["exec"] };
    case "yarn":
      return { cmd: "yarn", args: ["exec"] };
    case "npm":
    default:
      return { cmd: "npx", args: [] };
  }
}

/**
 * Compute a deterministic state ID based on git branch + working directory.
 * This allows the backend state to be reused across restarts.
 *
 * @param projectDir - The project directory path
 * @param suffix - Optional suffix to include in the hash for unique instances
 */
export function computeStateId(projectDir: string, suffix: string | undefined): string {
  let gitBranch = "unknown";
  try {
    const result = ChildProcess.spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status === 0 && result.stdout) {
      gitBranch = result.stdout.trim();
    }
  } catch {
    // Ignore git errors
  }

  const input = suffix ? `${gitBranch}:${projectDir}:${suffix}` : `${gitBranch}:${projectDir}`;
  const hash = crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);

  const sanitizedBranch = gitBranch.replace(/[^a-zA-Z0-9-]/g, "-");
  const sanitizedSuffix = suffix ? `-${suffix.replace(/[^a-zA-Z0-9-]/g, "-")}` : "";

  return `${sanitizedBranch}${sanitizedSuffix}-${hash}`;
}

/**
 * Debounce a function call by the specified delay.
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return (...args) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Match a file path against a glob-like pattern.
 */
export function matchPattern(filePath: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*")
    .replace(/\//g, "\\/");
  return new RegExp(`^${regexPattern}$`).test(filePath);
}

/**
 * Check if a port is available synchronously using platform-specific commands.
 */
function isPortAvailableSync(port: number): boolean {
  if (process.platform === "win32") {
    const result = ChildProcess.spawnSync("netstat", ["-an"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status !== 0) return true; // Assume available if command fails
    return !result.stdout?.includes(`:${port} `);
  }

  // macOS and Linux: use lsof
  const result = ChildProcess.spawnSync("lsof", ["-i", `:${port}`, "-sTCP:LISTEN"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  // If lsof returns nothing (exit 1) or empty output, port is available
  return result.status !== 0 || !result.stdout?.trim();
}

/**
 * Find an unused port synchronously, starting from a given port.
 * Useful for Vite plugin initialization where async is not allowed.
 */
export function findUnusedPortSync(startPort = 10000, maxAttempts = 100): number {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = startPort + attempt;
    if (isPortAvailableSync(port)) {
      return port;
    }
  }
  throw new Error(`Could not find an available port after ${maxAttempts} attempts`);
}

/**
 * Wait for an HTTP endpoint to return an OK response.
 */
export async function waitForHttpOk(url: string, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  while (true) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.ok || (res.status >= 300 && res.status < 400)) return;
    } catch {
      // no-op
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Timed out waiting for ${url} to become ready`);
    const delay = Math.min(200 * Math.pow(1.5, attempts), remaining);
    await new Promise((r) => setTimeout(r, delay));
    attempts++;
  }
}

/**
 * Register a cleanup handler to be called when the current process exits.
 */
export function onProcessExit(handler: () => Promise<void>): void {
  const handleExit = (signal: string) => {
    handler()
      .catch((error: unknown) => {
        console.error(`Error during cleanup (${signal}):`, error);
      })
      .finally(() => {
        process.exit(signal === "uncaughtException" ? 1 : 0);
      });
  };

  process.on("SIGINT", () => handleExit("SIGINT"));
  process.on("SIGTERM", () => handleExit("SIGTERM"));
  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
    handleExit("uncaughtException");
  });
}

interface ReleaseAsset {
  name: string;
  /** REST endpoint that serves the bytes for `Accept: application/octet-stream`. */
  url: string;
  browser_download_url: string;
  /** `sha256:<hex>`, or null for assets GitHub has no digest for. */
  digest?: string | null;
}

interface GitHubRelease {
  tag_name: string;
  assets: ReleaseAsset[];
}

const TRANSIENT_DOWNLOAD_STATUSES = new Set([408, 409, 429]);
const DOWNLOAD_MAX_ATTEMPTS = 3;

class DownloadHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

class ArchiveValidationError extends Error {}

function isTransientDownloadStatus(status: number): boolean {
  return TRANSIENT_DOWNLOAD_STATUSES.has(status) || status >= 500;
}

function isTransientDownloadError(error: unknown): boolean {
  return error instanceof DownloadHttpError
    ? isTransientDownloadStatus(error.status)
    : error instanceof TypeError;
}

async function waitForDownloadRetry(attempt: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
}

async function fetchConvexReleases(): Promise<GitHubRelease[]> {
  const url = "https://api.github.com/repos/get-convex/convex-backend/releases?per_page=50";
  const headers: HeadersInit = {};

  const githubToken = process.env.GITHUB_TOKEN;
  if (githubToken) {
    headers["Authorization"] = `Bearer ${githubToken}`;
  }

  for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new DownloadHttpError(
          `Failed to fetch releases: ${response.status}`,
          response.status,
        );
      }
      // Awaited here so a body that fails mid-read is retried too.
      return await response.json();
    } catch (error) {
      if (!isTransientDownloadError(error) || attempt === DOWNLOAD_MAX_ATTEMPTS) throw error;
      await waitForDownloadRetry(attempt);
    }
  }

  throw new Error("Convex release download retry exhausted");
}

function getPlatformTarget(): string {
  const arch =
    process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch;

  if (process.platform === "darwin") return `convex-local-backend-${arch}-apple-darwin`;
  if (process.platform === "linux") return `convex-local-backend-${arch}-unknown-linux-gnu`;
  if (process.platform === "win32") return `convex-local-backend-${arch}-pc-windows-msvc`;

  throw new Error(`Unsupported platform: ${process.platform}`);
}

function findAsset(
  releases: GitHubRelease[],
  target: string,
  version?: string,
): {
  asset: ReleaseAsset;
  version: string;
} {
  // If a specific version is requested, find that release
  if (version) {
    const release = releases.find((r) => r.tag_name === version);
    if (!release) {
      throw new Error(`Convex backend version '${version}' not found`);
    }
    const asset = release.assets.find((a) => a.name.includes(target));
    if (!asset) {
      throw new Error(`No asset for '${target}' in version '${version}'`);
    }
    return { asset, version: release.tag_name };
  }

  // Otherwise, find the latest release with a matching asset
  for (const release of releases) {
    const asset = release.assets.find((a) => a.name.includes(target));
    if (asset) return { asset, version: release.tag_name };
  }
  throw new Error(`No Convex binary asset matches '${target}'`);
}

function isRateLimitExhausted(response: Response): boolean {
  return (
    (response.status === 403 || response.status === 429) &&
    response.headers.get("x-ratelimit-remaining") === "0"
  );
}

// The anonymous github.com download link has answered 503 and 504 for hours
// while the REST asset endpoint kept serving, so the bytes come from the API.
// The API redirects to a signed objects host, and fetch drops Authorization on
// that cross-origin hop. Once the API's hourly quota is spent, this attempt
// falls back to the github.com link, which that quota does not cover.
async function downloadFile(asset: ReleaseAsset, destPath: string): Promise<void> {
  const headers: Record<string, string> = {
    Accept: "application/octet-stream",
    "User-Agent": "node",
  };
  const githubToken = process.env.GITHUB_TOKEN;
  if (githubToken) {
    headers["Authorization"] = `Bearer ${githubToken}`;
  }

  let url = asset.url;
  let response = await fetch(url, { headers, redirect: "follow" });
  if (isRateLimitExhausted(response)) {
    await response.body?.cancel();
    url = asset.browser_download_url;
    response = await fetch(url, { headers: { "User-Agent": "node" }, redirect: "follow" });
  }
  if (!response.ok) {
    throw new DownloadHttpError(
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (asset.digest) {
    const actual = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
    if (actual !== asset.digest.toLowerCase()) {
      throw new ArchiveValidationError(
        `${asset.name} has digest ${actual}, expected ${asset.digest}`,
      );
    }
  }
  await fsp.writeFile(destPath, bytes);
}

function extractZip(zipPath: string, destDir: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const args = ["-o", zipPath, "-d", destDir];
    ChildProcess.spawn("unzip", args, { stdio: "ignore" })
      .on("error", reject)
      .on("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new ArchiveValidationError(`Failed to extract ${zipPath} (exit code ${code})`));
        }
      });
  });
}

/**
 * Options for downloading the Convex binary.
 */
export interface DownloadConvexBinaryOptions {
  /**
   * How long to use a cached binary before checking for updates.
   * Set to 0 to always check for updates.
   */
  cacheTtlMs: number;
  /**
   * Pin to a specific Convex backend version (e.g., "precompiled-2024-12-17").
   * If not specified, uses the latest available version.
   */
  version?: string | undefined;
  /**
   * Directory to cache the Convex binary.
   * Defaults to ~/.convex-local-backend/releases
   */
  cacheDir?: string | undefined;
}

/**
 * Find the most recently downloaded binary in the cache directory.
 * Returns the path if found and not expired, null otherwise.
 */
function findCachedBinary(binaryDir: string, cacheTtlMs: number): string | null {
  const isWindows = process.platform === "win32";
  const suffix = isWindows ? ".exe" : "";
  const prefix = "convex-local-backend-precompiled-";

  try {
    if (!fs.existsSync(binaryDir)) return null;

    const files = fs.readdirSync(binaryDir);
    const binaries = files.filter(
      (f) => f.startsWith(prefix) && f.endsWith(suffix) && !f.endsWith(".zip"),
    );

    if (binaries.length === 0) return null;

    // Find the most recently modified binary
    let newestBinary: string | null = null;
    let newestMtime = 0;

    for (const binary of binaries) {
      const binaryPath = path.join(binaryDir, binary);
      const stat = fs.statSync(binaryPath);
      if (stat.mtimeMs > newestMtime) {
        newestMtime = stat.mtimeMs;
        newestBinary = binaryPath;
      }
    }

    if (!newestBinary) return null;

    // Check if cache is still valid
    const age = Date.now() - newestMtime;
    if (age < cacheTtlMs) {
      return newestBinary;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Download the Convex local backend binary for the current platform.
 * Caches the binary in ~/.convex-local-backend/releases for reuse.
 *
 * If a cached binary exists and is within the cache TTL, it will be used
 * without checking GitHub for updates. This avoids rate limiting issues.
 *
 * @param options - Configuration options
 * @returns Path to the binary executable
 */
export async function downloadConvexBinary(
  options: DownloadConvexBinaryOptions,
  logger: ConvexLogger,
): Promise<string> {
  const cacheTtlMs = options.cacheTtlMs;
  const isWindows = process.platform === "win32";
  const target = getPlatformTarget();

  const binaryDir =
    options.cacheDir ?? path.join(os.homedir(), ".convex-local-backend", "releases");
  fs.mkdirSync(binaryDir, { recursive: true });

  // Check for cached binary first (avoids GitHub API calls)
  // Skip cache check if a specific version is requested
  if (cacheTtlMs > 0 && !options.version) {
    const cachedBinary = findCachedBinary(binaryDir, cacheTtlMs);
    if (cachedBinary) {
      return cachedBinary;
    }
  }

  // No valid cache, fetch from GitHub
  const releases = await fetchConvexReleases();
  const { asset, version } = findAsset(releases, target, options.version);

  const binaryName = `convex-local-backend-${version}${isWindows ? ".exe" : ""}`;
  const binaryPath = path.join(binaryDir, binaryName);

  // Check if this specific version already exists
  if (fs.existsSync(binaryPath)) {
    // Touch the file to update mtime for cache purposes
    const now = new Date();
    fs.utimesSync(binaryPath, now, now);
    return binaryPath;
  }

  logger.info(`Downloading Convex backend ${version}...`, { timestamp: true });

  for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt++) {
    const attemptId = `${process.pid}-${crypto.randomUUID()}`;
    const zipPath = path.join(binaryDir, `${asset.name}.${attemptId}.tmp`);
    const extractDir = path.join(binaryDir, `.extract-${attemptId}`);

    try {
      await fsp.mkdir(extractDir, { recursive: true });
      await downloadFile(asset, zipPath);
      await extractZip(zipPath, extractDir);
      const extracted = path.join(extractDir, `convex-local-backend${isWindows ? ".exe" : ""}`);
      const extractedStat = await fsp.stat(extracted).catch(() => null);
      if (!extractedStat?.isFile()) {
        throw new ArchiveValidationError(`Archive does not contain ${path.basename(extracted)}`);
      }
      if (!isWindows) await fsp.chmod(extracted, 0o755);

      try {
        await fsp.rename(extracted, binaryPath);
      } catch (error) {
        const published = await fsp.stat(binaryPath).catch(() => null);
        if (!published?.isFile()) throw error;
      }

      logger.info(`Binary ready at: ${binaryPath}`, { timestamp: true });
      return binaryPath;
    } catch (error) {
      const retryable = error instanceof ArchiveValidationError || isTransientDownloadError(error);
      if (!retryable || attempt === DOWNLOAD_MAX_ATTEMPTS) throw error;
      await waitForDownloadRetry(attempt);
    } finally {
      await Promise.all([
        fsp.rm(zipPath, { force: true }).catch(() => {}),
        fsp.rm(extractDir, { recursive: true, force: true }).catch(() => {}),
      ]);
    }
  }

  throw new Error("Convex binary download retry exhausted");
}
