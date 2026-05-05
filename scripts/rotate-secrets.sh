#!/usr/bin/env bash
# Rotate the faucet's sensitive secrets in-place on a docker-compose deploy.
#
# Usage:
#
#   scripts/rotate-secrets.sh                # default: --simple
#   scripts/rotate-secrets.sh --simple       # rotate the four passphrase/password values
#   scripts/rotate-secrets.sh --with-wallet  # ALSO rotate the wallet keypair (sweeps balance)
#   scripts/rotate-secrets.sh --help
#
# What gets rotated
# -----------------
#
# --simple (always):
#     FAUCET_ADMIN_PASSWORD       (admin dashboard auth)
#     FAUCET_HASHCASH_SECRET      (hashcash HMAC secret)
#     FAUCET_KEY_PASSPHRASE       (encrypts wallet key inside the Nimiq node)
#     FAUCET_WALLET_PASSPHRASE    (unlocks the wallet at runtime)
#
# --with-wallet (additionally):
#     FAUCET_WALLET_ADDRESS       (new on-chain address)
#     FAUCET_PRIVATE_KEY          (new 64-char hex private key)
#     A balance sweep tx from the OLD wallet to the NEW one. Operator
#     confirms the on-chain step interactively before it fires.
#
# Safety properties
# -----------------
# * The .env file is backed up to .env.backup-<timestamp> before any write.
# * New secret values are printed once on /dev/tty (the controlling terminal),
#   never on stdout/stderr, so they don't end up in pipes / logs / scrollback
#   captures of the parent ssh session.
# * `set -x` is never enabled (would leak secrets via xtrace).
# * The Node helper takes secrets via env, not argv (argv is visible in `ps`).
# * The helper runs from the repo root with `tsx` (already a workspace dep).
#
# Layout assumptions
# ------------------
# * The compose stack lives at deploy/compose/ with docker-compose.yml,
#   docker-compose.override.yml, and fcaptcha.yml (the canonical operator
#   layout used by this repo's deployment guide).
# * The stack is started with `--profile local-node` (the documented
#   default for self-hosted Albatross node deployments). Override via the
#   COMPOSE_PROFILE env var.
# * The faucet's HTTP entrypoint is reachable at FAUCET_HEALTH_URL
#   (default: https://faucet.wevpage.com/healthz). Override per-deploy.
#
# Exit codes:
#   0  rotation finished, faucet healthy
#   1  rotation aborted by operator or runtime error

set -euo pipefail

# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_DIR="${REPO_ROOT}/deploy/compose"
ENV_FILE="${COMPOSE_DIR}/.env"
HELPER="${SCRIPT_DIR}/_rotate-wallet.mts"

COMPOSE_PROFILE="${COMPOSE_PROFILE:-local-node}"
HEALTH_URL="${FAUCET_HEALTH_URL:-}"

trap 'rc=$?; if [[ $rc -ne 0 ]]; then printf >&2 "\n[rotate-secrets] failed at line %s (exit %s)\n" "$LINENO" "$rc"; fi' ERR

err() { printf >&2 "[rotate-secrets] error: %s\n" "$*"; }
log() { printf >&2 "[rotate-secrets] %s\n" "$*"; }
tty_print() { printf "%s\n" "$*" > /dev/tty; }

usage() {
  sed -n '3,/^# Exit codes/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

read_env_value() {
  # Returns the value of $1 from $ENV_FILE, or empty if absent.
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]+=/, ""); print; exit }' "${ENV_FILE}"
}

write_env_value() {
  # Replace (or insert) `KEY=VALUE` in $ENV_FILE atomically. Uses a tmp
  # file + rename so a SIGINT mid-rewrite doesn't leave the file partial.
  local key="$1" val="$2" tmp
  tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
  if grep -q "^${key}=" "${ENV_FILE}"; then
    awk -v key="${key}" -v val="${val}" \
      'BEGIN{re="^"key"="} $0 ~ re { print key"="val; next } { print }' \
      "${ENV_FILE}" > "${tmp}"
  else
    cat "${ENV_FILE}" > "${tmp}"
    printf "%s=%s\n" "${key}" "${val}" >> "${tmp}"
  fi
  chmod 600 "${tmp}"
  mv "${tmp}" "${ENV_FILE}"
}

