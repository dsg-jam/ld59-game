#!/usr/bin/env bash

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

if [ "$(id -u)" -ne 0 ]; then
    echo "Script must run as root"
    exit 1
fi

if [ ! -d /var/lib/apt/lists ] || [ "$(ls -A /var/lib/apt/lists 2>/dev/null | wc -l)" -eq 0 ]; then
    apt-get update -y
fi

apt-get install -y --no-install-recommends \
    bash-completion \
    build-essential \
    curl \
    fd-find \
    git \
    jq \
    libatomic1 \
    openssh-client \
    python3 \
    python3-pip \
    ripgrep \
    unzip \
    xz-utils

rm -rf /var/lib/apt/lists/*
