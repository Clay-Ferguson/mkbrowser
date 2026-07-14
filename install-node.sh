#!/usr/bin/env bash
# this project requires NodeJS, and the following script is simply one possible way to install Node
set -euo pipefail

# Node 22 LTS. 
# WARNING: Do NOT bump to Node 24+: electron-forge 7.11 / electron-packager
# 18.4.4 bundle extract-zip@2.0.1, whose stream.pipeline call stalls during the
# Electron template extraction on Node 24, hanging `npm run make` indefinitely.
NODE_VERSION="22.22.3"
NVM_VERSION="v0.40.3"

export NVM_DIR="$HOME/.nvm"

if [ -d "$NVM_DIR" ]; then
    echo "nvm already installed, skipping install."
else
    echo "Downloading nvm ${NVM_VERSION} installer..."

    INSTALL_SCRIPT="$(mktemp)"

    curl -fsSL \
        "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" \
        -o "$INSTALL_SCRIPT"

    echo "Review installer at:"
    echo "  $INSTALL_SCRIPT"
    echo ""

    bash "$INSTALL_SCRIPT"

    rm -f "$INSTALL_SCRIPT"
fi

# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v nvm >/dev/null 2>&1; then
    echo "ERROR: nvm failed to load."
    exit 1
fi

echo "nvm version: $(nvm --version)"

echo "Installing Node.js ${NODE_VERSION}..."

nvm install "${NODE_VERSION}"
nvm use "${NODE_VERSION}"
nvm alias default "${NODE_VERSION}"

echo ""
echo "Node.js $(node --version) installed and set as default."
echo "npm version: $(npm --version)"
