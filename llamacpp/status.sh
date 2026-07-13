#!/usr/bin/env bash
#
# status.sh — Report on the running llama-server, and optionally test it
#
# Answers "is my LLM server up, what is it serving, and is it actually
# working?" in one shot: port/PID, health, loaded model, context and slot
# usage, process resource usage, and a real test inference with timings.
#
# Usage:
#   ./status.sh              # full report + test inference
#   ./status.sh --no-test    # skip the test inference (no tokens generated)
#   ./status.sh --port 9090  # check a server on a non-default port
#
# Exit codes:
#   0  server is up and healthy
#   1  nothing is listening on the port (server is down)
#   2  something is listening but it is not a healthy llama-server
#   3  server is alive but still loading the model
#
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=server-lib.sh
source "$SCRIPT_DIR/server-lib.sh"

llama_check_platform || exit 1

command -v curl >/dev/null 2>&1 || { echo "ERROR: 'curl' is required but not installed."; exit 1; }
command -v jq   >/dev/null 2>&1 || { echo "ERROR: 'jq' is required but not installed."; exit 1; }

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8080}"
RUN_TEST=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-test) RUN_TEST=0; shift ;;
    --port)    PORT="${2:?--port needs a value}"; shift 2 ;;
    --host)    HOST="${2:?--host needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)"; exit 1 ;;
  esac
done

BASE="http://${HOST}:${PORT}"

# Pretty-print a "  Label: value" line with an aligned label column.
row() { printf '  %-16s %s\n' "$1:" "$2"; }

echo "=== llama.cpp Server Status ==="
echo ""

# ── 1. Is anything listening? ────────────────────────────────────────────
if ! llama_port_listening "$HOST" "$PORT"; then
  echo "  DOWN — nothing is listening on ${HOST}:${PORT}"
  echo ""
  echo "  Start it with:  ./start-server.sh"
  # Only call the PID file stale if no live llama-server stands behind it —
  # a valid one just means a server is running on some other port.
  if [[ -f "$LLAMA_PID_FILE" ]] && ! llama_is_server "$(cat "$LLAMA_PID_FILE" 2>/dev/null)"; then
    echo "  (A stale PID file remains at $LLAMA_PID_FILE; ./stop-server.sh will clean it up.)"
  fi
  exit 1
fi

# ── 2. Is it a healthy llama-server? ─────────────────────────────────────
# Three distinct states, and they must not be conflated:
#   200 → ready
#   503 → alive but still loading the model into memory (normal for ~a minute
#         on a 17 GB MoE; NOT an error, and NOT something to "fix" by killing it)
#   anything else / no response → wedged, or not a llama-server at all
# Note the deliberate absence of curl's -f here: -f makes 503 indistinguishable
# from a dead socket, which would report a loading server as broken.
HEALTH_BODY=$(curl -s -m 5 -w '\n%{http_code}' "$BASE/health" 2>/dev/null)
HEALTH_CODE="${HEALTH_BODY##*$'\n'}"
HEALTH="${HEALTH_BODY%$'\n'*}"

case "$HEALTH_CODE" in
  200)
    echo "  UP — healthy and accepting requests"
    ;;
  503)
    echo "  LOADING — the model is still being loaded into memory."
    echo ""
    echo "  This is normal right after ./start-server.sh (a large MoE model can take"
    echo "  a minute or more). Requests will 503 until it finishes. Re-run ./status.sh"
    echo "  in a moment, or watch it with:"
    echo "    until curl -sf $BASE/health >/dev/null; do sleep 2; done; echo READY"
    exit 3
    ;;
  *)
    echo "  UNHEALTHY — ${HOST}:${PORT} is in use but /health did not answer (HTTP ${HEALTH_CODE:-none})."
    echo ""
    echo "  The process holding the port:"
    ss -tlnp 2>/dev/null | grep -E "[[:space:]]${HOST}:${PORT}[[:space:]]" | sed 's/^/    /'
    echo ""
    echo "  If it is a wedged llama-server, ./stop-server.sh will clear it."
    exit 2
    ;;
esac
echo ""
row "Endpoint" "$BASE"
row "API (OpenAI)" "$BASE/v1"
row "Health" "$(jq -r '.status // "?"' <<<"$HEALTH")"

# ── 3. Process info ──────────────────────────────────────────────────────
# Socket only (no PID-file fallback): we only get here because something IS
# listening on this port, so the socket's owner is the process being reported on.
# The PID file could only name a server bound to some *other* port, which would
# make every stat below describe the wrong process.
if llama_find_pid "$HOST" "$PORT" 0; then
  PID="$LLAMA_PID"
  echo ""
  row "PID" "$PID"
  # rss is in KB; etime is elapsed wall-clock since launch.
  read -r RSS ETIME PCPU < <(ps -o rss=,etime=,pcpu= -p "$PID" | awk '{$1=$1};1')
  row "Uptime" "$ETIME"
  row "CPU (avg)" "${PCPU}%"

  # --n-gpu-layers in the command line means the model was offloaded to the GPU.
  CMDLINE=$(tr '\0' ' ' < "/proc/$PID/cmdline" 2>/dev/null)
  if grep -q -- '--n-gpu-layers' <<<"$CMDLINE"; then
    row "Backend" "gpu (Vulkan, --n-gpu-layers $(grep -oP -- '--n-gpu-layers \K[0-9]+' <<<"$CMDLINE"))"
    # Under GPU offload the weights sit in (shared) GPU memory and the GGUF is
    # mmap'd, so process RSS stays tiny — it is NOT the model's memory cost.
    # Report it plainly and point at the weights size for the number that matters.
    row "Process RSS" "$(awk -v k="$RSS" 'BEGIN{printf "%.0f MB", k/1024}') (weights are in GPU memory, not RSS)"
  else
    row "Backend" "cpu"
    row "Process RSS" "$(awk -v k="$RSS" 'BEGIN{printf "%.1f GB", k/1048576}')"
  fi
