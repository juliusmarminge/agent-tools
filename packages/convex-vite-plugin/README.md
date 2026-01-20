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
  plugins: [
    convexLocal({
      instanceName: "my-app",
      instanceSecret: "my-secret",
      adminKey: "my-admin-key",
    }),
  ],
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

| Option             | Type                                                                       | Required | Description                                                              |
| ------------------ | -------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| `instanceName`     | `string`                                                                   | Yes      | The instance name for the Convex backend                                 |
| `instanceSecret`   | `string`                                                                   | Yes      | The instance secret for the Convex backend                               |
| `adminKey`         | `string`                                                                   | Yes      | The admin key for authenticating with the Convex backend                 |
| `projectDir`       | `string`                                                                   | No       | The project directory containing the Convex functions (defaults to cwd)  |
| `reset`            | `boolean`                                                                  | No       | Reset backend state before starting (delete existing data)               |
| `envVars`          | `Record<string, string>` or `(vitePort: number) => Record<string, string>` | No       | Environment variables to set on the backend                              |
| `watch.patterns`   | `string[]`                                                                 | No       | Glob patterns to watch (defaults to `["convex/*.ts", "convex/**/*.ts"]`) |
| `watch.ignore`     | `string[]`                                                                 | No       | Glob patterns to ignore (defaults to `["convex/_generated/**"]`)         |
| `watch.debounceMs` | `number`                                                                   | No       | Debounce delay in milliseconds (defaults to `500`)                       |
| `stdio`            | `"inherit"` or `"ignore"`                                                  | No       | How to handle stdio from the backend process                             |
| `onReady`          | `ConvexFunctionCall[]`                                                     | No       | Functions to run after backend is ready (e.g., seed scripts)             |

## Environment Variables

The plugin sets the following environment variables:

- `VITE_CONVEX_URL` - The URL of the local Convex backend
- `VITE_CONVEX_SITE_URL` - The URL of the Convex site proxy

Additionally, the plugin sets `IS_TEST=true` on the backend.

## State Persistence

The plugin computes a deterministic state directory based on your git branch and project directory. This means:

- Backend state persists across dev server restarts
- Different git branches have separate backend states
- Use the `reset` option to clear state when needed

State is stored in `.convex/<state-id>/` in your project directory.

## Advanced Usage

### Startup Scripts / Seeding

You can run functions after the backend is ready using the `onReady` option. This is useful for seeding data or running initialization scripts:

```ts
convexLocal({
  instanceName: "my-app",
  instanceSecret: "my-secret",
  adminKey: "my-admin-key",
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

### Custom Environment Variables

You can set custom environment variables on the backend:

```ts
convexLocal({
  instanceName: "my-app",
  instanceSecret: "my-secret",
  adminKey: "my-admin-key",
  envVars: {
    MY_API_KEY: "secret-key",
  },
});
```

Or use a function to access the Vite port:

```ts
convexLocal({
  instanceName: "my-app",
  instanceSecret: "my-secret",
  adminKey: "my-admin-key",
  envVars: (vitePort) => ({
    FRONTEND_URL: `http://localhost:${vitePort}`,
  }),
});
```

### Using ConvexBackend Directly

For advanced use cases, you can import and use the `ConvexBackend` class directly:

```ts
import { ConvexBackend } from "convex-vite-plugin";

const backend = new ConvexBackend({
  instanceName: "my-app",
  instanceSecret: "my-secret",
  adminKey: "my-admin-key",
});

await backend.startBackend("/path/to/state");
backend.deploy();
await backend.setEnv("MY_VAR", "value");
await backend.runFunction("seed:default", { count: 10 });
await backend.stop();
```

## License

MIT
