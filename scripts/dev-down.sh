#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly RUNTIME_ENV="$REPO_ROOT/.local/runtime.env"

source "$SCRIPT_DIR/local-context.sh"

command -v docker >/dev/null 2>&1 || {
  printf '%s\n' 'ERROR: required command not found: docker' >&2
  exit 1
}

[[ -f "$RUNTIME_ENV" ]] || {
  printf '%s\n' 'Local runtime is already stopped or was never initialized.'
  exit 0
}

docker compose --project-name "$CRIP_COMPOSE_PROJECT" \
  --project-directory "$REPO_ROOT" --env-file "$RUNTIME_ENV" down
printf '%s\n' 'Local containers stopped; ignored database and disposable test state were preserved.'
