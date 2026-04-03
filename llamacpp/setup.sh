#!/usr/bin/env bash
#
# setup.sh — Download and install prebuilt llama.cpp binaries
#
# Downloads the latest llama.cpp release for Ubuntu x64 from GitHub,
# extracts everything into ~/.local/lib/llama.cpp/, and creates symlinks
# in ~/.local/bin/ for the main executables. Keeping binaries and shared
# libraries in the same directory is required because llama-server loads
# its CPU backends (libggml-cpu-*.so) via dlopen() from the executable's
# own directory.
#
set -euo pipefail

BIN_DIR="$HOME/.local/bin"
LIB_DIR="$HOME/.local/lib/llama.cpp"
MODELS_DIR="$HOME/.local/share/llama.cpp/models"
TEMP_DIR=$(mktemp -d)

cleanup() { rm -rf "$TEMP_DIR"; }
trap cleanup EXIT

echo "=== llama.cpp Setup ==="
echo ""

# Ensure install directories exist
mkdir -p "$BIN_DIR"
mkdir -p "$LIB_DIR"
mkdir -p "$MODELS_DIR"

# Check if llama-server is already installed
if command -v llama-server &>/dev/null; then
  echo "llama-server is already installed:"
  llama-server --version 2>&1 || true
  echo ""
  read -rp "Re-install / update? (y/N) " answer
  if [[ ! "$answer" =~ ^[Yy] ]]; then
    echo "Skipping install."
    exit 0
  fi
fi

# Detect architecture
ARCH=$(uname -m)
if [[ "$ARCH" != "x86_64" ]]; then
  echo "ERROR: This script supports x86_64 only (detected: $ARCH)."
  echo "Visit https://github.com/ggml-org/llama.cpp/releases for other architectures."
  exit 1
fi

echo "Fetching latest llama.cpp release info from GitHub..."
RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest")
TAG=$(echo "$RELEASE_JSON" | grep -oP '"tag_name":\s*"\K[^"]+')
echo "Latest release: $TAG"

# Find the Ubuntu x64 binary asset (tar.gz archive)
# Pattern: llama-b{N}-bin-ubuntu-x64.tar.gz (plain CPU build, no vulkan/rocm/openvino)
ASSET_URL=$(echo "$RELEASE_JSON" \
  | grep -oP '"browser_download_url":\s*"\K[^"]+' \
  | grep -P 'ubuntu-x64\.tar\.gz$' \
  | head -1)

if [[ -z "$ASSET_URL" ]]; then
  echo "ERROR: Could not find a suitable binary download for Ubuntu x64."
  echo "Check releases manually: https://github.com/ggml-org/llama.cpp/releases"
  exit 1
fi

FILENAME=$(basename "$ASSET_URL")
echo "Downloading $FILENAME..."
curl -fSL -o "$TEMP_DIR/$FILENAME" "$ASSET_URL"

echo "Extracting..."
mkdir -p "$TEMP_DIR/extracted"
tar -xzf "$TEMP_DIR/$FILENAME" -C "$TEMP_DIR/extracted"

# Find the directory containing the extracted files
EXTRACT_DIR=$(find "$TEMP_DIR/extracted" -name "llama-server" -type f -printf '%h\n' | head -1)
if [[ -z "$EXTRACT_DIR" ]]; then
  echo "ERROR: llama-server binary not found in the downloaded archive."
  echo "Contents of archive:"
  find "$TEMP_DIR/extracted" -type f | head -20
  exit 1
fi

# Install everything (binaries + libraries) into LIB_DIR so that
# llama-server can find its dynamically-loaded backends via dlopen().
echo "Installing to $LIB_DIR ..."
find "$EXTRACT_DIR" \( -name '*.so*' -o -name 'llama-*' -o -name 'rpc-server' \) \
  \( -type f -o -type l \) -exec cp -a {} "$LIB_DIR/" \;
chmod +x "$LIB_DIR"/llama-* 2>/dev/null || true

# Create symlinks in BIN_DIR for convenient PATH access
ln -sf "$LIB_DIR/llama-server" "$BIN_DIR/llama-server"
if [[ -f "$LIB_DIR/llama-cli" ]]; then
  ln -sf "$LIB_DIR/llama-cli" "$BIN_DIR/llama-cli"
fi

echo ""
echo "=== Installation Complete ==="
echo "  Install dir  → $LIB_DIR/"
echo "  llama-server → $BIN_DIR/llama-server (symlink)"

# Verify it works
if command -v llama-server &>/dev/null; then
  echo ""
  llama-server --version 2>&1 || true
else
  echo ""
  echo "NOTE: $BIN_DIR is not on your PATH."
  echo "Add this to your ~/.bashrc:"
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

echo ""
echo "Models directory: $MODELS_DIR"
echo ""
echo "Next step: run ./download-model.sh to download the Gemma 4 model."
