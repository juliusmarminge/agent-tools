# Working with Agents in agent-tools

This document provides guidelines for AI agents and developers working with the agent-tools monorepo.

## Project Overview

**agent-tools** is a TypeScript monorepo containing tools for agentic development:

- **convex-vite-plugin**: Vite plugin for running local Convex backends with isolated environments
- **oxlint-plugin-convex**: Oxlint plugin for detecting unused Convex functions

## Repository Structure

```
/
├── packages/
│   ├── convex-vite-plugin/    # Vite plugin for local Convex backend
│   └── oxlint-plugin-convex/  # Oxlint plugin for unused function detection
├── examples/
│   └── convex-spa/            # Example React + Convex SPA
├── .github/                   # CI/CD workflows
├── .config/                   # Turbo and formatter config
├── scripts/                   # Release and utility scripts
└── .changeset/                # Changeset configuration
```

## Technology Stack

- **Runtime**: Bun (v1.3+) and Node.js (v24+)
- **Language**: TypeScript (strict mode, ES2022)
- **Build**: Turbo (monorepo orchestration), tsdown (bundler)
- **Quality**: Oxlint (linter), Oxfmt (formatter), Vitest (testing)
- **CI/CD**: GitHub Actions, Changesets

## Development Workflow

### Setup

```bash
bun install
bun run build
```

### Development Commands

```bash
bun run dev        # Watch mode for building and testing
bun run build      # Build all packages
bun run test       # Run tests in watch mode
bun run test:run   # Run tests once
bun run lint       # Lint with oxlint (includes type checking)
bun run fmt        # Format with oxfmt
bun run qa         # Combined lint + format check
```

### Package-Specific Commands

Navigate to a package directory and run:

```bash
cd packages/convex-vite-plugin
bun run build      # Build this package only
bun run test       # Test this package only
```

## Code Standards

### TypeScript

- **Strict typing**: No `any`, enable all strict checks
- **Explicit exports**: All exported functions must have explicit return types
- **Type imports**: Use `import type` for type-only imports
- **Readonly**: Use `readonly` properties where appropriate
- **JSDoc**: Document exported functions and complex logic

### Naming Conventions

- **Files & directories**: kebab-case (`backend.ts`, `convex-vite-plugin/`)
- **Variables & functions**: camelCase (`generateKeyPair`, `backendUrl`)
- **Constants & env vars**: UPPERCASE (`VITE_CONVEX_URL`, `BASE_PORT`)
- **Types & interfaces**: PascalCase (`ConvexBackendOptions`, `LoggerInterface`)

### Code Organization

- Keep files focused and modular
- Minimize dependencies (prefer standard library)
- Separate concerns (backend management, key generation, logging)
- Use utils files for shared helper functions
- Export library code separately from plugin code

## Testing

- Use Vitest for all tests
- Name test files `*.test.ts`
- Test edge cases and error conditions
- Mock external dependencies (file system, processes)
- Run smoke tests for example apps

## Making Changes

### Adding Features

1. Create a changeset: `bun changeset`
2. Select affected packages
3. Choose version bump (major/minor/patch)
4. Write clear changelog description
5. Commit changeset with your changes

### Fixing Bugs

1. Add a test that reproduces the bug
2. Fix the bug
3. Verify the test passes
4. Create a patch changeset
5. Commit changes

### Refactoring

- Ensure all tests pass before and after
- Maintain backward compatibility unless bumping major version
- Update JSDoc if function signatures change
- Run `bun run qa` before committing

## Package Details

### convex-vite-plugin

**Purpose**: Manages local Convex backend during Vite development.

**Key Files**:
- `src/index.ts` - Vite plugin implementation
- `src/backend.ts` - ConvexBackend class
- `src/keys.ts` - Key generation utilities
- `src/lib.ts` - Library exports (non-Vite usage)

**Key Features**:
- Auto-generates or persists backend keys
- Manages backend process lifecycle
- Watches convex/ directory for changes
- Supports isolated environments via `stateIdSuffix`
- Environment variable injection
- Health checks and graceful shutdown

**Example Usage**:
```typescript
convexLocal({
  reset: true,
  envVars: ({ resolvedUrls }) => ({
    SITE_URL: resolvedUrls?.local[0] ?? "http://localhost:5173",
  }),
})
```

### oxlint-plugin-convex

**Purpose**: Detects unused Convex functions during linting.

