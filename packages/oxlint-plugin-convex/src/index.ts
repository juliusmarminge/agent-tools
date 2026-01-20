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
 *         "deleteRoom"         // Ignore deleteRoom in any module
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

/**
 * Options for the `convex/no-unused-functions` rule.
 */
export type RuleOptions = {
  /**
   * Patterns to ignore when checking for unused functions.
   * - `"module.*"` - Ignore all functions in a module
   * - `"module.function"` - Ignore a specific function
   * - `"function"` - Ignore a function in any module
   */
  ignorePatterns?: string[];
  /**
   * Glob patterns for files whose api usages should be ignored.
   * Useful for excluding test files from the usage scan.
   */
  ignoreUsageFiles?: string[];
};

/**
 * Get all project files with the given extensions, excluding common directories.
 */
function getProjectFiles(
  dir: string,
  extensions = [".ts", ".tsx"],
  skipDirs = ["node_modules", ".git", "dist", "build", ".next", ".convex", "_generated"],
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
 * Check if key matches pattern:
 * - `"module.*"` -> matches all in module
 * - `"module.function"` -> exact match
 * - `"function"` -> matches function in any module
 */
function isIgnored(key: string, patterns: string[]): boolean {
  return patterns.some(
    (pattern) =>
      key === pattern || (pattern.endsWith(".*") && key.startsWith(pattern.slice(0, -1))),
  );
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePath(pattern);
  const regexSpecialChars = /[\\^$.*+?()[\]{}|]/;
  let regex = "^";
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (char === "*") {
      if (normalized[i + 1] === "*") {
        while (normalized[i + 1] === "*") i++;
        regex += ".*";
      } else {
        regex += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      regex += "[^/]";
      continue;
    }
    if (regexSpecialChars.test(char)) {
      regex += `\\${char}`;
      continue;
    }
    regex += char;
  }
  regex += "$";
  return new RegExp(regex);
}

type GlobMatcher = {
  pattern: string;
  regex: RegExp;
  hasSlash: boolean;
};

function buildGlobMatchers(patterns: string[]): GlobMatcher[] {
  return patterns.map((pattern) => ({
    pattern,
    regex: globToRegExp(pattern),
    hasSlash: normalizePath(pattern).includes("/"),
  }));
}

function matchesAnyGlob(filePath: string, matchers: GlobMatcher[]): boolean {
  if (matchers.length === 0) return false;
  const normalizedPath = normalizePath(filePath);
  const baseName = normalizedPath.split("/").pop() ?? normalizedPath;
  for (const matcher of matchers) {
    const target = matcher.hasSlash ? normalizedPath : baseName;
    if (matcher.regex.test(target)) {
      return true;
    }
  }
  return false;
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
            description: 'Patterns to ignore: "module.*", "module.function", or "function"',
          },
          ignoreUsageFiles: {
            type: "array",
            items: { type: "string" },
            description: "Glob patterns for files whose api usages should be ignored",
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
        const nextIgnoreUsageKey = JSON.stringify(ignoreUsageFiles);
        if (!usages || ignoreUsageKey !== nextIgnoreUsageKey) {
          ignoreUsageKey = nextIgnoreUsageKey;
          ignoreUsageMatchers = buildGlobMatchers(ignoreUsageFiles);
          const nextUsages = new Set<string>();
          for (const file of getProjectFiles(context.cwd)) {
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
