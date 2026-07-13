#!/usr/bin/env bash
#
# server-lib.sh — Shared llama-server discovery helpers
#
# Sourced by status.sh and stop-server.sh (not meant to be executed directly)
# so both agree on the answer to "which process is the server?"
#
# The design rule here: the listening socket is the source of truth, not the
# PID file. A PID file records a claim made at launch time, and that claim can
# rot — the process can be SIGKILLed, crash, be started outside the script, or
# (as actually happened) a failed duplicate launch can overwrite the file with
# its own PID and then die. Worse, a rotted PID file is not merely useless: PIDs
# get recycled, so a stale number can name an innocent unrelated process, and
# signalling it would kill the wrong thing silently.
#
# So: ask the kernel who holds the port (ss), fall back to the PID file only if
# that fails, and — the step that actually provides the safety — verify the
# process really is llama-server (via /proc/<pid>/comm) before any signal is
# sent. That verification makes even the fallback path safe against PID reuse.
#

LLAMA_PID_FILE="${LLAMA_PID_FILE:-$HOME/.local/share/llama.cpp/llama-server.pid}"

# The process name to expect. /proc/<pid>/comm truncates at 15 chars;
# "llama-server" is 12, so it is compared in full.
LLAMA_COMM="llama-server"

# Outputs of llama_find_pid(). They are globals rather than echoed values on
# purpose: a `$(...)` capture would run the function in a subshell, where any
# variable it set would be discarded, silently losing LLAMA_PID_SOURCE.
LLAMA_PID=""
LLAMA_PID_SOURCE=""   # "socket" or "pidfile"

# ── Platform / tooling check ─────────────────────────────────────────────
# These scripts lean on Linux-only facilities: `ss` (iproute2) to map a port to
# its owning PID, and /proc/<pid>/ to verify that PID is really llama-server.
# Neither exists on macOS or the BSDs, and without them we would be back to
# blindly trusting a PID file — exactly the unsafe behavior this exists to
# avoid. So refuse clearly rather than degrade into something dangerous.
llama_check_platform() {
  local os missing=()
  os="$(uname -s)"

  if [[ "$os" != "Linux" ]]; then
    echo "ERROR: this script requires Linux (detected: $os)."
    echo ""
    echo "  It identifies the server by asking the kernel which process holds the"
    echo "  listening port, using 'ss' (iproute2) and /proc — neither of which"
    echo "  exists on $os. Without them the script cannot safely confirm that the"
    echo "  PID it is about to signal is actually llama-server."
    echo ""
    if [[ "$os" == "Darwin" ]]; then
      echo "  On macOS the equivalent lookup is:"
      echo "    lsof -nP -iTCP:8080 -sTCP:LISTEN     # show what holds the port"
      echo "    kill \$(lsof -ti TCP@127.0.0.1:8080)  # stop it"
    fi
    return 1
  fi

  command -v ss >/dev/null 2>&1 || missing+=("ss (install the 'iproute2' package)")
  [[ -d /proc ]] || missing+=("/proc filesystem (is it mounted?)")

  if ((${#missing[@]} > 0)); then
    echo "ERROR: required tools are missing on this system:"
    printf '    - %s\n' "${missing[@]}"
    return 1
  fi

  return 0
}

# llama_port_listening HOST PORT → 0 if anything is listening there
llama_port_listening() {
  ss -tln 2>/dev/null | grep -qE "[[:space:]]$1:$2[[:space:]]"
}

# llama_is_server PID → 0 if PID is alive AND is really a llama-server process.
# This is the guard that makes signalling safe: a recycled PID belonging to some
# unrelated program will fail the comm check and never be touched.
llama_is_server() {
  local pid="${1:-}"
  [[ -n "$pid" && "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  [[ "$(cat "/proc/$pid/comm" 2>/dev/null)" == "$LLAMA_COMM" ]]
}

# llama_socket_pid HOST PORT → echoes the PID holding that listening socket.
# Empty if nothing is listening, or if the socket belongs to another user (ss
# only discloses the owning PID for our own sockets unless we are root).
llama_socket_pid() {
  ss -tlnp 2>/dev/null \
    | grep -E "[[:space:]]$1:$2[[:space:]]" \
    | grep -oP 'pid=\K[0-9]+' \
    | head -1
}

# llama_find_pid HOST PORT [ALLOW_PIDFILE]
#   → sets LLAMA_PID + LLAMA_PID_SOURCE and returns 0, or returns 1 if no
#     verified llama-server was found. Call it directly, NOT as $(...).
#
# The socket is authoritative. The PID file is consulted only when ALLOW_PIDFILE
# is 1 (the default), because it is the one thing that can still find a server
# bound to a port we were not told about.
#
# ALLOW_PIDFILE must be 0 whenever the caller has been given an explicit port,
# and this is a correctness requirement, not a style preference: the PID file
# says nothing about *which port* its process listens on. Falling back to it
# after being asked about a specific port means answering a question about port
# X with a process that is serving port Y — which, for stop-server.sh, means
# killing a server the user did not ask to touch.
llama_find_pid() {
  local host="$1" port="$2" allow_pidfile="${3:-1}" pid

  LLAMA_PID=""
  LLAMA_PID_SOURCE=""

  pid="$(llama_socket_pid "$host" "$port")"
  if llama_is_server "$pid"; then
    LLAMA_PID="$pid"
    LLAMA_PID_SOURCE="socket"
    return 0
  fi

  if [[ "$allow_pidfile" == "1" && -f "$LLAMA_PID_FILE" ]]; then
    pid="$(cat "$LLAMA_PID_FILE" 2>/dev/null)"
    if llama_is_server "$pid"; then
      LLAMA_PID="$pid"
      LLAMA_PID_SOURCE="pidfile"
      return 0
    fi
  fi

  return 1
}