rand_password() {
  # 24 bytes of entropy → ~32 base64 chars; strip URL/shell-trouble chars.
  openssl rand -base64 24 | tr -d '/+='
}

rand_hex32() {
  # 32 bytes hex = 64-char string; satisfies the ≥16-char hashcash check.
  openssl rand -hex 32
}

compose() {
  ( cd "${COMPOSE_DIR}" \
    && docker compose \
      -f docker-compose.yml \
      -f docker-compose.override.yml \
      -f fcaptcha.yml \
      --profile "${COMPOSE_PROFILE}" \
      "$@" )
}

restart_faucet() {
  log "recreating faucet container…"
  compose up -d faucet >/dev/null
}

wait_for_health() {
  if [[ -z "${HEALTH_URL}" ]]; then
    log "FAUCET_HEALTH_URL not set; skipping post-restart health probe"
    return 0
  fi
  log "polling ${HEALTH_URL} for up to 60s…"
  local deadline=$(( $(date +%s) + 60 ))
  while (( $(date +%s) < deadline )); do
    if curl -fsS -o /dev/null --max-time 5 "${HEALTH_URL}"; then
      log "faucet is healthy"
      return 0
    fi
    sleep 2
  done
  err "faucet did not report healthy within 60s"
  return 1
}

confirm() {
  # confirm "<prompt>" — reads y/N from /dev/tty. Defaults to N.
  local prompt="$1" reply
  printf "%s [y/N] " "${prompt}" > /dev/tty
  read -r reply < /dev/tty || reply=""
  case "${reply}" in
    [Yy]|[Yy][Ee][Ss]) return 0 ;;
    *) return 1 ;;
  esac
}

# ────────────────────────────────────────────────────────────────────────────
# Pre-flight
# ────────────────────────────────────────────────────────────────────────────

mode="simple"
case "${1:-}" in
  ""|--simple)       mode="simple" ;;
  --with-wallet)     mode="with-wallet" ;;
  -h|--help|help)    usage; exit 0 ;;
  *) err "unknown flag: $1"; usage >&2; exit 2 ;;
esac

if [[ ! -f "${ENV_FILE}" ]]; then
  err "${ENV_FILE} not found — are you running from the repo root on the deploy host?"
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  err "openssl not on PATH; install it first"
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  err "docker not on PATH"
  exit 1
fi

log "mode: ${mode}; .env: ${ENV_FILE}"

# Snapshot the current .env. .env permissions are preserved.
backup="${ENV_FILE}.backup-$(date -u +%Y%m%dT%H%M%SZ)"
cp -a "${ENV_FILE}" "${backup}"
chmod 600 "${backup}"
log "backed up .env → ${backup}"

# ────────────────────────────────────────────────────────────────────────────
# Generate fresh simple-rotation values
# ────────────────────────────────────────────────────────────────────────────

new_admin_password="$(rand_password)"
new_hashcash_secret="$(rand_hex32)"
new_key_passphrase="$(rand_password)"
new_wallet_passphrase="$(rand_password)"

tty_print ""
tty_print "==[ NEW SECRETS — save these in your password manager NOW ]=="
tty_print "FAUCET_ADMIN_PASSWORD     = ${new_admin_password}"
tty_print "FAUCET_HASHCASH_SECRET    = ${new_hashcash_secret}"
tty_print "FAUCET_KEY_PASSPHRASE     = ${new_key_passphrase}"
tty_print "FAUCET_WALLET_PASSPHRASE  = ${new_wallet_passphrase}"
tty_print ""

if ! confirm "Saved them? Continue and rewrite .env?"; then
  err "aborted before writing .env; backup left at ${backup}"
  exit 1
