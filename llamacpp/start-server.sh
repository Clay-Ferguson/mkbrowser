#!/usr/bin/env bash
#
# start-server.sh — Launch llama-server with a local GGUF model
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

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

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

# ── Speculative Decoding (optional) ──────────────────────────────────────
# SPEC selects a llama.cpp speculative-decoding type (--spec-type). Default
# "off" changes nothing. The ngram-* types are self-speculative (no draft
# model, no extra download) and mainly help rewrite/edit-style tasks where
# the output repeats long runs of the input. See README § Speculative
# Decoding for what applies (and doesn't) on this hardware.
#   SPEC=ngram-simple ./start-server.sh   # rewriting-oriented defaults
#   SPEC=ngram-mod ./start-server.sh      # constant-memory variant
# Any other --spec-type value is passed through as-is.
# NOTE: For the hardware mentioned in README (Dell XPS Laptop) 
#       speculative decoding is actually harmful to performance
#       so leaving it off is the correct and the default option here
#       for that particular hardware.
SPEC="${SPEC:-off}"

SPEC_ARGS=()
case "$SPEC" in
  off) ;;
  ngram-simple)
    SPEC_ARGS=(--spec-type ngram-simple --spec-draft-n-max 64)
    ;;
  ngram-mod)
    SPEC_ARGS=(--spec-type ngram-mod
               --spec-ngram-mod-n-match 24
               --spec-ngram-mod-n-min 48
               --spec-ngram-mod-n-max 64)
    ;;
  *)
    SPEC_ARGS=(--spec-type "$SPEC")
    ;;
esac

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
#
# Defaults below apply to any block that does not set them. Per-model blocks may
# override FA (flash-attention on/off) and BATCH (prefill batch size, -b):
#   FA    — "on" works well for the Gemma builds; the Arc 140V iGPU needs "off"
#           for Qwen (flash-attn + this iGPU is unstable; see model-research).
#   BATCH — empty uses the llama.cpp default; "256" improves A3B prefill on Vulkan.
FA="on"
BATCH=""

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
#MODEL_FILE="gemma-4-26B-A4B-it-UD-IQ4_XS.gguf"
#CTX_SIZE="8192"

# Qwen3.6-35B-A3B (MoE): ~3B active params (~17.7 GB)
# Mixture-of-Experts: all 35B params live in memory but only ~3B activate per
# token, so generation stays fast on bandwidth-limited unified memory while
# quality rivals a flagship coder. IQ4_XS avoids the known k-quant crash on the
# Arc 140V iGPU; flash-attn off + a small prefill batch are the recommended Arc
# workarounds (see model-research/Qwen).
MODEL_FILE="Qwen3.6-35B-A3B-UD-IQ4_XS.gguf"
CTX_SIZE="16384"
FA="off"
BATCH="256"
# ─────────────────────────────────────────────────────────────────────────

# ── Server Configuration ─────────────────────────────────────────────────
HOST="127.0.0.1"
PORT="8080"
# ─────────────────────────────────────────────────────────────────────────

MODEL_PATH="$MODELS_DIR/$MODEL_FILE"

# Allow CLI overrides (e.g., --port 9090)
EXTRA_ARGS=("$@")

# A --port override in EXTRA_ARGS wins over the PORT set above; track the
# effective port so the bind check and the banner report where we'll really be.
for ((i = 0; i < ${#EXTRA_ARGS[@]}; i++)); do
  if [[ "${EXTRA_ARGS[i]}" == "--port" && -n "${EXTRA_ARGS[i + 1]:-}" ]]; then
    PORT="${EXTRA_ARGS[i + 1]}"
  fi
done

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

# ── Port Pre-flight Check ────────────────────────────────────────────────
# llama-server only discovers a taken port *after* it has loaded the model and
# printed a startup banner, so a duplicate launch looks like a mysterious crash
# ("couldn't bind HTTP server socket") rather than "it's already running".
# Catch it here instead, before we print anything that looks like success — and
# crucially before the PID file is written, so a rejected launch cannot clobber
# the PID of the server that is already running.
#
# Unlike status.sh / stop-server.sh, this check is a convenience rather than a
# safety guard: if `ss` is unavailable (non-Linux), skip it and let llama.cpp
# report the bind failure itself rather than refusing to start at all.
# shellcheck source=server-lib.sh
source "$SCRIPT_DIR/server-lib.sh"

if command -v ss >/dev/null 2>&1 && llama_port_listening "$HOST" "$PORT"; then
  echo "ERROR: ${HOST}:${PORT} is already in use — not starting a second server."
  echo ""

  if curl -sf -m 5 "http://${HOST}:${PORT}/health" >/dev/null 2>&1; then
    echo "  A healthy llama-server is already listening there. To use it, set the"
    echo "  llama.cpp Base URL in MkBrowser Settings to:"
    echo "    http://localhost:${PORT}/v1"
    echo ""
    echo "  ./status.sh      # model, slots, and a test inference"
    echo "  ./stop-server.sh # stop it, then re-run this script to restart"
  else
    echo "  Something is listening on that port but it is not answering /health,"
    echo "  so it may be a different program or a wedged server:"
    ss -tlnp 2>/dev/null | grep -E "[[:space:]]${HOST}:${PORT}[[:space:]]" | sed 's/^/    /'
    echo ""
    echo "  Stop it (./stop-server.sh if it is llama-server), or start this one on"
    echo "  another port:  ./start-server.sh --port 8081"
  fi
  exit 1
fi
# ─────────────────────────────────────────────────────────────────────────

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
echo "  Flash-attn:   $FA"
echo "  Prefill batch: ${BATCH:-default}"
echo "  Spec decoding: $SPEC"
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
#
# This is a hint, not the source of truth: stop-server.sh prefers the listening
# socket's owning PID and only falls back to this file. See server-lib.sh.
echo $$ > "$LLAMA_PID_FILE"

# Thread tuning for the Intel Core Ultra 9 288V (Lunar Lake): 8 cores, no
# hyperthreading = 4 fast P-cores + 4 low-power E-cores.
#   --threads 4        Token generation is memory-bandwidth-bound, and the 4
#                      P-cores nearly saturate the LPDDR5X bandwidth on their
#                      own. Including the slower E-cores tends to gate each
#                      token (every token waits on the slowest thread) and
#                      hurts laptop responsiveness, so we pin generation to 4.
#   --threads-batch 8  Prompt ingestion (prefill) is compute-bound rather than
#                      bandwidth-bound, so it benefits from all 8 cores.
#
# Optional prefill batch size (-b); empty BATCH leaves the llama.cpp default.
BATCH_ARGS=()
[[ -n "$BATCH" ]] && BATCH_ARGS=(-b "$BATCH")

exec "$SERVER_BIN" \
  --model "$MODEL_PATH" \
  --host "$HOST" \
  --port "$PORT" \
  --ctx-size "$CTX_SIZE" \
  -fa "$FA" \
  "${BATCH_ARGS[@]}" \
  --threads 4 \
  --threads-batch 8 \
  "${GPU_ARGS[@]}" \
  "${SPEC_ARGS[@]}" \
  --reasoning "$REASONING" \
  "${EXTRA_ARGS[@]}"
