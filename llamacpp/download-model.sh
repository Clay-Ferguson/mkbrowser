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

# ── Model Configuration ──────────────────────────────────────────────────
# Edit these variables to change the model or quantization.
#
# Gemma 4 E2B: 2.3B effective parameters (5.1B total with embeddings).
# Matches the Ollama "gemma4:e2b" model. Q4_K_M quantization (~3.1 GB)
# is a good balance of quality and size for 32GB RAM / CPU-only.
# See the HuggingFace repo for other quantization options.
#
MODEL_REPO="unsloth/gemma-4-E2B-it-GGUF"
MODEL_FILE="gemma-4-E2B-it-Q4_K_M.gguf"
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

echo "Downloading (~3.1 GB, this may take a while)..."
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
