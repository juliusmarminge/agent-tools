/**
 * Oxlint plugin to detect unused Convex functions.
 *
 * A Convex function is considered unused if nothing references it via `api.path.to.function`.
 *
 * @example
 * ```json
 * // .oxlintrc.json
 * {
 *   "jsPlugins": ["oxlint-plugin-convex"],
 *   "rules": {
 *     "convex/no-unused-functions": "warn"
 *   }
 * }
 * ```
 *
 * @example
 * ```json
 * // With ignorePatterns
 * {
 *   "rules": {
 *     "convex/no-unused-functions": ["warn", {
 *       "ignorePatterns": [
 *         "presence.*",        // Ignore all functions in convex/presence.ts
 *         "foo.bar.*",         // Ignore all functions in convex/foo/bar.ts
 *         "game.get",          // Ignore only game.get
 *         "deleteRoom",        // Ignore deleteRoom in any module
 *         "*.seed*"            // Glob: ignore any function containing "seed"
 *       ]
 *     }]
 *   }
 * }
 * ```
 *
 * @example
 * ```json
 * // With ignoreUsageFiles
 * {
 *   "rules": {
 *     "convex/no-unused-functions": ["warn", {
 *       "ignoreUsageFiles": [
 *         "**\/*.test.ts",
 *         "**\/*.test.tsx",
 *         "e2e/**"
 *       ]
 *     }]
 *   }
 * }
 * ```
 *
 * @module
 */

import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { definePlugin, defineRule } from "oxlint";

import type { GlobMatcher } from "./utils.ts";

import { buildGlobMatchers, isIgnored, matchesAnyGlob, normalizePath } from "./utils.ts";

/**
 * Options for the `convex/no-unused-functions` rule.
 */
export type RuleOptions = {
  /**
   * Patterns to ignore when checking for unused functions.
   * - `"module.*"` - Ignore all functions in a module
   * - `"module.function"` - Ignore a specific function
   * - `"function"` - Ignore a function in any module
   * - `"*.seed*"` - Glob pattern with wildcards (* matches any chars, ? matches single char)
   */
  ignorePatterns?: string[];
  /**
   * Glob patterns for files whose api usages should be ignored.
   * Useful for excluding test files from the usage scan.
   */
  ignoreUsageFiles?: string[];
  /**
   * Additional directories to skip when scanning for files.
   * These are added to the default list: node_modules, .git, dist, build, .next, .convex, _generated
   */
  skipDirs?: string[];
};

/**
 * Get all project files with the given extensions, excluding common directories.
 */
const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const DEFAULT_SKIP_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".convex",
  "_generated",
];

function getProjectFiles(
  dir: string,
  extensions = DEFAULT_EXTENSIONS,
  skipDirs = DEFAULT_SKIP_DIRS,
): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true, recursive: true })
      .filter((entry) => {
        if (!entry.isFile()) return false;
        if (!extensions.includes(extname(entry.name))) return false;
        const fullPath = join(entry.parentPath, entry.name);
        return !skipDirs.some((skipDir) => fullPath.includes(`/${skipDir}/`));
      })
      .map((entry) => join(entry.parentPath, entry.name));
  } catch {
    return [];
  }
}

/**
 * Extract all `api.x.y.z` usages from file content.
 */
function extractApiUsages(content: string): Set<string> {
  const USAGE_PATTERN = /\bapi\.([\w.]+)/g;
  const usages = new Set<string>();
  let match: RegExpExecArray | null = null;
  while ((match = USAGE_PATTERN.exec(content)) !== null) {
    usages.add(match[1]);
  }
  return usages;
}

/**
 * Get module path from file path: "/project/convex/foo/bar.ts" -> "foo.bar"
 */
function getConvexModulePath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const isConvexFile =
    normalized.includes("/convex/") &&
    !normalized.includes("/convex/_generated/") &&
    !normalized.includes("node_modules");
  if (!isConvexFile) return null;
  const match = normalized.match(/\/convex\/(.+)\.(ts|js|tsx|jsx)$/);
  return match ? match[1].replace(/\//g, ".") : null;
}

/**
 * Check if a CallExpression is a Convex function definition.
 * A Convex function is defined as: `someFunc({ args: {...}, handler: () => {} })`
 * We check that the first argument is an object with both `args` and `handler` properties.
 */
