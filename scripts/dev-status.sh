#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly RUNTIME_ENV="$REPO_ROOT/.local/runtime.env"
readonly ANVIL_PORT="${CRIP_ANVIL_PORT:-8545}"
readonly ANVIL_CONFIG="$REPO_ROOT/.local/anvil/anvil.json"
readonly EXPECTED_ACCOUNTS='["0x1c253b59dc67f513975c444654632151314abbc5","0x6f784a4efcf99d56ef5d6d97b70f93da5c1b372f","0xa447c77278c88f6548c93a49ac34845141facee5"]'

source "$SCRIPT_DIR/local-context.sh"

"$SCRIPT_DIR/validate-local-env.sh"

require_command() {
  local -r name="$1"
  command -v "$name" >/dev/null 2>&1 || {
    printf 'ERROR: required command not found: %s\n' "$name" >&2
    return 1
  }
}

require_command curl
require_command docker
require_command jq

[[ -f "$RUNTIME_ENV" ]] || {
  printf '%s\n' 'ERROR: local runtime is not initialized; run npm run dev:up.' >&2
  exit 1
}

[[ -f "$ANVIL_CONFIG" ]] || {
  printf '%s\n' 'ERROR: local Anvil configuration is missing; run npm run dev:up.' >&2
  exit 1
}

readonly actual_accounts="$(jq -ce '.available_accounts | map(ascii_downcase)' "$ANVIL_CONFIG")"
[[ "$actual_accounts" == "$EXPECTED_ACCOUNTS" ]] || {
  printf '%s\n' 'ERROR: refusing unexpected deterministic Anvil account fixture.' >&2
  exit 1
}

readonly chain_response="$(curl --fail --silent --show-error \
  --header 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  "http://127.0.0.1:$ANVIL_PORT")"
readonly chain_id="$(jq -er '.result' <<<"$chain_response")"

[[ "$chain_id" == "0x7a69" ]] || {
  printf 'ERROR: refusing unexpected chain id: %s\n' "$chain_id" >&2
  exit 1
}

docker compose --project-name "$CRIP_COMPOSE_PROJECT" \
  --project-directory "$REPO_ROOT" --env-file "$RUNTIME_ENV" \
  exec -T postgres pg_isready --username crip --dbname crip_wallet >/dev/null

printf 'Crip local environment: PostgreSQL ready; Anvil chain %s ready.\n' "$chain_id"
printf '%s\n' 'LOCAL TEST ONLY: no production wallet or public network is configured.'
