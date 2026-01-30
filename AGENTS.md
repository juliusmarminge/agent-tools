# Overview

You are an expert in TypeScript library development with excellent taste in API design.

- Follow the user's requirements carefully & to the letter.
- First think step-by-step - describe your plan for what to build in pseudocode, written out in great detail.

## Project Description

**agent-tools** is a TypeScript monorepo containing tools for improving agentic development workflows with Convex backends:

- `convex-vite-plugin` - Vite plugin that runs a local Convex backend during development
- `oxlint-plugin-convex` - Oxlint plugin for detecting unused Convex functions
- `@examples/convex-spa` - Example React application demonstrating plugin usage

## Repository Structure

```
agent-tools/
├── packages/
│   ├── convex-vite-plugin/     # Main Vite plugin package
│   │   ├── src/
│   │   │   ├── index.ts        # Plugin factory
│   │   │   ├── backend.ts      # ConvexBackend class
│   │   │   ├── lib.ts          # Library exports
│   │   │   ├── keys.ts         # Key generation
│   │   │   ├── logger.ts       # Logging utilities
│   │   │   └── utils.ts        # Helper functions
│   │   └── package.json
│   └── oxlint-plugin-convex/   # Linting plugin package
│       ├── src/
│       │   ├── index.ts        # Plugin and rule
│       │   ├── utils.ts        # Pattern matching
│       │   └── utils.test.ts   # Test suite
│       └── package.json
├── examples/
│   └── convex-spa/             # Example application
├── scripts/                     # Build & release scripts
├── .config/                     # Shared configuration
│   ├── turbo.jsonc            # Turborepo config
│   └── .oxfmtrc.json         # Formatter config
└── .github/workflows/          # CI/CD pipelines
```

## Tech Stack

You're working in a monorepo using:

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js ^24.0.0, Bun ^1.3.0
- **Package Manager**: Bun
- **Monorepo Tool**: Turborepo
- **Build Tool**: tsdown (TypeScript to ESM)
- **Linting**: Oxlint
- **Formatting**: Oxfmt
- **Testing**: Vitest
- **Versioning**: Changesets

## Core Principles

- Write straightforward, readable, and maintainable code. Use explicit types on exported functions.
- Use strong typing, avoid 'any'.
- Restate what the objective is of what you are being asked to change clearly in a short summary.
- Do not use any third party library. The library must confirm to [Standard Schema](mdc:https:/standardschema.dev) and not be tied to any one schema validation library.
- Reason about the API design before implementing changes. Is it possible to achieve strong and generic typing for your chosen API? If not, reconsider.
- Create clearly documented changesets for your introduced changes using `bun changeset`.

## Coding Standards

### Naming Conventions

- Variables, functions, methods: camelCase
- Files, directories: kebab-case
- Constants, env variables: UPPERCASE

### Functions

- Use descriptive names: verbs & nouns (e.g., getUserData)
- Prefer the `function` keyword over arrow functions where their differences doesn't matter.
- Document with JSDoc annotations

### Types and Interfaces

- Prefer custom interfaces over inline types
- Use 'readonly' for immutable properties
- If an import is only used as a type in the file, use 'import type' instead of 'import'

### Validating changes

- Always validate your changes confirm to the project lint configuration by running `bun qa`.
- Write tests for changes and validate they pass using `bun run test`.

## Code Review Checklist

- Ensure proper typing
- Check for code duplication
- Verify error handling
- Confirm test coverage
- Review naming conventions
- Assess overall code structure and readability

## Documentation

- Use the active voice
- Use the present tense
- Write in a clear and concise manner
- Present information in a logical order
- Use lists and tables when appropriate
- When writing JSDocs, only use TypeDoc compatible tags.
- Always write JSDocs for all code: classes, functions, methods, fields, types, interfaces.
- For publishable code, always write a README.md file with usage examples and API documentation.

## Common Commands

### Development

```bash
bun install           # Install dependencies
bun run dev          # Watch mode for build + test
bun run build        # Build all packages
bun run test         # Run tests in watch mode
bun run test:run     # Run tests once (no watch)
```

### Quality Assurance

```bash
bun run qa           # Run linting + format check (run before committing!)
bun run lint         # Type-aware linting with oxlint
bun run fmt          # Format code with oxfmt
```

### Maintenance

```bash
bun run clean        # Clean dist + node_modules
bun changeset        # Create a changeset for versioning
bun turbo build      # Build all packages via Turborepo
```

## Making Changes