function isConvexFunctionCall(callExpr: { arguments: unknown[] }): boolean {
  const callArgs = callExpr.arguments;
  if (callArgs.length === 0) return false;

  const firstArg = callArgs[0] as { type?: string; properties?: unknown[] };
  if (firstArg.type !== "ObjectExpression") return false;

  const properties = firstArg.properties || [];
  const propertyNames = new Set<string>();
  for (const prop of properties) {
    const p = prop as { type?: string; key?: { type?: string; name?: string } };
    if (p.key?.type === "Identifier" && p.key.name) {
      propertyNames.add(p.key.name);
    }
  }

  return propertyNames.has("args") && propertyNames.has("handler");
}

/**
 * Rule that detects unused Convex functions.
 * A function is considered unused if no file references it via `api.module.function`.
 */
export const noUnusedFunctionsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow unused Convex functions",
      recommended: true,
    },
    schema: [
      {
        type: "object",
        properties: {
          ignorePatterns: {
            type: "array",
            items: { type: "string" },
            description:
              'Patterns to ignore: "module.*", "module.function", "function", or glob patterns like "*.seed*"',
          },
          ignoreUsageFiles: {
            type: "array",
            items: { type: "string" },
            description: "Glob patterns for files whose api usages should be ignored",
          },
          skipDirs: {
            type: "array",
            items: { type: "string" },
            description: "Additional directories to skip when scanning",
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      unusedFunction:
        "Convex function '{{name}}' is defined but never used. Expected usage: api.{{moduleName}}.{{name}}",
    },
  },

  // @ts-expect-error - type issues with Node inheritance in oxlint
  createOnce(context) {
    let usages: Set<string> | null = null;
    let ignoreUsageKey: string | null = null;
    let ignoreUsageMatchers: GlobMatcher[] = [];
    let modulePath: string | null = null;
    let ignorePatterns: string[] = [];

    return {
      before() {
        modulePath = getConvexModulePath(context.filename);
        if (!modulePath) return false;

        const options = (context.options[0] || {}) as RuleOptions;
        ignorePatterns = options.ignorePatterns || [];
        const ignoreUsageFiles = options.ignoreUsageFiles || [];
        const skipDirs = [...DEFAULT_SKIP_DIRS, ...(options.skipDirs || [])];
        const nextIgnoreUsageKey = JSON.stringify({ ignoreUsageFiles, skipDirs });
        if (!usages || ignoreUsageKey !== nextIgnoreUsageKey) {
          ignoreUsageKey = nextIgnoreUsageKey;
          ignoreUsageMatchers = buildGlobMatchers(ignoreUsageFiles);
          const nextUsages = new Set<string>();
          for (const file of getProjectFiles(context.cwd, DEFAULT_EXTENSIONS, skipDirs)) {
            const relativePath = normalizePath(relative(context.cwd, file));
            if (matchesAnyGlob(relativePath, ignoreUsageMatchers)) continue;
            try {
              const content = readFileSync(file, "utf-8");
              extractApiUsages(content).forEach((u) => nextUsages.add(u));
            } catch {
              // Skip unreadable files
            }
          }
          usages = nextUsages;
        }

        return !ignorePatterns.some((p) => p === `${modulePath}.*`);
      },

      ExportNamedDeclaration(node) {
        if (!modulePath || !usages) return;
        const declaration = node.declaration;
        if (!declaration || declaration.type !== "VariableDeclaration") return;

        for (const declarator of declaration.declarations) {
          if (declarator.type !== "VariableDeclarator") continue;
          if (declarator.id.type !== "Identifier") continue;
          if (!declarator.init || declarator.init.type !== "CallExpression") continue;
          if (!isConvexFunctionCall(declarator.init)) continue;

          const key = `${modulePath}.${declarator.id.name}`;

          // Skip if matches ignore pattern
          if (isIgnored(key, ignorePatterns)) continue;

          // Report if unused
          if (!usages.has(key)) {
            context.report({
              node: declarator.id,
              messageId: "unusedFunction",
              data: { name: declarator.id.name, moduleName: modulePath },
            });
          }
        }
      },
    };
  },
});

/**
 * The oxlint plugin for Convex.
 * Contains the `no-unused-functions` rule to detect unused Convex functions.
 */
export default definePlugin({
  meta: {
    name: "eslint-plugin-convex",
  },
  rules: {
    "no-unused-functions": noUnusedFunctionsRule,
  },
});
