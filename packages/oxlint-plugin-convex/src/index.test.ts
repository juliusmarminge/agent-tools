import { describe, expect, it } from "vitest";

import {
  buildGlobMatchers,
  globToRegExp,
  isIgnored,
  matchesAnyGlob,
  normalizePath,
} from "./utils.ts";

describe("isIgnored", () => {
  describe("exact match", () => {
    it("matches exact function name", () => {
      expect(isIgnored("module.function", ["module.function"])).toBe(true);
    });

    it("matches function-only pattern in any module", () => {
      expect(isIgnored("deleteRoom", ["deleteRoom"])).toBe(true);
    });

    it("does not match different function", () => {
      expect(isIgnored("module.other", ["module.function"])).toBe(false);
    });
  });

  describe("module wildcard (module.*)", () => {
    it("matches all functions in module", () => {
      expect(isIgnored("presence.get", ["presence.*"])).toBe(true);
      expect(isIgnored("presence.set", ["presence.*"])).toBe(true);
      expect(isIgnored("presence.delete", ["presence.*"])).toBe(true);
    });

    it("matches nested module paths", () => {
      expect(isIgnored("foo.bar.get", ["foo.bar.*"])).toBe(true);
    });

    it("does not match different module", () => {
      expect(isIgnored("other.get", ["presence.*"])).toBe(false);
    });
  });

  describe("glob patterns", () => {
    it("matches pattern with leading wildcard", () => {
      expect(isIgnored("module.seedData", ["*.seed*"])).toBe(true);
      expect(isIgnored("other.seedUsers", ["*.seed*"])).toBe(true);
    });

    it("matches pattern with trailing wildcard", () => {
      expect(isIgnored("internal.action", ["internal*"])).toBe(true);
      expect(isIgnored("internalHelper", ["internal*"])).toBe(true);
    });

    it("matches pattern with wildcard in middle", () => {
      expect(isIgnored("get_user_by_id", ["get*id"])).toBe(true);
      expect(isIgnored("get_something_by_id", ["get*id"])).toBe(true);
    });

    it("matches single character wildcard (?)", () => {
      expect(isIgnored("module.test1", ["module.test?"])).toBe(true);
      expect(isIgnored("module.testA", ["module.test?"])).toBe(true);
      expect(isIgnored("module.test12", ["module.test?"])).toBe(false);
    });

    it("combines multiple wildcards", () => {
      expect(isIgnored("foo.seedData", ["*.seed*"])).toBe(true);
      expect(isIgnored("bar.seedUsers", ["*.seed*"])).toBe(true);
      expect(isIgnored("baz.noseed", ["*.seed*"])).toBe(false);
    });

    it("does not match when pattern does not fit", () => {
      expect(isIgnored("module.getData", ["*.seed*"])).toBe(false);
      expect(isIgnored("module.function", ["other*"])).toBe(false);
    });
  });

  describe("multiple patterns", () => {
    it("matches if any pattern matches", () => {
      const patterns = ["presence.*", "internal.*", "*.seed*"];
      expect(isIgnored("presence.get", patterns)).toBe(true);
      expect(isIgnored("internal.action", patterns)).toBe(true);
      expect(isIgnored("module.seedData", patterns)).toBe(true);
    });

    it("returns false if no pattern matches", () => {
      const patterns = ["presence.*", "internal.*"];
      expect(isIgnored("other.function", patterns)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles empty patterns array", () => {
      expect(isIgnored("module.function", [])).toBe(false);
    });

    it("handles special regex characters in pattern", () => {
      expect(isIgnored("module.test(1)", ["module.test(1)"])).toBe(true);
      expect(isIgnored("module.test[0]", ["module.test[0]"])).toBe(true);
    });

    it("escapes dots properly in glob patterns", () => {
      // The dot should be literal, not regex "any char"
      expect(isIgnored("modulexfunction", ["module.function"])).toBe(false);
    });
  });
});

describe("normalizePath", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normalizePath("foo\\bar\\baz")).toBe("foo/bar/baz");
  });

  it("leaves forward slashes unchanged", () => {
    expect(normalizePath("foo/bar/baz")).toBe("foo/bar/baz");
  });

  it("handles mixed slashes", () => {
    expect(normalizePath("foo\\bar/baz\\qux")).toBe("foo/bar/baz/qux");
  });

  it("handles empty string", () => {
    expect(normalizePath("")).toBe("");
  });
});

