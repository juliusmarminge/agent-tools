import * as ChildProcess from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Compute a deterministic state ID based on git branch + working directory.
 * This allows the backend state to be reused across restarts.
 */
export function computeStateId(projectDir: string): string {
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

  const input = `${gitBranch}:${projectDir}`;
  const hash = crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);

  return `${gitBranch.replace(/[^a-zA-Z0-9-]/g, "-")}-${hash}`;
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
 * Find an unused port in the ephemeral range.
 */
export function findUnusedPort(): number {
  return 10000 + Math.floor(Math.random() * 50000);
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
 * Download the Convex local backend binary for the current platform.
 * Caches the binary in ~/.convex-local-backend/releases for reuse.
 */
export async function downloadConvexBinary(): Promise<string> {
  const isWindows = process.platform === "win32";
  const target = getPlatformTarget();

  const releases = await fetchConvexReleases();
  const { asset, version } = findAsset(releases, target);

  const binaryDir = path.join(os.homedir(), ".convex-local-backend", "releases");
  fs.mkdirSync(binaryDir, { recursive: true });

  const binaryName = `convex-local-backend-${version}${isWindows ? ".exe" : ""}`;
  const binaryPath = path.join(binaryDir, binaryName);
  if (fs.existsSync(binaryPath)) return binaryPath;

  const zipPath = path.join(binaryDir, asset.name);
  console.log(`Downloading Convex backend ${version}...`);
  await downloadFile(asset.browser_download_url, zipPath);
  console.log(`Downloaded: ${asset.name}`);

  await extractZip(zipPath, binaryDir);
  const extracted = path.join(binaryDir, `convex-local-backend${isWindows ? ".exe" : ""}`);
  await fsp.rename(extracted, binaryPath);
  if (!isWindows) fs.chmodSync(binaryPath, 0o755);
  await fsp.rm(zipPath);
  console.log(`Binary ready at: ${binaryPath}`);
  return binaryPath;
}
