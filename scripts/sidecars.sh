#!/usr/bin/env bash
# sidecars.sh — sobe/para OmniRoute (:20128) + Jarvis (:3000) em paralelo.
# OmniRoute usa serve/start, nunca npm run dev, salvo JARVIS_OMNI_DEV=1.
set -euo pipefail

ROOT="${JARVIS_ROOT:-$HOME/Projetos}"
JARVIS="${JARVIS_DIR:-$ROOT/jarvis}"
OMNI="${OMNIROUTE_DIR:-$ROOT/OmniRoute}"
LOG_DIR="${XDG_CACHE_HOME:-$HOME/Library/Caches}/jarvis"
STATE_FILE="$LOG_DIR/sidecars.state"
mkdir -p "$LOG_DIR"

ACTION="${1:-start}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "sidecars: falta '$1' no PATH" >&2
    exit 1
  }
}

port_up() {
  local port="$1"
  curl -sf -o /dev/null --max-time 1 "http://127.0.0.1:${port}/" 2>/dev/null \
    || curl -sf -o /dev/null --max-time 1 "http://127.0.0.1:${port}/v1/models" 2>/dev/null \
    || lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

start_bg() {
  local name="$1" cwd="$2" cmd="$3" log="$4" pidfile="$5"
  if [[ ! -d "$cwd" ]]; then
    echo "sidecars: pasta não encontrada: $cwd" >&2
    exit 1
  fi
  echo "→ $name"
  (
    cd "$cwd"
    exec nohup bash -lc "$cmd" >>"$log" 2>&1
  ) &
  echo $! >"$pidfile"
  disown "$!" 2>/dev/null || true
}

wait_port() {
  local port="$1" label="$2" tries="${3:-60}"
  for ((i = 1; i <= tries; i++)); do
    if port_up "$port"; then
      echo "✓ $label :$port"
      return 0
    fi
    sleep 1
  done
  echo "sidecars: timeout esperando $label em :$port (log: $LOG_DIR)" >&2
  return 1
}

kill_tree() {
  local pid="$1"
  [[ -n "$pid" && "$pid" =~ ^[0-9]+$ ]] || return 0
  local child
  while read -r child; do
    [[ -n "$child" ]] && kill_tree "$child"
  done < <(pgrep -P "$pid" 2>/dev/null || true)
  kill -TERM "$pid" 2>/dev/null || true
}

kill_tree_hard() {
  local pid="$1"
  kill_tree "$pid"
  sleep 2
  local child
  while read -r child; do
    [[ -n "$child" ]] && kill -KILL "$child" 2>/dev/null || true
  done < <(pgrep -P "$pid" 2>/dev/null || true)
  kill -KILL "$pid" 2>/dev/null || true
}

omni_has_prod_build() {
  [[ -f "$OMNI/.build/next/BUILD_ID" || -f "$OMNI/.next/BUILD_ID" ]]
}

omni_cmd() {
  local memory="${OMNIROUTE_MEMORY_MB:-768}"
  if [[ "${JARVIS_OMNI_DEV:-}" == "1" ]]; then
    echo "PORT=20128 npm run dev"
  elif [[ -f "$OMNI/dist/server.js" || -f "$OMNI/app/server.js" ]]; then
    echo "OMNIROUTE_MEMORY_MB=${memory} PORT=20128 node bin/omniroute.mjs serve --no-open --no-tray --port 20128"
  elif omni_has_prod_build; then
    echo "PORT=20128 npm start"
  else
    echo "OMNIROUTE_MEMORY_MB=${memory} PORT=20128 node --max-old-space-size=${memory} scripts/dev/run-next.mjs dev"
  fi
}

jarvis_cmd() {
  local electron="${JARVIS_ELECTRON:-0}"
  local next_dev="${JARVIS_NEXT_DEV:-0}"
  if [[ "$electron" == "1" && "$next_dev" != "1" && -d "$JARVIS/.next" ]]; then
    echo "npm start"
  else
    echo "npm run dev"
  fi
}

write_state() {
  cat >"$STATE_FILE" <<EOF
OMNI_OWNED=${OMNI_OWNED:-0}
JARVIS_OWNED=${JARVIS_OWNED:-0}
OMNI_PID=${OMNI_PID:-}
JARVIS_PID=${JARVIS_PID:-}
HERMES_PID=${HERMES_PID:-}
HERMES_OWNED=${HERMES_OWNED:-0}
EOF
}

load_state() {
  OMNI_OWNED=0
  JARVIS_OWNED=0
  OMNI_PID=
  JARVIS_PID=
  if [[ -f "$STATE_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE"
  fi
}

status_json() {
  local omni="down" jarvis="down" hermes="down"
  port_up 20128 && omni="up"
  port_up 3000 && jarvis="up"
  port_up 9119 && hermes="up"
  printf '{"omni":"%s","jarvis":"%s","hermes":"%s"}\n' "$omni" "$jarvis" "$hermes"
}

hermes_token() {
  local token_file="$LOG_DIR/hermes.session-token"
  if [[ ! -s "$token_file" ]]; then
    openssl rand -hex 32 >"$token_file"
  fi
  cat "$token_file"
}

omniroute_loopback_key() {
  python3 - "$JARVIS/.env.local" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
if not path.exists():
    raise SystemExit(0)
for line in path.read_text().splitlines():
    if line.startswith("LOCAL_OPENAI_API_KEY=") or line.startswith("OMNIROUTE_API_KEY="):
        value = line.split("=", 1)[1].strip().strip('"')
        if value:
            print(value, end="")
            break
PY
}

hermes_env() {
  local bin="${HERMES_BIN:-$HOME/.hermes/venvs/hermes-313/bin/hermes}"
  local home="${HERMES_HOME:-$HOME/.hermes/profiles/jarvis}"
  local cwd="${HERMES_DEFAULT_CWD:-$HOME/Projetos}"
  local token key
  token="$(hermes_token)"
  key="$(omniroute_loopback_key)"
  echo "HERMES_HOME=$home HERMES_BIN=$bin HERMES_DEFAULT_CWD=$cwd HERMES_DASHBOARD_SESSION_TOKEN=$token HERMES_GATEWAY_TOKEN=$token HERMES_GATEWAY_URL=ws://127.0.0.1:9119/api/ws HERMES_GATEWAY_HTTP=http://127.0.0.1:9119 HERMES_TUI_PROVIDER=custom LOCAL_OPENAI_API_KEY=$key CUSTOM_API_KEY=$key OMNIROUTE_API_KEY=$key OPENAI_API_KEY=$key CUSTOM_BASE_URL=http://127.0.0.1:20128/v1 OPENAI_BASE_URL=http://127.0.0.1:20128/v1"
}

hermes_cmd() {
  local bin="${HERMES_BIN:-$HOME/.hermes/venvs/hermes-313/bin/hermes}"
  echo "$(hermes_env) $bin serve --host 127.0.0.1 --port 9119"
}


do_start() {
  need node
  need npm
  need curl

  load_state
  OMNI_OWNED=0
  JARVIS_OWNED=0
  OMNI_PID=
  JARVIS_PID=

  local wait_omni=0 wait_jarvis=0
  if port_up 20128; then
    echo "✓ OmniRoute já ativo :20128"
  else
    start_bg "OmniRoute" "$OMNI" "OMNIROUTE_API_KEY=$(omniroute_loopback_key) ROUTER_API_KEY=$(omniroute_loopback_key) $(omni_cmd)" "$LOG_DIR/omniroute.log" "$LOG_DIR/omniroute.log.pid"
    OMNI_PID="$(cat "$LOG_DIR/omniroute.log.pid")"
    OMNI_OWNED=1
    wait_omni=1
  fi

  local wait_hermes=0
  if port_up 9119; then
    echo "✓ Hermes já ativo :9119"
  else
    start_bg "Hermes" "${HERMES_HOME:-$HOME/.hermes/profiles/jarvis}" "$(hermes_cmd)" "$LOG_DIR/hermes.log" "$LOG_DIR/hermes.log.pid"
    HERMES_PID="$(cat "$LOG_DIR/hermes.log.pid")"
    HERMES_OWNED=1
    wait_hermes=1
  fi

  if port_up 3000; then
    echo "✓ Jarvis já ativo :3000"
  else
    local jcmd henv
    jcmd="$(jarvis_cmd)"
    henv="$(hermes_env)"
    if [[ "${JARVIS_ELECTRON:-}" == "1" ]]; then
      start_bg "Jarvis" "$JARVIS" "$henv JARVIS_ELECTRON=1 JARVIS_OMNIROUTE_MCP=1 $jcmd" "$LOG_DIR/jarvis.log" "$LOG_DIR/jarvis.log.pid"
    else
      start_bg "Jarvis" "$JARVIS" "$henv $jcmd" "$LOG_DIR/jarvis.log" "$LOG_DIR/jarvis.log.pid"
    fi
    JARVIS_PID="$(cat "$LOG_DIR/jarvis.log.pid")"
    JARVIS_OWNED=1
    wait_jarvis=1
  fi

  write_state

  local fail=0
  if [[ "$wait_omni" == "1" ]]; then
    wait_port 20128 "OmniRoute" 90 || fail=1
  fi
  if [[ "$wait_hermes" == "1" ]]; then
    wait_port 9119 "Hermes" 90 || fail=1
  fi
  if [[ "$wait_jarvis" == "1" ]]; then
    wait_port 3000 "Jarvis" 90 || fail=1
  fi

  if [[ "$fail" != "0" ]]; then
    exit 1
  fi
  status_json
}

do_stop() {
  load_state
  if [[ "${OMNI_OWNED:-0}" == "1" && -n "${OMNI_PID:-}" ]]; then
    echo "→ parando OmniRoute pid $OMNI_PID"
    kill_tree_hard "$OMNI_PID"
  fi
  if [[ "${JARVIS_OWNED:-0}" == "1" && -n "${JARVIS_PID:-}" ]]; then
    echo "→ parando Jarvis pid $JARVIS_PID"
    kill_tree_hard "$JARVIS_PID"
  fi
  if [[ "${HERMES_OWNED:-0}" == "1" && -n "${HERMES_PID:-}" ]]; then
    echo "→ parando Hermes pid $HERMES_PID"
    kill_tree_hard "$HERMES_PID"
  fi
  rm -f "$STATE_FILE" "$LOG_DIR/omniroute.log.pid" "$LOG_DIR/jarvis.log.pid" "$LOG_DIR/hermes.log.pid"
}

case "$ACTION" in
  start) do_start ;;
  stop) do_stop ;;
  status) status_json ;;
  *)
    echo "uso: sidecars.sh start|stop|status" >&2
    exit 2
    ;;
esac
