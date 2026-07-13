#!/usr/bin/env bash
#
# stop-server.sh — Stop a running llama-server instance
#
# Finds the server by asking the kernel which process holds the listening port,
# verifies that process really is llama-server, then sends SIGTERM (escalating
# to SIGKILL) and cleans up the PID file.
#
# The PID file is only a fallback, never the sole basis for a kill — see the
# design note at the top of server-lib.sh for why trusting it is unsafe.
#
# Usage:
#   ./stop-server.sh              # stop the server on the default port
#   ./stop-server.sh --port 9090  # stop a server on another port
#
# Exit codes:
#   0  server stopped (or was not running)
#   1  unsupported platform / missing tools
#   2  the port is held by something that is not llama-server (left untouched)
#
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=server-lib.sh
source "$SCRIPT_DIR/server-lib.sh"

llama_check_platform || exit 1

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8080}"

# Whether the user named a port explicitly. This narrows the script's mandate:
#   ./stop-server.sh              → "stop my llama-server, wherever it is"
#   ./stop-server.sh --port 9090  → "stop the server on 9090, and nothing else"
# In the explicit case the PID-file and stray-process fallbacks are disabled,
# because they can only ever find a server on some *other* port — and killing
# that is not what was asked for.
PORT_EXPLICIT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)    PORT="${2:?--port needs a value}"; PORT_EXPLICIT=1; shift 2 ;;
    --host)    HOST="${2:?--host needs a value}"; PORT_EXPLICIT=1; shift 2 ;;
    -h|--help) sed -n '2,22p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)"; exit 1 ;;
  esac
done

ALLOW_PIDFILE=$((1 - PORT_EXPLICIT))

# stop_pid PID — SIGTERM, wait up to 10s, then SIGKILL.
stop_pid() {
  local pid="$1"
  echo "Stopping llama-server (PID $pid)..."
  kill "$pid" 2>/dev/null || true

  for _ in $(seq 1 20); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "llama-server stopped."
      return 0
    fi
    sleep 0.5
  done

  echo "Server did not exit gracefully after 10s. Sending SIGKILL..."
  kill -9 "$pid" 2>/dev/null || true
  echo "llama-server killed."
}

if llama_find_pid "$HOST" "$PORT" "$ALLOW_PIDFILE"; then
  if [[ "$LLAMA_PID_SOURCE" == "pidfile" ]]; then
    echo "Note: nothing was listening on ${HOST}:${PORT}, but the PID file points at a"
    echo "      live llama-server (PID $LLAMA_PID) — it is bound to some other port."
  fi
  stop_pid "$LLAMA_PID"
  rm -f "$LLAMA_PID_FILE"
  exit 0
fi

# Nothing verified on the expected port. Is the port held by something else?
if llama_port_listening "$HOST" "$PORT"; then
  echo "WARNING: ${HOST}:${PORT} is in use, but the process holding it is NOT llama-server."
  echo "         Leaving it alone — stopping it is not this script's business."
  echo ""
  ss -tlnp 2>/dev/null | grep -E "[[:space:]]${HOST}:${PORT}[[:space:]]" | sed 's/^/    /'
  exit 2
fi

# Last resort: a llama-server may be running on a port we were not told about,
# with no usable PID file. pgrep -x matches the *executable name* exactly — note
# this deliberately replaces the old `pkill -f llama-server`, which matched any
# command line containing that string (an editor open on this script, a grep, a
# tail of the log) and could kill an unrelated process.
#
# Skipped when a port was named explicitly: any process found this way is by
# definition not on the requested port, so stopping it would exceed the mandate.
STRAYS=()
if ((PORT_EXPLICIT == 0)); then
  mapfile -t STRAYS < <(pgrep -x "$LLAMA_COMM" 2>/dev/null)
fi

if ((${#STRAYS[@]} > 0)); then
  echo "No server on ${HOST}:${PORT}, but found llama-server process(es) elsewhere:"
  ps -o pid=,etime=,args= -p "${STRAYS[@]}" | cut -c1-100 | sed 's/^/    /'
  echo ""
  for pid in "${STRAYS[@]}"; do
    stop_pid "$pid"
  done
  rm -f "$LLAMA_PID_FILE"
  exit 0
fi

if ((PORT_EXPLICIT == 1)); then
  echo "No llama-server is listening on ${HOST}:${PORT}."
else
  echo "No llama-server is running."
fi

# Clean up the PID file only if it is genuinely stale — i.e. no live llama-server
# stands behind it. Verify rather than assume: with an explicit --port we may have
# found nothing simply because the real server is on another port, and it is that
# server which owns this file. (A truly stale file is worth deleting, since its
# PID can be recycled by an unrelated process and later trusted.)
if [[ -f "$LLAMA_PID_FILE" ]] && ! llama_is_server "$(cat "$LLAMA_PID_FILE" 2>/dev/null)"; then
  echo "Removing stale PID file ($LLAMA_PID_FILE)."
  rm -f "$LLAMA_PID_FILE"
fi

exit 0
