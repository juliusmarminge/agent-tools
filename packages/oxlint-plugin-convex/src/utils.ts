/**
 * Check if key matches pattern:
 * - `"module.*"` -> matches all in module
 * - `"module.function"` -> exact match
 * - `"function"` -> matches function in any module
 * - `"*.seed*"` -> glob pattern matching any function containing "seed"
 */
export function isIgnored(key: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    // Fast path for exact match
    if (key === pattern) return true;

    // Fast path for module wildcard (e.g., "module.*")
    if (pattern.endsWith(".*") && !pattern.includes("*", 0)) {
      return key.startsWith(pattern.slice(0, -1));
    }

    // Glob pattern matching for patterns with wildcards
    if (pattern.includes("*") || pattern.includes("?")) {
      const regex = new RegExp(
        "^" +
          pattern
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".") +
          "$",
      );
      return regex.test(key);
    }

    return false;
  });
}

export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function globToRegExp(pattern: string): RegExp {
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

export type GlobMatcher = {
  pattern: string;
  regex: RegExp;
  hasSlash: boolean;
};

export function buildGlobMatchers(patterns: string[]): GlobMatcher[] {
  return patterns.map((pattern) => ({
    pattern,
    regex: globToRegExp(pattern),
    hasSlash: normalizePath(pattern).includes("/"),
  }));
}

export function matchesAnyGlob(filePath: string, matchers: GlobMatcher[]): boolean {
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