fi

# ── 4. Model info ────────────────────────────────────────────────────────
MODELS=$(curl -sf -m 5 "$BASE/v1/models" 2>/dev/null)
if [[ -n "$MODELS" ]]; then
  echo ""
  row "Model" "$(jq -r '.data[0].id // "?" | split("/") | last' <<<"$MODELS")"
  row "Quant" "$(jq -r '.data[0].meta.ftype // "?"' <<<"$MODELS")"
  row "Params" "$(jq -r '.data[0].meta.n_params // 0 | . / 1e9 | "\(. * 10 | round / 10)B"' <<<"$MODELS")"
  row "Weights size" "$(jq -r '.data[0].meta.size // 0 | . / 1073741824 | "\(. * 10 | round / 10) GB"' <<<"$MODELS")"
  row "Context" "$(jq -r '.data[0].meta.n_ctx // "?"' <<<"$MODELS") tokens (trained: $(jq -r '.data[0].meta.n_ctx_train // "?"' <<<"$MODELS"))"
fi

# ── 5. Slots (llama.cpp's parallel request lanes) ────────────────────────
# Each slot holds one conversation's KV cache; a request waits if all are busy.
SLOTS=$(curl -sf -m 5 "$BASE/slots" 2>/dev/null)
if [[ -n "$SLOTS" ]] && jq -e 'type == "array"' <<<"$SLOTS" >/dev/null 2>&1; then
  TOTAL=$(jq 'length' <<<"$SLOTS")
  BUSY=$(jq '[.[] | select(.is_processing)] | length' <<<"$SLOTS")
  echo ""
  row "Slots" "$TOTAL total, $BUSY busy, $((TOTAL - BUSY)) idle"
fi

# ── 6. Test inference ────────────────────────────────────────────────────
if [[ "$RUN_TEST" -eq 0 ]]; then
  echo ""
  echo "  (Skipping test inference: --no-test)"
  exit 0
fi

echo ""
echo "=== Test Inference ==="
echo ""

MODEL_ID=$(jq -r '.data[0].id // "default"' <<<"${MODELS:-{\}}")
PROMPT="In one short sentence, what is a mixture-of-experts model?"
row "Prompt" "\"$PROMPT\""
echo ""

REQ=$(jq -n --arg m "$MODEL_ID" --arg p "$PROMPT" \
  '{model: $m, messages: [{role: "user", content: $p}], max_tokens: 100, temperature: 0.7, stream: false}')

START=$EPOCHREALTIME
RESP=$(curl -sf -m 120 -H 'Content-Type: application/json' -d "$REQ" \
       "$BASE/v1/chat/completions" 2>/dev/null)
CURL_RC=$?
END=$EPOCHREALTIME

if [[ $CURL_RC -ne 0 || -z "$RESP" ]]; then
  echo "  FAILED — the server is healthy but the completion request errored (curl rc=$CURL_RC)."
  echo "  It may still be loading the model into VRAM, or the request timed out (120s)."
  exit 2
fi

ELAPSED=$(awk -v s="$START" -v e="$END" 'BEGIN{printf "%.2f", e - s}')

echo "  Response:"
jq -r '.choices[0].message.content // "(empty)"' <<<"$RESP" | fold -s -w 70 | sed 's/^/    /'
echo ""

# llama.cpp adds a non-standard "timings" object to the OpenAI response; it is
# the only place the real prefill/generation token rates are reported.
if jq -e '.timings' <<<"$RESP" >/dev/null 2>&1; then
  row "Prompt eval" "$(jq -r '.timings.prompt_n // 0' <<<"$RESP") tokens @ $(jq -r '.timings.prompt_per_second // 0 | . * 10 | round / 10' <<<"$RESP") tok/s"
  row "Generation" "$(jq -r '.timings.predicted_n // 0' <<<"$RESP") tokens @ $(jq -r '.timings.predicted_per_second // 0 | . * 10 | round / 10' <<<"$RESP") tok/s"
else
  row "Tokens" "$(jq -r '.usage.completion_tokens // 0' <<<"$RESP") generated, $(jq -r '.usage.prompt_tokens // 0' <<<"$RESP") in prompt"
fi
row "Round trip" "${ELAPSED}s"
echo ""
echo "  Inference works. MkBrowser can talk to this server at $BASE/v1"
