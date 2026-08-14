#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly RUNTIME_ENV="$REPO_ROOT/.local/runtime.env"

command -v docker >/dev/null 2>&1 || {
  printf '%s\n' 'ERROR: required command not found: docker' >&2
  exit 1
}

[[ -f "$RUNTIME_ENV" ]] || {
  printf '%s\n' 'Local runtime is already stopped or was never initialized.\n'
  exit 0
}

set -a
# shellcheck disable=SC1090
source "$RUNTIME_ENV"
set +a
readonly RUNTIME_CHECKOUT_HASH="$CRIP_CHECKOUT_HASH"
readonly RUNTIME_COMPOSE_PROJECT="$CRIP_COMPOSE_PROJECT"
source "$SCRIPT_DIR/local-context.sh"
[[ "$RUNTIME_CHECKOUT_HASH" == "$CRIP_CHECKOUT_HASH" && "$RUNTIME_COMPOSE_PROJECT" == "$CRIP_COMPOSE_PROJECT" ]] || {
  printf '%s\n' 'ERROR: local runtime belongs to a different checkout.' >&2
  exit 1
}

docker compose --project-name "$CRIP_COMPOSE_PROJECT" \
  --project-directory "$REPO_ROOT" --env-file "$RUNTIME_ENV" down --remove-orphans

readonly temporary="$RUNTIME_ENV.tmp.$$"
awk 'BEGIN { FS = "=" } $1 == "CRIP_RUNTIME_STATE" { print "CRIP_RUNTIME_STATE=stopped"; next } { print }' \
  "$RUNTIME_ENV" >"$temporary"
chmod 600 "$temporary"
mv -f "$temporary" "$RUNTIME_ENV"
printf '%s\n' 'Local containers stopped; ignored database and disposable test state were preserved.'
