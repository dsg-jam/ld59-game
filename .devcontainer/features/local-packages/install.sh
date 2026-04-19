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
    gh \
    git \
    jq \
    libatomic1 \
    libegl-mesa0 \
    libegl1 \
    libgbm1 \
    libgl1 \
    libgl1-mesa-dri \
    libgles2 \
    libglx-mesa0 \
    mesa-utils \
    openssh-client \
    python3 \
    python3-pip \
    ripgrep \
    unzip \
    xauth \
    xvfb \
    xz-utils

rm -rf /var/lib/apt/lists/*
