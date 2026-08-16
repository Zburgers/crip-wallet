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
