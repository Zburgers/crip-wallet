#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly LOCAL_DIR="$REPO_ROOT/.local"
readonly RUNTIME_ENV="$LOCAL_DIR/runtime.env"
readonly ANVIL_CONFIG="$LOCAL_DIR/anvil/anvil.json"
readonly ANVIL_STATE_DIR="$LOCAL_DIR/anvil-state"
readonly COORDINATION_DIR="$LOCAL_DIR/coordination"
readonly ANVIL_POISON_FILE="$COORDINATION_DIR/anvil.poisoned"

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
require_command id

umask 077
mkdir -p "$LOCAL_DIR/anvil" "$ANVIL_STATE_DIR" "$COORDINATION_DIR"
chmod 700 "$LOCAL_DIR" "$LOCAL_DIR/anvil" "$ANVIL_STATE_DIR" "$COORDINATION_DIR"
acquire_anvil_mutation_lease
readonly CRIP_LOCAL_UID="$(id -u)"
readonly CRIP_LOCAL_GID="$(id -g)"

runtime_value() {
  local -r key="$1"
  [[ -f "$RUNTIME_ENV" ]] || return 0
  awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "$RUNTIME_ENV"
}

readonly SAME_RUNTIME_CHECKOUT="$(runtime_value CRIP_CHECKOUT_HASH)"
readonly SAME_RUNTIME_PROJECT="$(runtime_value CRIP_COMPOSE_PROJECT)"
readonly EXISTING_PASSWORD="$(runtime_value CRIP_POSTGRES_PASSWORD)"
existing_port() {
  local -r value="$(runtime_value "$1")"
  if [[ "$value" =~ ^[1-9][0-9]{3,4}$ ]]; then
    printf '%s' "$value"
  else
    printf '0'
  fi
}
if [[ "$SAME_RUNTIME_CHECKOUT" == "$CRIP_CHECKOUT_HASH" && "$SAME_RUNTIME_PROJECT" == "$CRIP_COMPOSE_PROJECT" ]]; then
  readonly EFFECTIVE_PASSWORD="$EXISTING_PASSWORD"
  readonly EXISTING_POSTGRES_PORT="$(existing_port CRIP_POSTGRES_PORT)"
  readonly EXISTING_ANVIL_PORT="$(existing_port CRIP_ANVIL_PORT)"
else
  readonly EFFECTIVE_PASSWORD="$(openssl rand -hex 24)"
  readonly EXISTING_POSTGRES_PORT=0
  readonly EXISTING_ANVIL_PORT=0
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
    printf 'CRIP_LOCAL_UID=%s\n' "$CRIP_LOCAL_UID"
    printf 'CRIP_LOCAL_GID=%s\n' "$CRIP_LOCAL_GID"
    printf 'CRIP_ANVIL_HOST=127.0.0.1\n'
    printf 'CRIP_ANVIL_PORT=%s\n' "$runtime_anvil_port"
    printf 'CRIP_RPC_URL=http://127.0.0.1:%s\n' "$runtime_anvil_port"
  } >"$temporary"
  chmod 600 "$temporary"
  mv -f "$temporary" "$RUNTIME_ENV"
}

write_runtime starting "$EXISTING_POSTGRES_PORT" "$EXISTING_ANVIL_PORT"
"$SCRIPT_DIR/validate-local-env.sh" "$RUNTIME_ENV"

startup_attempted=1
cleanup_on_failure() {
  local -r status="$?"
  if ((status != 0)) && ((startup_attempted)); then
    docker compose --project-name "$CRIP_COMPOSE_PROJECT" \
      --project-directory "$REPO_ROOT" --env-file "$RUNTIME_ENV" \
      stop anvil-gateway >/dev/null 2>&1 || true
    docker compose --project-name "$CRIP_COMPOSE_PROJECT" \
      --project-directory "$REPO_ROOT" --env-file "$RUNTIME_ENV" \
      kill anvil >/dev/null 2>&1 || true
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
  --project-directory "$REPO_ROOT" --env-file "$RUNTIME_ENV" up -d --wait postgres
docker compose --project-name "$CRIP_COMPOSE_PROJECT" \
  --project-directory "$REPO_ROOT" --env-file "$RUNTIME_ENV" \
  stop anvil-gateway >/dev/null 2>&1 || true
docker compose --project-name "$CRIP_COMPOSE_PROJECT" \
  --project-directory "$REPO_ROOT" --env-file "$RUNTIME_ENV" \
  kill anvil >/dev/null 2>&1 || true
rm -f "$ANVIL_POISON_FILE"
docker compose --project-name "$CRIP_COMPOSE_PROJECT" \
  --project-directory "$REPO_ROOT" --env-file "$RUNTIME_ENV" \
  up -d --wait --build --force-recreate anvil anvil-gateway
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
  --project-directory "$REPO_ROOT" --env-file "$RUNTIME_ENV" port anvil-gateway 8545)"
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
