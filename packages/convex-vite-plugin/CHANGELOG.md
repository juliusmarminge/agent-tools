# convex-vite-plugin

## 0.4.0

### Minor Changes

- [#17](https://github.com/juliusmarminge/agent-tools/pull/17) [`55aa857`](https://github.com/juliusmarminge/agent-tools/commit/55aa857197533f1927d080f11123cddef43805cb) Thanks [@juliusmarminge](https://github.com/juliusmarminge)! - **BREAKING:** The `envVars` callback signature changed from `(vitePort: number)` to `({ vitePort, resolvedUrls })`. This provides access to Vite's full `ResolvedServerUrls` object which includes both local and network URLs.

  Migration:

  ```diff
  convexLocal({
  -  envVars: (vitePort) => ({
  -    SITE_URL: `http://localhost:${vitePort}`,
  +  envVars: ({ vitePort, resolvedUrls }) => ({
  +    SITE_URL: resolvedUrls?.local[0] ?? `http://localhost:${vitePort}`,
    }),
  })
  ```

## 0.3.2

### Patch Changes

- [#14](https://github.com/juliusmarminge/agent-tools/pull/14) [`751fb5d`](https://github.com/juliusmarminge/agent-tools/commit/751fb5d6afc5f9a19f76f4c598775ef56eae22c7) Thanks [@juliusmarminge](https://github.com/juliusmarminge)! - Remove hardcoded bun dependency from plugin. The plugin now detects the package manager (npm, yarn, pnpm, or bun) from the `npm_config_user_agent` environment variable and uses the appropriate exec command (npx, yarn exec, pnpm exec, or bunx).

## 0.3.1

### Patch Changes

- [#12](https://github.com/juliusmarminge/agent-tools/pull/12) [`898dd1f`](https://github.com/juliusmarminge/agent-tools/commit/898dd1fb0e36f35ef3b457cc774c590232cf2552) Thanks [@juliusmarminge](https://github.com/juliusmarminge)! - Improve error logging for deploy and onReady function failures. Error messages are now included in the log output instead of being empty.

## 0.3.0

### Minor Changes

- [#8](https://github.com/juliusmarminge/agent-tools/pull/8) [`9db4c1e`](https://github.com/juliusmarminge/agent-tools/commit/9db4c1eb42da4e27670960be2c58026aab1c39cf) Thanks [@juliusmarminge](https://github.com/juliusmarminge)! - Add custom logger interface and `/lib` entrypoint
  - Added `ConvexLogger` interface and `LogLevel` type for flexible logging configuration
  - `ConvexBackend` constructor now accepts optional `logger?: ConvexLogger | LogLevel` parameter
  - Added `createConvexLogger()` factory function for creating loggers with configurable levels
  - New `/lib` entrypoint exports `ConvexBackend`, logger utilities, and key generation functions without requiring Vite
  - Main entrypoint now only exports the Vite plugin and its options

## 0.2.0

### Minor Changes

- [#6](https://github.com/juliusmarminge/agent-tools/pull/6) [`34d1a15`](https://github.com/juliusmarminge/agent-tools/commit/34d1a15a900685902df169fb10e8e385d278ea9e) Thanks [@juliusmarminge](https://github.com/juliusmarminge)! - Add `getAdminKey()` method to `ConvexBackend` class for creating custom authenticated clients

## 0.1.0

### Minor Changes

- [#2](https://github.com/juliusmarminge/agent-tools/pull/2) [`1aa3533`](https://github.com/juliusmarminge/agent-tools/commit/1aa3533290f265a6743dc9a3c044c0a8f4ea4f09) Thanks [@juliusmarminge](https://github.com/juliusmarminge)! - initial release
