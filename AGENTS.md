# Overview

You are an expert in TypeScript library development with excellent taste in API design.

- Follow the user's requirements carefully & to the letter.
- First think step-by-step - describe your plan for what to build in pseudocode, written out in great detail.

## Repository Structure

This is a monorepo managed with Turborepo and Bun workspaces containing:

```
agent-tools/
├── packages/
│   ├── convex-vite-plugin/    # Vite plugin for local Convex backend
│   └── oxlint-plugin-convex/  # Oxlint plugin to detect unused Convex functions
├── examples/
│   └── convex-spa/            # Example SPA using the Vite plugin
├── scripts/                   # Build, publish, and versioning scripts
└── .config/                   # Shared configuration (turbo, oxfmt)
```

## Tech Stack

You're working in a monorepo using:

- TypeScript (type-aware with full TypeScript 7.0 native preview)
- Bun (runtime, package manager, task runner)
- Vitest (testing framework)
- Turborepo (monorepo orchestration)
- Oxlint (fast linter with type-aware checking)
- Oxfmt (fast formatter)
- Changesets (versioning and changelog management)

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

## Common Commands

### Setup and Building

```bash
bun install                     # Install dependencies
bun run build                   # Build all packages
bun run dev                     # Watch mode: build and test continuously
bun run clean                   # Clean all build artifacts and node_modules
```

### Quality Assurance

```bash
bun run qa                      # Run linting and formatting checks
bun run lint                    # Run oxlint with type-aware checking
bun run fmt                     # Format code with oxfmt
bun run fmt --check             # Check formatting without modifying files
```

### Testing

```bash
bun run test                    # Run tests in watch mode
bun run test:run                # Run tests once (CI mode)
```

### Publishing

```bash
bun changeset                   # Create a changeset for versioning
bun changeset version           # Update versions from changesets
bun changeset publish           # Publish packages to npm
```

## Workflow for Making Changes

1. **Understand the change**: Read relevant code and tests first
2. **Plan the implementation**: Think through API design and typing implications
3. **Make the changes**: Edit code following the coding standards
4. **Write or update tests**: Ensure test coverage for your changes
5. **Validate**: Run `bun qa` and `bun run test:run` to ensure everything passes
6. **Create changeset**: Run `bun changeset` to document your changes
   - Choose the package(s) affected
   - Select bump type (major/minor/patch)
   - Write a clear description of the change
7. **Commit**: Create a clear commit message describing the change

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

## Package-Specific Notes

### convex-vite-plugin

- Main entry point: `src/index.ts` (exports the Vite plugin)
- Backend management: `src/backend.ts` (ConvexBackend class)
- State is persisted in `.convex/<state-id>/` based on git branch
- Uses Convex local backend binary (auto-downloaded and cached)
- Injects `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` environment variables

### oxlint-plugin-convex

- Single rule: `convex/no-unused-functions`
- Scans codebase for `api.x.y.z` references to detect usage
- Main logic: `src/index.ts`
- Utilities and tests: `src/utils.ts` and `src/utils.test.ts`

## Important Repository Details

### Git Branch State

- The Convex Vite plugin uses git branch names to determine state directories
- Different branches maintain separate Convex backend states
- This allows multiple agents/developers to work without conflicts

### Linting Configuration

- Root config: `.oxlintrc.json`
- Uses type-aware linting with `--type-aware` and `--type-check` flags
- All warnings are treated as errors with `--deny-warnings`
- Uses the `tsgolint` preset via `oxlint-tsgolint`

### Formatting Configuration

- Config: `.config/.oxfmtrc.json`
- Uses oxfmt for fast, consistent formatting
- Run `bun run fmt` to format all files

### Turbo Configuration

- Config: `.config/turbo.jsonc`
- Build tasks have proper dependency ordering via `dependsOn: ["^build"]`
- Test tasks run at root level (`//#test`, `//#test:run`)
- Uses TUI mode for better terminal output

## Troubleshooting

### Build Failures

- Check that all dependencies are installed: `bun install`
- Try cleaning and rebuilding: `bun run clean && bun run build`
- Ensure you're using the correct Node and Bun versions (see `engines` in root `package.json`)

### Test Failures

- Make sure packages are built first: `bun run build`
- Check if tests are running in the correct directory
- Review test output for specific error messages

### Linting Errors

- Review the specific lint error and fix the code
- Type-aware linting requires proper TypeScript configuration
- Use `bun run fmt` to auto-fix formatting issues

## Additional Resources

- [Standard Schema](https://standardschema.dev) - The library follows this specification
- [Oxlint Documentation](https://oxc.rs/docs/guide/usage/linter)
- [Convex Documentation](https://docs.convex.dev)
- [Turborepo Documentation](https://turbo.build/docs)
