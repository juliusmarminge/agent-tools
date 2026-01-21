---
"convex-vite-plugin": patch
---

Remove hardcoded bun dependency from plugin. The plugin now detects the package manager (npm, yarn, pnpm, or bun) from the `npm_config_user_agent` environment variable and uses the appropriate exec command (npx, yarn exec, pnpm exec, or bunx).