describe("globToRegExp", () => {
  it("converts single * to match non-slash characters", () => {
    const regex = globToRegExp("*.ts");
    expect(regex.test("file.ts")).toBe(true);
    expect(regex.test("another.ts")).toBe(true);
    expect(regex.test("dir/file.ts")).toBe(false); // * doesn't match /
  });

  it("converts ** to match any characters including slashes", () => {
    const regex = globToRegExp("**/*.ts");
    // **/ requires at least one directory level before the filename
    expect(regex.test("file.ts")).toBe(false);
    expect(regex.test("dir/file.ts")).toBe(true);
    expect(regex.test("a/b/c/file.ts")).toBe(true);

    // ** alone matches any path
    const regex2 = globToRegExp("**.ts");
    expect(regex2.test("file.ts")).toBe(true);
    expect(regex2.test("dir/file.ts")).toBe(true);
  });

  it("converts ? to match single non-slash character", () => {
    const regex = globToRegExp("file?.ts");
    expect(regex.test("file1.ts")).toBe(true);
    expect(regex.test("fileA.ts")).toBe(true);
    expect(regex.test("file12.ts")).toBe(false);
    expect(regex.test("file/.ts")).toBe(false);
  });

  it("escapes regex special characters", () => {
    const regex = globToRegExp("file.test.ts");
    expect(regex.test("file.test.ts")).toBe(true);
    expect(regex.test("filextest.ts")).toBe(false); // dot should be literal
  });

  it("handles complex patterns", () => {
    const regex = globToRegExp("src/**/*.test.ts");
    // **/ requires at least one directory level
    expect(regex.test("src/file.test.ts")).toBe(false);
    expect(regex.test("src/utils/file.test.ts")).toBe(true);
    expect(regex.test("src/a/b/helper.test.ts")).toBe(true);
    expect(regex.test("lib/utils/file.test.ts")).toBe(false);

    // Pattern without **/ works for direct children
    const regex2 = globToRegExp("src/*.test.ts");
    expect(regex2.test("src/file.test.ts")).toBe(true);
    expect(regex2.test("src/utils/file.test.ts")).toBe(false);
  });
});

describe("buildGlobMatchers", () => {
  it("builds matchers with correct properties", () => {
    const matchers = buildGlobMatchers(["*.ts", "src/**/*.js"]);

    expect(matchers).toHaveLength(2);
    expect(matchers[0].pattern).toBe("*.ts");
    expect(matchers[0].hasSlash).toBe(false);
    expect(matchers[1].pattern).toBe("src/**/*.js");
    expect(matchers[1].hasSlash).toBe(true);
  });

  it("handles empty array", () => {
    const matchers = buildGlobMatchers([]);
    expect(matchers).toHaveLength(0);
  });
});

describe("matchesAnyGlob", () => {
  it("returns false for empty matchers", () => {
    expect(matchesAnyGlob("file.ts", [])).toBe(false);
  });

  it("matches basename for patterns without slash", () => {
    const matchers = buildGlobMatchers(["*.test.ts"]);
    expect(matchesAnyGlob("src/utils/helper.test.ts", matchers)).toBe(true);
    expect(matchesAnyGlob("helper.test.ts", matchers)).toBe(true);
    expect(matchesAnyGlob("src/utils/helper.ts", matchers)).toBe(false);
  });

  it("matches full path for patterns with slash", () => {
    const matchers = buildGlobMatchers(["src/**/*.ts"]);
    // **/ requires at least one directory level after src/
    expect(matchesAnyGlob("src/file.ts", matchers)).toBe(false);
    expect(matchesAnyGlob("src/utils/file.ts", matchers)).toBe(true);
    expect(matchesAnyGlob("src/a/b/file.ts", matchers)).toBe(true);
    expect(matchesAnyGlob("lib/file.ts", matchers)).toBe(false);

    // Pattern for direct children
    const matchers2 = buildGlobMatchers(["src/*.ts"]);
    expect(matchesAnyGlob("src/file.ts", matchers2)).toBe(true);
    expect(matchesAnyGlob("src/utils/file.ts", matchers2)).toBe(false);
  });

  it("matches if any matcher matches", () => {
    const matchers = buildGlobMatchers(["*.test.ts", "*.spec.ts"]);
    expect(matchesAnyGlob("file.test.ts", matchers)).toBe(true);
    expect(matchesAnyGlob("file.spec.ts", matchers)).toBe(true);
    expect(matchesAnyGlob("file.ts", matchers)).toBe(false);
  });

  it("normalizes Windows paths", () => {
    const matchers = buildGlobMatchers(["src/**/*.ts"]);
    expect(matchesAnyGlob("src\\utils\\file.ts", matchers)).toBe(true);
  });
});
