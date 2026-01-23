---
"convex-vite-plugin": minor
---

**BREAKING:** The `envVars` callback signature changed from `(vitePort: number)` to `({ vitePort, resolvedUrls })`. This provides access to Vite's full `ResolvedServerUrls` object which includes both local and network URLs.

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
