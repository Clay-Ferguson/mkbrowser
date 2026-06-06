#!/usr/bin/env bash
#
# setup-with-vulkan.sh — Install a Vulkan-enabled llama.cpp build (Intel Arc iGPU)
#
# This is a SAFE, SIDE-BY-SIDE companion to setup.sh. It does NOT modify or
# replace your working CPU-only installation:
#
#   CPU build (from setup.sh):   ~/.local/lib/llama.cpp/        -> llama-server
#   Vulkan build (this script):  ~/.local/lib/llama.cpp-vulkan/ -> llama-server-vulkan
#
# Because the two installs live in different directories and use different
# binary names, you can always fall back to the CPU build simply by running
# `llama-server` (or ./start-server.sh) exactly as you do today. To "uninstall"
# Vulkan you can just delete ~/.local/lib/llama.cpp-vulkan/ — nothing else is
# touched. This script also requires no sudo and installs no system packages.
#
# After install it runs a verification step that asks llama.cpp to enumerate
# Vulkan devices, so you'll know immediately whether your Arc GPU is usable
# *before* trying to serve a real model.
#
set -euo pipefail

BIN_DIR="$HOME/.local/bin"
LIB_DIR="$HOME/.local/lib/llama.cpp-vulkan"     # separate from the CPU install
MODELS_DIR="$HOME/.local/share/llama.cpp/models" # shared with the CPU install
BIN_NAME="llama-server-vulkan"                   # separate from the CPU symlink
TEMP_DIR=$(mktemp -d)

cleanup() { rm -rf "$TEMP_DIR"; }
trap cleanup EXIT

echo "=== llama.cpp Vulkan Setup (side-by-side) ==="
echo ""

# ── Step 1: Architecture check ───────────────────────────────────────────
ARCH=$(uname -m)
if [[ "$ARCH" != "x86_64" ]]; then
  echo "ERROR: This script supports x86_64 only (detected: $ARCH)."
  exit 1
fi

# ── Step 2: Vulkan runtime preflight ─────────────────────────────────────
# We need the Vulkan loader (libvulkan.so.1) and at least one ICD (the
# installable client driver). On this machine the Intel Mesa driver
# (libvulkan_intel.so via intel_icd.json) provides Arc GPU support. We only
# *check* for these — we do not install system packages, to keep things safe.
echo "Checking Vulkan runtime..."
RUNTIME_OK=1

# Check the loader on disk directly (don't depend on ldconfig being on PATH).
if compgen -G "/lib/x86_64-linux-gnu/libvulkan.so.1*" >/dev/null \
   || compgen -G "/usr/lib/x86_64-linux-gnu/libvulkan.so.1*" >/dev/null \
   || ldconfig -p 2>/dev/null | grep -q "libvulkan.so.1"; then
  echo "  [ok]   Vulkan loader (libvulkan.so.1) found"
else
  echo "  [MISS] Vulkan loader not found."
  echo "         Install with: sudo apt-get install libvulkan1"
  RUNTIME_OK=0
fi

if ls /usr/share/vulkan/icd.d/intel_icd*.json &>/dev/null; then
  echo "  [ok]   Intel Vulkan ICD found"
else
  echo "  [MISS] Intel Vulkan ICD not found."
  echo "         Install with: sudo apt-get install mesa-vulkan-drivers"
  RUNTIME_OK=0
fi

if [[ "$RUNTIME_OK" -ne 1 ]]; then
  echo ""
  echo "ERROR: Vulkan runtime prerequisites are missing (see above)."
  echo "Install the listed packages, then re-run this script."
  exit 1
fi
echo ""

# ── Step 3: Locate the Vulkan release asset ──────────────────────────────
echo "Fetching latest llama.cpp release info from GitHub..."
RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest")
TAG=$(echo "$RELEASE_JSON" | grep -oP '"tag_name":\s*"\K[^"]+')
echo "Latest release: $TAG"

# Pattern: llama-b{N}-bin-ubuntu-vulkan-x64.tar.gz  (Vulkan build, not plain CPU)
ASSET_URL=$(echo "$RELEASE_JSON" \
  | grep -oP '"browser_download_url":\s*"\K[^"]+' \
  | grep -P 'ubuntu-vulkan-x64\.tar\.gz$' \
  | head -1)

if [[ -z "$ASSET_URL" ]]; then
  echo "ERROR: Could not find a Vulkan Ubuntu x64 build in the latest release."
  echo "Check releases manually: https://github.com/ggml-org/llama.cpp/releases"
  exit 1
fi

FILENAME=$(basename "$ASSET_URL")
echo "Downloading $FILENAME..."
curl -fSL -o "$TEMP_DIR/$FILENAME" "$ASSET_URL"

# ── Step 4: Extract and install side-by-side ─────────────────────────────
echo "Extracting..."
mkdir -p "$TEMP_DIR/extracted"
tar -xzf "$TEMP_DIR/$FILENAME" -C "$TEMP_DIR/extracted"

EXTRACT_DIR=$(find "$TEMP_DIR/extracted" -name "llama-server" -type f -printf '%h\n' | head -1)
if [[ -z "$EXTRACT_DIR" ]]; then
  echo "ERROR: llama-server binary not found in the downloaded archive."
  find "$TEMP_DIR/extracted" -type f | head -20
  exit 1
fi

# Install into a fresh, dedicated dir (wipe any previous Vulkan install only).
echo "Installing to $LIB_DIR ..."
mkdir -p "$BIN_DIR" "$MODELS_DIR"
rm -rf "$LIB_DIR"
mkdir -p "$LIB_DIR"
# Copy binaries + all shared libs (incl. libggml-vulkan.so) into one dir so
# llama-server can dlopen its backends from its own directory.
find "$EXTRACT_DIR" \( -name '*.so*' -o -name 'llama-*' -o -name 'rpc-server' \) \
  \( -type f -o -type l \) -exec cp -a {} "$LIB_DIR/" \;
chmod +x "$LIB_DIR"/llama-* 2>/dev/null || true

# Symlink under a DISTINCT name so the CPU symlink (llama-server) is untouched.
ln -sf "$LIB_DIR/llama-server" "$BIN_DIR/$BIN_NAME"

echo ""
echo "=== Installation Complete ==="
echo "  Install dir → $LIB_DIR/"
echo "  Binary      → $BIN_DIR/$BIN_NAME (symlink)"
echo ""

# ── Step 5: Verify the GPU is actually visible to llama.cpp ───────────────
# This is the real test. We ask llama.cpp to list compute devices. If the
# Vulkan backend initializes and finds your Arc GPU, it will appear here.
echo "=== Verifying Vulkan device detection ==="
export LD_LIBRARY_PATH="$LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
DEVICE_OUTPUT=$("$LIB_DIR/llama-server" --list-devices 2>&1 || true)
echo "$DEVICE_OUTPUT"
echo ""

if echo "$DEVICE_OUTPUT" | grep -qiE "Vulkan|Intel|Arc"; then
  echo "SUCCESS: A Vulkan/GPU device was detected. 🎉"
  echo ""
  echo "Next step: launch a model on the GPU. To offload all layers, add"
  echo "  -ngl 99   (i.e. --n-gpu-layers 99)"
  echo "to a llama-server-vulkan invocation. I can wire start-server.sh up"
  echo "to use this build when you're ready."
else
  echo "WARNING: No Vulkan/GPU device was detected in the output above."
  echo "The CPU build remains your working setup (llama-server / start-server.sh)."
  echo "Vulkan may still need driver troubleshooting on this hardware."
fi
