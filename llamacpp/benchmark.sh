#!/usr/bin/env bash
#
# benchmark.sh — Measure llama-server tokens-per-second from the command line
#
# Stops any running llama-server, starts a fresh one (honoring the same
# BACKEND / SPEC / NGL environment variables as start-server.sh), runs one
# small warmup inference plus one measured inference, prints the performance
# metrics, then shuts the server back down.
#
# Usage:
#   ./benchmark.sh                           # default prompt, 300 tokens
#   ./benchmark.sh -n 500                    # generate 500 tokens instead
#   ./benchmark.sh -p "Explain quicksort."   # custom prompt
#   ./benchmark.sh -f mydoc.md               # read the prompt from a file
#   SPEC=ngram-simple ./benchmark.sh         # benchmark a speculative mode
#   BACKEND=cpu ./benchmark.sh               # benchmark the CPU build
#
# The metrics come from llama-server itself (the `timings` object in the
# /completion response), so they are exact, not wall-clock estimates:
#   - prefill tok/s   — prompt-processing speed
#   - generation tok/s — the TPS number you usually care about
#   - draft acceptance — only shown when SPEC is enabled
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8080}"
BASE="http://127.0.0.1:${PORT}"
LOG_FILE="$HOME/.local/share/llama.cpp/benchmark-server.log"

# ── Options ──────────────────────────────────────────────────────────────
N_PREDICT=300
PROMPT="Explain how binary search trees work, covering insertion, search, deletion, and balancing. Be thorough."

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n) N_PREDICT="$2"; shift 2 ;;
    -p) PROMPT="$2"; shift 2 ;;
    -f) PROMPT="$(cat "$2")"; shift 2 ;;
    *)  echo "Unknown option: $1"; echo "Usage: ./benchmark.sh [-n tokens] [-p prompt] [-f prompt-file]"; exit 1 ;;
  esac
done

# ── Stop any running server, start a fresh one ───────────────────────────
"$SCRIPT_DIR/stop-server.sh" >/dev/null 2>&1 || true

echo "Starting llama-server (BACKEND=${BACKEND:-gpu}, SPEC=${SPEC:-off})..."
echo "Server log: $LOG_FILE"
"$SCRIPT_DIR/start-server.sh" >"$LOG_FILE" 2>&1 &
SERVER_PID=$!

# Always shut the server down on exit, even if the benchmark fails.
cleanup() { "$SCRIPT_DIR/stop-server.sh" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# ── Wait for the model to finish loading ─────────────────────────────────
echo -n "Loading model (this can take a few minutes on first load)"
READY=0
for _ in $(seq 1 180); do
  if curl -fsS -m 2 "$BASE/health" 2>/dev/null | grep -q '"ok"'; then
    READY=1
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo ""
    echo "ERROR: llama-server exited during startup. Last log lines:"
    tail -20 "$LOG_FILE"
    exit 1
  fi
  echo -n "."
  sleep 2
done
echo ""
if [[ "$READY" -ne 1 ]]; then
  echo "ERROR: server never became healthy (see $LOG_FILE)."
  exit 1
fi

# ── Warmup + measured run (python3 for robust JSON handling) ─────────────
echo "Running warmup inference (16 tokens)..."
echo "Running measured inference ($N_PREDICT tokens)..."
python3 - "$BASE" "$N_PREDICT" "$PROMPT" <<'PYEOF'
import json, sys, urllib.request

base, n_predict, prompt = sys.argv[1], int(sys.argv[2]), sys.argv[3]

def post(path, payload, timeout=900):
    req = urllib.request.Request(base + path, json.dumps(payload).encode(),
                                 {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)

def completion(text, n):
    # Route through the model's chat template so instruct models behave.
    tmpl = post("/apply-template",
                {"messages": [{"role": "user", "content": text}]})["prompt"]
    return post("/completion", {"prompt": tmpl, "n_predict": n,
                                "temperature": 0, "cache_prompt": False})

completion("Say hello.", 16)          # warmup: shader compile, weight touch
resp = completion(prompt, n_predict)  # measured run

t = resp["timings"]
print()
print("=== Benchmark Results ===")
print(f"  Prompt tokens:    {t.get('prompt_n')}  "
      f"({(t.get('prompt_per_second') or 0):.1f} tok/s prefill)")
print(f"  Generated tokens: {t.get('predicted_n')}  "
      f"({(t.get('predicted_per_second') or 0):.1f} tok/s generation)")
draft = t.get("draft_n") or 0
if draft:
    acc = t.get("draft_n_accepted") or 0
    print(f"  Draft tokens:     {draft}  "
          f"({acc} accepted, {100 * acc / draft:.1f}%)")
print()
print("--- First lines of model output ---")
print("\n".join(resp.get("content", "").strip().splitlines()[:6]))
PYEOF

echo ""
echo "Done. Stopping server."