**Key Files**:
- `src/index.ts` - Rule definition and plugin
- `src/utils.ts` - Glob matching utilities
- `src/utils.test.ts` - Comprehensive tests

**Rule**: `convex/no-unused-functions`

**Configuration Options**:
- `ignorePatterns`: Patterns to ignore (supports wildcards)
- `ignoreUsageFiles`: Files to exclude from usage scanning

**Example Config**:
```json
{
  "jsPlugins": ["oxlint-plugin-convex"],
  "rules": {
    "convex/no-unused-functions": ["warn", {
      "ignorePatterns": ["*.seed*"]
    }]
  }
}
```

## CI/CD Pipeline

### Continuous Integration

Runs on every push and PR:
- Install dependencies
- Lint (oxlint with type checking)
- Build all packages
- Run tests
- Format check (oxfmt)

### Release Process

1. Changes merged to main with changesets
2. GitHub Action creates "Version Packages" PR
3. Merge PR triggers release workflow
4. Packages versioned and published to npm
5. GitHub releases created with changelogs

### Canary Releases

Triggered manually for testing pre-release versions:
- Builds packages with canary versions
- Publishes to npm with `canary` tag

## Working with Examples

### convex-spa Example

Location: `examples/convex-spa`

**Purpose**: Demonstrates convex-vite-plugin usage.

**Structure**:
- `src/` - React app (App.tsx, main.tsx)
- `convex/` - Convex backend (schema, functions)
- `test/` - Smoke tests
- `vite.config.ts` - Plugin configuration

**Development**:
```bash
cd examples/convex-spa
bun install
bun run dev  # Starts Vite dev server with local Convex backend
```

## Common Tasks

### Adding a New Package

1. Create directory in `packages/`
2. Add `package.json` with workspace dependencies
3. Create `tsconfig.json` extending root config
4. Add build script to `turbo.jsonc`
5. Update root `package.json` workspaces

### Updating Dependencies

```bash
bun update              # Update all dependencies
bun update <package>    # Update specific package
```

### Debugging

- Check Turbo cache: `.turbo/`
- View build logs: Turbo outputs detailed logs
- Test individual packages: `cd packages/<name> && bun test`
- Clear Turbo cache: `rm -rf .turbo`

## Best Practices for Agents

1. **Read before modifying**: Always read files before editing
2. **Follow conventions**: Match existing naming and structure
3. **Test changes**: Run tests after modifications
4. **Create changesets**: Always create changeset for user-facing changes
5. **Minimize dependencies**: Prefer standard library solutions
6. **Document public APIs**: Add JSDoc to exported functions
7. **Respect types**: Don't use `any`, maintain strict typing
8. **Run QA**: Execute `bun run qa` before finalizing changes

## Common Patterns

### Error Handling

```typescript
try {
  // Operation
} catch (error) {
  logger.error('Operation failed:', error);
  throw new Error('Descriptive error message');
}
```

### Process Management

```typescript
// Always clean up processes
process.on('exit', () => cleanup());
process.on('SIGINT', () => cleanup());
process.on('SIGTERM', () => cleanup());
```

### Key Generation

```typescript
import { generateKeyPair, generateAdminKey } from 'convex-vite-plugin/lib';

const { deploymentPublicKey, deploymentPrivateKey } = generateKeyPair();
const adminKey = generateAdminKey();
```

## Troubleshooting

### Build Failures

- Clear Turbo cache: `rm -rf .turbo`
- Clean node_modules: `rm -rf node_modules && bun install`
- Check TypeScript errors: `bun run build --force`

### Test Failures

- Run tests in isolation: `cd packages/<name> && bun test`
- Check test output for specific errors
- Verify mocks are properly configured

### Lint Errors

- Run formatter: `bun run fmt`
- Check type errors: `bun tsc --noEmit`
- Review oxlint config: `.oxlintrc.json`

## Resources

- [Turbo Documentation](https://turbo.build/repo/docs)
- [Vite Plugin API](https://vitejs.dev/guide/api-plugin.html)
- [Convex Documentation](https://docs.convex.dev)
- [Oxlint Documentation](https://oxc.rs/docs/guide/usage/linter.html)
- [Changesets Documentation](https://github.com/changesets/changesets)

## Getting Help

- Check existing issues and PRs
- Review commit history for similar changes
- Read package README files
- Examine test files for usage examples
