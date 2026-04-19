#!/usr/bin/env bash

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

if [ "$(id -u)" -ne 0 ]; then
    echo "Script must run as root"
    exit 1
fi

export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

echo "Installing Playwright system dependencies..."
npx -y playwright@1.59.1 install-deps chromium

echo "Installing Playwright Chromium browser..."
npx -y playwright@1.59.1 install chromium

mkdir -p /ms-playwright
chmod -R a+rX /ms-playwright
