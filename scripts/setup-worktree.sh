#!/bin/bash

ROOT_PATH="$1"

if [ -z "$ROOT_PATH" ]; then
  echo "Usage: setup-worktree.sh <root-path>"
  exit 1
fi

# Setup Node version
fnm use

# Link .env.local if it exists
if [ -f "$ROOT_PATH/.env.local" ]; then
  ln -sf "$ROOT_PATH/.env.local" .env.local
  echo "Linked .env.local"
fi

# Link .env if it exists
if [ -f "$ROOT_PATH/.env" ]; then
  ln -sf "$ROOT_PATH/.env" .env
  echo "Linked .env"
fi

# Install dependencies
bun i

# Install Playwright browsers
bun playwright install chromium
