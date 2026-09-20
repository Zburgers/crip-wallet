#!/usr/bin/env bash
set -Eeuo pipefail

checkout_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum
  elif command -v shasum >/dev/null 2>&1; then
    shasum --algorithm 256
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 -r
  else
    printf '%s\n' 'ERROR: SHA-256 tool not found (sha256sum, shasum, or openssl).' >&2
    return 1
  fi
}

readonly CRIP_CHECKOUT_HASH="$(printf '%s' "$REPO_ROOT" | checkout_sha256 | cut -c1-12)"
readonly CRIP_COMPOSE_PROJECT="crip-wallet-$CRIP_CHECKOUT_HASH"
readonly CRIP_RUNTIME_ENV="$REPO_ROOT/.local/runtime.env"
export CRIP_COMPOSE_PROJECT
export CRIP_RUNTIME_ENV

acquire_anvil_mutation_lease() {
  local -r coordination_dir="$REPO_ROOT/.local/coordination"
  local -r lock_path="$coordination_dir/anvil.lock"
  command -v flock >/dev/null 2>&1 || {
    printf '%s\n' 'ERROR: required command not found: flock' >&2
    return 1
  }
  mkdir -p "$coordination_dir"
  chmod 700 "$coordination_dir"
  if [[ -L "$lock_path" ]]; then
    printf '%s\n' 'ERROR: Anvil mutation lock must not be a symlink.' >&2
    return 1
  elif [[ ! -e "$lock_path" ]]; then
    install --mode 600 /dev/null "$lock_path"
  elif [[ ! -f "$lock_path" ]]; then
    printf '%s\n' 'ERROR: Anvil mutation lock must be a regular file.' >&2
    return 1
  fi
  chmod 600 "$lock_path"
  # ponytail: one lease serializes the single local chain; shard only if contention matters.
  exec 9<"$lock_path"
  flock --exclusive 9
}
