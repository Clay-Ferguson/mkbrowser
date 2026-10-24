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

# nvm is not written for strict mode: sourcing nvm.sh returns non-zero when no
# Node version is installed yet (always the case on a clean machine), which
# under `set -e` silently ended this script before Node was installed. Its
# functions also reference unset variables, so relax -e/-u while using nvm and
# check each nvm command's result explicitly instead.
set +eu

# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v nvm >/dev/null 2>&1; then
    echo "ERROR: nvm failed to load."
    exit 1
fi

echo "nvm version: $(nvm --version)"

echo "Installing Node.js ${NODE_VERSION}..."

nvm install "${NODE_VERSION}" || { echo "ERROR: nvm install ${NODE_VERSION} failed."; exit 1; }
nvm use "${NODE_VERSION}" || { echo "ERROR: nvm use ${NODE_VERSION} failed."; exit 1; }
nvm alias default "${NODE_VERSION}" || { echo "ERROR: nvm alias default ${NODE_VERSION} failed."; exit 1; }

set -eu

echo ""
echo "Node.js $(node --version) installed and set as default."
echo "npm version: $(npm --version)"
echo ""
echo "IMPORTANT: nvm, node and npm are only available in NEW terminal windows."
echo "Close this terminal and open a new one (or run: source ~/.nvm/nvm.sh)"
echo "before running 'npm install'."