fi

write_env_value "FAUCET_ADMIN_PASSWORD"    "${new_admin_password}"
write_env_value "FAUCET_HASHCASH_SECRET"   "${new_hashcash_secret}"
write_env_value "FAUCET_KEY_PASSPHRASE"    "${new_key_passphrase}"
write_env_value "FAUCET_WALLET_PASSPHRASE" "${new_wallet_passphrase}"
log ".env updated (4 simple values)"

# ────────────────────────────────────────────────────────────────────────────
# --with-wallet path
# ────────────────────────────────────────────────────────────────────────────

if [[ "${mode}" == "with-wallet" ]]; then
  log "wallet rotation requested; generating fresh keypair…"
  if [[ ! -f "${HELPER}" ]]; then
    err "helper missing: ${HELPER}"
    exit 1
  fi

  # The helper emits two `KEY=VALUE` lines on stdout. We capture into shell
  # vars without ever putting the private key in a file or argv.
  pushd "${REPO_ROOT}" >/dev/null
  helper_out="$(pnpm exec tsx "${HELPER}" generate)"
  popd >/dev/null

  new_wallet_address="$(printf "%s" "${helper_out}" | awk -F= '$1=="NEW_FAUCET_WALLET_ADDRESS"{ sub(/^[^=]+=/,""); print }')"
  new_private_key="$(printf "%s" "${helper_out}" | awk -F= '$1=="NEW_FAUCET_PRIVATE_KEY"{ sub(/^[^=]+=/,""); print }')"
  if [[ -z "${new_wallet_address}" || -z "${new_private_key}" ]]; then
    err "helper did not emit a valid keypair"
    exit 1
  fi

  tty_print ""
  tty_print "==[ NEW WALLET — record BOTH lines in your password manager ]=="
  tty_print "FAUCET_WALLET_ADDRESS = ${new_wallet_address}"
  tty_print "FAUCET_PRIVATE_KEY    = ${new_private_key}"
  tty_print ""
  if ! confirm "Saved them? Continue with the on-chain balance sweep?"; then
    err "aborted before sweep; .env reverted to keep the OLD wallet active"
    cp -a "${backup}" "${ENV_FILE}"
    exit 1
  fi

  old_wallet_address="$(read_env_value "FAUCET_WALLET_ADDRESS")"
  rpc_url="$(read_env_value "FAUCET_RPC_URL")"
  rpc_user="$(read_env_value "FAUCET_RPC_USERNAME" || true)"
  rpc_pass="$(read_env_value "FAUCET_RPC_PASSWORD" || true)"
  if [[ -z "${old_wallet_address}" || -z "${rpc_url}" ]]; then
    err "FAUCET_WALLET_ADDRESS or FAUCET_RPC_URL missing in .env"
    exit 1
  fi

  log "sweeping balance from ${old_wallet_address} → ${new_wallet_address} via ${rpc_url}"
  pushd "${REPO_ROOT}" >/dev/null
  FAUCET_RPC_URL="${rpc_url}" \
  FAUCET_RPC_USERNAME="${rpc_user}" \
  FAUCET_RPC_PASSWORD="${rpc_pass}" \
  OLD_FAUCET_WALLET_ADDRESS="${old_wallet_address}" \
  NEW_FAUCET_WALLET_ADDRESS="${new_wallet_address}" \
    pnpm exec tsx "${HELPER}" sweep
  popd >/dev/null

  write_env_value "FAUCET_WALLET_ADDRESS" "${new_wallet_address}"
  write_env_value "FAUCET_PRIVATE_KEY"    "${new_private_key}"
  log ".env updated (wallet keypair)"
fi

# ────────────────────────────────────────────────────────────────────────────
# Restart and verify
# ────────────────────────────────────────────────────────────────────────────

restart_faucet
wait_for_health

log "done. backup retained at ${backup}; delete it once you've confirmed the new credentials work."
