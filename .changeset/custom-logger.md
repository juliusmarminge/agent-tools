---
"convex-vite-plugin": minor
---

Add custom logger interface and `/lib` entrypoint

- Added `ConvexLogger` interface and `LogLevel` type for flexible logging configuration
- `ConvexBackend` constructor now accepts optional `logger?: ConvexLogger | LogLevel` parameter
- Added `createConvexLogger()` factory function for creating loggers with configurable levels
- New `/lib` entrypoint exports `ConvexBackend`, logger utilities, and key generation functions without requiring Vite
- Main entrypoint now only exports the Vite plugin and its options
