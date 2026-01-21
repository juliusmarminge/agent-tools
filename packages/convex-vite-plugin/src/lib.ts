/**
 * Library entrypoint for convex-vite-plugin.
 *
 * This module exports the core ConvexBackend functionality without the Vite plugin,
 * for use in test suites, scripts, or other Node.js environments.
 *
 * @example
 * ```ts
 * import { ConvexBackend } from "convex-vite-plugin/lib";
 *
 * const backend = new ConvexBackend({});
 * await backend.startBackend("/tmp/convex-test");
 *
 * // Run your tests...
 *
 * await backend.stop();
 * ```
 */

// Backend exports
export { ConvexBackend, type ConvexBackendOptions } from "./backend.ts";

// Logger exports
export { type ConvexLogger, type LogLevel, createConvexLogger, normalizeLogger } from "./logger.ts";

// Key generation utilities
export { generateAdminKey, generateInstanceSecret, generateKeyPair } from "./keys.ts";
