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
# Uncomment ONE group of settings below.
# All model files can coexist on disk — download each variant once.

# Gemma 4 E2B: 2.3B effective params (5.1B total with embeddings)
#MODEL_REPO="unsloth/gemma-4-E2B-it-GGUF"
#MODEL_FILE="gemma-4-E2B-it-Q4_K_M.gguf"
#MODEL_SIZE_HINT="~3.1 GB"

# Gemma 4 E4B: 4.5B effective params (8B total with embeddings)
#MODEL_REPO="unsloth/gemma-4-E4B-it-GGUF"
#MODEL_FILE="gemma-4-E4B-it-Q4_K_M.gguf"
#MODEL_SIZE_HINT="~5.0 GB"

# Gemma 4 26B-A4B (MoE): 3.8B active params (25.2B total)
MODEL_REPO="unsloth/gemma-4-26B-A4B-it-GGUF"
MODEL_FILE="gemma-4-26B-A4B-it-UD-IQ4_XS.gguf"
MODEL_SIZE_HINT="~13.4 GB"
# ─────────────────────────────────────────────────────────────────────────

MODEL_URL="https://huggingface.co/${MODEL_REPO}/resolve/main/${MODEL_FILE}"

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
