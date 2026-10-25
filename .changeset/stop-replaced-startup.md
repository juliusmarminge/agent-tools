---
"convex-vite-plugin": patch
---

Stop the old startup when a dev server restart kills its backend. It no longer sets env vars, deploys or runs `onReady` functions after the kill, logs the resulting failures, or reports that backend as ready.
