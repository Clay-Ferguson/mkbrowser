#!/usr/bin/env bash
#
# download-model.sh — Download a Gemma 4 GGUF model for llama.cpp
#
# Downloads a quantized Gemma 4 model from HuggingFace into
# ~/.local/share/llama.cpp/models/
#
set -euo pipefail

MODELS_DIR="$HOME/.local/share/llama.cpp/models"
mkdir -p "$MODELS_DIR"

# ── Model Selection ──────────────────────────────────────────────────────
# Uncomment ONE of the following model variants:
#MODEL_VARIANT="E2B"   # Gemma 4 E2B: 2.3B effective params (~3.1 GB Q4_K_M)
MODEL_VARIANT="E4B"    # Gemma 4 E4B: 4.5B effective params (~5.0 GB Q4_K_M)
# ─────────────────────────────────────────────────────────────────────────

# ── Derived model settings (no need to edit below) ───────────────────────
case "$MODEL_VARIANT" in
  E2B) MODEL_SIZE_HINT="~3.1 GB" ;;
  E4B) MODEL_SIZE_HINT="~5.0 GB" ;;
  *)   echo "ERROR: Unknown MODEL_VARIANT='$MODEL_VARIANT'. Use E2B or E4B."; exit 1 ;;
esac
MODEL_REPO="unsloth/gemma-4-${MODEL_VARIANT}-it-GGUF"
MODEL_FILE="gemma-4-${MODEL_VARIANT}-it-Q4_K_M.gguf"
MODEL_URL="https://huggingface.co/${MODEL_REPO}/resolve/main/${MODEL_FILE}"
# ─────────────────────────────────────────────────────────────────────────

DEST="$MODELS_DIR/$MODEL_FILE"

echo "=== Gemma 4 Model Download ==="
echo ""
echo "  Repository: $MODEL_REPO"
echo "  File:       $MODEL_FILE"
echo "  Destination: $DEST"
echo ""

if [[ -f "$DEST" ]]; then
  FILE_SIZE=$(stat -c%s "$DEST" 2>/dev/null || stat -f%z "$DEST" 2>/dev/null)
  FILE_SIZE_GB=$(echo "scale=1; $FILE_SIZE / 1073741824" | bc 2>/dev/null || echo "?")
  echo "Model file already exists (${FILE_SIZE_GB} GB)."
  read -rp "Re-download? (y/N) " answer
  if [[ ! "$answer" =~ ^[Yy] ]]; then
    echo "Skipping download."
    exit 0
  fi
fi

echo "Downloading (${MODEL_SIZE_HINT}, this may take a while)..."
echo ""

# Use curl with resume support in case of interruption
curl -fSL --progress-bar -C - -o "$DEST" "$MODEL_URL"

echo ""
FILE_SIZE=$(stat -c%s "$DEST" 2>/dev/null || stat -f%z "$DEST" 2>/dev/null)
FILE_SIZE_GB=$(echo "scale=1; $FILE_SIZE / 1073741824" | bc 2>/dev/null || echo "?")
echo "=== Download Complete ==="
echo "  File: $DEST"
echo "  Size: ${FILE_SIZE_GB} GB"
echo ""
echo "Next step: run ./start-server.sh to start the llama.cpp server."