1. **Read existing code** before making changes to understand patterns
2. **Make your changes** following the code style guidelines
3. **Run QA checks**: `bun run qa` - this is mandatory before committing
4. **Run tests**: `bun run test`
5. **Create a changeset**: `bun changeset`
   - Select the packages you modified
   - Choose the version bump type (major/minor/patch):
     - **major**: Breaking changes
     - **minor**: New features (backwards compatible)
     - **patch**: Bug fixes
   - Write a clear changelog entry describing the change
6. **Commit your changes** with descriptive commit messages

## Package-Specific Information

### convex-vite-plugin

**Purpose**: Vite plugin that manages a local Convex backend during development.

**Key Files**:
- `src/index.ts` - Plugin factory function
- `src/backend.ts` - ConvexBackend class (process management, deployment)
- `src/lib.ts` - Library-only exports (for non-Vite usage)
- `src/keys.ts` - Cryptographic key generation and persistence
- `src/logger.ts` - Logging utilities
- `src/utils.ts` - Helper functions (port discovery, debouncing, etc.)

**Key Features**:
- Manages Convex backend process lifecycle
- Auto-deploys functions with file watching and hot reload
- Persists state based on git branch
- Injects environment variables (`VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`)
- Supports startup functions and seeding

### oxlint-plugin-convex

**Purpose**: Oxlint plugin that detects unused Convex functions.

**Key Files**:
- `src/index.ts` - Plugin and rule definition
- `src/utils.ts` - Pattern matching utilities (glob support)
- `src/utils.test.ts` - Comprehensive test suite (100+ test cases)

**Key Features**:
- Scans for unused Convex function exports
- Supports ignore patterns (glob patterns, module.function syntax)
- Configurable file scanning and directory exclusions
- Reports functions that are exported but never referenced via `api.module.function`

## Build System

### tsdown

Packages are built using tsdown, which compiles TypeScript to ESM:
- Output: `.mjs` files with `.d.mts` type declarations
- Format: ESM only (no CommonJS)
- Entry points defined in `package.json` exports

### Turborepo

Task orchestration with caching:
- **build**: Depends on dependencies being built first (`^build`)
- **dev**: Never cached, persistent watch mode
- **test**: Persistent watch mode
- **test:run**: Single run, not persistent

## CI/CD Workflows

### ci.yml
Runs on every PR and push:
- Installs dependencies
- Builds all packages
- Runs linting
- Runs format check

### release.yml
Automated releases:
- Uses Changesets for version management
- Publishes to JSR and npm
- Generates changelogs

### release-canary.yaml
Pre-release builds for testing (manual trigger)

## Common Tasks for Agents

### Adding a New Feature

1. Read existing code to understand patterns
2. Create necessary files in appropriate `src/` directory
3. Write tests for new functionality
4. Update relevant README.md with new features
5. Run `bun run qa` and `bun run test`
6. Create a changeset: `bun changeset` (select minor version bump)

### Fixing a Bug

1. Locate the bug in source code
2. Write a failing test that reproduces it
3. Fix the bug
4. Verify test passes
5. Run `bun run qa` and `bun run test`
6. Create a changeset: `bun changeset` (select patch version bump)

### Refactoring

1. Ensure tests exist for affected code
2. Make refactoring changes
3. Verify all tests still pass
4. Run `bun run qa`
5. Create a changeset if behavior changed

## Debugging Tips

### Build Issues
- Check `tsconfig.json` for type errors
- Run `bun run build` to see detailed errors
- Verify all imports are correctly typed

### Test Failures
- Run `bun run test` to see detailed output
- Check test files for outdated assertions
- Verify test setup and teardown

### Linting Errors
- Run `bun run lint` to see all issues
- Check `.oxlintrc.json` for rule configuration
- Fix errors before committing

## Important Notes

- Always run `bun run qa` before committing changes
- Never skip creating a changeset for meaningful changes
- Follow existing code patterns and architecture
- Keep solutions simple and avoid over-engineering
- No third-party dependencies unless absolutely necessary
- Watch for security vulnerabilities (injection attacks, XSS, etc.)
- Test with the example app in `examples/convex-spa/` for integration testing

## Resources

- Package README.md files for detailed API documentation
- JSDoc comments in source code
- TypeScript definitions for type information
- Example app in `examples/convex-spa/` for integration examples
- [Convex Documentation](https://docs.convex.dev/)
- [Vite Plugin API](https://vitejs.dev/guide/api-plugin.html)
- [Oxlint Documentation](https://oxc-project.github.io/docs/guide/usage/linter.html)
