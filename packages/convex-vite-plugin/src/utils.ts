import type { Logger } from "vite";

import * as ChildProcess from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

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

interface GitHubRelease {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

async function fetchConvexReleases(): Promise<GitHubRelease[]> {
  const url = "https://api.github.com/repos/get-convex/convex-backend/releases?per_page=50";
  const headers: HeadersInit = {};

  const githubToken = process.env.GITHUB_TOKEN;
  if (githubToken) {
    headers["Authorization"] = `Bearer ${githubToken}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch releases: ${response.status}`);
  }

  return response.json();
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
): {
  asset: { name: string; browser_download_url: string };
  version: string;
} {
  for (const release of releases) {
    const asset = release.assets.find((a) => a.name.includes(target));
    if (asset) return { asset, version: release.tag_name };
  }
  throw new Error(`No Convex binary asset matches '${target}'`);
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url, {
    headers: { "User-Agent": "node" },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  await fsp.writeFile(destPath, Buffer.from(buffer));
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
          reject(new Error(`Failed to extract ${zipPath} (exit code ${code})`));
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
  logger: Logger,
): Promise<string> {
  const cacheTtlMs = options.cacheTtlMs;
  const isWindows = process.platform === "win32";
  const target = getPlatformTarget();

  const binaryDir = path.join(os.homedir(), ".convex-local-backend", "releases");
  fs.mkdirSync(binaryDir, { recursive: true });

  // Check for cached binary first (avoids GitHub API calls)
  if (cacheTtlMs > 0) {
    const cachedBinary = findCachedBinary(binaryDir, cacheTtlMs);
    if (cachedBinary) {
      return cachedBinary;
    }
  }

  // No valid cache, fetch from GitHub
  const releases = await fetchConvexReleases();
  const { asset, version } = findAsset(releases, target);

  const binaryName = `convex-local-backend-${version}${isWindows ? ".exe" : ""}`;
  const binaryPath = path.join(binaryDir, binaryName);

  // Check if this specific version already exists
  if (fs.existsSync(binaryPath)) {
    // Touch the file to update mtime for cache purposes
    const now = new Date();
    fs.utimesSync(binaryPath, now, now);
    return binaryPath;
  }

  const zipPath = path.join(binaryDir, asset.name);
  logger.info(`Downloading Convex backend ${version}...`);
  await downloadFile(asset.browser_download_url, zipPath);
  logger.info(`Downloaded: ${asset.name}`);

  await extractZip(zipPath, binaryDir);
  const extracted = path.join(binaryDir, `convex-local-backend${isWindows ? ".exe" : ""}`);
  await fsp.rename(extracted, binaryPath);
  if (!isWindows) fs.chmodSync(binaryPath, 0o755);
  await fsp.rm(zipPath);
  logger.info(`Binary ready at: ${binaryPath}`);
  return binaryPath;
}
