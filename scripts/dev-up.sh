#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly LOCAL_DIR="$REPO_ROOT/.local"
readonly RUNTIME_ENV="$LOCAL_DIR/runtime.env"
readonly ANVIL_CONFIG="$LOCAL_DIR/anvil/anvil.json"

source "$SCRIPT_DIR/local-context.sh"

"$SCRIPT_DIR/validate-local-env.sh"

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

if [[ ! -e "$ANVIL_CONFIG" ]]; then
  install --mode 600 /dev/null "$ANVIL_CONFIG"
else
  chmod 600 "$ANVIL_CONFIG"
fi

if [[ ! -f "$RUNTIME_ENV" ]]; then
  readonly generated_password="$(openssl rand -hex 24)"
  printf 'CRIP_POSTGRES_PASSWORD=%s\n' "$generated_password" >"$RUNTIME_ENV"
fi
chmod 600 "$RUNTIME_ENV"

printf '%s\n' 'LOCAL TEST ONLY: starting disposable Anvil and local PostgreSQL.' >&2
docker compose --project-name "$CRIP_COMPOSE_PROJECT" \
  --project-directory "$REPO_ROOT" --env-file "$RUNTIME_ENV" up -d --wait
[[ -f "$ANVIL_CONFIG" ]] || {
  printf '%s\n' 'ERROR: Anvil did not create its local test configuration.' >&2
  exit 1
}
chmod 600 "$ANVIL_CONFIG"
"$SCRIPT_DIR/dev-status.sh"
