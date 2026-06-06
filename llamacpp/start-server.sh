#!/usr/bin/env bash
#
# start-server.sh — Launch llama-server with Gemma 4
#
# Starts the llama.cpp HTTP server on localhost:8080 with an
# OpenAI-compatible API. MkBrowser connects to this endpoint
# when using a LLAMACPP provider model.
#
# Usage:
#   ./start-server.sh              # Start with defaults (reasoning off)
#   ./start-server.sh on           # Start with reasoning on
#   ./start-server.sh off          # Start with reasoning off
#   ./start-server.sh on --port 9090  # reasoning on + override port
#
# Backend (CPU vs GPU) is chosen via the BACKEND env var (default "cpu"):
#   BACKEND=gpu ./start-server.sh        # run on the Intel Arc iGPU (Vulkan)
#   BACKEND=gpu ./start-server.sh on     # GPU + reasoning on
# (GPU mode requires ./setup-with-vulkan.sh to have been run first.)
#
set -euo pipefail

# ── Reasoning Mode ───────────────────────────────────────────────────────
# Optional first argument: "on" or "off" (controls --reasoning). Defaults
# to "off". MkBrowser passes "on" when Agentic Mode is enabled.
REASONING="off"
if [[ "${1:-}" == "on" || "${1:-}" == "off" ]]; then
  REASONING="$1"
  shift
fi
# ─────────────────────────────────────────────────────────────────────────

MODELS_DIR="$HOME/.local/share/llama.cpp/models"

# ── Backend Selection: CPU vs GPU (Vulkan / Intel Arc) ───────────────────
# Choose which llama.cpp build to launch:
#   "cpu" → the CPU-only build installed by ./setup.sh
#   "gpu" → the default Vulkan build installed by ./setup-with-vulkan.sh, which
#           offloads the model to the Intel Arc iGPU (adds --n-gpu-layers).
# The two builds live in separate directories with separate binaries, so the
# CPU setup is never disturbed. Pick one by editing BACKEND below, or override
# from the environment without editing this file:  BACKEND=gpu ./start-server.sh
BACKEND="${BACKEND:-gpu}"

# Layers to offload to the GPU in "gpu" mode. 99 = offload all layers.
NGL="${NGL:-99}"

case "$BACKEND" in
  cpu)
    LIB_DIR="$HOME/.local/lib/llama.cpp"
    SERVER_BIN="$LIB_DIR/llama-server"
    GPU_ARGS=()
    ;;
  gpu)
    LIB_DIR="$HOME/.local/lib/llama.cpp-vulkan"
    SERVER_BIN="$LIB_DIR/llama-server"
    GPU_ARGS=(--n-gpu-layers "$NGL")
    ;;
  *)
    echo "ERROR: Unknown BACKEND='$BACKEND' (expected 'cpu' or 'gpu')."
    exit 1
    ;;
esac
# ─────────────────────────────────────────────────────────────────────────

# ── Model Selection ──────────────────────────────────────────────────────
# Uncomment ONE group of settings below.

# Gemma 4 E2B: 2.3B effective params (~3.1 GB)
#MODEL_FILE="gemma-4-E2B-it-Q4_K_M.gguf"
#CTX_SIZE="16384"

# Gemma 4 E4B: 4.5B effective params (~5.0 GB)
#MODEL_FILE="gemma-4-E4B-it-Q4_K_M.gguf"
#CTX_SIZE="16384"

# Gemma 4 12B (dense): 12B params (~7.1 GB)
#MODEL_FILE="gemma-4-12b-it-Q4_K_M.gguf"
#CTX_SIZE="16384"

# Gemma 4 12B QAT (dense, Quantization-Aware Training): 12B params (~6.7 GB)
# Lower memory footprint (~7 GB total) and potentially faster than the
# standard Q4_K_M 12B build, with accuracy close to the original BF16.
# In other words, this QAT model is "smarter" (better answers/inference) than 
# the non-QAT model above, but runs in about the same memory.
#MODEL_FILE="gemma-4-12B-it-qat-UD-Q4_K_XL.gguf"
#CTX_SIZE="16384"

# Gemma 4 26B-A4B (MoE): 3.8B active params (~13.4 GB)
# Mixture-of-Experts: all 25.2B params live in memory but only ~3.8B activate
# per token, so generation stays fast while quality is higher than the 12B.
# Context kept at 8192 to leave memory headroom alongside the larger weights,
# although there is reason to believe 16384 will alwo work on my hardware.
MODEL_FILE="gemma-4-26B-A4B-it-UD-IQ4_XS.gguf"
CTX_SIZE="8192"
# ─────────────────────────────────────────────────────────────────────────

# ── Server Configuration ─────────────────────────────────────────────────
HOST="127.0.0.1"
PORT="8080"
# ─────────────────────────────────────────────────────────────────────────

MODEL_PATH="$MODELS_DIR/$MODEL_FILE"

# Allow CLI overrides (e.g., --port 9090)
EXTRA_ARGS=("$@")

# Verify prerequisites
if [[ ! -x "$SERVER_BIN" ]]; then
  if [[ "$BACKEND" == "gpu" ]]; then
    echo "ERROR: Vulkan build not found at $SERVER_BIN."
    echo "Run ./setup-with-vulkan.sh first."
  else
    echo "ERROR: llama-server not found at $SERVER_BIN."
    echo "Run ./setup.sh first."
  fi
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
if [[ "$BACKEND" == "gpu" ]]; then
  echo "  Backend:      gpu (Vulkan / Intel Arc, --n-gpu-layers $NGL)"
else
  echo "  Backend:      cpu"
fi
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

# Write PID file so stop-server.sh (and MkBrowser) can find us.
# exec replaces this shell, so $$ will be the llama-server PID.
PID_FILE="$HOME/.local/share/llama.cpp/llama-server.pid"
echo $$ > "$PID_FILE"

# Thread tuning for the Intel Core Ultra 9 288V (Lunar Lake): 8 cores, no
# hyperthreading = 4 fast P-cores + 4 low-power E-cores.
#   --threads 4        Token generation is memory-bandwidth-bound, and the 4
#                      P-cores nearly saturate the LPDDR5X bandwidth on their
#                      own. Including the slower E-cores tends to gate each
#                      token (every token waits on the slowest thread) and
#                      hurts laptop responsiveness, so we pin generation to 4.
#   --threads-batch 8  Prompt ingestion (prefill) is compute-bound rather than
#                      bandwidth-bound, so it benefits from all 8 cores.
exec "$SERVER_BIN" \
  --model "$MODEL_PATH" \
  --host "$HOST" \
  --port "$PORT" \
  --ctx-size "$CTX_SIZE" \
  -fa on \
  --threads 4 \
  --threads-batch 8 \
  "${GPU_ARGS[@]}" \
  --reasoning "$REASONING" \
  "${EXTRA_ARGS[@]}"
