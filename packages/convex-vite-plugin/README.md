# convex-vite-plugin

A Vite plugin that runs a local Convex backend during development.

## Features

- Automatically starts a local Convex backend when Vite dev server starts
- Deploys your Convex functions on startup
- Watches for changes in your `convex/` directory and redeploys automatically
- Injects `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` environment variables
- Persists backend state across restarts (based on git branch)
- Cleans up when the dev server stops

## Installation

```bash
bun add convex-vite-plugin
```

## Usage

```ts
// vite.config.ts
import { convexLocal } from "convex-vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [convexLocal()],
});
```

Then access the Convex URL in your app:

```ts
import { ConvexProvider, ConvexReactClient } from "convex/react";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

function App() {
  return (
    <ConvexProvider client={convex}>
      {/* your app */}
    </ConvexProvider>
  );
}
```

## Options

All options are optional. The plugin auto-generates keys and finds available ports by default.

| Option           | Type                                                                       | Default                                      | Description                                                 |
| ---------------- | -------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| `instanceName`   | `string`                                                                   | `"convex-local"`                             | The instance name for the Convex backend                    |
| `projectDir`     | `string`                                                                   | `process.cwd()`                              | The project directory containing the Convex functions       |
| `convexDir`      | `string`                                                                   | `"convex"`                                   | The directory containing Convex functions (relative to projectDir) |
| `reset`          | `boolean`                                                                  | `false`                                      | Reset backend state before starting (delete existing data)  |
| `envVars`        | `Record<string, string>` or `(vitePort: number) => Record<string, string>` | -                                            | Environment variables to set on the backend                 |
| `onReady`        | `ConvexFunctionCall[]`                                                     | -                                            | Functions to run after backend is ready (e.g., seed scripts)|
| `stdio`          | `"inherit"` or `"ignore"`                                                  | `"ignore"`                                   | How to handle stdio from the backend process                |

### File Watching

| Option             | Type       | Default                              | Description                            |
| ------------------ | ---------- | ------------------------------------ | -------------------------------------- |
| `watch.patterns`   | `string[]` | `["<convexDir>/*.ts", "<convexDir>/**/*.ts"]` | Glob patterns to watch        |
| `watch.ignore`     | `string[]` | `["<convexDir>/_generated/**"]`      | Glob patterns to ignore                |
| `watch.debounceMs` | `number`   | `500`                                | Debounce delay in milliseconds         |

## Environment Variables

The plugin sets the following environment variables in your Vite app:

- `VITE_CONVEX_URL` - The URL of the local Convex backend
- `VITE_CONVEX_SITE_URL` - The URL of the Convex site proxy (for HTTP actions)

## State Persistence

The plugin computes a deterministic state directory based on your git branch and project directory. This means:

- Backend state persists across dev server restarts
- Different git branches have separate backend states
- Use the `reset` option to clear state when needed

State is stored in `.convex/<state-id>/` in your project directory.

## Startup Scripts / Seeding

You can run functions after the backend is ready using the `onReady` option. This is useful for seeding data or running initialization scripts:

```ts
convexLocal({
  onReady: [
    { name: "seed:default" },
    { name: "init:createAdmin", args: { email: "admin@example.com" } },
  ],
});
```

Each function call specifies:

- `name`: The function path (e.g., `"myModule:myFunction"`)
- `args`: Optional arguments to pass to the function

Functions are executed sequentially after the initial deploy completes.

## Custom Environment Variables

You can set custom environment variables on the backend:

```ts
convexLocal({
  envVars: {
    MY_API_KEY: "secret-key",
  },
});
```

Or use a function to access the Vite port:

```ts
convexLocal({
  envVars: (vitePort) => ({
    FRONTEND_URL: `http://localhost:${vitePort}`,
  }),
});
```

## Using the Convex Dashboard

You can use the Convex dashboard to inspect and manage your local backend. Run the dashboard using Docker:

```bash
docker run -e 'NEXT_PUBLIC_DEPLOYMENT_URL=http://127.0.0.1:<port>' -p '6791:6791' 'ghcr.io/get-convex/convex-dashboard:latest'
```

Replace `<port>` with the backend port shown in the console output when the plugin starts:

```
[convex]   Backend URL:     http://127.0.0.1:54321
```

Then visit [http://localhost:6791](http://localhost:6791) and enter the admin key (also shown in the console output).

### Browser Compatibility

- **Safari**: Blocks requests to localhost. Use Chrome, Firefox, or Edge instead.
- **Brave**: Blocks localhost by default. Enable the `#brave-localhost-access-permission` flag in `brave://flags/` and allow localhost access in site settings.

---

## Advanced Options

These options are for advanced use cases and generally don't need to be changed.

### Port Configuration

| Option          | Type     | Default              | Description                                      |
| --------------- | -------- | -------------------- | ------------------------------------------------ |
| `port`          | `number` | dynamically assigned | Port for the Convex backend                      |
| `siteProxyPort` | `number` | dynamically assigned | Port for the Convex site proxy / HTTP actions    |

### Authentication Keys

Keys are auto-generated and persisted across restarts. Only provide these if you need to use specific keys.

| Option           | Type     | Default        | Description                                    |
| ---------------- | -------- | -------------- | ---------------------------------------------- |
| `instanceSecret` | `string` | auto-generated | The instance secret for the Convex backend     |
| `adminKey`       | `string` | auto-generated | The admin key for authenticating with the backend |

### State Management

| Option          | Type     | Default     | Description                                                        |
| --------------- | -------- | ----------- | ------------------------------------------------------------------ |
| `stateIdSuffix` | `string` | -           | Suffix for unique backend instances (when cwd and branch are same) |

### Timeouts

| Option               | Type     | Default  | Description                                     |
| -------------------- | -------- | -------- | ----------------------------------------------- |
| `deployTimeout`      | `number` | `60000`  | Timeout for deploy operations in milliseconds   |
| `healthCheckTimeout` | `number` | `10000`  | Timeout for backend health check in milliseconds|

### Binary Management

| Option           | Type     | Default                              | Description                                      |
| ---------------- | -------- | ------------------------------------ | ------------------------------------------------ |
| `binaryVersion`  | `string` | latest                               | Pin to a specific Convex backend version (e.g., `"precompiled-2024-12-17"`) |
| `binaryCacheDir` | `string` | `~/.convex-local-backend/releases`   | Directory to cache the Convex binary             |
| `binaryCacheTtl` | `number` | `604800000` (7 days)                 | How long to use cached binary before checking for updates (ms) |

### Using ConvexBackend Directly

For advanced use cases, you can import and use the `ConvexBackend` class directly:

```ts
import { ConvexBackend } from "convex-vite-plugin";

const backend = new ConvexBackend({
  instanceName: "my-app",
});

await backend.startBackend("/path/to/state");
backend.deploy();
await backend.setEnv("MY_VAR", "value");
await backend.runFunction("seed:default", { count: 10 });
await backend.stop();
```

## License

MIT
