#!/usr/bin/env bash
set -euo pipefail

stack_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${ENV_FILE:-$stack_dir/.env}"

force=false

usage() {
  cat <<'EOF'
Usage: ./scripts/regen-service-jwt.sh [--force] [--env <path>]

Regenerates SANDBOXED_JWT in the .env file from SANDBOXED_JWT_SECRET.
This fixes 401s caused by an expired/mismatched service token without rotating the secret.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) force=true; shift ;;
    --env) env_file="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ ! -f "$env_file" ]]; then
  echo "Missing env file: $env_file" >&2
  exit 1
fi

secret="$(grep -E '^SANDBOXED_JWT_SECRET=' "$env_file" | head -n1 | cut -d= -f2- || true)"
token="$(grep -E '^SANDBOXED_JWT=' "$env_file" | head -n1 | cut -d= -f2- || true)"

if [[ -z "${secret//[[:space:]]/}" ]]; then
  echo "SANDBOXED_JWT_SECRET is missing/empty in $env_file" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to generate/verify SANDBOXED_JWT" >&2
  exit 1
fi

should_regen="$force"
if [[ "$should_regen" != "true" && -n "${token//[[:space:]]/}" ]]; then
  if node - "$secret" "$token" <<'NODE' >/dev/null 2>&1; then
const crypto = require('node:crypto');
const secret = process.argv[2];
const token = process.argv[3];
const parts = token.split('.');
if (parts.length !== 3) process.exit(1);
const [h, p, sig] = parts;
const unsigned = `${h}.${p}`;
const expected = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
if (expected !== sig) process.exit(1);
const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
const now = Math.floor(Date.now() / 1000);
if (typeof payload.exp !== 'number' || payload.exp < now + 3600) process.exit(1);
process.exit(0);
NODE
  then
    should_regen=false
  else
    should_regen=true
  fi
fi

if [[ "$should_regen" != "true" ]]; then
  echo "SANDBOXED_JWT is already valid (use --force to rotate anyway)."
  exit 0
fi

new_token="$(node - "$secret" <<'NODE'
const crypto = require('node:crypto');
const secret = process.argv[2];
const now = Math.floor(Date.now() / 1000);
const exp = now + 30 * 24 * 60 * 60;
const header = { alg: 'HS256', typ: 'JWT' };
const payload = { sub: 'default', usr: 'default', iat: now, exp };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const unsigned = `${encode(header)}.${encode(payload)}`;
const sig = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
process.stdout.write(`${unsigned}.${sig}`);
NODE
)"

if grep -qE '^SANDBOXED_JWT=' "$env_file"; then
  # macOS/BSD sed compat not required inside the server container, but keep it simple anyway.
  tmp="$(mktemp)"
  awk -v tok="$new_token" 'BEGIN{done=0} { if ($0 ~ /^SANDBOXED_JWT=/ && done==0) { print "SANDBOXED_JWT=" tok; done=1 } else { print $0 } } END{ if (done==0) print "SANDBOXED_JWT=" tok }' "$env_file" > "$tmp"
  mv "$tmp" "$env_file"
else
  printf "\nSANDBOXED_JWT=%s\n" "$new_token" >> "$env_file"
fi

echo "Updated SANDBOXED_JWT in $env_file"

