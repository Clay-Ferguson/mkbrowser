#!/usr/bin/env bash
#
# start-server.sh — Launch llama-server with Gemma 4
#
# Starts the llama.cpp HTTP server on localhost:8080 with an
# OpenAI-compatible API. MkBrowser connects to this endpoint
# when using a LLAMACPP provider model.
#
# Usage:
#   ./start-server.sh              # Start with defaults
#   ./start-server.sh --port 9090  # Override port
#
set -euo pipefail

MODELS_DIR="$HOME/.local/share/llama.cpp/models"
LIB_DIR="$HOME/.local/lib/llama.cpp"

# ── Server Configuration ─────────────────────────────────────────────────
HOST="127.0.0.1"
PORT="8080"
CTX_SIZE="16384"
MODEL_FILE="gemma-4-E2B-it-Q4_K_M.gguf"
# ─────────────────────────────────────────────────────────────────────────

MODEL_PATH="$MODELS_DIR/$MODEL_FILE"

# Allow CLI overrides (e.g., --port 9090)
EXTRA_ARGS=("$@")

# Verify prerequisites
if ! command -v llama-server &>/dev/null; then
  echo "ERROR: llama-server not found. Run ./setup.sh first."
  exit 1
fi

if [[ ! -f "$MODEL_PATH" ]]; then
  echo "ERROR: Model not found at $MODEL_PATH"
  echo "Run ./download-model.sh first."
  exit 1
fi

# Ensure shared libraries are findable
export LD_LIBRARY_PATH="$LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

echo "=== Starting llama.cpp Server ==="
echo ""
echo "  Model:        $MODEL_FILE"
echo "  Context size: $CTX_SIZE"
echo "  Endpoint:     http://${HOST}:${PORT}"
echo "  API (OpenAI): http://${HOST}:${PORT}/v1"
echo ""
echo "  In MkBrowser Settings, set the llama.cpp Base URL to:"
echo "  http://localhost:${PORT}/v1"
echo ""
echo "Press Ctrl+C to stop the server."
echo ""

exec llama-server \
  --model "$MODEL_PATH" \
  --host "$HOST" \
  --port "$PORT" \
  --ctx-size "$CTX_SIZE" \
  "${EXTRA_ARGS[@]}"
