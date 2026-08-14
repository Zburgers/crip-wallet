#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly LOCAL_DIR="$REPO_ROOT/.local"
readonly RUNTIME_ENV="$LOCAL_DIR/runtime.env"
readonly ANVIL_CONFIG="$LOCAL_DIR/anvil/anvil.json"

source "$SCRIPT_DIR/local-context.sh"

require_command() {
  local -r name="$1"
  command -v "$name" >/dev/null 2>&1 || {
    printf 'ERROR: required command not found: %s\n' "$name" >&2
    return 1
  }
}

require_command docker
require_command openssl

umask 077
mkdir -p "$LOCAL_DIR/anvil"

runtime_value() {
  local -r key="$1"
  [[ -f "$RUNTIME_ENV" ]] || return 0
  awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "$RUNTIME_ENV"
}

readonly POSTGRES_PASSWORD="$(runtime_value CRIP_POSTGRES_PASSWORD)"
if [[ -n "$POSTGRES_PASSWORD" ]]; then
  readonly EFFECTIVE_PASSWORD="$POSTGRES_PASSWORD"
else
  readonly EFFECTIVE_PASSWORD="$(openssl rand -hex 24)"
fi

write_runtime() {
  local -r state="$1"
  local -r runtime_postgres_port="$2"
  local -r runtime_anvil_port="$3"
  local -r temporary="$RUNTIME_ENV.tmp.$$"
  umask 077
  {
    printf 'CRIP_RUNTIME_STATE=%s\n' "$state"
    printf 'CRIP_CHECKOUT_HASH=%s\n' "$CRIP_CHECKOUT_HASH"
    printf 'CRIP_COMPOSE_PROJECT=%s\n' "$CRIP_COMPOSE_PROJECT"
    printf 'CRIP_ENVIRONMENT=local\n'
    printf 'CRIP_CHAIN_ID=eip155:31337\n'
    printf 'CRIP_POSTGRES_HOST=127.0.0.1\n'
    printf 'CRIP_POSTGRES_PORT=%s\n' "$runtime_postgres_port"
    printf 'CRIP_POSTGRES_DATABASE=crip_wallet\n'
    printf 'CRIP_POSTGRES_USER=crip\n'
    printf 'CRIP_POSTGRES_PASSWORD=%s\n' "$EFFECTIVE_PASSWORD"
    printf 'CRIP_ANVIL_HOST=127.0.0.1\n'
    printf 'CRIP_ANVIL_PORT=%s\n' "$runtime_anvil_port"
    printf 'CRIP_RPC_URL=http://127.0.0.1:%s\n' "$runtime_anvil_port"
  } >"$temporary"
  chmod 600 "$temporary"
  mv -f "$temporary" "$RUNTIME_ENV"
}

runtime_is_ready() {
  [[ -f "$RUNTIME_ENV" ]] || return 1
  [[ "$(runtime_value CRIP_RUNTIME_STATE)" == "ready" ]] || return 1
  [[ "$(runtime_value CRIP_CHECKOUT_HASH)" == "$CRIP_CHECKOUT_HASH" ]] || return 1
  [[ "$(runtime_value CRIP_COMPOSE_PROJECT)" == "$CRIP_COMPOSE_PROJECT" ]] || return 1
  [[ "$(runtime_value CRIP_POSTGRES_PORT)" =~ ^[1-9][0-9]{3,4}$ ]] || return 1
  [[ "$(runtime_value CRIP_ANVIL_PORT)" =~ ^[1-9][0-9]{3,4}$ ]] || return 1
}

if runtime_is_ready; then
  "$SCRIPT_DIR/validate-local-env.sh" "$RUNTIME_ENV"
else
  write_runtime starting 0 0
  "$SCRIPT_DIR/validate-local-env.sh" "$RUNTIME_ENV"
fi

startup_attempted=1
cleanup_on_failure() {
  local -r status="$?"
  if ((status != 0)) && ((startup_attempted)); then
    docker compose --project-name "$CRIP_COMPOSE_PROJECT" \
      --project-directory "$REPO_ROOT" --env-file "$RUNTIME_ENV" \
      down --remove-orphans >/dev/null 2>&1 || true
    write_runtime stopped 0 0 || true
  fi
  exit "$status"
}
trap cleanup_on_failure EXIT

if [[ ! -e "$ANVIL_CONFIG" ]]; then
  install --mode 600 /dev/null "$ANVIL_CONFIG"
else
  chmod 600 "$ANVIL_CONFIG"
fi

printf '%s\n' 'LOCAL TEST ONLY: starting disposable Anvil and local PostgreSQL.' >&2
docker compose --project-name "$CRIP_COMPOSE_PROJECT" \
  --project-directory "$REPO_ROOT" --env-file "$RUNTIME_ENV" up -d --wait
readonly anvil_container_id="$(docker compose --project-name "$CRIP_COMPOSE_PROJECT" \
  --project-directory "$REPO_ROOT" --env-file "$RUNTIME_ENV" ps -q anvil)"
[[ -n "$anvil_container_id" ]] || {
  printf '%s\n' 'ERROR: Anvil container was not created.' >&2
  exit 1
}
for attempt in {1..30}; do
  if docker exec "$anvil_container_id" test -s /tmp/anvil.json; then
    break
  fi
  if [[ "$attempt" == 30 ]]; then
    printf '%s\n' 'ERROR: Anvil did not create its local test configuration.' >&2
    exit 1
  fi
  sleep 1
done
docker exec "$anvil_container_id" cat /tmp/anvil.json >"$ANVIL_CONFIG"
[[ -f "$ANVIL_CONFIG" ]] || {
  printf '%s\n' 'ERROR: Anvil did not create its local test configuration.' >&2
  exit 1
}

readonly postgres_binding="$(docker compose --project-name "$CRIP_COMPOSE_PROJECT" \
  --project-directory "$REPO_ROOT" --env-file "$RUNTIME_ENV" port postgres 5432)"
readonly anvil_binding="$(docker compose --project-name "$CRIP_COMPOSE_PROJECT" \
  --project-directory "$REPO_ROOT" --env-file "$RUNTIME_ENV" port anvil 8545)"
[[ "$postgres_binding" == 127.0.0.1:* && "$anvil_binding" == 127.0.0.1:* ]] || {
  printf '%s\n' 'ERROR: Compose did not report loopback-only effective ports.' >&2
  exit 1
}
readonly postgres_port="${postgres_binding##*:}"
readonly anvil_port="${anvil_binding##*:}"
[[ "$postgres_port" =~ ^[1-9][0-9]{3,4}$ && "$anvil_port" =~ ^[1-9][0-9]{3,4}$ ]] || {
  printf '%s\n' 'ERROR: Compose reported invalid effective host ports.' >&2
  exit 1
}

chmod 600 "$ANVIL_CONFIG"
write_runtime ready "$postgres_port" "$anvil_port"
"$SCRIPT_DIR/dev-status.sh"
startup_attempted=0
