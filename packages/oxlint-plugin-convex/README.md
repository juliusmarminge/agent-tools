# oxlint-plugin-convex

An [oxlint](https://oxc.rs/docs/guide/usage/linter) plugin to detect unused [Convex](https://convex.dev) functions.

A Convex function is considered unused if nothing references it via `api.path.to.function`.

## Installation

```bash
npm install -D oxlint-plugin-convex oxlint
# or
bun add -D oxlint-plugin-convex oxlint
```

## Usage

Add the plugin to your `.oxlintrc.json`:

```json
{
  "jsPlugins": ["oxlint-plugin-convex"],
  "rules": {
    "convex/no-unused-functions": "warn"
  }
}
```

## Rules

### `convex/no-unused-functions`

Detects Convex functions that are exported but never referenced via `api.module.function`.

#### Options

| Option             | Type       | Default | Description                                            |
| ------------------ | ---------- | ------- | ------------------------------------------------------ |
| `ignorePatterns`   | `string[]` | `[]`    | Patterns for functions to ignore                       |
| `ignoreUsageFiles` | `string[]` | `[]`    | Glob patterns for files to exclude from usage scanning |
| `skipDirs`         | `string[]` | `[]`    | Additional directories to skip when scanning           |

#### Pattern Matching

The `ignorePatterns` option supports three formats:

| Pattern             | Matches                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `"module.*"`        | All functions in a module (e.g., `"presence.*"` ignores all in `convex/presence.ts`) |
| `"module.function"` | A specific function (e.g., `"game.get"` ignores only `get` in `convex/game.ts`)      |
| `"function"`        | A function name in any module (e.g., `"deleteRoom"` ignores `deleteRoom` everywhere) |

#### Examples

**Basic usage:**

```json
{
  "jsPlugins": ["oxlint-plugin-convex"],
  "rules": {
    "convex/no-unused-functions": "warn"
  }
}
```

**With ignore patterns:**

```json
{
  "rules": {
    "convex/no-unused-functions": [
      "warn",
      {
        "ignorePatterns": ["presence.*", "internal.*", "game.get", "deleteRoom"]
      }
    ]
  }
}
```

**Excluding test files from usage scanning:**

```json
{
  "rules": {
    "convex/no-unused-functions": [
      "warn",
      {
        "ignoreUsageFiles": ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "e2e/**"]
      }
    ]
  }
}
```

This is useful when you have test files that reference Convex functions for testing purposes, but you don't want those usages to count as "real" usage.

**Skipping additional directories:**

```json
{
  "rules": {
    "convex/no-unused-functions": [
      "warn",
      {
        "skipDirs": ["coverage", ".turbo", "out"]
      }
    ]
  }
}
```

This adds to the default list of skipped directories (node_modules, .git, dist, build, .next, .convex, \_generated).

**Combined options:**

```json
{
  "rules": {
    "convex/no-unused-functions": [
      "warn",
      {
        "ignorePatterns": ["internal.*", "crons.*"],
        "ignoreUsageFiles": ["**/*.test.ts"],
        "skipDirs": ["coverage"]
      }
    ]
  }
}
```

## How It Works

1. **Scans the codebase** for all `api.x.y.z` references
2. **Identifies Convex functions** by looking for exports with the pattern:
   ```ts
   export const myFunction = query({ args: {...}, handler: () => {} })
   ```
3. **Reports unused functions** that are defined but not referenced anywhere

The plugin automatically excludes these directories from scanning:

- `node_modules`
- `.git`
- `dist`
- `build`
- `.next`
- `.convex`
- `_generated`

## API Reference

### Default Export

The plugin object to use with oxlint's `jsPlugins` configuration.

```ts
import convexPlugin from "oxlint-plugin-convex";
```

### Named Exports

#### `noUnusedFunctionsRule`

The rule definition for direct access, useful for programmatic usage.

```ts
import { noUnusedFunctionsRule } from "oxlint-plugin-convex";
```

#### `RuleOptions`

TypeScript type for the rule options.

```ts
import type { RuleOptions } from "oxlint-plugin-convex";

const options: RuleOptions = {
  ignorePatterns: ["internal.*"],
  ignoreUsageFiles: ["**/*.test.ts"],
  skipDirs: ["coverage"],
};
```

## License

MIT
