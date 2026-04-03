#!/usr/bin/env bash
#
# stop-server.sh — Stop a running llama-server instance
#
# Reads the PID file written by start-server.sh, sends SIGTERM,
# waits for graceful exit, and cleans up.
#
# Usage:
#   ./stop-server.sh
#
set -euo pipefail

PID_FILE="$HOME/.local/share/llama.cpp/llama-server.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "No PID file found at $PID_FILE"
  echo "Falling back to pkill..."
  if pkill -f "llama-server" 2>/dev/null; then
    echo "Sent SIGTERM to llama-server process(es)."
  else
    echo "No llama-server process found."
  fi
  exit 0
fi

PID=$(cat "$PID_FILE")

if ! kill -0 "$PID" 2>/dev/null; then
  echo "PID $PID is not running. Removing stale PID file."
  rm -f "$PID_FILE"
  exit 0
fi

echo "Stopping llama-server (PID $PID)..."
kill "$PID"

# Wait up to 10 seconds for graceful exit
for i in $(seq 1 20); do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "llama-server stopped."
    rm -f "$PID_FILE"
    exit 0
  fi
  sleep 0.5
done

# Still running — force kill
echo "Server did not exit gracefully. Sending SIGKILL..."
kill -9 "$PID" 2>/dev/null || true
rm -f "$PID_FILE"
echo "llama-server killed."
