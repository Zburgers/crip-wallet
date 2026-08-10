#!/usr/bin/env bash
set -Eeuo pipefail

readonly ENVIRONMENT="${CRIP_ENVIRONMENT:-local}"
readonly CHAIN_ID="${CRIP_CHAIN_ID:-eip155:31337}"
readonly ANVIL_PORT="${CRIP_ANVIL_PORT:-8545}"
readonly POSTGRES_PORT="${CRIP_POSTGRES_PORT:-55432}"
readonly POSTGRES_HOST="${CRIP_POSTGRES_HOST:-127.0.0.1}"
readonly RPC_URL="${CRIP_RPC_URL:-http://127.0.0.1:$ANVIL_PORT}"

refuse() {
  printf '%s\n' 'ERROR: refusing unsafe local configuration.' >&2
  exit 1
}

valid_port() {
  local -r port="$1"
  [[ "$port" =~ ^[1-9][0-9]{3,4}$ ]] || return 1
  ((10#$port >= 1024 && 10#$port <= 65535))
}

[[ "$ENVIRONMENT" == "local" ]] || refuse
[[ "$CHAIN_ID" == "eip155:31337" ]] || refuse
valid_port "$ANVIL_PORT" || refuse
valid_port "$POSTGRES_PORT" || refuse
[[ "$RPC_URL" == "http://127.0.0.1:$ANVIL_PORT" ]] || refuse
[[ "$POSTGRES_HOST" == "127.0.0.1" ]] || refuse
