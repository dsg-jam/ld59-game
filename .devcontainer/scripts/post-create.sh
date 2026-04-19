#!/usr/bin/env bash
set -euo pipefail

echo "Installing workspace dependencies from lockfile..."
npm ci

echo "Devcontainer is ready."
