#!/usr/bin/env bash
set -Eeuo pipefail

readonly RUNTIME_FILE="${1:-}"
if [[ -n "$RUNTIME_FILE" ]]; then
  [[ -f "$RUNTIME_FILE" ]] || {
    printf '%s\n' 'ERROR: local runtime state is missing.' >&2
    exit 1
  }
  set -a
  # This file is generated from validated values by dev-up and is mode 0600.
  # shellcheck disable=SC1090
  source "$RUNTIME_FILE"
  set +a
fi

readonly ENVIRONMENT="${CRIP_ENVIRONMENT:-local}"
readonly CHAIN_ID="${CRIP_CHAIN_ID:-eip155:31337}"
readonly RUNTIME_STATE="${CRIP_RUNTIME_STATE:-ready}"
readonly ANVIL_PORT="${CRIP_ANVIL_PORT:-8545}"
readonly POSTGRES_PORT="${CRIP_POSTGRES_PORT:-55432}"
readonly ANVIL_HOST="${CRIP_ANVIL_HOST:-127.0.0.1}"
readonly POSTGRES_HOST="${CRIP_POSTGRES_HOST:-127.0.0.1}"
readonly RPC_URL="${CRIP_RPC_URL:-http://127.0.0.1:$ANVIL_PORT}"

refuse() {
  printf '%s\n' 'ERROR: refusing unsafe local configuration.' >&2
  exit 1
}

valid_port() {
  local -r port="$1"
  [[ "$port" =~ ^[0-9]+$ ]] || return 1
  ((10#$port >= 1024 && 10#$port <= 65535))
}

[[ "$ENVIRONMENT" == "local" ]] || refuse
[[ "$CHAIN_ID" == "eip155:31337" ]] || refuse
[[ "$RUNTIME_STATE" == "ready" || "$RUNTIME_STATE" == "starting" ]] || refuse
if [[ "$RUNTIME_STATE" == "starting" ]]; then
  [[ "$ANVIL_PORT" == "0" && "$POSTGRES_PORT" == "0" ]] || refuse
else
  valid_port "$ANVIL_PORT" || refuse
  valid_port "$POSTGRES_PORT" || refuse
fi
[[ "$RPC_URL" == "http://127.0.0.1:$ANVIL_PORT" ]] || refuse
[[ "$POSTGRES_HOST" == "127.0.0.1" && "$ANVIL_HOST" == "127.0.0.1" ]] || refuse
