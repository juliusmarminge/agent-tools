/**
 * Log levels for the Convex logger.
 * - "silent": No logging
 * - "error": Only errors
 * - "warn": Errors and warnings
 * - "info": All messages (default)
 */
export type LogLevel = "silent" | "error" | "warn" | "info";

/**
 * Logger interface for ConvexBackend.
 * Compatible with Vite's Logger but focused on the methods actually used.
 */
export interface ConvexLogger {
  info(msg: string, options?: { timestamp?: boolean }): void;
  warn(msg: string, options?: { timestamp?: boolean }): void;
  error(msg: string, options?: { timestamp?: boolean; error?: Error }): void;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
};

function formatMessage(prefix: string, msg: string, timestamp: boolean): string {
  if (timestamp) {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false });
    return `${time} ${prefix} ${msg}`;
  }
  return `${prefix} ${msg}`;
}

/**
 * Create a ConvexLogger with the specified log level.
 *
 * @param level - The minimum log level to display
 * @param prefix - Optional prefix for log messages (defaults to "[convex]")
 * @returns A ConvexLogger instance
 *
 * @example
 * ```ts
 * const logger = createConvexLogger("info");
 * logger.info("Backend started", { timestamp: true });
 * ```
 */
export function createConvexLogger(level: LogLevel, prefix = "[convex]"): ConvexLogger {
  const priority = LOG_LEVEL_PRIORITY[level];

  return {
    info(msg: string, options?: { timestamp?: boolean }): void {
      if (priority >= LOG_LEVEL_PRIORITY.info) {
        console.log(formatMessage(prefix, msg, options?.timestamp ?? false));
      }
    },
    warn(msg: string, options?: { timestamp?: boolean }): void {
      if (priority >= LOG_LEVEL_PRIORITY.warn) {
        console.warn(formatMessage(prefix, msg, options?.timestamp ?? false));
      }
    },
    error(msg: string, options?: { timestamp?: boolean; error?: Error }): void {
      if (priority >= LOG_LEVEL_PRIORITY.error) {
        const formatted = formatMessage(prefix, msg, options?.timestamp ?? false);
        if (options?.error) {
          console.error(formatted, options.error);
        } else {
          console.error(formatted);
        }
      }
    },
  };
}

/**
 * Normalize a logger input to a ConvexLogger instance.
 *
 * @param logger - A ConvexLogger, LogLevel string, or undefined
 * @returns A ConvexLogger instance
 *
 * @example
 * ```ts
 * // All of these return a valid ConvexLogger:
 * normalizeLogger();                    // default "info" logger
 * normalizeLogger("error");             // only errors
 * normalizeLogger("silent");            // no logging
 * normalizeLogger(customLogger);        // pass-through
 * ```
 */
export function normalizeLogger(logger?: ConvexLogger | LogLevel): ConvexLogger {
  if (logger === undefined) {
    return createConvexLogger("info");
  }

  if (typeof logger === "string") {
    return createConvexLogger(logger);
  }

  return logger;
}
